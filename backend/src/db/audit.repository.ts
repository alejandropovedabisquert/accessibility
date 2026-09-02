import { getDb } from './client';
import type {
  Audit,
  AuditConfig,
  AuditPage,
  AuditStatus,
  AuditWithPages,
  Counters,
  HistoryPoint,
  Impact,
  ListAuditsQuery,
  PageIssue,
  PageStatus,
  Paginated,
  ScanBrowser,
  ScanTarget,
  ScanWaitUntil,
} from '../types/audit.types';

interface AuditRow {
  id: string;
  label: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  browser: string;
  device: string | null;
  viewport_width: number | null;
  viewport_height: number | null;
  wait_until: string;
  timeout_ms: number;
  tags: string;
  total_pages: number;
  completed_pages: number;
  failed_pages: number;
  violations: number;
  violation_nodes: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  passes: number;
  incomplete: number;
  inapplicable: number;
  score: number | null;
  error: string | null;
}

interface PageRow {
  id: string;
  audit_id: string;
  url: string;
  host: string;
  include_selector: string | null;
  exclude_selector: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  violations: number;
  violation_nodes: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  passes: number;
  incomplete: number;
  inapplicable: number;
  score: number | null;
  error: string | null;
}

interface IssueRow {
  rule_id: string;
  impact: string | null;
  node_count: number;
  help: string;
  help_url: string;
  description: string;
}

const counters = (row: Counters): Counters => ({
  violations: row.violations,
  violationNodes: row.violationNodes,
  critical: row.critical,
  serious: row.serious,
  moderate: row.moderate,
  minor: row.minor,
  passes: row.passes,
  incomplete: row.incomplete,
  inapplicable: row.inapplicable,
});

const rowCounters = (row: AuditRow | PageRow): Counters => ({
  violations: row.violations,
  violationNodes: row.violation_nodes,
  critical: row.critical,
  serious: row.serious,
  moderate: row.moderate,
  minor: row.minor,
  passes: row.passes,
  incomplete: row.incomplete,
  inapplicable: row.inapplicable,
});

const toAudit = (row: AuditRow): Audit => ({
  id: row.id,
  label: row.label,
  status: row.status as AuditStatus,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  config: {
    browser: row.browser as ScanBrowser,
    device: row.device,
    viewport:
      row.viewport_width !== null && row.viewport_height !== null
        ? { width: row.viewport_width, height: row.viewport_height }
        : null,
    waitUntil: row.wait_until as ScanWaitUntil,
    timeoutMs: row.timeout_ms,
    tags: JSON.parse(row.tags) as string[],
  },
  totalPages: row.total_pages,
  completedPages: row.completed_pages,
  failedPages: row.failed_pages,
  score: row.score,
  error: row.error,
  ...rowCounters(row),
});

const toPage = (row: PageRow): AuditPage => ({
  id: row.id,
  auditId: row.audit_id,
  url: row.url,
  host: row.host,
  include: row.include_selector,
  exclude: row.exclude_selector,
  status: row.status as PageStatus,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  durationMs: row.duration_ms,
  score: row.score,
  error: row.error,
  ...rowCounters(row),
});

const toIssue = (row: IssueRow): PageIssue => ({
  ruleId: row.rule_id,
  impact: row.impact as Impact | null,
  nodeCount: row.node_count,
  help: row.help,
  helpUrl: row.help_url,
  description: row.description,
});

class AuditRepository {
  createAudit(audit: {
    id: string;
    label: string | null;
    createdAt: string;
    config: AuditConfig;
    urls: Array<ScanTarget & { id: string; host: string }>;
  }): void {
    const db = getDb();
    const insertAudit = db.prepare(`
      INSERT INTO audits (id, label, status, created_at, browser, device, viewport_width,
                          viewport_height, wait_until, timeout_ms, tags, total_pages)
      VALUES (@id, @label, 'queued', @createdAt, @browser, @device, @viewportWidth,
              @viewportHeight, @waitUntil, @timeoutMs, @tags, @totalPages)
    `);
    const insertPage = db.prepare(`
      INSERT INTO audit_pages (id, audit_id, position, url, host, include_selector,
                               exclude_selector, status)
      VALUES (@id, @auditId, @position, @url, @host, @include, @exclude, 'pending')
    `);

    db.transaction(() => {
      insertAudit.run({
        id: audit.id,
        label: audit.label,
        createdAt: audit.createdAt,
        browser: audit.config.browser,
        device: audit.config.device,
        viewportWidth: audit.config.viewport?.width ?? null,
        viewportHeight: audit.config.viewport?.height ?? null,
        waitUntil: audit.config.waitUntil,
        timeoutMs: audit.config.timeoutMs,
        tags: JSON.stringify(audit.config.tags),
        totalPages: audit.urls.length,
      });

      audit.urls.forEach((page, position) => {
        insertPage.run({
          id: page.id,
          auditId: audit.id,
          position,
          url: page.url,
          host: page.host,
          include: page.include,
          exclude: page.exclude,
        });
      });
    })();
  }

  markAuditRunning(id: string, startedAt: string): void {
    getDb()
      .prepare(`UPDATE audits SET status = 'running', started_at = @startedAt WHERE id = @id`)
      .run({ id, startedAt });
  }

  markPageRunning(id: string, startedAt: string): void {
    getDb()
      .prepare(`UPDATE audit_pages SET status = 'running', started_at = @startedAt WHERE id = @id`)
      .run({ id, startedAt });
  }

  completePage(input: {
    id: string;
    finishedAt: string;
    durationMs: number;
    score: number;
    counters: Counters;
    issues: PageIssue[];
  }): void {
    const db = getDb();
    const update = db.prepare(`
      UPDATE audit_pages
      SET status = 'completed', finished_at = @finishedAt, duration_ms = @durationMs, score = @score,
          violations = @violations, violation_nodes = @violationNodes, critical = @critical,
          serious = @serious, moderate = @moderate, minor = @minor, passes = @passes,
          incomplete = @incomplete, inapplicable = @inapplicable, error = NULL
      WHERE id = @id
    `);
    const clearIssues = db.prepare('DELETE FROM page_issues WHERE page_id = @id');
    const insertIssue = db.prepare(`
      INSERT INTO page_issues (page_id, rule_id, impact, node_count, help, help_url, description)
      VALUES (@pageId, @ruleId, @impact, @nodeCount, @help, @helpUrl, @description)
    `);

    db.transaction(() => {
      update.run({
        id: input.id,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
        score: input.score,
        ...counters(input.counters),
      });
      clearIssues.run({ id: input.id });
      for (const issue of input.issues) {
        insertIssue.run({ pageId: input.id, ...issue });
      }
    })();
  }

  failPage(input: { id: string; finishedAt: string; durationMs: number; error: string }): void {
    getDb()
      .prepare(`
        UPDATE audit_pages
        SET status = 'failed', finished_at = @finishedAt, duration_ms = @durationMs, error = @error
        WHERE id = @id
      `)
      .run(input);
  }

  /** Recalcula los agregados de la auditoria a partir de sus paginas y la cierra. */
  finalizeAudit(id: string, finishedAt: string): void {
    getDb()
      .prepare(`
        UPDATE audits
        SET finished_at = @finishedAt,
            completed_pages = (SELECT COUNT(*) FROM audit_pages WHERE audit_id = @id AND status = 'completed'),
            failed_pages    = (SELECT COUNT(*) FROM audit_pages WHERE audit_id = @id AND status = 'failed'),
            violations      = (SELECT COALESCE(SUM(violations), 0)      FROM audit_pages WHERE audit_id = @id),
            violation_nodes = (SELECT COALESCE(SUM(violation_nodes), 0) FROM audit_pages WHERE audit_id = @id),
            critical        = (SELECT COALESCE(SUM(critical), 0)        FROM audit_pages WHERE audit_id = @id),
            serious         = (SELECT COALESCE(SUM(serious), 0)         FROM audit_pages WHERE audit_id = @id),
            moderate        = (SELECT COALESCE(SUM(moderate), 0)        FROM audit_pages WHERE audit_id = @id),
            minor           = (SELECT COALESCE(SUM(minor), 0)           FROM audit_pages WHERE audit_id = @id),
            passes          = (SELECT COALESCE(SUM(passes), 0)          FROM audit_pages WHERE audit_id = @id),
            incomplete      = (SELECT COALESCE(SUM(incomplete), 0)      FROM audit_pages WHERE audit_id = @id),
            inapplicable    = (SELECT COALESCE(SUM(inapplicable), 0)    FROM audit_pages WHERE audit_id = @id),
            score           = (SELECT ROUND(AVG(score), 1) FROM audit_pages WHERE audit_id = @id AND status = 'completed'),
            status          = CASE
              WHEN (SELECT COUNT(*) FROM audit_pages WHERE audit_id = @id AND status = 'completed') = 0
              THEN 'failed' ELSE 'completed' END
        WHERE id = @id
      `)
      .run({ id, finishedAt });
  }

  failAudit(id: string, finishedAt: string, error: string): void {
    getDb()
      .prepare(`UPDATE audits SET status = 'failed', finished_at = @finishedAt, error = @error WHERE id = @id`)
      .run({ id, finishedAt, error });
  }

  /** Cierra auditorias que quedaron a medias por un reinicio del proceso. */
  recoverInterrupted(at: string): number {
    const db = getDb();
    const message = 'Interrumpida por un reinicio del servicio';
    return db.transaction(() => {
      db.prepare(`
        UPDATE audit_pages SET status = 'failed', finished_at = @at, error = @message
        WHERE status IN ('pending', 'running')
          AND audit_id IN (SELECT id FROM audits WHERE status IN ('queued', 'running'))
      `).run({ at, message });

      const stale = db
        .prepare(`SELECT id FROM audits WHERE status IN ('queued', 'running')`)
        .all() as Array<{ id: string }>;

      for (const row of stale) {
        this.finalizeAudit(row.id, at);
        db.prepare(`UPDATE audits SET error = @message WHERE id = @id`).run({ id: row.id, message });
      }
      return stale.length;
    })();
  }

  list(query: ListAuditsQuery): Paginated<Audit> {
    const db = getDb();
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.status) {
      where.push('a.status = @status');
      params.status = query.status;
    }
    if (query.search) {
      where.push(`(
        a.label LIKE @search
        OR EXISTS (SELECT 1 FROM audit_pages p WHERE p.audit_id = a.id AND p.url LIKE @search)
      )`);
      params.search = `%${query.search}%`;
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM audits a ${clause}`)
      .get(params) as { total: number };

    const rows = db
      .prepare(`
        SELECT a.* FROM audits a ${clause}
        ORDER BY a.created_at DESC, a.rowid DESC
        LIMIT @limit OFFSET @offset
      `)
      .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize }) as AuditRow[];

    return {
      items: rows.map(toAudit),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  findAudit(id: string): Audit | null {
    const row = getDb().prepare('SELECT * FROM audits WHERE id = @id').get({ id }) as AuditRow | undefined;
    return row ? toAudit(row) : null;
  }

  findAuditWithPages(id: string): AuditWithPages | null {
    const audit = this.findAudit(id);
    if (!audit) return null;
    return { ...audit, pages: this.findPages(id) };
  }

  findPages(auditId: string): AuditPage[] {
    const rows = getDb()
      .prepare('SELECT * FROM audit_pages WHERE audit_id = @auditId ORDER BY position ASC')
      .all({ auditId }) as PageRow[];
    return rows.map(toPage);
  }

  findPage(auditId: string, pageId: string): AuditPage | null {
    const row = getDb()
      .prepare('SELECT * FROM audit_pages WHERE id = @pageId AND audit_id = @auditId')
      .get({ auditId, pageId }) as PageRow | undefined;
    return row ? toPage(row) : null;
  }

  findIssues(pageId: string): PageIssue[] {
    const rows = getDb()
      .prepare(`
        SELECT rule_id, impact, node_count, help, help_url, description
        FROM page_issues WHERE page_id = @pageId
        ORDER BY
          CASE impact WHEN 'critical' THEN 0 WHEN 'serious' THEN 1
                      WHEN 'moderate' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END,
          node_count DESC, rule_id ASC
      `)
      .all({ pageId }) as IssueRow[];
    return rows.map(toIssue);
  }

  /**
   * Escaneo completado inmediatamente anterior de la misma URL y la misma seccion.
   *
   * `IS` en vez de `=` porque NULL (pagina entera) tiene que casar con NULL.
   * Solo se compara `include_selector`: el de exclusion filtra ruido puntual
   * (banners de cookies) y partir la serie por el daria comparaciones inutiles.
   */
  findPreviousPage(url: string, include: string | null, before: string): AuditPage | null {
    const row = getDb()
      .prepare(`
        SELECT p.* FROM audit_pages p
        JOIN audits a ON a.id = p.audit_id
        WHERE p.url = @url AND p.include_selector IS @include
          AND p.status = 'completed' AND a.created_at < @before
        ORDER BY a.created_at DESC
        LIMIT 1
      `)
      .get({ url, include, before }) as PageRow | undefined;
    return row ? toPage(row) : null;
  }

  /** Serie temporal de una URL y seccion, de mas antiguo a mas reciente. */
  history(url: string, include: string | null, limit: number): HistoryPoint[] {
    const rows = getDb()
      .prepare(`
        SELECT p.*, a.created_at AS audit_created_at FROM audit_pages p
        JOIN audits a ON a.id = p.audit_id
        WHERE p.url = @url AND p.include_selector IS @include AND p.status = 'completed'
        ORDER BY a.created_at DESC
        LIMIT @limit
      `)
      .all({ url, include, limit }) as PageRow[];

    return rows
      .map((row) => ({
        auditId: row.audit_id,
        pageId: row.id,
        finishedAt: row.finished_at,
        score: row.score,
        include: row.include_selector,
        ...rowCounters(row),
      }))
      .reverse();
  }

  /** Series distintas auditadas (URL + seccion), para el selector de historico. */
  scannedUrls(): Array<{
    url: string;
    host: string;
    include: string | null;
    runs: number;
    lastScan: string | null;
  }> {
    return getDb()
      .prepare(`
        SELECT url, host, include_selector AS "include", COUNT(*) AS runs,
               MAX(finished_at) AS lastScan
        FROM audit_pages WHERE status = 'completed'
        GROUP BY url, host, include_selector
        ORDER BY lastScan DESC
      `)
      .all() as Array<{
      url: string;
      host: string;
      include: string | null;
      runs: number;
      lastScan: string | null;
    }>;
  }

  deleteAudit(id: string): boolean {
    return getDb().prepare('DELETE FROM audits WHERE id = @id').run({ id }).changes > 0;
  }

  stats(): { audits: number; pages: number; urls: number } {
    const db = getDb();
    const { audits } = db.prepare('SELECT COUNT(*) AS audits FROM audits').get() as { audits: number };
    const { pages } = db.prepare('SELECT COUNT(*) AS pages FROM audit_pages').get() as { pages: number };
    const { urls } = db.prepare('SELECT COUNT(DISTINCT url) AS urls FROM audit_pages').get() as { urls: number };
    return { audits, pages, urls };
  }
}

export default new AuditRepository();
