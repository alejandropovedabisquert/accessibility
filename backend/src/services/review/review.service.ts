import { randomUUID } from 'crypto';
import auditRepository from '../../db/audit.repository';
import reviewRepository, { type NewFinding } from '../../db/review.repository';
import rawStore from '../storage/rawStore';
import { MAX_HTML_LENGTH, MAX_NODES_LIMIT, toCompactNode, truncate } from '../export/compact';
import { catalog, checksForAxeRule, findCheck } from './catalog';
import { normalizeHost } from '../../utils/url';
import { badRequest, conflict, notFound } from '../../utils/errors';
import type {
  Assertor,
  AuditPage,
  AxeResults,
  Check,
  CheckReview,
  CollectedEvidenceKind,
  EarlOutcome,
  FindingOutcome,
  FindingTarget,
  ManualFinding,
  PageEvidence,
  PageReview,
  ReviewStatus,
  Site,
  SiteDetail,
} from '../../types/audit.types';

export const MAX_SITE_HOSTS = 20;
/** Paginas que devuelve el detalle de un sitio; de sobra para elegir una muestra. */
const SITE_PAGES_LIMIT = 500;

export interface FindingInput {
  checkId: string;
  outcome: FindingOutcome;
  targets: FindingTarget[];
  targetCount?: number;
  description: string;
  recommendation: string | null;
  evidenceRefs: string[];
  assertedBy: Assertor;
}

export type FindingUpdate = Partial<Omit<FindingInput, 'checkId' | 'assertedBy'>> & { assertedBy: Assertor };

export interface FindingReviewInput {
  status: Exclude<ReviewStatus, 'proposed'>;
  by: string;
  note: string | null;
  outcome?: FindingOutcome;
  description?: string;
}

const OUTCOME_ORDER: readonly EarlOutcome[] = ['failed', 'cantTell', 'passed', 'inapplicable', 'untested'];

/**
 * Estado de un criterio en una pagina. Una violacion de axe basta para darlo por
 * fallado (sus `passes` nunca lo cierran, ver `CheckCoverage`); si no, manda lo
 * peor de los hallazgos que la capa 3 no ha rechazado.
 */
export const deriveOutcome = (axeViolation: boolean, findings: readonly ManualFinding[]): EarlOutcome => {
  if (axeViolation) return 'failed';
  const outcomes = new Set<EarlOutcome>(
    findings.filter((finding) => finding.review.status !== 'rejected').map((finding) => finding.outcome),
  );
  return OUTCOME_ORDER.find((outcome) => outcomes.has(outcome)) ?? 'untested';
};

const cleanTargets = (targets: FindingTarget[]): FindingTarget[] =>
  targets.map((target) => ({ selector: target.selector, html: truncate(target.html, MAX_HTML_LENGTH) }));

/** Para quien lee la revision (sobre todo una IA) bastan unos pocos nodos; el total va en `targetCount`. */
const limitTargets = (finding: ManualFinding, maxTargets: number): ManualFinding => ({
  ...finding,
  targets: finding.targets.slice(0, maxTargets),
});

const requireCheck = (checkId: string, scope: Check['scope']): Check => {
  const check = findCheck(checkId);
  if (!check) throw badRequest(`Criterio desconocido en el catálogo ${catalog.id} v${catalog.version}: ${checkId}`);
  if (check.scope !== scope) {
    throw badRequest(
      scope === 'page'
        ? `El criterio ${check.criterion} (${check.name}) se evalúa por sitio: regístralo en /api/sites/:id/findings`
        : `El criterio ${check.criterion} (${check.name}) se evalúa por página: regístralo en la revisión de la página`,
    );
  }
  return check;
};

class ReviewService {
  public getCatalog() {
    return catalog;
  }

  public createSite(input: { name: string; hosts: string[] }): Site {
    const hosts = [...new Set(input.hosts.map(normalizeHost))];
    const taken = reviewRepository.findHostOwners(hosts);
    const first = taken[0];
    if (first) {
      throw conflict(`El host ${first.host} ya pertenece al sitio "${first.siteName}"`);
    }

    const id = randomUUID();
    reviewRepository.createSite({ id, name: input.name, hosts, createdAt: new Date().toISOString() });
    const site = reviewRepository.findSite(id);
    if (!site) throw notFound('Sitio no encontrado');
    return site;
  }

  public listSites(): Site[] {
    return reviewRepository.listSites();
  }

  public getSite(id: string): SiteDetail {
    const site = reviewRepository.findSite(id);
    if (!site) throw notFound('Sitio no encontrado');
    return {
      ...site,
      pages: auditRepository.findSitePages(id, SITE_PAGES_LIMIT),
      findings: reviewRepository.findSiteFindings(id),
    };
  }

  public deleteSite(id: string): void {
    if (!reviewRepository.deleteSite(id)) throw notFound('Sitio no encontrado');
  }

  /**
   * Revision de una pagina. Al abrirla se convierten en propuestas las
   * `needs-review` de axe que aun no lo estuvieran: se hace aqui y no al
   * escanear para no cargar la ruta de escaneo con algo que muchas paginas
   * nunca van a necesitar (mismo motivo que el PDF perezoso).
   */
  public async getPageReview(auditId: string, pageId: string, maxTargets: number): Promise<PageReview> {
    const page = this.requireCompletedPage(auditId, pageId);
    const results = await rawStore.readRaw(auditId, pageId);
    if (!results) throw notFound('No hay resultado guardado para esta pagina');
    const evidence = await rawStore.readEvidence(auditId, pageId);

    this.proposeFromTools(page, results, evidence);

    const findings = reviewRepository.findPageFindings(page.id);
    const violated = new Set(results.violations.map((rule) => rule.id));
    const needsReview = new Set(results.incomplete.map((rule) => rule.id));

    const checks = catalog.checks
      .filter((check) => check.scope === 'page')
      .map((check): CheckReview => {
        const own = findings.filter((finding) => finding.source.checkId === check.id);
        const violations = check.axeRules.filter((rule) => violated.has(rule));
        return {
          checkId: check.id,
          criterion: check.criterion,
          name: check.name,
          outcome: deriveOutcome(violations.length > 0, own),
          axe: { violations, needsReview: check.axeRules.filter((rule) => needsReview.has(rule)) },
          pendingReview: own.filter((finding) => finding.review.status === 'proposed').length,
          findings: own.map((finding) => limitTargets(finding, maxTargets)),
        };
      });

    const summary = Object.fromEntries(OUTCOME_ORDER.map((outcome) => [outcome, 0])) as Record<EarlOutcome, number>;
    for (const check of checks) summary[check.outcome]++;

    return {
      page,
      site: reviewRepository.findSiteByHost(page.host),
      catalog: { id: catalog.id, version: catalog.version },
      evidence: evidence
        ? { collected: Object.keys(evidence.items), errors: evidence.errors as Record<string, string> }
        : null,
      summary,
      checks,
    };
  }

  /** Evidencia de una pagina, opcionalmente solo de algunos tipos para no mandar de mas. */
  public async getPageEvidence(auditId: string, pageId: string, kinds?: CollectedEvidenceKind[]): Promise<PageEvidence> {
    this.requireCompletedPage(auditId, pageId);
    const evidence = await rawStore.readEvidence(auditId, pageId);
    if (!evidence) throw notFound('Esta página no tiene evidencia: la auditoría no la pidió (evidence: true)');
    if (!kinds) return evidence;

    const wanted = new Set<string>(kinds);
    const pick = <T extends object>(record: T): Partial<T> =>
      Object.fromEntries(Object.entries(record).filter(([kind]) => wanted.has(kind))) as Partial<T>;
    return { ...evidence, items: pick(evidence.items), errors: pick(evidence.errors) };
  }

  public evidenceFile(auditId: string, pageId: string, name: string): string {
    this.requireCompletedPage(auditId, pageId);
    const filePath = rawStore.evidenceFilePath(auditId, pageId, name);
    if (!rawStore.exists(filePath)) throw notFound('Captura no encontrada');
    return filePath;
  }

  public createPageFinding(auditId: string, pageId: string, input: FindingInput): ManualFinding {
    const page = this.requireCompletedPage(auditId, pageId);
    requireCheck(input.checkId, 'page');
    return this.insert({ kind: 'page', pageId: page.id }, input);
  }

  public createSiteFinding(siteId: string, input: FindingInput): ManualFinding {
    if (!reviewRepository.findSite(siteId)) throw notFound('Sitio no encontrado');
    requireCheck(input.checkId, 'site');
    return this.insert({ kind: 'site', siteId }, input);
  }

  public getFinding(id: string): ManualFinding {
    const finding = reviewRepository.findFinding(id);
    if (!finding) throw notFound('Hallazgo no encontrado');
    return finding;
  }

  /**
   * Cambia el contenido de un hallazgo aun sin revisar: es como la capa 2 cierra
   * una propuesta de axe (`cantTell` → `passed`/`failed`). Una vez revisado ya
   * solo lo cambia la capa 3, con `amended`.
   */
  public updateFinding(id: string, update: FindingUpdate): ManualFinding {
    const current = this.getFinding(id);
    if (current.review.status !== 'proposed') {
      throw conflict('Este hallazgo ya está revisado: solo la revisión (amended) puede cambiarlo');
    }

    const targets = update.targets ? cleanTargets(update.targets) : current.targets;
    reviewRepository.updateFinding(id, {
      outcome: update.outcome ?? current.outcome,
      targets,
      targetCount: update.targetCount ?? (update.targets ? targets.length : current.targetCount),
      description: update.description ?? current.description,
      recommendation: update.recommendation !== undefined ? update.recommendation : current.recommendation,
      evidenceRefs: update.evidenceRefs ?? current.evidenceRefs,
      assertedBy: update.assertedBy,
    });
    return this.getFinding(id);
  }

  public reviewFinding(id: string, input: FindingReviewInput): ManualFinding {
    const current = this.getFinding(id);
    const outcome = input.outcome ?? current.outcome;
    const description = input.description ?? current.description;
    const changed = outcome !== current.outcome || description !== current.description;

    if (input.status === 'amended' && !changed) {
      throw badRequest('Para corregir (amended) hay que cambiar el resultado o la descripción');
    }
    if (input.status !== 'amended' && changed) {
      throw badRequest('Solo una corrección (amended) puede cambiar el resultado o la descripción');
    }
    // Validar un "no se puede decidir" dejaria el criterio sin resultado y con apariencia de revisado.
    if (input.status !== 'rejected' && outcome === 'cantTell') {
      throw badRequest('Un hallazgo sin decidir (cantTell) no se puede validar: corrígelo con su resultado');
    }

    reviewRepository.reviewFinding({
      id,
      status: input.status,
      by: input.by,
      at: new Date().toISOString(),
      note: input.note,
      outcome,
      description,
    });
    return this.getFinding(id);
  }

  private requireCompletedPage(auditId: string, pageId: string): AuditPage {
    const page = auditRepository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    if (page.status !== 'completed') {
      throw conflict('La página no tiene resultados que revisar: el escaneo no ha terminado o falló');
    }
    return page;
  }

  private insert(subject: NewFinding['subject'], input: FindingInput): ManualFinding {
    const targets = cleanTargets(input.targets);
    const id = randomUUID();
    reviewRepository.insertFinding({
      id,
      subject,
      source: { kind: 'check', checkId: input.checkId, catalogVersion: catalog.version },
      outcome: input.outcome,
      targets,
      targetCount: input.targetCount ?? targets.length,
      description: input.description,
      recommendation: input.recommendation,
      evidenceRefs: input.evidenceRefs,
      assertedBy: input.assertedBy,
      createdAt: new Date().toISOString(),
    });
    return this.getFinding(id);
  }

  /**
   * Propuestas del sistema: un `cantTell` por cada `needs-review` de axe y
   * criterio de pagina al que afecta, y un `inapplicable` por cada criterio cuyo
   * `appliesWhen` no caso con nada al recoger la evidencia.
   */
  private proposeFromTools(page: AuditPage, results: AxeResults, evidence: PageEvidence | null): void {
    const createdAt = new Date().toISOString();
    const tool = (name: string): Assertor => ({ type: 'tool', name, model: null, assistiveTech: null });
    const axeAuthor = tool(`axe-core ${results.testEngine?.version ?? ''}`.trim());

    const fromAxe = results.incomplete.flatMap((rule) =>
      checksForAxeRule(rule.id)
        .filter((check) => check.scope === 'page')
        .map(
          (check): NewFinding => ({
            id: randomUUID(),
            subject: { kind: 'page', pageId: page.id },
            source: { kind: 'axe-needs-review', ruleId: rule.id, checkId: check.id },
            outcome: 'cantTell',
            // Se guardan como mucho MAX_NODES_LIMIT: el resto sigue en el JSON crudo.
            targets: rule.nodes.slice(0, MAX_NODES_LIMIT).map((node) => {
              const { selector, html } = toCompactNode(node);
              return { selector, html };
            }),
            targetCount: rule.nodes.length,
            description: rule.help,
            recommendation: null,
            evidenceRefs: [],
            assertedBy: axeAuthor,
            createdAt,
          }),
        ),
    );

    const where = page.include ? 'la sección analizada' : 'la página';
    const fromEvidence = evidence
      ? catalog.checks.flatMap((check): NewFinding[] => {
          // -1 = el navegador no entendio el selector: no se puede afirmar nada.
          if (check.scope !== 'page' || !check.appliesWhen || evidence.applicability[check.id] !== 0) return [];
          return [
            {
              id: randomUUID(),
              subject: { kind: 'page', pageId: page.id },
              source: { kind: 'applicability', checkId: check.id, selector: check.appliesWhen },
              outcome: 'inapplicable',
              targets: [],
              targetCount: 0,
              description: `Ningún elemento de ${where} casa con «${check.appliesWhen}»: se propone como no aplicable.`,
              recommendation: null,
              evidenceRefs: ['evidence.json#applicability'],
              assertedBy: tool('evidencia'),
              createdAt,
            },
          ];
        })
      : [];

    const proposals = [...fromAxe, ...fromEvidence];
    if (proposals.length > 0) reviewRepository.insertSystemProposals(proposals, catalog.version);
  }
}

export default new ReviewService();
