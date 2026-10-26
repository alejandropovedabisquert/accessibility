import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { deleteSiteAction } from '@/app/actions';
import { ApiError, getChecks, getSignOffPreview, getSite, listSignOffs } from '@/lib/api';
import { CONFORMANCE_LABEL, displayUrl, formatDateTime, groupByPage, screenLabel, siteCheckOutcome } from '@/lib/format';
import { getReviewer } from '@/lib/reviewer';
import { SearchCheckIcon } from '@/components/icons';
import { Breadcrumbs, Card, FIELD, OutcomeBadge, PageHeader, ScopeBadge, buttonStyles } from '@/components/ui';
import { FindingCard } from '@/components/FindingCard';
import { CreateFindingForm, SignOffForm } from '@/components/ReviewForms';
import { SelectLatestButton } from '@/components/SelectLatestButton';
import { ConfirmDelete } from '@/components/ConfirmDelete';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ muestra?: string | string[]; comprobar?: string }>;
}

const BLOCKER_LABEL = {
  'pending-review': 'Sin validar',
  undecided: 'Sin decidir',
  untested: 'Sin revisar',
  page: 'Página',
  'duplicate-page': 'Repetida',
} as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await getSite(id)).name };
  } catch {
    return { title: 'Sitio' };
  }
}

export default async function SiteDetail({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const rawSample = query.muestra;
  const sample = (Array.isArray(rawSample) ? rawSample : rawSample ? [rawSample] : []).filter(Boolean);
  // Enviado sin elegir nada: sin `comprobar` no se distingue de entrar en la página sin más.
  const emptySample = query.comprobar === '1' && sample.length === 0;

  let site;
  try {
    site = await getSite(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [catalog, reviewer, signOffs, preview] = await Promise.all([
    getChecks(),
    getReviewer(),
    listSignOffs(id),
    sample.length > 0 ? getSignOffPreview(id, sample).catch(() => null) : Promise.resolve(null),
  ]);
  const sampleIndex = new Map((preview?.snapshot.pages ?? []).map((page, index) => [page.id, index + 1]));
  const siteChecks = catalog.checks.filter((check) => check.scope === 'site');
  const pageGroups = groupByPage(site.pages);
  const path = `/sitios/${id}`;

  return (
    <>
      <Breadcrumbs trail={[{ href: '/sitios', label: 'Sitios' }]} current={site.name} />

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
          Páginas escaneadas ({pageGroups.length})
        </h2>
        {pageGroups.length < site.pages.length ? (
          <p className="mb-3 text-sm text-ink-muted">
            Cada página (URL, sección y pantalla) muestra su último escaneo; los anteriores están dentro.
          </p>
        ) : null}
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
                {pageGroups.map(({ key, latest: page, previous }) => (
                  <tr key={key} className="border-t border-line align-top">
                    <th scope="row" className="max-w-md px-4 py-3 text-left font-normal">
                      <Link
                        href={`/auditorias/${page.auditId}/paginas/${page.id}`}
                        className="break-all text-accent underline-offset-2 hover:underline"
                      >
                        {displayUrl(page.url)}
                      </Link>
                      <ScopeBadge scope={page} />
                      {previous.length > 0 ? (
                        <details className="mt-1.5 text-xs">
                          <summary className="cursor-pointer text-ink-muted">
                            {previous.length === 1 ? '1 escaneo anterior' : `${previous.length} escaneos anteriores`}
                          </summary>
                          <ul className="mt-1 space-y-0.5 pl-3">
                            {previous.map((old) => (
                              <li key={old.id}>
                                <Link
                                  href={`/auditorias/${old.auditId}/paginas/${old.id}`}
                                  className="text-accent underline-offset-2 hover:underline"
                                >
                                  {formatDateTime(old.finishedAt)}
                                </Link>
                                {' · '}
                                <Link
                                  href={`/auditorias/${old.auditId}/paginas/${old.id}/revision`}
                                  className="text-accent underline underline-offset-2"
                                >
                                  Revisar<span className="sr-only"> el escaneo del {formatDateTime(old.finishedAt)}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
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

      <section className="mb-10" aria-labelledby="h-firma">
        <h2 id="h-firma" className="mb-1 text-lg font-semibold">
          Firmar la web
        </h2>
        <p className="mb-4 text-sm text-ink-muted">
          Elige la muestra de páginas (WCAG-EM): las plantillas y flujos representativos de la web. Para firmar, todos los
          criterios tienen que estar decididos y todos los hallazgos validados en esas páginas.
        </p>

        {site.pages.length > 0 ? (
          <Card className="mb-4 p-5">
            <form method="get" action={`/sitios/${id}#h-firma`}>
              <input type="hidden" name="comprobar" value="1" />
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Muestra</legend>
                <p className="mb-3 text-xs text-ink-muted">
                  Un escaneo por página como máximo. Si una página se ha escaneado varias veces, elige cuál entra.
                </p>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th scope="col" className="px-3 py-2 font-medium">
                          Página
                        </th>
                        <th scope="col" className="w-72 px-3 py-2 font-medium">
                          Escaneo
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageGroups.map(({ key, latest, previous }) => {
                        // La fila nombra a su control: «Incluir» o un desplegable sueltos no dicen de qué página son.
                        const rowId = `muestra-fila-${latest.id}`;
                        const scans = [latest, ...previous];
                        return (
                          <tr key={key} className="border-b border-line align-middle last:border-0">
                            <th scope="row" id={rowId} className="px-3 py-2.5 text-left font-normal">
                              <span className="block break-all font-medium">{displayUrl(latest.url)}</span>
                              <span className="sr-only">, </span>
                              <span className="mt-0.5 block text-xs text-ink-muted">
                                {screenLabel(latest)}
                                {latest.include ? (
                                  <>
                                    {' · '}
                                    <code>{latest.include}</code>
                                  </>
                                ) : null}
                              </span>
                            </th>
                            <td className="px-3 py-2.5">
                              {previous.length === 0 ? (
                                <label className="inline-flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    name="muestra"
                                    value={latest.id}
                                    defaultChecked={sample.includes(latest.id)}
                                    aria-labelledby={`${rowId} ${rowId}-incluir`}
                                    className="size-4"
                                  />
                                  <span id={`${rowId}-incluir`}>
                                    Incluir
                                    <span className="text-ink-muted"> · {formatDateTime(latest.finishedAt)}</span>
                                  </span>
                                </label>
                              ) : (
                                <select
                                  name="muestra"
                                  aria-labelledby={rowId}
                                  defaultValue={scans.find((scan) => sample.includes(scan.id))?.id ?? ''}
                                  className={FIELD}
                                >
                                  <option value="">No incluir</option>
                                  {scans.map((scan, index) => (
                                    <option key={scan.id} value={scan.id}>
                                      {formatDateTime(scan.finishedAt)}
                                      {index === 0 ? ' (último)' : ''}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </fieldset>
              <div className="mt-4 flex flex-wrap gap-2">
                <SelectLatestButton name="muestra" />
                <button type="submit" className={buttonStyles.secondary}>
                  <SearchCheckIcon />
                  Comprobar la muestra
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        {emptySample ? (
          <p role="alert" className="mb-4 rounded-md border border-moderate/30 bg-moderate-soft px-4 py-3 text-sm text-moderate">
            No has elegido ninguna página: marca o elige al menos un escaneo para comprobar la muestra.
          </p>
        ) : null}

        {sample.length > 0 && !preview ? (
          <p role="alert" className="mb-4 rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical">
            No se pudo calcular la vista previa de esta muestra.
          </p>
        ) : null}

        {preview ? (
          <Card className="space-y-5 p-5">
            <div>
              <p className="text-sm text-ink-muted">Si firmaras ahora, la web quedaría como</p>
              <p className="text-xl font-semibold">{CONFORMANCE_LABEL[preview.snapshot.conformance.status]}</p>
              <p className="mt-1 text-sm">
                Requisitos legales (WCAG 2.1 A/AA): {preview.snapshot.conformance.passed} cumplen,{' '}
                {preview.snapshot.conformance.failed} no cumplen, {preview.snapshot.conformance.inapplicable} no aplican.
                Nuevos de WCAG 2.2 (aún no exigibles): {preview.snapshot.wcag22.failed} no cumplen,{' '}
                {preview.snapshot.wcag22.pending} pendientes.
                {preview.snapshot.aaa
                  ? ` AAA (no exigibles): ${preview.snapshot.aaa.failed} no cumplen, ${preview.snapshot.aaa.pending} pendientes.`
                  : null}
              </p>
            </div>

            {preview.blockers.length > 0 ? (
              <div className="rounded-md border border-moderate/30 bg-moderate-soft px-4 py-3 text-sm text-moderate">
                <p id="pendientes-firma" className="font-medium">
                  Todavía no se puede firmar: {preview.blockers.length} pendiente(s).
                </p>
                {/* Con scroll propio: enfocable para poder desplazarla con el teclado (axe scrollable-region-focusable). */}
                <ul
                  tabIndex={0}
                  aria-labelledby="pendientes-firma"
                  className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5"
                >
                  {preview.blockers.map((blocker, index) => (
                    <li key={`${blocker.kind}-${blocker.checkId}-${blocker.pageId}-${index}`}>
                      <strong>{BLOCKER_LABEL[blocker.kind]}:</strong> {blocker.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
                Todo decidido y validado: se puede firmar.
              </p>
            )}

            <details>
              <summary className="cursor-pointer text-sm font-semibold">Resultado por criterio y página</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Resultado de cada criterio en cada página de la muestra</caption>
                  <thead className="text-xs text-ink-muted">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">Criterio</th>
                      <th scope="col" className="py-1 pr-3 font-medium">Muestra</th>
                      {preview.snapshot.pages.map((page) => (
                        <th key={page.id} scope="col" className="py-1 pr-3 font-medium" title={page.url}>
                          <Link href={`/auditorias/${page.auditId}/paginas/${page.id}/revision`} className="text-accent underline underline-offset-2">
                            P{sampleIndex.get(page.id)}
                            <span className="sr-only"> {displayUrl(page.url)}</span>
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.snapshot.criteria.map((criterion) => (
                      <tr key={criterion.checkId} className="border-t border-line">
                        <th scope="row" className="py-1 pr-3 font-normal">
                          {criterion.criterion} {criterion.name}
                        </th>
                        <td className="py-1 pr-3">
                          <OutcomeBadge outcome={criterion.outcome} />
                        </td>
                        {preview.snapshot.pages.map((page) => (
                          <td key={page.id} className="py-1 pr-3">
                            {criterion.scope === 'site' ? (
                              <span className="text-xs text-ink-muted">sitio</span>
                            ) : (
                              <OutcomeBadge outcome={criterion.byPage[page.id] ?? 'untested'} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <SignOffForm
              siteId={id}
              siteName={site.name}
              pageIds={preview.snapshot.pages.map((page) => page.id)}
              reviewer={reviewer}
              canSign={preview.canSign}
            />
          </Card>
        ) : null}
      </section>

      {signOffs.length > 0 ? (
        <section className="mb-10" aria-labelledby="h-firmas">
          <h2 id="h-firmas" className="mb-3 text-lg font-semibold">
            Firmas ({signOffs.length})
          </h2>
          <Card>
            <ul className="divide-y divide-line">
              {signOffs.map((signOff) => (
                <li key={signOff.id} className="px-5 py-3 text-sm">
                  <Link href={`/firmas/${signOff.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {CONFORMANCE_LABEL[signOff.conformance]} · {formatDateTime(signOff.signedAt)}
                  </Link>
                  <span className="text-ink-muted">
                    {' '}
                    · {signOff.signer}
                    {signOff.credential ? ` (${signOff.credential})` : ''} · {signOff.pageIds.length} página(s)
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <details className="rounded-lg border border-critical/30 bg-surface p-5">
        <summary className="cursor-pointer text-sm font-medium text-critical">Borrar el sitio</summary>
        <p className="mt-3 text-sm">
          Se borran el sitio, sus {site.findings.length} hallazgo(s) de sitio (también los ya validados)
          {signOffs.length > 0 ? (
            <>
              {' '}y <strong>sus {signOffs.length} firma(s)</strong>, con sus informes PDF y EARL
            </>
          ) : null}
          . No se puede deshacer. Las auditorías, sus páginas y los hallazgos de cada página se conservan.
        </p>
        <form action={deleteSiteAction} className="mt-3">
          <input type="hidden" name="id" value={site.id} />
          <ConfirmDelete label={`Borrar ${site.name}`} title={`¿Borrar el sitio ${site.name}?`} confirmLabel="Sí, borrar el sitio">
            <p>
              Se borran sus {site.findings.length} hallazgo(s) de sitio
              {signOffs.length > 0 ? <strong> y sus {signOffs.length} firma(s)</strong> : null}. No se puede deshacer.
            </p>
          </ConfirmDelete>
        </form>
      </details>
    </>
  );
}
