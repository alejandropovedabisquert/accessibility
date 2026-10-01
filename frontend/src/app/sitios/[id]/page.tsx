import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { deleteSiteAction } from '@/app/actions';
import { ApiError, getChecks, getSite } from '@/lib/api';
import { displayUrl, formatDateTime, screenLabel, siteCheckOutcome } from '@/lib/format';
import { getReviewer } from '@/lib/reviewer';
import { Card, OutcomeBadge, PageHeader, ScopeBadge, buttonStyles } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { CreateFindingForm } from '@/components/ReviewForms';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await getSite(id)).name };
  } catch {
    return { title: 'Sitio' };
  }
}

export default async function SiteDetail({ params }: Props) {
  const { id } = await params;

  let site;
  try {
    site = await getSite(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [catalog, reviewer] = await Promise.all([getChecks(), getReviewer()]);
  const siteChecks = catalog.checks.filter((check) => check.scope === 'site');
  const path = `/sitios/${id}`;

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-3 text-sm">
        <ol className="flex flex-wrap items-center gap-1.5 text-ink-muted">
          <li>
            <Link href="/sitios" className="text-accent underline-offset-2 hover:underline">
              Sitios
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{site.name}</li>
        </ol>
      </nav>

      <PageHeader title={site.name} description={<>Hosts: {site.origins.join(', ')}</>} />

      <section className="mb-10" aria-labelledby="h-criterios-sitio">
        <h2 id="h-criterios-sitio" className="mb-1 text-lg font-semibold">
          Criterios de sitio
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          Se evalúan comparando varias páginas del sitio, no página a página.
        </p>
        <div className="space-y-4">
          {siteChecks.map((check) => {
            const findings = site.findings.filter((finding) => finding.source.checkId === check.id);
            return (
              <Card key={check.id} className="p-5">
                <section aria-labelledby={`h-${check.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`h-${check.id}`} className="font-semibold">
                      {check.criterion} {check.name}
                      <span className="ml-2 text-xs font-normal text-ink-muted">Nivel {check.level}</span>
                    </h3>
                    <OutcomeBadge outcome={siteCheckOutcome(findings)} />
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">{check.instructions}</p>
                  {findings.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {findings.map((finding) => (
                        <FindingCard key={finding.id} finding={finding} path={path} reviewer={reviewer} />
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <CreateFindingForm checkId={check.id} target={{ siteId: id }} path={path} reviewer={reviewer} />
                  </div>
                </section>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="mb-10" aria-labelledby="h-paginas">
        <h2 id="h-paginas" className="mb-3 text-lg font-semibold">
          Páginas escaneadas ({site.pages.length})
        </h2>
        {site.pages.length === 0 ? (
          <Card className="px-5 py-6 text-sm text-ink-muted">
            Aún no hay páginas escaneadas de estos hosts. Lanza una auditoría con URLs del sitio.
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">URL</th>
                  <th scope="col" className="px-4 py-3 font-medium">Pantalla</th>
                  <th scope="col" className="px-4 py-3 font-medium">Escaneada</th>
                  <th scope="col" className="px-4 py-3 font-medium">Revisión manual</th>
                </tr>
              </thead>
              <tbody>
                {site.pages.map((page) => (
                  <tr key={page.id} className="border-t border-line">
                    <th scope="row" className="max-w-md px-4 py-3 text-left font-normal">
                      <Link
                        href={`/auditorias/${page.auditId}/paginas/${page.id}`}
                        className="break-all text-accent underline-offset-2 hover:underline"
                      >
                        {displayUrl(page.url)}
                      </Link>
                      <ScopeBadge scope={page} />
                    </th>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{screenLabel(page)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{formatDateTime(page.finishedAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/auditorias/${page.auditId}/paginas/${page.id}/revision`}
                        className="text-accent underline underline-offset-2"
                      >
                        Revisar<span className="sr-only"> {displayUrl(page.url)} en {screenLabel(page)}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <details className="rounded-lg border border-critical/30 bg-surface p-5">
        <summary className="cursor-pointer text-sm font-medium text-critical">Borrar el sitio</summary>
        <p className="mt-3 text-sm">
          Se borran el sitio y sus {site.findings.length} hallazgo(s) de sitio, también los ya validados. Las auditorías,
          sus páginas y los hallazgos de cada página se conservan.
        </p>
        <form action={deleteSiteAction} className="mt-3">
          <input type="hidden" name="id" value={site.id} />
          <button type="submit" className={buttonStyles.danger}>
            Borrar {site.name}
          </button>
        </form>
      </details>
    </>
  );
}
