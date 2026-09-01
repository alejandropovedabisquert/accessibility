import { chromium, firefox, webkit, type Browser } from 'playwright';
import config from '../../config/config';
import type { ScanBrowser } from '../../types/audit.types';

const LAUNCHERS = { chromium, firefox, webkit } as const;

interface Entry {
  browser: Browser;
  leases: number;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Mantiene vivo un navegador por motor y lo reutiliza entre escaneos.
 *
 * El codigo anterior lanzaba y cerraba un navegador por cada URL, que es la parte
 * mas cara del escaneo (~1-2s cada arranque). Aqui cada escaneo solo abre un
 * BrowserContext nuevo, que es barato y sigue aislando cookies y almacenamiento.
 * Tras `browserIdleTimeoutMs` sin trabajo el navegador se cierra para no dejar
 * procesos colgados en una maquina de desarrollo.
 */
class BrowserPool {
  private readonly entries = new Map<ScanBrowser, Entry>();
  private readonly launching = new Map<ScanBrowser, Promise<Browser>>();
  private closed = false;

  public async acquire(name: ScanBrowser): Promise<Browser> {
    if (this.closed) throw new Error('El pool de navegadores esta cerrado');

    const existing = this.entries.get(name);
    if (existing && existing.browser.isConnected()) {
      this.cancelIdleTimer(existing);
      existing.leases++;
      return existing.browser;
    }

    // Varios escaneos pueden pedir el mismo motor a la vez: compartimos el arranque.
    let pending = this.launching.get(name);
    if (!pending) {
      pending = this.launch(name);
      this.launching.set(name, pending);
    }

    try {
      const browser = await pending;
      const entry = this.entries.get(name);
      if (entry) {
        this.cancelIdleTimer(entry);
        entry.leases++;
      }
      return browser;
    } finally {
      this.launching.delete(name);
    }
  }

  public release(name: ScanBrowser): void {
    const entry = this.entries.get(name);
    if (!entry) return;

    entry.leases = Math.max(0, entry.leases - 1);
    if (entry.leases > 0 || this.closed) return;

    entry.idleTimer = setTimeout(() => {
      const current = this.entries.get(name);
      if (!current || current.leases > 0) return;
      this.entries.delete(name);
      void current.browser.close().catch(() => undefined);
    }, config.browserIdleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  public async closeAll(): Promise<void> {
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map((entry) => {
        this.cancelIdleTimer(entry);
        return entry.browser.close().catch(() => undefined);
      })
    );
  }

  public getStats() {
    return [...this.entries.entries()].map(([name, entry]) => ({
      browser: name,
      connected: entry.browser.isConnected(),
      leases: entry.leases,
    }));
  }

  private async launch(name: ScanBrowser): Promise<Browser> {
    const browser = await LAUNCHERS[name].launch({ headless: true });
    // Si el navegador muere solo (crash, OOM), lo sacamos del pool para que el
    // siguiente acquire arranque uno nuevo en vez de devolver uno muerto.
    browser.on('disconnected', () => {
      const entry = this.entries.get(name);
      if (entry?.browser === browser) {
        this.cancelIdleTimer(entry);
        this.entries.delete(name);
      }
    });
    this.entries.set(name, { browser, leases: 0, idleTimer: null });
    return browser;
  }

  private cancelIdleTimer(entry: Entry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }
}

export default new BrowserPool();
