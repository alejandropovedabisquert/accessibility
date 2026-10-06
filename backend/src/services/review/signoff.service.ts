import { createHash, randomUUID } from 'crypto';
import axe from 'axe-core';
import { buildEarl } from './earl';
import { signOffReportHtml } from './signoffReport';
import { htmlToPdf } from '../report/pdf.service';
import { slugifyUrl } from '../../utils/url';
import auditRepository from '../../db/audit.repository';
import reviewRepository from '../../db/review.repository';
import rawStore from '../storage/rawStore';
import { catalog, checksOfVersion } from './catalog';
import reviewService, { deriveOutcome } from './review.service';
import { AppError, badRequest, notFound } from '../../utils/errors';
import type {
  AuditPage,
  CheckReview,
  ConformanceStatus,
  ConformanceSummary,
  CriterionResult,
  EarlOutcome,
  ManualFinding,
  Site,
  SignOff,
  SignOffBlocker,
  SignOffDetail,
  SignOffPreview,
  SignOffSnapshot,
} from '../../types/audit.types';

export const MAX_SAMPLE_PAGES = 50;

/**
 * Peor resultado de un criterio en la muestra. A diferencia de una pagina,
 * aqui `untested` pesa mas que `passed`: si una pagina de la muestra no se ha
 * mirado, el criterio no esta evaluado en la web aunque otra cumpla.
 */
const SAMPLE_ORDER: readonly EarlOutcome[] = ['failed', 'cantTell', 'untested', 'passed', 'inapplicable'];

export const aggregateOutcome = (outcomes: readonly EarlOutcome[]): EarlOutcome => {
  if (outcomes.length === 0) return 'untested';
  const present = new Set(outcomes);
  return SAMPLE_ORDER.find((outcome) => present.has(outcome)) ?? 'untested';
};

/**
 * Estado de conformidad del RD 1112/2018 sobre los criterios legales. El RD no
 * cuantifica "parcialmente": aqui es no conforme si falla la mitad o mas de los
 * criterios que aplican. Es una decision nuestra, y por eso se calcula y se
 * documenta en vez de dejarla al gusto de quien firma.
 */
export const conformanceOf = (criteria: readonly CriterionResult[]): ConformanceSummary => {
  const legal = criteria.filter((criterion) => criterion.legal);
  const failed = legal.filter((criterion) => criterion.outcome === 'failed').length;
  const inapplicable = legal.filter((criterion) => criterion.outcome === 'inapplicable').length;
  const passed = legal.filter((criterion) => criterion.outcome === 'passed').length;
  const applicable = legal.length - inapplicable;
  let status: ConformanceStatus = 'full';
  if (failed > 0) status = failed * 2 >= applicable ? 'non-conformant' : 'partial';
  return { status, applicable, passed, failed, inapplicable };
};

/** JSON con las claves ordenadas: el mismo contenido da siempre el mismo hash. */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const snapshotHash = (snapshot: SignOffSnapshot): string =>
  createHash('sha256').update(stableStringify(snapshot)).digest('hex');

const pageLabel = (page: Pick<AuditPage, 'url'>) => page.url;

type CatalogRef = SignOffSnapshot['catalog'];

/** No aplicable cuenta como cumplido: no hay nada que corregir. */
const tally = (criteria: readonly CriterionResult[]) => ({
  passed: criteria.filter((criterion) => criterion.outcome === 'passed' || criterion.outcome === 'inapplicable').length,
  failed: criteria.filter((criterion) => criterion.outcome === 'failed').length,
  pending: criteria.filter((criterion) => criterion.outcome === 'cantTell' || criterion.outcome === 'untested').length,
});

class SignOffService {
  /** Lo que se firmaria con esta muestra y lo que todavia lo impide. */
  public async preview(siteId: string, pageIds: string[]): Promise<SignOffPreview> {
    const site = this.requireSite(siteId);
    const { snapshot, blockers } = await this.build(site, pageIds);
    return { snapshot, blockers, canSign: blockers.length === 0 };
  }

  public async sign(
    siteId: string,
    input: { pageIds: string[]; signer: string; credential: string | null; statement: string },
  ): Promise<SignOffDetail> {
    const site = this.requireSite(siteId);
    const { snapshot, blockers } = await this.build(site, input.pageIds);
    if (blockers.length > 0) {
      throw new AppError(
        `No se puede firmar todavía: ${blockers.length} criterio(s) o hallazgo(s) pendientes`,
        409,
        blockers,
      );
    }

    const signOff: SignOff = {
      id: randomUUID(),
      siteId: site.id,
      pageIds: snapshot.pages.map((page) => page.id),
      catalogId: snapshot.catalog.id,
      catalogVersion: snapshot.catalog.version,
      signer: input.signer,
      credential: input.credential,
      signedAt: new Date().toISOString(),
      conformance: snapshot.conformance.status,
      findingsHash: snapshotHash(snapshot),
      statement: input.statement,
    };
    // Primero el contenido en disco: una fila sin su contenido seria una firma de nada.
    await rawStore.saveSignOffSnapshot(signOff.id, snapshot);
    reviewRepository.insertSignOff(signOff);
    return { ...signOff, snapshot, stillMatches: true };
  }

  public listForSite(siteId: string): SignOff[] {
    this.requireSite(siteId);
    return reviewRepository.listSiteSignOffs(siteId);
  }

  /**
   * Una firma con lo que se firmo. `stillMatches` recalcula con los datos de
   * ahora: si alguien ha corregido un hallazgo despues de firmar, se nota.
   */
  public async get(id: string): Promise<SignOffDetail> {
    const signOff = reviewRepository.findSignOff(id);
    if (!signOff) throw notFound('Firma no encontrada');
    const snapshot = await rawStore.readSignOffSnapshot<SignOffSnapshot>(id);
    if (!snapshot) throw notFound('No se encuentra el contenido firmado en disco');

    let stillMatches: boolean | null = null;
    const site = reviewRepository.findSite(signOff.siteId);
    if (site) {
      try {
        // Con el catalogo con el que se firmo: con el de ahora no coincidiria ninguna firma anterior.
        const current = await this.build(site, signOff.pageIds, { id: signOff.catalogId, version: signOff.catalogVersion });
        const lost = current.blockers.some((blocker) => blocker.kind === 'page');
        stillMatches = lost ? null : snapshotHash(current.snapshot) === signOff.findingsHash;
      } catch {
        stillMatches = null;
      }
    }
    return { ...signOff, snapshot, stillMatches };
  }

  /** Siempre de la copia firmada, no de los datos actuales. */
  public async earl(id: string) {
    const { snapshot, ...signOff } = await this.frozen(id);
    return { signOff, siteName: snapshot.site.name, earl: buildEarl(signOff, snapshot, axe.version) };
  }

  /** PDF perezoso y cacheado, como el de las paginas: una firma no cambia. */
  public async pdf(id: string): Promise<{ filePath: string; fileName: string }> {
    const { snapshot, ...signOff } = await this.frozen(id);
    const filePath = rawStore.signOffPdfPath(id);
    if (!rawStore.exists(filePath)) await htmlToPdf(signOffReportHtml(signOff, snapshot), filePath);
    return { filePath, fileName: `firma-accesibilidad-${slugifyUrl(snapshot.site.name)}-${signOff.signedAt.slice(0, 10)}.pdf` };
  }

  private async frozen(id: string): Promise<SignOff & { snapshot: SignOffSnapshot }> {
    const signOff = reviewRepository.findSignOff(id);
    if (!signOff) throw notFound('Firma no encontrada');
    const snapshot = await rawStore.readSignOffSnapshot<SignOffSnapshot>(id);
    if (!snapshot) throw notFound('No se encuentra el contenido firmado en disco');
    return { ...signOff, snapshot };
  }

  private requireSite(siteId: string): Site {
    const site = reviewRepository.findSite(siteId);
    if (!site) throw notFound('Sitio no encontrado');
    return site;
  }

  private async build(
    site: Site,
    rawPageIds: string[],
    catalogRef: CatalogRef = { id: catalog.id, version: catalog.version },
  ): Promise<{ snapshot: SignOffSnapshot; blockers: SignOffBlocker[] }> {
    const pageIds = [...new Set(rawPageIds)];
    if (pageIds.length === 0) throw badRequest('Elige al menos una página para la muestra');
    if (pageIds.length > MAX_SAMPLE_PAGES) throw badRequest(`Máximo ${MAX_SAMPLE_PAGES} páginas por muestra`);

    const blockers: SignOffBlocker[] = [];
    const pages: AuditPage[] = [];
    for (const pageId of pageIds) {
      const page = auditRepository.findPageById(pageId);
      if (!page) {
        blockers.push({ kind: 'page', checkId: null, pageId, message: 'La página ya no existe (se borró su auditoría)' });
      } else if (page.status !== 'completed') {
        blockers.push({ kind: 'page', checkId: null, pageId, message: `${pageLabel(page)}: el escaneo no terminó` });
      } else if (!site.origins.includes(page.host)) {
        blockers.push({ kind: 'page', checkId: null, pageId, message: `${pageLabel(page)} no es de este sitio` });
      } else {
        pages.push(page);
      }
    }

    const reviews = new Map<string, CheckReview[]>();
    for (const page of pages) reviews.set(page.id, (await reviewService.pageCheckReviews(page)).checks);
    const siteFindings = reviewRepository.findSiteFindings(site.id);

    const criteria = checksOfVersion(catalogRef.version).map((check): CriterionResult => {
      const base = {
        checkId: check.id,
        criterion: check.criterion,
        name: check.name,
        level: check.level,
        scope: check.scope,
        legal: check.en301549 !== null,
      };
      if (check.scope === 'site') {
        const findings = siteFindings.filter((finding) => finding.source.checkId === check.id);
        return { ...base, outcome: deriveOutcome([], findings), byPage: {}, axeViolations: {}, findings };
      }

      const byPage: Record<string, EarlOutcome> = {};
      const axeViolations: Record<string, string[]> = {};
      const findings: ManualFinding[] = [];
      for (const page of pages) {
        const review = reviews.get(page.id)?.find((item) => item.checkId === check.id);
        byPage[page.id] = review?.outcome ?? 'untested';
        if (review && review.axe.violations.length > 0) axeViolations[page.id] = review.axe.violations;
        findings.push(...(review?.findings ?? []));
      }
      return { ...base, outcome: aggregateOutcome(Object.values(byPage)), byPage, axeViolations, findings };
    });

    for (const criterion of criteria) {
      const pending = criterion.findings.filter((finding) => finding.review.status === 'proposed').length;
      if (pending > 0) {
        blockers.push({
          kind: 'pending-review',
          checkId: criterion.checkId,
          pageId: null,
          message: `${criterion.criterion} ${criterion.name}: ${pending} hallazgo(s) sin validar`,
        });
      }
      if (criterion.outcome === 'cantTell' || criterion.outcome === 'untested') {
        blockers.push({
          kind: criterion.outcome === 'cantTell' ? 'undecided' : 'untested',
          checkId: criterion.checkId,
          pageId: null,
          message: `${criterion.criterion} ${criterion.name}: ${criterion.outcome === 'cantTell' ? 'sin decidir' : 'sin revisar'}`,
        });
      }
    }

    const newIn22 = criteria.filter((criterion) => !criterion.legal && criterion.level !== 'AAA');
    const snapshot: SignOffSnapshot = {
      site,
      pages: pages.map((page) => ({
        id: page.id,
        auditId: page.auditId,
        url: page.url,
        include: page.include,
        exclude: page.exclude,
        viewport: page.viewport,
        device: page.device,
        finishedAt: page.finishedAt,
      })),
      catalog: catalogRef,
      criteria,
      conformance: conformanceOf(criteria),
      wcag22: tally(newIn22),
      // Ausente, no a cero, en las firmas v1: un campo de mas cambiaria su hash.
      ...(catalogRef.version >= 2 ? { aaa: tally(criteria.filter((criterion) => criterion.level === 'AAA')) } : {}),
    };
    return { snapshot, blockers };
  }
}

export default new SignOffService();
