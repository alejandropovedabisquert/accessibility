import { getDb } from './client';
import type {
  Assertor,
  FindingOutcome,
  FindingSource,
  FindingSubject,
  FindingTarget,
  ManualFinding,
  ReviewStatus,
  Site,
} from '../types/audit.types';

interface SiteRow {
  id: string;
  name: string;
  created_at: string;
  hosts: string | null;
}

interface FindingRow {
  id: string;
  page_id: string | null;
  site_id: string | null;
  check_id: string;
  catalog_version: number;
  source_kind: string;
  axe_rule_id: string | null;
  source_selector: string | null;
  outcome: string;
  targets: string;
  target_count: number;
  description: string;
  recommendation: string | null;
  evidence_refs: string;
  asserted_by: string;
  review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  inherited_from: string | null;
  inherited_fingerprint: string | null;
  created_at: string;
}

/** Lo que se inserta: todo el hallazgo salvo lo que pone la capa 3. */
export type NewFinding = Omit<ManualFinding, 'review' | 'inheritedFrom'>;

export type FindingChanges = Pick<
  ManualFinding,
  'outcome' | 'targets' | 'targetCount' | 'description' | 'recommendation' | 'evidenceRefs' | 'assertedBy'
>;

// GROUP_CONCAT con separador que no puede aparecer en un host.
const SITE_SELECT = `
  SELECT s.id, s.name, s.created_at, GROUP_CONCAT(h.host, ' ') AS hosts
  FROM sites s LEFT JOIN site_hosts h ON h.site_id = s.id
`;

const toSite = (row: SiteRow): Site => ({
  id: row.id,
  name: row.name,
  origins: row.hosts ? row.hosts.split(' ').sort() : [],
  createdAt: row.created_at,
});

const toSubject = (row: FindingRow): FindingSubject =>
  row.page_id !== null
    ? { kind: 'page', pageId: row.page_id }
    : { kind: 'site', siteId: row.site_id ?? '' };

const toSource = (row: FindingRow): FindingSource => {
  if (row.source_kind === 'axe-needs-review') {
    return { kind: 'axe-needs-review', ruleId: row.axe_rule_id ?? '', checkId: row.check_id };
  }
  if (row.source_kind === 'applicability') {
    return { kind: 'applicability', checkId: row.check_id, selector: row.source_selector ?? '' };
  }
  return { kind: 'check', checkId: row.check_id, catalogVersion: row.catalog_version };
};

const toFinding = (row: FindingRow): ManualFinding => ({
  id: row.id,
  subject: toSubject(row),
  source: toSource(row),
  outcome: row.outcome as FindingOutcome,
  targets: JSON.parse(row.targets) as FindingTarget[],
  targetCount: row.target_count,
  description: row.description,
  recommendation: row.recommendation,
  evidenceRefs: JSON.parse(row.evidence_refs) as string[],
  assertedBy: JSON.parse(row.asserted_by) as Assertor,
  review: {
    status: row.review_status as ReviewStatus,
    by: row.reviewed_by,
    at: row.reviewed_at,
    note: row.review_note,
  },
  createdAt: row.created_at,
  inheritedFrom:
    row.inherited_from && row.inherited_fingerprint
      ? { findingId: row.inherited_from, fingerprint: row.inherited_fingerprint }
      : null,
});

class ReviewRepository {
  createSite(site: { id: string; name: string; hosts: string[]; createdAt: string }): void {
    const db = getDb();
    const insertSite = db.prepare('INSERT INTO sites (id, name, created_at) VALUES (@id, @name, @createdAt)');
    const insertHost = db.prepare('INSERT INTO site_hosts (host, site_id) VALUES (@host, @siteId)');

    db.transaction(() => {
      insertSite.run(site);
      for (const host of site.hosts) insertHost.run({ host, siteId: site.id });
    })();
  }

  /** Sitio que ya tiene alguno de estos hosts, para avisar antes de chocar con la PRIMARY KEY. */
  findHostOwners(hosts: string[]): Array<{ host: string; siteId: string; siteName: string }> {
    if (hosts.length === 0) return [];
    const placeholders = hosts.map((_, index) => `@h${index}`).join(', ');
    const params = Object.fromEntries(hosts.map((host, index) => [`h${index}`, host]));
    return getDb()
      .prepare(`
        SELECT h.host AS host, s.id AS siteId, s.name AS siteName
        FROM site_hosts h JOIN sites s ON s.id = h.site_id
        WHERE h.host IN (${placeholders})
      `)
      .all(params) as Array<{ host: string; siteId: string; siteName: string }>;
  }

  listSites(): Site[] {
    const rows = getDb().prepare(`${SITE_SELECT} GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).all() as SiteRow[];
    return rows.map(toSite);
  }

  findSite(id: string): Site | null {
    const row = getDb().prepare(`${SITE_SELECT} WHERE s.id = @id GROUP BY s.id`).get({ id }) as
      | SiteRow
      | undefined;
    return row ? toSite(row) : null;
  }

  findSiteByHost(host: string): Site | null {
    const row = getDb()
      .prepare('SELECT site_id FROM site_hosts WHERE host = @host')
      .get({ host }) as { site_id: string } | undefined;
    return row ? this.findSite(row.site_id) : null;
  }

  deleteSite(id: string): boolean {
    return getDb().prepare('DELETE FROM sites WHERE id = @id').run({ id }).changes > 0;
  }

  insertFinding(finding: NewFinding): void {
    const { subject, source } = finding;
    getDb()
      .prepare(`
        INSERT INTO manual_findings (id, page_id, site_id, check_id, catalog_version, source_kind,
          axe_rule_id, source_selector, outcome, targets, target_count, description, recommendation,
          evidence_refs, asserted_by, review_status, created_at)
        VALUES (@id, @pageId, @siteId, @checkId, @catalogVersion, @sourceKind, @axeRuleId,
          @sourceSelector, @outcome, @targets, @targetCount, @description, @recommendation,
          @evidenceRefs, @assertedBy, 'proposed', @createdAt)
      `)
      .run(this.findingParams(finding, subject, source));
  }

  /**
   * Propuestas que pone el sistema (axe, `appliesWhen`). Si ya existe la de esa
   * pagina y origen, no hace nada: los indices unicos parciales lo garantizan
   * aunque se abra la revision dos veces a la vez.
   */
  insertSystemProposals(findings: NewFinding[], catalogVersion: number): number {
    const db = getDb();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO manual_findings (id, page_id, site_id, check_id, catalog_version,
        source_kind, axe_rule_id, source_selector, outcome, targets, target_count, description,
        recommendation, evidence_refs, asserted_by, review_status, created_at)
      VALUES (@id, @pageId, NULL, @checkId, @catalogVersion, @sourceKind, @axeRuleId, @sourceSelector,
        @outcome, @targets, @targetCount, @description, NULL, @evidenceRefs, @assertedBy, 'proposed',
        @createdAt)
    `);
    let inserted = 0;
    db.transaction(() => {
      for (const finding of findings) {
        const params = this.findingParams(finding, finding.subject, finding.source, catalogVersion);
        inserted += insert.run(params).changes;
      }
    })();
    return inserted;
  }

  private findingParams(
    finding: NewFinding,
    subject: FindingSubject,
    source: FindingSource,
    catalogVersion?: number,
  ) {
    return {
      id: finding.id,
      pageId: subject.kind === 'page' ? subject.pageId : null,
      siteId: subject.kind === 'site' ? subject.siteId : null,
      checkId: source.checkId,
      catalogVersion: source.kind === 'check' ? source.catalogVersion : (catalogVersion ?? 0),
      sourceKind: source.kind,
      axeRuleId: source.kind === 'axe-needs-review' ? source.ruleId : null,
      sourceSelector: source.kind === 'applicability' ? source.selector : null,
      outcome: finding.outcome,
      targets: JSON.stringify(finding.targets),
      targetCount: finding.targetCount,
      description: finding.description,
      recommendation: finding.recommendation,
      evidenceRefs: JSON.stringify(finding.evidenceRefs),
      assertedBy: JSON.stringify(finding.assertedBy),
      createdAt: finding.createdAt,
    };
  }

  findFinding(id: string): ManualFinding | null {
    const row = getDb().prepare('SELECT * FROM manual_findings WHERE id = @id').get({ id }) as
      | FindingRow
      | undefined;
    return row ? toFinding(row) : null;
  }

  findPageFindings(pageId: string): ManualFinding[] {
    const rows = getDb()
      .prepare('SELECT * FROM manual_findings WHERE page_id = @pageId ORDER BY created_at ASC, id ASC')
      .all({ pageId }) as FindingRow[];
    return rows.map(toFinding);
  }

  findSiteFindings(siteId: string): ManualFinding[] {
    const rows = getDb()
      .prepare('SELECT * FROM manual_findings WHERE site_id = @siteId ORDER BY created_at ASC, id ASC')
      .all({ siteId }) as FindingRow[];
    return rows.map(toFinding);
  }

  updateFinding(id: string, changes: FindingChanges): void {
    getDb()
      .prepare(`
        UPDATE manual_findings
        SET outcome = @outcome, targets = @targets, target_count = @targetCount,
            description = @description, recommendation = @recommendation,
            evidence_refs = @evidenceRefs, asserted_by = @assertedBy
        WHERE id = @id
      `)
      .run({
        id,
        outcome: changes.outcome,
        targets: JSON.stringify(changes.targets),
        targetCount: changes.targetCount,
        description: changes.description,
        recommendation: changes.recommendation,
        evidenceRefs: JSON.stringify(changes.evidenceRefs),
        assertedBy: JSON.stringify(changes.assertedBy),
      });
  }

  /** La validacion de la capa 3. `amended` puede venir con resultado o descripcion corregidos. */
  reviewFinding(input: {
    id: string;
    status: Exclude<ReviewStatus, 'proposed'>;
    by: string;
    at: string;
    note: string | null;
    outcome: FindingOutcome;
    description: string;
  }): void {
    getDb()
      .prepare(`
        UPDATE manual_findings
        SET review_status = @status, reviewed_by = @by, reviewed_at = @at, review_note = @note,
            outcome = @outcome, description = @description
        WHERE id = @id
      `)
      .run(input);
  }
}

export default new ReviewRepository();
