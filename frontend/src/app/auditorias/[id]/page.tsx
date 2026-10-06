import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAudit, getMeta } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { deleteAuditAction, rerunAuditAction } from '@/app/actions';
import {
  displayUrl,
  formatDateTime,
  formatDuration,
  formatViewport,
  isInProgress,
  screenLabel,
} from '@/lib/format';
import { AutoRefresh } from '@/components/AutoRefresh';
import { DownloadMenu } from '@/components/DownloadMenu';
import {
  Card,
  ComplianceSummary,
  ExcludeNotice,
  ImpactBreakdown,
  PageHeader,
  ScopeBadge,
  ScoreDial,
  Stat,
  StatusBadge,
  buttonStyles,
} from '@/components/ui';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const audit = await getAudit(id);
    return { title: audit.label ?? `Auditoría ${id.slice(0, 8)}` };
  } catch {
    return { title: 'Auditoría' };
  }
}

export default async function AuditDetailPage({ params }: Props) {
  const { id } = await params;

  let audit;
  try {
    audit = await getAudit(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Solo sirve para poner nombre bonito a los selectores de sección: si falla, se enseña el CSS.
  const meta = await getMeta().catch(() => null);

  const screensLabel =
    audit.config.device ?? (audit.config.viewports.map(formatViewport).join(', ') || 'Por defecto');
  // Con una sola pantalla la columna repetiria lo mismo en todas las filas.
  const multiScreen = new Set(audit.pages.map((page) => screenLabel(page))).size > 1;

  const inProgress = isInProgress(audit.status);
  const done = audit.completedPages + audit.failedPages;
  const progress = audit.totalPages > 0 ? Math.round((done / audit.totalPages) * 100) : 0;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/" className="text-accent underline-offset-2 hover:underline">
          ← Auditorías
        </Link>
      </p>

      <PageHeader
        title={audit.label ?? `Auditoría de ${audit.totalPages} URL(s)`}
        description={
          <>
            Lanzada el {formatDateTime(audit.createdAt)} · {audit.config.browser}
            {` · ${screensLabel}`}
          </>
        }
        actions={
          <>
            {audit.completedPages > 0 ? (
              <DownloadMenu
                label="Descargar JSON"
                options={[
                  {
                    href: `/api/backend/audits/${audit.id}/export?format=compact&detail=legal&download=1`,
                    label: 'Para IA',
                    hint: 'Todas las páginas, fallos repetidos agrupados. Detalle de WCAG A/AA; AAA y buenas prácticas, resumidas por regla',
                  },
                  {
                    href: `/api/backend/audits/${audit.id}/export?format=compact&detail=full&download=1`,
                    label: 'Para IA, completo',
                    hint: 'Igual, con el detalle de todos los niveles, incluidas AAA y buenas prácticas',
                  },
                ]}
              />
            ) : null}
            <form action={rerunAuditAction}>
              <input type="hidden" name="id" value={audit.id} />
              <button type="submit" className={buttonStyles.secondary}>
                Volver a lanzar
              </button>
            </form>
            <form action={deleteAuditAction}>
              <input type="hidden" name="id" value={audit.id} />
              <button type="submit" className={buttonStyles.danger}>
                Borrar
              </button>
            </form>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <StatusBadge status={audit.status} />
        {inProgress ? (
          <>
            <div className="min-w-48 flex-1 max-w-sm">
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progreso del escaneo: ${done} de ${audit.totalPages} páginas`}
                className="h-2 overflow-hidden rounded-full bg-surface-muted"
              >
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {done} de {audit.totalPages} páginas
              </p>
            </div>
            <AutoRefresh label="Escaneo en curso" intervalMs={2500} />
          </>
        ) : null}
      </div>

      {audit.error ? (
        <div role="alert" className="mb-5 rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical">
          {audit.error}
        </div>
      ) : null}

      {audit.completedPages > 0 ? <ComplianceSummary compliance={audit.compliance} averaged /> : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Incumplimientos" value={audit.violations} hint={`${audit.violationNodes} elementos afectados, legales y mejoras`} />
        <Stat label="Revisión manual" value={audit.incomplete} hint="axe no pudo decidir" />
        <Stat label="Páginas" value={`${audit.completedPages}/${audit.totalPages}`} hint={audit.failedPages > 0 ? `${audit.failedPages} fallida(s)` : 'Todas correctas'} />
      </dl>

      <ExcludeNotice
        selectors={[...new Set(audit.pages.flatMap((page) => (page.exclude ? [page.exclude] : [])))]}
        className="mb-6"
      />

      <h2 className="mb-3 text-lg font-semibold">Páginas escaneadas</h2>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">Resultado por página de la auditoría</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="px-4 py-3 font-medium">URL</th>
              {multiScreen ? <th scope="col" className="px-4 py-3 font-medium">Pantalla</th> : null}
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              <th scope="col" className="px-4 py-3 font-medium">Incumplimientos</th>
              <th scope="col" className="px-4 py-3 text-center font-medium">Cumplimiento legal</th>
              <th scope="col" className="px-4 py-3 font-medium">Duración</th>
              <th scope="col" className="px-4 py-3 font-medium">Revisión manual</th>
            </tr>
          </thead>
          <tbody>
            {audit.pages.map((page) => (
              <tr key={page.id} className="border-b border-line last:border-0 hover:bg-surface-muted">
                <th scope="row" className="max-w-md px-4 py-3 text-left font-normal">
                  {page.status === 'completed' ? (
                    <Link
                      href={`/auditorias/${audit.id}/paginas/${page.id}`}
                      className="break-all font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {displayUrl(page.url)}
                    </Link>
                  ) : (
                    <span className="break-all">{displayUrl(page.url)}</span>
                  )}
                  <ScopeBadge scope={page} sections={meta?.sections} />
                  {page.error ? <p className="mt-0.5 text-xs text-critical">{page.error}</p> : null}
                </th>
                {multiScreen ? (
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{screenLabel(page)}</td>
                ) : null}
                <td className="px-4 py-3">
                  <StatusBadge status={page.status} kind="page" />
                </td>
                <td className="px-4 py-3">
                  {page.status === 'completed' ? <ImpactBreakdown counters={page} /> : <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <ScoreDial
                    score={page.status === 'completed' ? (page.compliance?.legal.score ?? null) : null}
                    size={44}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted tabular-nums">
                  {formatDuration(page.durationMs)}
                </td>
                <td className="px-4 py-3">
                  {page.status === 'completed' ? (
                    <Link
                      href={`/auditorias/${audit.id}/paginas/${page.id}/revision`}
                      className="text-accent underline underline-offset-2"
                    >
                      Revisar
                      <span className="sr-only">
                        {' '}
                        {displayUrl(page.url)}
                        {multiScreen ? ` en ${screenLabel(page)}` : ''}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-ink-muted">Configuración usada</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-ink-muted">Navegador:</dt>
            <dd>{audit.config.browser}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Esperar hasta:</dt>
            <dd>{audit.config.waitUntil}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Timeout:</dt>
            <dd>{audit.config.timeoutMs} ms</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-muted">Pantallas:</dt>
            <dd>{screensLabel}</dd>
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <dt className="text-ink-muted">Normas:</dt>
            <dd>{audit.config.tags.join(', ')}</dd>
          </div>
        </dl>
      </details>
    </>
  );
}
