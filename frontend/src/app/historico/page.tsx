import Link from 'next/link';
import type { Metadata } from 'next';
import { getHistory, getMeta, getScannedUrls } from '@/lib/api';
import { displayUrl, formatRelative, screenLabel, screenQuery, sectionLabel } from '@/lib/format';
import type { ScannedUrl } from '@/lib/types';
import { HistoryChart } from '@/components/HistoryChart';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Histórico' };

interface Props {
  searchParams: Promise<{ url?: string; include?: string; viewport?: string; device?: string }>;
}

type Series = Pick<ScannedUrl, 'url' | 'include' | 'viewport' | 'device'>;

/** Una serie es URL + seccion + pantalla, asi que hace falta todo para identificarla. */
const seriesKey = (series: Series) => {
  const { viewport = '', device = '' } = screenQuery(series);
  return [series.url, series.include ?? '', viewport, device].join('\n');
};

const seriesHref = (series: Series) => {
  const query = new URLSearchParams({ url: series.url, ...screenQuery(series) });
  if (series.include) query.set('include', series.include);
  return `/historico?${query.toString()}`;
};

export default async function HistoryPage({ searchParams }: Props) {
  const { url, include, viewport, device } = await searchParams;
  const [urls, meta] = await Promise.all([getScannedUrls(), getMeta().catch(() => null)]);

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

  const requested = url
    ? [url, include ?? '', viewport ?? '', device ?? ''].join('\n')
    : null;
  // Los enlaces de antes de los viewports multiples no llevan pantalla: se
  // cae en la primera serie de esa URL y seccion.
  const selected =
    urls.find((item) => seriesKey(item) === requested) ??
    urls.find((item) => item.url === url && (item.include ?? '') === (include ?? '')) ??
    urls[0] ??
    null;
  const history = selected
    ? await getHistory(selected.url, selected.include, selected, 50).catch(() => null)
    : null;

  return (
    <>
      <PageHeader
        title="Histórico por URL"
        description="Cómo evoluciona el número de incumplimientos de cada URL a lo largo de los escaneos."
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label="Series auditadas">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Series auditadas ({urls.length})
          </h2>
          <Card className="divide-y divide-line">
            {urls.map((item) => {
              const key = seriesKey(item);
              const active = selected !== null && key === seriesKey(selected);
              const scope = sectionLabel(item.include, meta?.sections);

              return (
                <Link
                  key={key}
                  href={seriesHref(item)}
                  aria-current={active ? 'true' : undefined}
                  className={`block px-4 py-3 text-sm transition-colors hover:bg-surface-muted ${
                    active ? 'bg-accent-soft' : ''
                  }`}
                >
                  <span className="block break-all font-medium">{displayUrl(item.url)}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {scope ? `${scope} · ` : ''}
                    {screenLabel(item)} · {item.runs} escaneo(s) · {formatRelative(item.lastScan)}
                  </span>
                </Link>
              );
            })}
          </Card>
        </nav>

        <div>
          {history && selected ? (
            <Card className="p-5">
              <h2 className="mb-4 break-all text-base font-semibold">
                {displayUrl(selected.url)}
                {sectionLabel(selected.include, meta?.sections)
                  ? ` · ${sectionLabel(selected.include, meta?.sections)}`
                  : ''}
                {` · ${screenLabel(selected)}`}
              </h2>
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
