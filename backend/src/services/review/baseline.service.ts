import { createHash, randomUUID } from 'crypto';
import auditRepository from '../../db/audit.repository';
import reviewRepository from '../../db/review.repository';
import rawStore from '../storage/rawStore';
import { normalizeHtml } from '../export/fingerprint';
import { MAX_NODES_LIMIT, nodeSelector, toCompactNode } from '../export/compact';
import { probe } from '../evidence/evidence.service';
import { withStoredDom } from '../evidence/storedDom';
import { findCheck } from './catalog';
import reviewService from './review.service';
import { badRequest, conflict, notFound } from '../../utils/errors';
import type {
  AuditPage,
  AxeResults,
  BaselineRegion,
  BaselineReport,
  ManualFinding,
  NotInheritedReason,
  PageEvidence,
} from '../../types/audit.types';

const DECIDED = new Set(['validated', 'amended']);
/** Paginas candidatas como mucho: las de la auditoria y las del sitio. */
const CANDIDATES_LIMIT = 500;

/** Huella estructural: sin textos, enlaces ni ids generados (ver `fingerprint.ts`). */
const structuralHash = (html: string): string => createHash('sha256').update(normalizeHtml(html)).digest('hex');

const sameScreen = (a: AuditPage, b: AuditPage) =>
  a.device === b.device && a.viewport?.width === b.viewport?.width && a.viewport?.height === b.viewport?.height;

interface ResolvedDom {
  /** Por selector: huella del elemento y de su region, o null si no esta. */
  targets: Map<string, { element: string; region: string } | null>;
  regions: Map<string, { role: string | null; hash: string }>;
  body: string;
}

/**
 * Resuelve los selectores en un DOM guardado: los hallazgos de la linea base se
 * decidieron con ese estado, no con la web de ahora.
 */
const resolveDom = (html: string, selectors: string[]): Promise<ResolvedDom> =>
  withStoredDom(html, async (page) => {
    const resolved = await probe(page, 'resolveTargets', ['body', ...selectors]);
    const regions = await probe(page, 'regionsHtml');

    const regionHashes = resolved.regions.map((region) => structuralHash(region.html));
    const targets = new Map<string, { element: string; region: string } | null>();
    for (const target of resolved.targets) {
      targets.set(
        target.selector,
        target.found ? { element: structuralHash(target.html), region: regionHashes[target.region] ?? '' } : null,
      );
    }
    return {
      targets,
      regions: new Map(regions.map((region) => [region.selector, { role: region.role, hash: structuralHash(region.html) }])),
      body: targets.get('body')?.element ?? '',
    };
  });

const ruleNodes = (results: AxeResults, kind: 'violations' | 'incomplete', ruleId: string) =>
  results[kind].find((rule) => rule.id === ruleId)?.nodes ?? [];

/**
 * Lineas base: una pagina ya revisada y validada de la que otras heredan los
 * hallazgos cuyos elementos (y la region que los contiene) son estructuralmente
 * iguales. Enlazar es una decision de la capa 3, por eso lleva nombre: los
 * hallazgos heredados nacen validados a nombre de quien enlaza.
 */
class BaselineService {
  public get(auditId: string, pageId: string): BaselineReport {
    this.requirePage(auditId, pageId);
    const report = reviewRepository.findBaseline(pageId);
    if (!report) throw notFound('Esta página no tiene línea base');
    return report;
  }

  /** Paginas con las que tiene sentido comparar: misma pantalla, de la misma auditoria o del mismo sitio. */
  public candidates(auditId: string, pageId: string) {
    const page = this.requirePage(auditId, pageId);
    const site = reviewRepository.findSiteByHost(page.host);
    const pool = [...auditRepository.findPages(auditId), ...(site ? auditRepository.findSitePages(site.id, CANDIDATES_LIMIT) : [])];
    const unique = new Map(pool.map((candidate) => [candidate.id, candidate]));
    return [...unique.values()]
      .filter((candidate) => candidate.id !== page.id && candidate.status === 'completed' && sameScreen(candidate, page))
      .map((candidate) => ({
        page: candidate,
        decidedFindings: reviewRepository
          .findPageFindings(candidate.id)
          .filter((finding) => DECIDED.has(finding.review.status) && !finding.inheritedFrom).length,
      }));
  }

  public async link(auditId: string, pageId: string, input: { baselinePageId: string; by: string }): Promise<BaselineReport> {
    const page = this.requirePage(auditId, pageId);
    const baseline = auditRepository.findPageById(input.baselinePageId);
    if (!baseline || baseline.status !== 'completed') throw notFound('Página de línea base no encontrada o sin escaneo completado');
    if (baseline.id === page.id) throw badRequest('Una página no puede ser su propia línea base');
    if (!sameScreen(page, baseline)) {
      throw badRequest('La línea base tiene que ser de la misma pantalla (resolución o dispositivo): si no, no se puede comparar');
    }

    const [pageEvidence, baselineEvidence, pageResults] = await Promise.all([
      rawStore.readEvidence(page.auditId, page.id),
      rawStore.readEvidence(baseline.auditId, baseline.id),
      rawStore.readRaw(page.auditId, page.id),
    ]);
    const pageDom = await this.dom(page, pageEvidence);
    const baselineDom = await this.dom(baseline, baselineEvidence);
    if (!pageResults) throw notFound('No hay resultado guardado para esta página');

    // Volver a enlazar empieza de cero: lo heredado antes puede ya no valer.
    this.clearInheritance(page, pageResults);
    // Crea las propuestas de axe de la pagina, que la herencia puede resolver.
    await reviewService.pageCheckReviews(page);

    const decided = reviewRepository
      .findPageFindings(baseline.id)
      .filter((finding) => DECIDED.has(finding.review.status));
    const own = reviewRepository.findPageFindings(page.id);

    const axeSelectors = decided.flatMap((finding) => {
      if (finding.source.kind === 'axe-needs-review') return ruleNodes(pageResults, 'incomplete', finding.source.ruleId).map(nodeSelector);
      if (finding.source.kind === 'axe-false-positive') return ruleNodes(pageResults, 'violations', finding.source.ruleId).map(nodeSelector);
      return [];
    });
    const selectors = [...new Set([...decided.flatMap((finding) => finding.targets.map((target) => target.selector)), ...axeSelectors])];

    const [inBaseline, inPage] = [await resolveDom(baselineDom, selectors), await resolveDom(pageDom, selectors)];
    const wholePageMatch = inBaseline.body !== '' && inBaseline.body === inPage.body;
    /** Huella de un elemento si es igual (el y su region) en las dos paginas. */
    const matchOne = (selector: string): string | null => {
      const a = inBaseline.targets.get(selector);
      const b = inPage.targets.get(selector);
      return a && b && a.element === b.element && a.region === b.region ? `${a.region}:${a.element}` : null;
    };
    const hashOf = (parts: string[]) => createHash('sha256').update([...new Set(parts)].sort().join('|')).digest('hex').slice(0, 16);
    /** Huella de lo que se ha comparado para heredar; null si algun elemento no coincide. */
    const match = (targetSelectors: string[]): string | null => {
      const parts = targetSelectors.map(matchOne);
      return parts.every((part): part is string => part !== null) ? hashOf(parts) : null;
    };

    const at = new Date().toISOString();
    const note = `Heredado de ${baseline.url} (línea base enlazada por ${input.by})`;
    const report: BaselineReport = {
      pageId: page.id,
      baseline: { pageId: baseline.id, auditId: baseline.auditId, url: baseline.url },
      linkedBy: input.by,
      linkedAt: at,
      regions: this.compareRegions(inBaseline, inPage),
      wholePageMatch,
      focusSequence: this.compareFocus(baselineEvidence, pageEvidence),
      inherited: [],
      notInherited: [],
    };

    for (const original of decided) {
      const checkId = original.source.checkId;
      const criterion = findCheck(checkId)?.criterion ?? checkId;
      const skip = (reason: NotInheritedReason) => report.notInherited.push({ fromFindingId: original.id, checkId, criterion, reason });
      const review = { status: original.review.status as 'validated' | 'amended', by: input.by, at, note };
      const source = original.source;

      if (source.kind === 'applicability') {
        skip('not-inheritable');
        continue;
      }

      if (source.kind === 'axe-needs-review') {
        const proposal = own.find(
          (finding) =>
            finding.source.kind === 'axe-needs-review' && finding.source.ruleId === source.ruleId && finding.source.checkId === checkId,
        );
        if (!proposal) {
          skip('not-in-page');
          continue;
        }
        if (proposal.review.status !== 'proposed') {
          skip('already-reviewed');
          continue;
        }
        const fingerprint = match(ruleNodes(pageResults, 'incomplete', source.ruleId).map(nodeSelector));
        if (!fingerprint) {
          skip('targets-changed');
          continue;
        }
        reviewRepository.resolveByInheritance(proposal.id, {
          outcome: original.outcome,
          description: original.description,
          recommendation: original.recommendation,
          assertedBy: original.assertedBy,
          ...review,
          inheritedFrom: original.id,
          fingerprint,
        });
        report.inherited.push({ findingId: proposal.id, fromFindingId: original.id, checkId, criterion });
        continue;
      }

      if (source.kind === 'axe-false-positive') {
        const nodes = ruleNodes(pageResults, 'violations', source.ruleId);
        if (nodes.length === 0) {
          skip('not-in-page');
          continue;
        }
        if (own.some((finding) => finding.source.kind === 'axe-false-positive' && finding.source.ruleId === source.ruleId && finding.source.checkId === checkId)) {
          skip('already-reviewed');
          continue;
        }
        const fingerprint = match(nodes.map(nodeSelector));
        if (!fingerprint) {
          skip('targets-changed');
          continue;
        }
        const id = randomUUID();
        reviewRepository.insertInherited(
          {
            ...original,
            id,
            subject: { kind: 'page', pageId: page.id },
            targets: nodes.slice(0, MAX_NODES_LIMIT).map((node) => {
              const { selector, html } = toCompactNode(node);
              return { selector, html };
            }),
            targetCount: nodes.length,
            createdAt: at,
          },
          review,
          { findingId: original.id, fingerprint },
        );
        report.inherited.push({ findingId: id, fromFindingId: original.id, checkId, criterion });
        continue;
      }

      // Resultado de una revision (IA o persona) sobre un criterio de pagina.
      let copy: ManualFinding = original;
      let fingerprint =
        original.targets.length > 0
          ? match(original.targets.map((target) => target.selector))
          : wholePageMatch
            ? `body:${inPage.body.slice(0, 16)}`
            : null;
      // Un fallo se puede heredar a trozos: cada elemento que falla en la linea
      // base y es igual aqui falla tambien aqui. Un "cumple" no: dice algo de
      // toda la pagina, y lo que no casa puede incumplir.
      if (!fingerprint && original.outcome === 'failed' && original.targets.length > 0) {
        const kept = original.targets.filter((target) => matchOne(target.selector) !== null);
        if (kept.length > 0) {
          fingerprint = hashOf(kept.map((target) => matchOne(target.selector) ?? ''));
          copy = {
            ...original,
            targets: kept,
            targetCount: kept.length,
            description: `Heredado solo para los elementos comunes con la línea base (${kept.length} de ${original.targets.length}): ${kept
              .map((target) => target.selector)
              .join(', ')}. ${original.description}`,
          };
        }
      }

      // Lo propio de la pagina manda si mira lo mismo que se heredaria: sin
      // elementos (toda la pagina) o alguno en comun. Si no, conviven: lo
      // heredado suele ser la cabecera o el pie, y lo propio, el contenido.
      const inheritedSelectors = new Set(copy.targets.map((target) => target.selector));
      const ownReview = own.some(
        (finding) =>
          finding.source.kind === 'check' &&
          finding.source.checkId === checkId &&
          finding.review.status !== 'rejected' &&
          !finding.inheritedFrom &&
          (finding.targets.length === 0 ||
            inheritedSelectors.size === 0 ||
            finding.targets.some((target) => inheritedSelectors.has(target.selector))),
      );
      if (ownReview) {
        skip('already-reviewed');
        continue;
      }
      if (!fingerprint) {
        skip(original.targets.length > 0 ? 'targets-changed' : 'page-changed');
        continue;
      }
      const id = randomUUID();
      reviewRepository.insertInherited(
        { ...copy, id, subject: { kind: 'page', pageId: page.id }, createdAt: at },
        review,
        { findingId: original.id, fingerprint },
      );
      report.inherited.push({
        findingId: id,
        fromFindingId: original.id,
        checkId,
        criterion,
        ...(copy !== original ? { partial: { kept: copy.targets.length, of: original.targets.length } } : {}),
      });
    }

    reviewRepository.saveBaseline(report);
    return report;
  }

  public async unlink(auditId: string, pageId: string): Promise<void> {
    const page = this.requirePage(auditId, pageId);
    if (!reviewRepository.findBaseline(pageId)) throw notFound('Esta página no tiene línea base');
    const results = await rawStore.readRaw(page.auditId, page.id);
    if (results) this.clearInheritance(page, results);
    reviewRepository.deleteBaseline(pageId);
  }

  /**
   * Quita lo heredado: las copias se borran y las propuestas de axe resueltas
   * por herencia vuelven a como las dejo axe, pendientes de revisar.
   */
  private clearInheritance(page: AuditPage, results: AxeResults): void {
    for (const finding of reviewRepository.findPageFindings(page.id)) {
      if (!finding.inheritedFrom) continue;
      if (finding.source.kind === 'axe-needs-review') {
        const { ruleId } = finding.source;
        reviewRepository.resetProposal(finding.id, {
          description: results.incomplete.find((rule) => rule.id === ruleId)?.help ?? finding.description,
          assertedBy: { type: 'tool', name: `axe-core ${results.testEngine?.version ?? ''}`.trim(), model: null, assistiveTech: null },
        });
      } else {
        reviewRepository.deleteFinding(finding.id);
      }
    }
  }

  private compareRegions(baseline: ResolvedDom, page: ResolvedDom): BaselineRegion[] {
    const regions: BaselineRegion[] = [];
    for (const [selector, region] of baseline.regions) {
      const other = page.regions.get(selector);
      regions.push({ selector, role: region.role, status: !other ? 'only-baseline' : other.hash === region.hash ? 'same' : 'changed' });
    }
    for (const [selector, region] of page.regions) {
      if (!baseline.regions.has(selector)) regions.push({ selector, role: region.role, status: 'only-page' });
    }
    return regions;
  }

  /** Mismo recorrido con el tabulador: mismos elementos en el mismo orden (por selector). */
  private compareFocus(baseline: PageEvidence | null, page: PageEvidence | null): BaselineReport['focusSequence'] {
    const a = baseline?.items['focus-sequence']?.stops.map((stop) => stop.selector);
    const b = page?.items['focus-sequence']?.stops.map((stop) => stop.selector);
    if (!a || !b) return 'unavailable';
    return a.length === b.length && a.every((selector, index) => selector === b[index]) ? 'same' : 'different';
  }

  private async dom(page: AuditPage, evidence: PageEvidence | null): Promise<string> {
    const html = evidence?.domSnapshot ? await rawStore.readEvidenceText(page.auditId, page.id, evidence.domSnapshot) : null;
    if (!html) {
      throw conflict(`${page.url} no tiene el DOM guardado: relanza su auditoría con «Recoger evidencia»`);
    }
    return html;
  }

  private requirePage(auditId: string, pageId: string): AuditPage {
    const page = auditRepository.findPage(auditId, pageId);
    if (!page) throw notFound('Pagina no encontrada en esta auditoria');
    if (page.status !== 'completed') throw conflict('La página no tiene un escaneo completado');
    return page;
  }
}

export default new BaselineService();
