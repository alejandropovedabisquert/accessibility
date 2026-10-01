import { randomUUID } from 'crypto';
import { devices } from 'playwright';
import config from '../../config/config';
import repository from '../../db/audit.repository';
import scanService, { DEFAULT_TAGS } from '../scanner/scan.service';
import rawStore from '../storage/rawStore';
import { aggregateCompliance, summarize } from './summary';
import { hostOf, normalizeUrl } from '../../utils/url';
import { AppError, badRequest, notFound, toMessage } from '../../utils/errors';
import type {
  Audit,
  AuditConfig,
  AuditPage,
  AuditWithPages,
  CreateAuditInput,
  HistoryPoint,
  ListAuditsQuery,
  PageDiff,
  PageIssue,
  Paginated,
  ScanScreen,
  ScanTarget,
  Viewport,
} from '../../types/audit.types';
import { DEFAULT_VIEWPORT } from '../../types/audit.types';

type PlannedPage = ScanTarget & ScanScreen;

class AuditService {
  /** Auditorias que este proceso esta ejecutando ahora mismo. */
  private readonly running = new Map<string, Promise<void>>();

  /** Crea la auditoria, la deja encolada y devuelve sin esperar a que termine. */
  public create(input: CreateAuditInput): Audit {
    const auditConfig = this.resolveConfig(input);
    const pages = this.planPages(this.resolveTargets(input.urls), auditConfig);
    const id = randomUUID();

    repository.createAudit({
      id,
      label: input.label?.trim() || null,
      createdAt: new Date().toISOString(),
      config: auditConfig,
      urls: pages.map((page) => ({ ...page, id: randomUUID(), host: hostOf(page.url) })),
    });

    const audit = repository.findAudit(id);
    if (!audit) throw new AppError('No se pudo crear la auditoria');

    const job = this.run(id, auditConfig).finally(() => this.running.delete(id));
    this.running.set(id, job);

    return audit;
  }

  public list(query: ListAuditsQuery): Paginated<Audit> {
    return repository.list(query);
  }

  public get(id: string): AuditWithPages {
    const audit = repository.findAuditWithPages(id);
    if (!audit) throw notFound('Auditoria no encontrada');
    return audit;
  }

  public getPageDetail(auditId: string, pageId: string) {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    return { page, issues: repository.findIssues(pageId) };
  }

  public async getPageResults(auditId: string, pageId: string) {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');

    const results = await rawStore.readRaw(auditId, pageId);
    if (!results) throw notFound('No hay resultado guardado para esta pagina');
    return { page, results };
  }

  /** Compara una pagina con el escaneo completado anterior de la misma URL, seccion y pantalla. */
  public getPageDiff(auditId: string, pageId: string): PageDiff {
    const page = repository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');

    const audit = repository.findAudit(auditId);
    const previous = audit
      ? repository.findPreviousPage(
          { url: page.url, include: page.include, viewport: page.viewport, device: page.device },
          audit.createdAt,
        )
      : null;

    if (!previous) {
      return { previous: null, added: [], resolved: [], changed: [], unchanged: 0 };
    }

    const current = repository.findIssues(pageId);
    const before = repository.findIssues(previous.id);
    const beforeByRule = new Map(before.map((issue) => [issue.ruleId, issue]));
    const currentRules = new Set(current.map((issue) => issue.ruleId));

    const added: PageIssue[] = [];
    const changed: Array<PageIssue & { previousNodeCount: number }> = [];
    let unchanged = 0;

    for (const issue of current) {
      const old = beforeByRule.get(issue.ruleId);
      if (!old) added.push(issue);
      else if (old.nodeCount !== issue.nodeCount) changed.push({ ...issue, previousNodeCount: old.nodeCount });
      else unchanged++;
    }

    return {
      previous: { auditId: previous.auditId, pageId: previous.id, finishedAt: previous.finishedAt },
      added,
      resolved: before.filter((issue) => !currentRules.has(issue.ruleId)),
      changed,
      unchanged,
    };
  }

  /** Sin `screen` devuelve todas las pantallas mezcladas, como antes de los viewports multiples. */
  public history(
    url: string,
    include: string | null = null,
    screen?: ScanScreen,
    limit = 30,
  ): HistoryPoint[] {
    return repository.history(normalizeUrl(url), include, screen, Math.min(Math.max(limit, 1), 200));
  }

  public scannedUrls() {
    return repository.scannedUrls();
  }

  public async remove(id: string): Promise<void> {
    const audit = repository.findAudit(id);
    if (!audit) throw notFound('Auditoria no encontrada');
    if (this.running.has(id)) throw new AppError('No se puede borrar una auditoria en ejecucion', 409);

    repository.deleteAudit(id);
    await rawStore.removeAudit(id);
  }

  /** Relanza una auditoria existente con exactamente la misma configuracion. */
  public rerun(id: string): Audit {
    const previous = repository.findAuditWithPages(id);
    if (!previous) throw notFound('Auditoria no encontrada');

    // Las paginas son URL x seccion x viewport: se deduplican aqui y create()
    // las vuelve a multiplicar por los viewports de la configuracion.
    return this.create({
      urls: previous.pages.map((page) => ({
        url: page.url,
        include: page.include ?? undefined,
        exclude: page.exclude ?? undefined,
      })),
      label: previous.label ?? undefined,
      browser: previous.config.browser,
      device: previous.config.device ?? undefined,
      viewports: previous.config.device ? undefined : previous.config.viewports,
      waitUntil: previous.config.waitUntil,
      timeout: previous.config.timeoutMs,
      tags: previous.config.tags,
      evidence: previous.config.evidence,
    });
  }

  /**
   * Rellena el desglose legal / mejoras de las paginas escaneadas antes de que
   * existiera, a partir de su JSON crudo. Se lanza al arrancar, en segundo
   * plano. Una pagina sin JSON en disco se queda sin desglose ("n/d").
   */
  public async backfillCompliance(): Promise<{ pages: number; audits: number }> {
    let pages = 0;
    for (const page of repository.findPagesWithoutCompliance()) {
      const results = await rawStore.readRaw(page.auditId, page.id);
      if (!results) continue;
      repository.setPageCompliance(page.id, summarize(results).compliance);
      pages++;
    }

    const audits = repository.findAuditIdsWithoutCompliance();
    for (const auditId of audits) this.refreshAuditCompliance(auditId);
    return { pages, audits: audits.length };
  }

  public stats() {
    return { ...repository.stats(), ...scanService.getStats(), running: this.running.size };
  }

  /** Espera a que terminen las auditorias en vuelo (usado en tests y al apagar). */
  public async drain(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  // ---------------------------------------------------------------- interno

  /**
   * Normaliza las entradas de `urls` y descarta duplicados.
   *
   * La clave del duplicado es URL + seccion: la misma URL puede aparecer varias
   * veces si cada vez se mira una parte distinta de la pagina.
   */
  private resolveTargets(rawTargets: CreateAuditInput['urls']): ScanTarget[] {
    const unique = new Map<string, ScanTarget>();

    for (const raw of rawTargets) {
      const entry = typeof raw === 'string' ? { url: raw } : raw;
      const target: ScanTarget = {
        url: normalizeUrl(entry.url),
        include: entry.include?.trim() || null,
        exclude: entry.exclude?.trim() || null,
      };
      unique.set(`${target.url}\n${target.include}\n${target.exclude}`, target);
    }

    if (unique.size === 0) throw badRequest('Hay que indicar al menos una URL');
    return [...unique.values()];
  }

  /**
   * Una pagina por cada objetivo y cada pantalla. El limite de la auditoria va
   * sobre el total de escaneos, que es lo que cuesta: 10 URLs en 3 viewports
   * son 30 escaneos.
   */
  private planPages(targets: ScanTarget[], auditConfig: AuditConfig): PlannedPage[] {
    const screens: ScanScreen[] = auditConfig.device
      ? [{ device: auditConfig.device, viewport: devices[auditConfig.device]?.viewport ?? null }]
      : auditConfig.viewports.map((viewport) => ({ device: null, viewport }));

    const pages = targets.flatMap((target) => screens.map((screen) => ({ ...target, ...screen })));
    if (pages.length > config.maxUrlsPerAudit) {
      throw badRequest(
        screens.length > 1
          ? `Maximo ${config.maxUrlsPerAudit} escaneos por auditoria: ${targets.length} URL(s) en ${screens.length} resoluciones son ${pages.length}`
          : `Maximo ${config.maxUrlsPerAudit} URLs por auditoria`,
      );
    }
    return pages;
  }

  /** `viewport` suelto equivale a una lista de uno; sin nada, la resolucion por defecto. */
  private resolveViewports(input: CreateAuditInput): Viewport[] {
    if (input.device) return [];
    const requested = input.viewports ?? (input.viewport ? [input.viewport] : [DEFAULT_VIEWPORT]);
    const unique = new Map(requested.map((viewport) => [`${viewport.width}x${viewport.height}`, viewport]));
    return [...unique.values()];
  }

  private resolveConfig(input: CreateAuditInput): AuditConfig {
    const viewports = this.resolveViewports(input);
    return {
      browser: input.browser ?? 'chromium',
      device: input.device ?? null,
      // Se conserva como antes: null si no se pidio ninguna resolucion.
      viewport: input.device ? null : (input.viewports?.[0] ?? input.viewport ?? null),
      viewports,
      waitUntil: input.waitUntil ?? 'load',
      timeoutMs: input.timeout ?? config.defaultTimeoutMs,
      tags: input.tags && input.tags.length > 0 ? input.tags : DEFAULT_TAGS,
      evidence: input.evidence ?? false,
    };
  }

  private async run(auditId: string, auditConfig: AuditConfig): Promise<void> {
    try {
      repository.markAuditRunning(auditId, new Date().toISOString());
      const pages = repository.findPages(auditId);

      // Las paginas se encolan todas a la vez; la concurrencia real la limita
      // la cola de scanService, no este bucle.
      await Promise.all(pages.map((page) => this.runPage(auditId, page, auditConfig)));

      repository.finalizeAudit(auditId, new Date().toISOString());
      this.refreshAuditCompliance(auditId);
    } catch (error) {
      repository.failAudit(auditId, new Date().toISOString(), toMessage(error));
    }
  }

  private refreshAuditCompliance(auditId: string): void {
    const pages = repository.findPages(auditId).filter((page) => page.status === 'completed');
    repository.setAuditCompliance(auditId, aggregateCompliance(pages.map((page) => page.compliance)));
  }

  private async runPage(auditId: string, page: AuditPage, auditConfig: AuditConfig): Promise<void> {
    const pageId = page.id;
    const startedAt = Date.now();
    repository.markPageRunning(pageId, new Date().toISOString());

    try {
      const { results, evidence } = await scanService.enqueue({
        url: page.url,
        scope: { include: page.include, exclude: page.exclude },
        viewport: page.viewport,
        config: auditConfig,
      });
      const { counters, score, compliance, issues } = summarize(results);

      await rawStore.saveRaw(auditId, pageId, results);
      if (evidence) await rawStore.saveEvidence(auditId, pageId, evidence.evidence, evidence.files);
      repository.completePage({
        id: pageId,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        score,
        compliance,
        counters,
        issues,
      });
    } catch (error) {
      // Una URL caida no debe tumbar el resto de la auditoria.
      repository.failPage({
        id: pageId,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: toMessage(error),
      });
    }
  }
}

export default new AuditService();
