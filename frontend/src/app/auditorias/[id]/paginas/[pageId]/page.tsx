import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, getAudit, getHistory, getMeta, getPageDiff, getPageResults } from '@/lib/api';
import { displayUrl, formatDateTime, formatDuration, sectionLabel } from '@/lib/format';
import { ViolationList } from '@/components/ViolationList';
import { DiffPanel } from '@/components/DiffPanel';
import { HistoryChart } from '@/components/HistoryChart';
import { Card, PageHeader, ScoreDial, Stat, buttonStyles } from '@/components/ui';

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
    // La serie es por URL + seccion: comparar la cabecera contra la pagina entera no diria nada.
    getHistory(page.url, page.include).catch(() => null),
    getMeta().catch(() => null),
  ]);

  const scope = sectionLabel(page.include, meta?.sections);

  const pdfHref = `/api/backend/audits/${id}/pages/${pageId}/report.pdf`;
  const jsonHref = `/api/backend/audits/${id}/pages/${pageId}/results?download=1`;

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
            {scope ? ` · ${scope}` : ''}
          </li>
        </ol>
      </nav>

      <PageHeader
        title={displayUrl(page.url)}
        description={
          <>
            {scope ? <>Sección <strong>{scope}</strong> · </> : null}
            Escaneada el {formatDateTime(page.finishedAt)} en {formatDuration(page.durationMs)} ·{' '}
            <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              Abrir la página <span className="sr-only">(se abre en una pestaña nueva)</span>
            </a>
          </>
        }
        actions={
          <>
            <a href={pdfHref} className={buttonStyles.secondary}>
              Descargar PDF
            </a>
            <a href={jsonHref} className={buttonStyles.secondary}>
              Descargar JSON
            </a>
          </>
        }
      />

      {page.include ? (
        <div className="mb-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
          <p>
            Solo se ha analizado <code>{page.include}</code>
            {page.exclude ? <> excluyendo <code>{page.exclude}</code></> : null}.
          </p>
          <p className="mt-1 text-ink-muted">
            axe omite las reglas de ámbito de página (idioma del documento, landmarks, título) cuando
            el análisis se acota a una sección, así que no aparecerán aquí aunque la página falle en
            ellas.
          </p>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <ScoreDial score={page.score} size={64} />
          <div>
            <p className="text-sm font-medium">Reglas superadas</p>
            <p className="text-xs text-ink-muted">
              {page.passes} de {page.passes + page.violations} reglas aplicables
            </p>
          </div>
        </div>
      </div>

      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Críticos" value={page.critical} />
        <Stat label="Graves" value={page.serious} />
        <Stat label="Moderados" value={page.moderate} />
        <Stat label="Leves" value={page.minor} />
      </dl>

      <section className="mb-10" aria-labelledby="h-incumplimientos">
        <h2 id="h-incumplimientos" className="mb-1 text-lg font-semibold">
          Incumplimientos ({results.violations.length})
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          {page.violationNodes} elemento(s) del DOM incumplen alguna regla.
        </p>
        <ViolationList
          rules={results.violations}
          emptyMessage="Ningún incumplimiento detectado con las normas seleccionadas."
        />
      </section>

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
          Evolución de {scope ? `esta sección` : 'esta URL'}
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
          Comparación con el escaneo anterior
        </h2>
        {diff ? <DiffPanel diff={diff} /> : <p className="text-sm text-ink-muted">No se pudo cargar la comparación.</p>}
      </section>
    </>
  );
}
