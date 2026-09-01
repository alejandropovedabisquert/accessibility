import Link from 'next/link';
import { Suspense } from 'react';
import { listAudits } from '@/lib/api';
import { formatRelative, isInProgress } from '@/lib/format';
import type { AuditStatus } from '@/lib/types';
import { AuditFilters } from '@/components/AuditFilters';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Pagination } from '@/components/Pagination';
import { Card, EmptyState, ImpactBreakdown, PageHeader, ScoreDial, StatusBadge, buttonStyles } from '@/components/ui';

interface Props {
  searchParams: Promise<{ page?: string; status?: string; search?: string }>;
}

export default async function AuditsPage({ searchParams }: Props) {
  const params = await searchParams;
  const page = Number(params.page) || 1;

  const result = await listAudits({
    page,
    pageSize: 20,
    status: params.status,
    search: params.search,
  });

  const hasFilters = Boolean(params.search || params.status);
  const anyInProgress = result.items.some((audit) => isInProgress(audit.status));

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
        description="Histórico de escaneos de accesibilidad. Cada auditoría guarda su resultado completo."
        actions={
          <Link href="/nueva" className={buttonStyles.primary}>
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
              Listado de auditorías de accesibilidad, de la más reciente a la más antigua
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
              {result.items.map((audit) => (
                <tr key={audit.id} className="border-b border-line last:border-0 hover:bg-surface-muted">
                  <th scope="row" className="max-w-xs px-4 py-3 text-left font-normal">
                    <Link
                      href={`/auditorias/${audit.id}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {audit.label ?? `Auditoría de ${audit.totalPages} URL(s)`}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {audit.config.browser}
                      {audit.config.device ? ` · ${audit.config.device}` : ''}
                    </p>
                  </th>
                  <td className="px-4 py-3">
                    <StatusBadge status={audit.status as AuditStatus} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {audit.completedPages}/{audit.totalPages}
                    {audit.failedPages > 0 ? (
                      <span className="ml-1 text-xs text-critical">({audit.failedPages} fallida)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {audit.status === 'completed' ? <ImpactBreakdown counters={audit} /> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreDial score={audit.status === 'completed' ? audit.score : null} size={44} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                    <time dateTime={audit.createdAt}>{formatRelative(audit.createdAt)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} total={result.total} buildHref={buildHref} />
    </>
  );
}
