import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAudit } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { deleteAuditAction, rerunAuditAction } from '@/app/actions';
import { displayUrl, formatDateTime, formatDuration, isInProgress } from '@/lib/format';
import { AutoRefresh } from '@/components/AutoRefresh';
import {
  Card,
  ImpactBreakdown,
  PageHeader,
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
            {audit.config.device ? ` · ${audit.config.device}` : ''}
            {audit.config.viewport
              ? ` · ${audit.config.viewport.width}×${audit.config.viewport.height}`
              : ''}
          </>
        }
        actions={
          <>
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

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Reglas superadas"
          value={audit.score === null ? '—' : `${audit.score}%`}
          hint="Media de las páginas escaneadas"
        />
        <Stat label="Incumplimientos" value={audit.violations} hint={`${audit.violationNodes} elementos afectados`} />
        <Stat label="Revisión manual" value={audit.incomplete} hint="axe no pudo decidir" />
        <Stat label="Páginas" value={`${audit.completedPages}/${audit.totalPages}`} hint={audit.failedPages > 0 ? `${audit.failedPages} fallida(s)` : 'Todas correctas'} />
      </dl>

      <h2 className="mb-3 text-lg font-semibold">Páginas escaneadas</h2>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">Resultado por página de la auditoría</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="px-4 py-3 font-medium">URL</th>
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              <th scope="col" className="px-4 py-3 font-medium">Incumplimientos</th>
              <th scope="col" className="px-4 py-3 text-center font-medium">Superadas</th>
              <th scope="col" className="px-4 py-3 font-medium">Duración</th>
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
                  {page.error ? <p className="mt-0.5 text-xs text-critical">{page.error}</p> : null}
                </th>
                <td className="px-4 py-3">
                  <StatusBadge status={page.status} kind="page" />
                </td>
                <td className="px-4 py-3">
                  {page.status === 'completed' ? <ImpactBreakdown counters={page} /> : <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <ScoreDial score={page.status === 'completed' ? page.score : null} size={44} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-muted tabular-nums">
                  {formatDuration(page.durationMs)}
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
            <dt className="text-ink-muted">Dispositivo:</dt>
            <dd>
              {audit.config.device ??
                (audit.config.viewport
                  ? `${audit.config.viewport.width}×${audit.config.viewport.height}`
                  : 'Por defecto')}
            </dd>
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
