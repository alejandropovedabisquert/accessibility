import type { Page } from 'playwright';
import { catalog } from '../review/catalog';
import { toMessage } from '../../utils/errors';
import { installProbes, type FocusStepResult, type ProbeApi, type ProbeHost, type ProbeOptions } from './probes';
import type {
  CollectedEvidenceKind,
  EvidenceData,
  FocusStop,
  FocusSequenceEvidence,
  LayoutEvidence,
  PageEvidence,
  ScanBrowser,
  ScanScope,
  Viewport,
} from '../../types/audit.types';

/** Limites para que una pagina enorme no genere cientos de MB de evidencia. */
export const EVIDENCE_LIMITS = {
  maxItems: 200,
  maxTextLength: 20_000,
  maxFocusStops: 80,
  /** Pulsaciones de tabulador en total, contando las que se quedan dentro de un iframe. */
  maxTabPresses: 200,
  maxImageShots: 40,
  maxFullPageHeight: 8_000,
} as const;

/** 1280 × 1024 al 400 % (lo que pide 1.4.10). */
const REFLOW_VIEWPORT: Viewport = { width: 320, height: 256 };
const JPEG = { type: 'jpeg', quality: 70 } as const;

export interface EvidenceFile {
  name: string;
  data: Buffer;
}

export interface EvidenceBundle {
  evidence: PageEvidence;
  files: EvidenceFile[];
}

export interface EvidenceJob {
  page: Page;
  browser: ScanBrowser;
  scope: ScanScope;
}

/**
 * `installProbes` se manda como texto con un `__name` vacio delante: tsx y
 * vitest compilan con esbuild y meten llamadas a ese helper dentro de las
 * funciones con nombre, y en el navegador no existe.
 */
const installScript = (options: ProbeOptions): string =>
  `(() => { const __name = (fn) => fn; (${installProbes.toString()})(${JSON.stringify(options)}); })()`;

/**
 * Llama a un metodo de los probes ya instalados. Por nombre y no pasando una
 * funcion: evaluar codigo construido dentro de la pagina (new Function) lo
 * bloquea el CSP de muchas webs, y `page.evaluate` no.
 */
const probe = <K extends keyof ProbeApi>(
  page: Page,
  method: K,
  ...args: Parameters<ProbeApi[K]>
): Promise<ReturnType<ProbeApi[K]>> =>
  page.evaluate(
    ({ name, params }) => {
      const api = (globalThis as unknown as ProbeHost).__a11yEvidence;
      return (api[name] as (...values: unknown[]) => unknown)(...params);
    },
    { name: method, params: args as unknown[] },
  ) as Promise<ReturnType<ProbeApi[K]>>;

/**
 * Recoge la evidencia de una pagina ya cargada (la misma en la que acaba de
 * correr axe). Cada recolector va por separado: si uno falla se anota en
 * `errors` y los demas siguen. Nunca lanza.
 *
 * El orden importa: primero lo que solo lee, luego el foco (mueve el scroll)
 * y al final lo que cambia el viewport o los estilos, que se restauran.
 */
class EvidenceService {
  public async collect(job: EvidenceJob): Promise<EvidenceBundle> {
    const { page } = job;
    const items: Partial<EvidenceData> = {};
    const errors: Partial<Record<CollectedEvidenceKind, string>> = {};
    const files: EvidenceFile[] = [];
    const original = page.viewportSize();
    let applicability: Record<string, number> = {};

    const step = async <K extends CollectedEvidenceKind>(kind: K, run: () => Promise<EvidenceData[K]>) => {
      try {
        items[kind] = await run();
      } catch (error) {
        errors[kind] = toMessage(error).split('\n')[0] ?? 'Error desconocido';
      }
    };

    try {
      await page.evaluate(
        installScript({
          scope: job.scope,
          maxItems: EVIDENCE_LIMITS.maxItems,
          maxTextLength: EVIDENCE_LIMITS.maxTextLength,
        }),
      );
    } catch (error) {
      // Sin probes no hay nada que recoger; se devuelve el error en todos los tipos.
      const message = `No se pudo preparar la página: ${toMessage(error).split('\n')[0]}`;
      return {
        evidence: this.emptyEvidence(job, original, message),
        files,
      };
    }

    try {
      const entries = catalog.checks.flatMap((check) =>
        check.appliesWhen ? [{ id: check.id, selector: check.appliesWhen }] : [],
      );
      applicability = await probe(page, 'applicability', entries);
    } catch {
      applicability = {};
    }

    await step('text-content', () => probe(page, 'textContent'));
    await step('headings', async () => ({ items: await probe(page, 'headings') }));
    await step('landmarks', async () => ({
      items: await probe(page, 'landmarks'),
      ariaSnapshot: await page.locator(job.scope.include ?? 'body').first().ariaSnapshot(),
    }));
    await step('forms', () => probe(page, 'forms'));
    await step('controls', () => probe(page, 'controls'));
    await step('media', () => probe(page, 'media'));
    await step('screenshot', () => this.screenshots(page, files));
    await step('images', () => this.images(page, files));
    await step('focus-sequence', () => this.focusSequence(page, files));
    await step('text-spacing', () => this.textSpacing(page, files, original));

    // A partir de aqui se cambia el viewport; se restaura siempre al final.
    try {
      await step('reflow-320', () => this.layoutAt(page, files, REFLOW_VIEWPORT, 'reflow-320'));
      if (original) {
        await step('zoom-200', () =>
          this.layoutAt(
            page,
            files,
            // El zoom del navegador al 200 % deja la mitad de pixeles CSS de ancho y alto.
            { width: Math.round(original.width / 2), height: Math.round(original.height / 2) },
            'zoom-200',
          ),
        );
        await step('orientation', () => this.orientation(page, files, original));
      }
    } finally {
      if (original) await page.setViewportSize(original).catch(() => undefined);
    }

    return {
      evidence: {
        collectedAt: new Date().toISOString(),
        browser: job.browser,
        viewport: original,
        scope: job.scope,
        items,
        errors,
        applicability,
      },
      files,
    };
  }

  private emptyEvidence(job: EvidenceJob, viewport: Viewport | null, message: string): PageEvidence {
    return {
      collectedAt: new Date().toISOString(),
      browser: job.browser,
      viewport,
      scope: job.scope,
      items: {},
      errors: { screenshot: message },
      applicability: {},
    };
  }

  private async fullPageShot(page: Page): Promise<{ data: Buffer; truncated: boolean }> {
    const height = await probe(page, 'scrollHeight');
    const width = page.viewportSize()?.width ?? 1280;
    const truncated = height > EVIDENCE_LIMITS.maxFullPageHeight;
    const data = await page.screenshot({
      ...JPEG,
      fullPage: true,
      ...(truncated ? { clip: { x: 0, y: 0, width, height: EVIDENCE_LIMITS.maxFullPageHeight } } : {}),
    });
    return { data, truncated };
  }

  private async screenshots(page: Page, files: EvidenceFile[]): Promise<EvidenceData['screenshot']> {
    await page.evaluate(() => (globalThis as unknown as { scrollTo(x: number, y: number): void }).scrollTo(0, 0));
    files.push({ name: 'viewport.jpg', data: await page.screenshot(JPEG) });
    const full = await this.fullPageShot(page);
    files.push({ name: 'full-page.jpg', data: full.data });
    return { viewport: 'viewport.jpg', fullPage: 'full-page.jpg', fullPageTruncated: full.truncated };
  }

  private async images(page: Page, files: EvidenceFile[]): Promise<EvidenceData['images']> {
    const found = await probe(page, 'images');
    const items: EvidenceData['images']['items'] = [];

    for (const [index, image] of found.items.entries()) {
      let screenshot: string | null = null;
      // Sin captura las que son diminutas (pixeles de seguimiento) o pasan del cupo.
      const bigEnough = (image.box?.width ?? 0) >= 8 && (image.box?.height ?? 0) >= 8;
      if (bigEnough && index < EVIDENCE_LIMITS.maxImageShots) {
        try {
          const name = `image-${index}.jpg`;
          files.push({ name, data: await page.locator(image.selector).first().screenshot({ ...JPEG, timeout: 3_000 }) });
          screenshot = name;
        } catch {
          screenshot = null;
        }
      }
      items.push({ ...image, screenshot });
    }
    return { items, total: found.total };
  }

  private async focusSequence(page: Page, files: EvidenceFile[]): Promise<FocusSequenceEvidence> {
    await probe(page, 'prepareFocus');

    const stops: FocusStop[] = [];
    let stoppedBecause: FocusSequenceEvidence['stoppedBecause'] = 'limit';
    let repeats = 0;
    let revisits = 0;

    for (let press = 0; press < EVIDENCE_LIMITS.maxTabPresses; press++) {
      await page.keyboard.press('Tab');
      const result: FocusStepResult = await probe(page, 'focusStep');

      if (result.kind === 'none') {
        // Salio del documento (a la barra del navegador): se ha recorrido entero.
        stoppedBecause = stops.length > 0 ? 'cycle' : 'no-focusable';
        break;
      }
      if (!result.isNew) {
        if (result.index === 0) {
          stoppedBecause = 'cycle';
          break;
        }
        if (result.sameAsPrevious) {
          // Dentro de un iframe el foco va por sus elementos y el activo sigue siendo el iframe.
          repeats++;
          if (repeats >= (result.isFrame ? 50 : 3)) {
            stoppedBecause = 'stuck';
            break;
          }
        } else if (++revisits > 10) {
          // Da vueltas por un subconjunto sin volver al principio: trampa o modal que retiene el foco.
          stoppedBecause = 'stuck';
          break;
        }
        continue;
      }

      repeats = 0;
      let screenshot: string | null = null;
      if (result.clip) {
        try {
          const name = `focus-${result.index}.jpg`;
          files.push({ name, data: await page.screenshot({ ...JPEG, clip: result.clip }) });
          screenshot = name;
        } catch {
          screenshot = null;
        }
      }
      stops.push({
        ...result.element,
        index: result.index,
        indicator: result.indicator,
        indicatorProperties: result.indicatorProperties,
        obscured: result.obscured,
        screenshot,
      });
      if (stops.length >= EVIDENCE_LIMITS.maxFocusStops) {
        stoppedBecause = 'limit';
        break;
      }
    }

    await page.evaluate(() => {
      const active = (globalThis as unknown as { document: { activeElement: { blur?(): void } | null } }).document
        .activeElement;
      active?.blur?.();
    });
    return { stops, stoppedBecause };
  }

  private async layoutAt(page: Page, files: EvidenceFile[], viewport: Viewport, name: string): Promise<LayoutEvidence> {
    await page.setViewportSize(viewport);
    // Deja que se apliquen las media queries y se recoloque todo.
    await page.waitForTimeout(250);
    const layout = await probe(page, 'layout');
    const shot = await this.fullPageShot(page);
    files.push({ name: `${name}.jpg`, data: shot.data });
    return { viewport, ...layout, screenshot: `${name}.jpg` };
  }

  private async textSpacing(page: Page, files: EvidenceFile[], viewport: Viewport | null): Promise<LayoutEvidence> {
    await probe(page, 'setTextSpacing', true);
    try {
      await page.waitForTimeout(100);
      const layout = await probe(page, 'layout');
      const shot = await this.fullPageShot(page);
      files.push({ name: 'text-spacing.jpg', data: shot.data });
      return { viewport: viewport ?? REFLOW_VIEWPORT, ...layout, screenshot: 'text-spacing.jpg' };
    } finally {
      await probe(page, 'setTextSpacing', false);
    }
  }

  private async orientation(page: Page, files: EvidenceFile[], original: Viewport): Promise<EvidenceData['orientation']> {
    const portrait = original.height >= original.width ? original : { width: original.height, height: original.width };
    const landscape = { width: portrait.height, height: portrait.width };

    const shoot = async (viewport: Viewport, name: string) => {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      const { horizontalScroll } = await probe(page, 'layout');
      await page.evaluate(() => (globalThis as unknown as { scrollTo(x: number, y: number): void }).scrollTo(0, 0));
      files.push({ name, data: await page.screenshot(JPEG) });
      return { viewport, horizontalScroll, screenshot: name };
    };

    return {
      portrait: await shoot(portrait, 'orientation-portrait.jpg'),
      landscape: await shoot(landscape, 'orientation-landscape.jpg'),
    };
  }
}

export default new EvidenceService();
