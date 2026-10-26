import Link from 'next/link';
import { Suspense } from 'react';
import { listAuditGroups } from '@/lib/api';
import { AUDIT_STATUS_LABEL, formatDateTime, formatRelative, isInProgress } from '@/lib/format';
import type { Audit, AuditGroup } from '@/lib/types';
import { AuditFilters } from '@/components/AuditFilters';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Pagination } from '@/components/Pagination';
import { PlusIcon } from '@/components/icons';
import { Card, EmptyState, ImpactBreakdown, PageHeader, ScoreDial, StatusBadge, buttonStyles } from '@/components/ui';

interface Props {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}

export default async function AuditsPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = Number(params.page) || 1;

  const result = await listAuditGroups({
    page,
    pageSize: 20,
    status: params.status,
    search: params.search,
  });

  const hasFilters = Boolean(params.search || params.status);
  const anyInProgress = result.items.some((group) => isInProgress(group.latest.status));

  const buildHref = (target: number) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    query.set('page', String(target));
    return `/?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Auditorías"
        description="Histórico de escaneos de accesibilidad. Cada auditoría guarda su resultado completo, y al volver a lanzarla los lanzamientos anteriores quedan dentro."
        actions={
          <Link href="/nueva" className={buttonStyles.primary}>
            <PlusIcon />
            Nueva auditoría
          </Link>
        }
      />

      <Suspense fallback={null}>
        <AuditFilters />
      </Suspense>

      {anyInProgress ? <AutoRefresh label="Hay auditorías en curso; la lista se actualiza sola." /> : null}

      {result.items.length === 0 ? (
        <div className="mt-4">
          {hasFilters ? (
            <EmptyState
              title="Sin resultados"
              description="Ninguna auditoría coincide con los filtros aplicados."
              action={{ href: '/', label: 'Quitar filtros' }}
            />
          ) : (
            <EmptyState
              title="Todavía no hay auditorías"
              description="Lanza el primer escaneo indicando una o varias URLs. El resultado queda guardado para consultarlo cuando quieras."
              action={{ href: '/nueva', label: 'Lanzar la primera auditoría' }}
            />
          )}
        </div>
      ) : (
        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">
              Listado de auditorías de accesibilidad, de la más reciente a la más antigua, con su último lanzamiento
            </caption>
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th scope="col" className="px-4 py-3 font-medium">Auditoría</th>
                <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                <th scope="col" className="px-4 py-3 font-medium">Páginas</th>
                <th scope="col" className="px-4 py-3 font-medium">Incumplimientos</th>
                <th scope="col" className="px-4 py-3 text-center font-medium">Superadas</th>
                <th scope="col" className="px-4 py-3 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((group) => (
                <GroupRow key={group.id} group={group} />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} total={result.total} buildHref={buildHref} />
    </>
  );
}

const auditTitle = (audit: Audit) => audit.label ?? `Auditoría de ${audit.totalPages} URL(s)`;

/** Diferencia con el último lanzamiento anterior que terminó con puntuación. */
const scoreTrend = (group: AuditGroup): number | null => {
  const { latest } = group;
  const before = group.previous.find((run) => run.status === 'completed' && run.score !== null);
  if (latest.status !== 'completed' || latest.score === null || !before?.score) return null;
  return Math.round((latest.score - before.score) * 10) / 10;
};

function GroupRow({ group }: { group: AuditGroup }) {
  const audit = group.latest;
  const trend = scoreTrend(group);

  return (
    <tr className="border-b border-line align-top last:border-0 hover:bg-surface-muted">
      <th scope="row" className="max-w-xs px-4 py-3 text-left font-normal">
        <Link href={`/auditorias/${audit.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
          {auditTitle(audit)}
        </Link>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {audit.config.browser}
          {audit.config.device ? ` · ${audit.config.device}` : ''}
        </p>
        {group.previous.length > 0 ? (
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer text-ink-muted">
              {group.previous.length === 1 ? '1 lanzamiento anterior' : `${group.previous.length} lanzamientos anteriores`}
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {group.previous.map((run) => (
                <li key={run.id}>
                  <Link href={`/auditorias/${run.id}`} className="text-accent underline-offset-2 hover:underline">
                    {formatDateTime(run.createdAt)}
                  </Link>
                  <span className="text-ink-muted">
                    {' '}
                    · {run.status === 'completed' && run.score !== null ? `${Math.round(run.score)}% superadas` : AUDIT_STATUS_LABEL[run.status]}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </th>
      <td className="px-4 py-3">
        <StatusBadge status={audit.status} />
      </td>
      <td className="px-4 py-3 tabular-nums">
        {audit.completedPages}/{audit.totalPages}
        {audit.failedPages > 0 ? <span className="ml-1 text-xs text-critical">({audit.failedPages} fallida)</span> : null}
      </td>
      <td className="px-4 py-3">
        {audit.status === 'completed' ? <ImpactBreakdown counters={audit} /> : <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <ScoreDial score={audit.status === 'completed' ? audit.score : null} size={44} />
        {trend !== null && trend !== 0 ? (
          <p className={`mt-0.5 text-xs tabular-nums ${trend > 0 ? 'text-ok' : 'text-critical'}`}>
            <span aria-hidden="true">{trend > 0 ? '▲' : '▼'}</span>
            <span className="sr-only">{trend > 0 ? 'Sube' : 'Baja'}</span> {Math.abs(trend)}
            <span className="sr-only"> puntos respecto al lanzamiento anterior</span>
          </p>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
        <time dateTime={audit.createdAt}>{formatRelative(audit.createdAt)}</time>
      </td>
    </tr>
  );
}
