import Link from 'next/link';
import type { Metadata } from 'next';
import { getHistory, getScannedUrls } from '@/lib/api';
import { displayUrl, formatRelative } from '@/lib/format';
import { HistoryChart } from '@/components/HistoryChart';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Histórico' };

interface Props {
  searchParams: Promise<{ url?: string }>;
}

export default async function HistoryPage({ searchParams }: Props) {
  const { url } = await searchParams;
  const urls = await getScannedUrls();

  if (urls.length === 0) {
    return (
      <>
        <PageHeader title="Histórico" />
        <EmptyState
          title="Todavía no hay histórico"
          description="En cuanto escanees una URL más de una vez podrás ver aquí cómo evoluciona."
          action={{ href: '/nueva', label: 'Lanzar una auditoría' }}
        />
      </>
    );
  }

  const selected = url && urls.some((item) => item.url === url) ? url : urls[0]?.url;
  const history = selected ? await getHistory(selected, 50).catch(() => null) : null;

  return (
    <>
      <PageHeader
        title="Histórico por URL"
        description="Cómo evoluciona el número de incumplimientos de cada URL a lo largo de los escaneos."
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="URLs auditadas">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            URLs auditadas ({urls.length})
          </h2>
          <Card className="divide-y divide-line">
            {urls.map((item) => {
              const active = item.url === selected;
              return (
                <Link
                  key={item.url}
                  href={`/historico?url=${encodeURIComponent(item.url)}`}
                  aria-current={active ? 'true' : undefined}
                  className={`block px-4 py-3 text-sm transition-colors hover:bg-surface-muted ${
                    active ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span className="block break-all font-medium">{displayUrl(item.url)}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {item.runs} escaneo(s) · {formatRelative(item.lastScan)}
                  </span>
                </Link>
              );
            })}
          </Card>
        </nav>

        <div>
          {history && selected ? (
            <Card className="p-5">
              <h2 className="mb-4 break-all text-base font-semibold">{displayUrl(selected)}</h2>
              <HistoryChart points={history.points} label="Incumplimientos por escaneo" />
              {history.points.length > 0 ? (
                <p className="mt-4 text-sm">
                  <Link
                    href={`/auditorias/${history.points[history.points.length - 1]!.auditId}/paginas/${history.points[history.points.length - 1]!.pageId}`}
                    className="text-accent underline underline-offset-2"
                  >
                    Ver el último resultado en detalle →
                  </Link>
                </p>
              ) : null}
            </Card>
          ) : (
            <Card className="px-5 py-8 text-sm text-ink-muted">No se pudo cargar el histórico.</Card>
          )}
        </div>
      </div>
    </>
  );
}
