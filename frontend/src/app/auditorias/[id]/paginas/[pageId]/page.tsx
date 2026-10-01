import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, getAudit, getHistory, getMeta, getPageDiff, getPageResults } from '@/lib/api';
import {
  complianceGroup,
  displayUrl,
  formatDateTime,
  formatDuration,
  ruleLevel,
  screenLabel,
  sectionLabel,
} from '@/lib/format';
import { ViolationList } from '@/components/ViolationList';
import { DiffPanel } from '@/components/DiffPanel';
import { HistoryChart } from '@/components/HistoryChart';
import { Card, ComplianceSummary, ExcludeNotice, PageHeader, buttonStyles } from '@/components/ui';

interface Props {
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, pageId } = await params;
  try {
    const { page } = await getPageResults(id, pageId);
    return { title: displayUrl(page.url) };
  } catch {
    return { title: 'Resultado' };
  }
}

export default async function PageDetail({ params }: Props) {
  const { id, pageId } = await params;

  let data;
  try {
    data = await getPageResults(id, pageId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { page, results } = data;

  // Diff e historico son informativos: si fallan, la pagina principal sigue sirviendo.
  const [audit, diff, history, meta] = await Promise.all([
    getAudit(id).catch(() => null),
    getPageDiff(id, pageId).catch(() => null),
    // La serie es por URL + seccion + pantalla: comparar la cabecera contra la
    // pagina entera, o el movil contra el escritorio, no diria nada.
    getHistory(page.url, page.include, page).catch(() => null),
    getMeta().catch(() => null),
  ]);

  const scope = sectionLabel(page.include, meta?.sections);

  const isLegal = (tags: string[]) => complianceGroup(ruleLevel(tags)) === 'legal';
  const legalViolations = results.violations.filter((rule) => isLegal(rule.tags));
  const improvementViolations = results.violations.filter((rule) => !isLegal(rule.tags));

  const pdfHref = `/api/backend/audits/${id}/pages/${pageId}/report.pdf`;
  const jsonHref = `/api/backend/audits/${id}/pages/${pageId}/results?download=1`;
  const aiJsonHref = `/api/backend/audits/${id}/pages/${pageId}/results?format=compact&download=1`;

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
          <li aria-current="page">
            {displayUrl(page.url)}
            {scope ? ` · ${scope}` : ''} · {screenLabel(page)}
          </li>
        </ol>
      </nav>

      <PageHeader
        title={displayUrl(page.url)}
        description={
          <>
            {scope ? <>Sección <strong>{scope}</strong> · </> : null}
            Pantalla <strong>{screenLabel(page)}</strong> ·{' '}
            Escaneada el {formatDateTime(page.finishedAt)} en {formatDuration(page.durationMs)} ·{' '}
            <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              Abrir la página <span className="sr-only">(se abre en una pestaña nueva)</span>
            </a>
          </>
        }
        actions={
          <>
            <Link href={`/auditorias/${id}/paginas/${pageId}/revision`} className={buttonStyles.primary}>
              Revisión manual
            </Link>
            <a href={pdfHref} className={buttonStyles.secondary}>
              Descargar PDF
            </a>
            <a href={jsonHref} className={buttonStyles.secondary}>
              Descargar JSON
            </a>
            <a
              href={aiJsonHref}
              className={buttonStyles.secondary}
              title="Solo incumplimientos y revisiones manuales, con 5 elementos de ejemplo por regla"
            >
              Descargar JSON para IA
            </a>
          </>
        }
      />

      {page.include ? (
        <div className="mb-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
          <p>
            Solo se ha analizado <code>{page.include}</code>.
          </p>
          <p className="mt-1 text-ink-muted">
            axe omite las reglas de ámbito de página (idioma del documento, landmarks, título) cuando
            el análisis se acota a una sección, así que no aparecerán aquí aunque la página falle en
            ellas.
          </p>
        </div>
      ) : null}

      {page.exclude ? <ExcludeNotice selectors={[page.exclude]} className="mb-6" /> : null}

      <ComplianceSummary compliance={page.compliance} />

      <section className="mb-10" aria-labelledby="h-incumplimientos">
        <h2 id="h-incumplimientos" className="mb-1 text-lg font-semibold">
          Incumplimientos legales ({legalViolations.length})
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          Reglas WCAG A y AA. {page.violationNodes} elemento(s) del DOM incumplen alguna regla, contando
          también las mejoras.
        </p>
        <ViolationList
          rules={legalViolations}
          emptyMessage="Ningún incumplimiento WCAG A/AA detectado con las normas seleccionadas."
        />
      </section>

      {improvementViolations.length > 0 ? (
        <section className="mb-10" aria-labelledby="h-mejoras">
          <h2 id="h-mejoras" className="mb-1 text-lg font-semibold">
            Mejoras ({improvementViolations.length})
          </h2>
          <p className="mb-4 text-sm text-ink-muted">
            Reglas WCAG AAA y buenas prácticas. No son exigibles legalmente.
          </p>
          <ViolationList rules={improvementViolations} emptyMessage="" />
        </section>
      ) : null}

      <section className="mb-10" aria-labelledby="h-manual">
        <h2 id="h-manual" className="mb-1 text-lg font-semibold">
          Requieren revisión manual ({results.incomplete.length})
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          axe no ha podido decidir automáticamente si estos casos cumplen o no.
        </p>
        <ViolationList rules={results.incomplete} emptyMessage="Nada pendiente de revisión manual." />
      </section>

      <section className="mb-10" aria-labelledby="h-evolucion">
        <h2 id="h-evolucion" className="mb-3 text-lg font-semibold">
          Evolución de {scope ? `esta sección` : 'esta URL'} en {screenLabel(page)}
        </h2>
        {history ? (
          <Card className="p-5">
            <HistoryChart points={history.points} label="Incumplimientos por escaneo" />
          </Card>
        ) : (
          <p className="text-sm text-ink-muted">No se pudo cargar el histórico.</p>
        )}
      </section>

      <section aria-labelledby="h-comparacion">
        <h2 id="h-comparacion" className="mb-3 text-lg font-semibold">
          Comparación con el escaneo anterior en {screenLabel(page)}
        </h2>
        {diff ? <DiffPanel diff={diff} /> : <p className="text-sm text-ink-muted">No se pudo cargar la comparación.</p>}
      </section>
    </>
  );
}
