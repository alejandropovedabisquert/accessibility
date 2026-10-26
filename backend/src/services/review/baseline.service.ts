import { createHash, randomUUID } from 'crypto';
import auditRepository from '../../db/audit.repository';
import reviewRepository from '../../db/review.repository';
import rawStore from '../storage/rawStore';
import { normalizeHtml } from '../export/fingerprint';
import { nodeSelector, toFindingTargets } from '../export/compact';
import { probe } from '../evidence/evidence.service';
import { withStoredDom } from '../evidence/storedDom';
import { findCheck } from './catalog';
import reviewService, { axeAssertor } from './review.service';
import { AppError, badRequest, conflict, notFound, toMessage } from '../../utils/errors';
import type {
  AuditPage,
  AxeResults,
  BaselineRegion,
  BaselineReport,
  HeirCandidate,
  HeirResult,
  HeirsOverview,
  ManualFinding,
  NotInheritedReason,
  PageEvidence,
} from '../../types/audit.types';
import { requireCompletedPage } from '../shared/require';

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
    requireCompletedPage(auditId, pageId);
    const report = reviewRepository.findBaseline(pageId);
    if (!report) throw notFound('Esta página no tiene línea base');
    return report;
  }

  /**
   * Las paginas que pueden heredar de esta y en que situacion esta cada una. Se eligen desde la linea
   * base: se revisa una a fondo y se reparte a las que comparten plantilla.
   */
  public heirs(auditId: string, pageId: string): HeirsOverview {
    const page = requireCompletedPage(auditId, pageId);
    const pool = this.comparablePages(page);
    const links = reviewRepository.findBaselineLinks([page.id, ...pool.map((candidate) => candidate.id)]);
    const baselineOf = new Map(links.map((link) => [link.pageId, link.baselinePageId]));
    const isBaseline = new Set(links.map((link) => link.baselinePageId));
    const urlOf = (id: string) => pool.find((candidate) => candidate.id === id)?.url ?? auditRepository.findPageById(id)?.url;

    const candidates = pool.map((candidate): HeirCandidate => {
      const from = baselineOf.get(candidate.id);
      if (from === page.id) {
        const report = reviewRepository.findBaseline(candidate.id);
        return { page: candidate, status: 'heir', inherited: report?.inherited.length, notInherited: report?.notInherited.length };
      }
      if (from) return { page: candidate, status: 'other-baseline', baselineUrl: urlOf(from) ?? '' };
      if (isBaseline.has(candidate.id)) return { page: candidate, status: 'has-heirs' };
      return { page: candidate, status: 'available' };
    });

    const inheritsFrom = baselineOf.has(page.id) ? (reviewRepository.findBaseline(page.id)?.baseline ?? null) : null;
    return {
      inheritsFrom,
      decidedFindings: reviewRepository
        .findPageFindings(page.id)
        .filter((finding) => DECIDED.has(finding.review.status) && !finding.inheritedFrom).length,
      chain: inheritsFrom !== null && isBaseline.has(page.id),
      candidates,
    };
  }

  /**
   * Enlaza varias herederas a esta linea base, una detras de otra: cada una compara DOMs en un
   * navegador. Una que no se puede enlazar se anota y no para las demas. Volver a mandar las que ya
   * heredan es recalcular: trae lo que se haya decidido en la linea base despues.
   */
  public async linkHeirs(auditId: string, pageId: string, input: { pageIds: string[]; by: string }): Promise<HeirResult[]> {
    const baseline = requireCompletedPage(auditId, pageId);
    this.assertCanBeBaseline(baseline);

    const results: HeirResult[] = [];
    for (const heirId of new Set(input.pageIds)) {
      const heir = auditRepository.findPageById(heirId);
      if (!heir) {
        results.push({ pageId: heirId, url: '', linked: false, error: 'Página no encontrada' });
        continue;
      }
      try {
        const report = await this.link(heir.auditId, heir.id, { baselinePageId: baseline.id, by: input.by });
        results.push({
          pageId: heir.id,
          url: heir.url,
          linked: true,
          inherited: report.inherited.length,
          notInherited: report.notInherited.length,
        });
      } catch (error) {
        if (!(error instanceof AppError)) console.error(error);
        results.push({ pageId: heir.id, url: heir.url, linked: false, error: toMessage(error) });
      }
    }
    return results;
  }

  public async link(auditId: string, pageId: string, input: { baselinePageId: string; by: string }): Promise<BaselineReport> {
    const page = requireCompletedPage(auditId, pageId);
    const baseline = auditRepository.findPageById(input.baselinePageId);
    if (!baseline || baseline.status !== 'completed') throw notFound('Página de línea base no encontrada o sin escaneo completado');
    if (baseline.id === page.id) throw badRequest('Una página no puede ser su propia línea base');
    if (!sameScreen(page, baseline)) {
      throw badRequest('La línea base tiene que ser de la misma pantalla (resolución o dispositivo): si no, no se puede comparar');
    }
    // Sin cadenas: lo heredado viene siempre de una pagina revisada a mano, y de una sola.
    this.assertCanBeBaseline(baseline);
    if (reviewRepository.findHeirIds(page.id).length > 0) {
      throw conflict(`${page.url} es línea base de otras páginas: no puede heredar mientras las tenga`);
    }
    const current = reviewRepository.findBaseline(page.id);
    if (current && current.baseline.pageId !== baseline.id) {
      throw conflict(`${page.url} ya hereda de ${current.baseline.url}: quítale esa herencia antes de enlazarla a otra`);
    }

    const [pageEvidence, baselineEvidence, pageResults] = await Promise.all([
      rawStore.readEvidence(page.auditId, page.id),
      rawStore.readEvidence(baseline.auditId, baseline.id),
      rawStore.readRaw(page.auditId, page.id),
    ]);
    const pageDom = await this.dom(page, pageEvidence);
    const baselineDom = await this.dom(baseline, baselineEvidence);
    if (!pageResults) throw notFound('No hay resultado guardado para esta página');

    const decided = reviewRepository
      .findPageFindings(baseline.id)
      .filter((finding) => DECIDED.has(finding.review.status));
    const axeSelectors = decided.flatMap((finding) => {
      if (finding.source.kind === 'axe-needs-review') return ruleNodes(pageResults, 'incomplete', finding.source.ruleId).map(nodeSelector);
      if (finding.source.kind === 'axe-false-positive') return ruleNodes(pageResults, 'violations', finding.source.ruleId).map(nodeSelector);
      return [];
    });
    const selectors = [...new Set([...decided.flatMap((finding) => finding.targets.map((target) => target.selector)), ...axeSelectors])];

    const [inBaseline, inPage] = [await resolveDom(baselineDom, selectors), await resolveDom(pageDom, selectors)];

    // Volver a enlazar empieza de cero: lo heredado antes puede ya no valer. Va despues de todo lo
    // que puede fallar (disco, navegador), para no dejar la pagina sin herencia y con la fila de
    // `baseline` del enlace anterior apuntando a copias borradas.
    this.clearInheritance(page, pageResults);
    // Crea las propuestas de axe de la pagina, que la herencia puede resolver.
    await reviewService.pageCheckReviews(page);
    const own = reviewRepository.findPageFindings(page.id);

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
            targets: toFindingTargets(nodes),
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

  private assertCanBeBaseline(baseline: AuditPage): void {
    const inherits = reviewRepository.findBaseline(baseline.id);
    if (inherits) {
      throw conflict(
        `${baseline.url} hereda de ${inherits.baseline.url}: una heredera no puede ser línea base. Quítale su herencia antes`,
      );
    }
  }

  /** Con las que tiene sentido comparar: misma pantalla, de la misma auditoria o del mismo sitio. */
  private comparablePages(page: AuditPage): AuditPage[] {
    const site = reviewRepository.findSiteByHost(page.host);
    const pool = [...auditRepository.findPages(page.auditId), ...(site ? auditRepository.findSitePages(site.id, CANDIDATES_LIMIT) : [])];
    const unique = new Map(pool.map((candidate) => [candidate.id, candidate]));
    return [...unique.values()].filter(
      (candidate) => candidate.id !== page.id && candidate.status === 'completed' && sameScreen(candidate, page),
    );
  }

  public async unlink(auditId: string, pageId: string): Promise<void> {
    const page = requireCompletedPage(auditId, pageId);
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
          assertedBy: axeAssertor(results),
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

}

export default new BaselineService();
