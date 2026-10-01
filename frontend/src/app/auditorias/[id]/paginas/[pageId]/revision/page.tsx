import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, getAudit, getBaseline, getBaselineCandidates, getChecks, getPage, getPageEvidence, getPageReview } from '@/lib/api';
import { OUTCOME_LABEL, OUTCOMES, displayUrl, screenLabel } from '@/lib/format';
import { getReviewer } from '@/lib/reviewer';
import type { Check, CheckReview, EarlOutcome } from '@/lib/types';
import { Card, OutcomeBadge, PageHeader, buttonStyles } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { EvidencePanel } from '@/components/EvidencePanel';
import { BulkInapplicableForm, CreateFindingForm, FalsePositiveForm } from '@/components/ReviewForms';
import { BaselinePanel } from '@/components/BaselinePanel';

interface Props {
  params: Promise<{ id: string; pageId: string }>;
  searchParams: Promise<{ estado?: string }>;
}

const PRINCIPLES = [
  { id: '1', name: 'Perceptible' },
  { id: '2', name: 'Operable' },
  { id: '3', name: 'Comprensible' },
  { id: '4', name: 'Robusto' },
] as const;

/** Lo que el panel enseña; el texto completo y los formularios se quedan fuera para no cargar de más. */
const PANEL_KINDS = ['screenshot', 'reflow-320', 'zoom-200', 'text-spacing', 'orientation', 'focus-sequence', 'images'] as const;

const PENDING_FILTER = 'por-validar';

type Filter = EarlOutcome | typeof PENDING_FILTER | null;

const parseFilter = (value: string | undefined): Filter => {
  if (value === PENDING_FILTER) return PENDING_FILTER;
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
};

const matches = (check: CheckReview, filter: Filter) =>
  filter === null || (filter === PENDING_FILTER ? check.pendingReview > 0 : check.outcome === filter);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, pageId } = await params;
  try {
    // getPage y no getPageReview: abrir la revisión crea propuestas, y esto solo quiere el título.
    const { page } = await getPage(id, pageId);
    return { title: `Revisión · ${displayUrl(page.url)}` };
  } catch {
    return { title: 'Revisión manual' };
  }
}

export default async function PageReviewView({ params, searchParams }: Props) {
  const { id, pageId } = await params;
  const filter = parseFilter((await searchParams).estado);

  let review;
  try {
    review = await getPageReview(id, pageId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [catalog, audit, evidence, reviewer, baseline, candidates] = await Promise.all([
    getChecks(),
    getAudit(id).catch(() => null),
    review.evidence ? getPageEvidence(id, pageId, [...PANEL_KINDS]).catch(() => null) : Promise.resolve(null),
    getReviewer(),
    getBaseline(id, pageId).catch(() => null),
    getBaselineCandidates(id, pageId).catch(() => []),
  ]);

  const checkById = new Map<string, Check>(catalog.checks.map((check) => [check.id, check]));
  const path = `/auditorias/${id}/paginas/${pageId}/revision`;
  const pending = review.checks.reduce((sum, check) => sum + check.pendingReview, 0);
  const pendingInapplicable = review.checks.flatMap((check) =>
    check.findings
      .filter((finding) => finding.source.kind === 'applicability' && finding.review.status === 'proposed')
      .map((finding) => ({ criterion: check.criterion, name: check.name, reason: finding.description })),
  );
  const visible = review.checks.filter((check) => matches(check, filter));
  const filterHref = (value: Filter) => (value ? `${path}?estado=${value}` : path);

  const filters: Array<{ value: Filter; label: string; count: number }> = [
    { value: null, label: 'Todos', count: review.checks.length },
    { value: PENDING_FILTER, label: 'Por validar', count: review.checks.filter((check) => check.pendingReview > 0).length },
    ...OUTCOMES.map((outcome) => ({ value: outcome, label: OUTCOME_LABEL[outcome], count: review.summary[outcome] })),
  ];

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-3 text-sm">
        <ol className="flex flex-wrap items-center gap-1.5 text-ink-muted">
          <li>
            <Link href="/" className="text-accent underline-offset-2 hover:underline">
              Auditorías
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/auditorias/${id}`} className="text-accent underline-offset-2 hover:underline">
              {audit?.label ?? 'Auditoría'}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/auditorias/${id}/paginas/${pageId}`} className="text-accent underline-offset-2 hover:underline">
              {displayUrl(review.page.url)}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">Revisión manual</li>
        </ol>
      </nav>

      <PageHeader
        title="Revisión manual"
        description={
          <>
            {displayUrl(review.page.url)} · {screenLabel(review.page)} · Catálogo {review.catalog.id} v{review.catalog.version}
            {review.site ? (
              <>
                {' '}· Sitio{' '}
                <Link href={`/sitios/${review.site.id}`} className="text-accent underline underline-offset-2">
                  {review.site.name}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <Link href={`/auditorias/${id}/paginas/${pageId}`} className={buttonStyles.secondary}>
            Resultado de axe
          </Link>
        }
      />

      {!review.site ? (
        <p className="mb-4 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
          Esta página no pertenece a ningún sitio. Para firmar la web y revisar los criterios de sitio (navegación
          coherente, múltiples vías…), <Link href="/sitios" className="text-accent underline underline-offset-2">crea el sitio</Link>{' '}
          con su host.
        </p>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-6">
        {OUTCOMES.map((outcome) => (
          <div key={outcome} className="rounded-lg border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-ink-muted">{OUTCOME_LABEL[outcome]}</dt>
            <dd className="text-xl font-semibold tabular-nums">{review.summary[outcome]}</dd>
          </div>
        ))}
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2">
          <dt className="text-xs text-accent">Hallazgos por validar</dt>
          <dd className="text-xl font-semibold tabular-nums text-accent">{pending}</dd>
        </div>
      </dl>

      {pendingInapplicable.length > 0 ? (
        <Card className="mb-6 p-5">
          <BulkInapplicableForm auditId={id} pageId={pageId} path={path} reviewer={reviewer} criteria={pendingInapplicable} />
        </Card>
      ) : null}

      <section className="mb-8" aria-labelledby="h-evidencia">
        <h2 id="h-evidencia" className="mb-3 text-lg font-semibold">
          Evidencia
        </h2>
        {evidence ? (
          <EvidencePanel evidence={evidence} auditId={id} pageId={pageId} />
        ) : (
          <Card className="px-5 py-4 text-sm text-ink-muted">
            Esta auditoría no recogió evidencia. Relánzala marcando &laquo;Recoger evidencia para la revisión
            manual&raquo; para tener capturas, recorrido con el tabulador, reflujo y el resto.
          </Card>
        )}
      </section>

      <section className="mb-8" aria-labelledby="h-linea-base">
        <h2 id="h-linea-base" className="mb-3 text-lg font-semibold">
          Línea base
        </h2>
        <BaselinePanel
          report={baseline}
          candidates={candidates}
          auditId={id}
          pageId={pageId}
          path={path}
          reviewer={reviewer}
        />
      </section>

      <nav aria-label="Filtrar criterios" className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <li key={item.label}>
              <Link
                href={filterHref(item.value)}
                aria-current={filter === item.value ? 'true' : undefined}
                className={`inline-block rounded-full border px-3 py-1 text-sm ${
                  filter === item.value ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface hover:bg-surface-muted'
                }`}
              >
                {item.label} <span className="tabular-nums">({item.count})</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {visible.length === 0 ? <p className="text-sm text-ink-muted">Ningún criterio con ese estado.</p> : null}

      {PRINCIPLES.map((principle) => {
        const checks = visible.filter((check) => check.criterion.startsWith(`${principle.id}.`));
        if (checks.length === 0) return null;
        return (
          <section key={principle.id} className="mb-8" aria-labelledby={`h-principio-${principle.id}`}>
            <h2 id={`h-principio-${principle.id}`} className="mb-3 text-lg font-semibold">
              {principle.id}. {principle.name}
            </h2>
            <div className="space-y-4">
              {checks.map((item) => {
                const check = checkById.get(item.checkId);
                return (
                  <Card key={item.checkId} className="p-5">
                    <section aria-labelledby={`h-${item.checkId}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 id={`h-${item.checkId}`} className="font-semibold">
                          {item.criterion} {item.name}
                          {check ? <span className="ml-2 text-xs font-normal text-ink-muted">Nivel {check.level}</span> : null}
                        </h3>
                        <OutcomeBadge outcome={item.outcome} />
                      </div>

                      {check ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm text-accent">Qué comprobar</summary>
                          <p className="mt-2 text-sm">{check.instructions}</p>
                          {check.requiresAssistiveTech ? (
                            <p className="mt-2 text-sm font-medium">Hay que probarlo con un lector de pantalla.</p>
                          ) : null}
                          {check.en301549 === null ? (
                            <p className="mt-2 text-xs text-ink-muted">Nuevo en WCAG 2.2: aún no está en EN 301 549 v3.2.1.</p>
                          ) : null}
                        </details>
                      ) : null}

                      {item.axe.violations.length > 0 ? (
                        <div className="mt-3 rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm">
                          <p className="text-critical">
                            axe detecta incumplimientos de este criterio. Están en el{' '}
                            <Link href={`/auditorias/${id}/paginas/${pageId}`} className="underline underline-offset-2">
                              resultado de axe
                            </Link>
                            .
                          </p>
                          <ul className="mt-2 space-y-2">
                            {item.axe.violations.map((rule) => (
                              <li key={rule}>
                                <code>{rule}</code>
                                <FalsePositiveForm
                                  auditId={id}
                                  pageId={pageId}
                                  checkId={item.checkId}
                                  ruleId={rule}
                                  path={path}
                                  reviewer={reviewer}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {item.findings.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {item.findings.map((finding) => (
                            <FindingCard key={finding.id} finding={finding} path={path} reviewer={reviewer} page={{ auditId: id, pageId }} />
                          ))}
                        </div>
                      ) : item.axe.violations.length === 0 ? (
                        <p className="mt-3 text-sm text-ink-muted">Nadie ha revisado este criterio todavía.</p>
                      ) : null}

                      <div className="mt-3">
                        <CreateFindingForm checkId={item.checkId} target={{ auditId: id, pageId }} path={path} reviewer={reviewer} />
                      </div>
                    </section>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
