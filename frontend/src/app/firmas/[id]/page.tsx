import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ApiError, getSignOff } from '@/lib/api';
import { CONFORMANCE_LABEL, displayUrl, formatDateTime, screenLabel } from '@/lib/format';
import { Card, OutcomeBadge, PageHeader, buttonStyles } from '@/components/ui';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: `Firma · ${(await getSignOff(id)).snapshot.site.name}` };
  } catch {
    return { title: 'Firma' };
  }
}

/** Una firma tal y como se firmó. Todo sale de la copia congelada, no de los datos de ahora. */
export default async function SignOffView({ params }: Props) {
  const { id } = await params;

  let signOff;
  try {
    signOff = await getSignOff(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { snapshot } = signOff;
  const pageIndex = new Map(snapshot.pages.map((page, index) => [page.id, index + 1]));

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
          <li>
            <Link href={`/sitios/${snapshot.site.id}`} className="text-accent underline-offset-2 hover:underline">
              {snapshot.site.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">Firma del {formatDateTime(signOff.signedAt)}</li>
        </ol>
      </nav>

      <PageHeader
        title={CONFORMANCE_LABEL[signOff.conformance]}
        description={
          <>
            {snapshot.site.name} · firmado por <strong>{signOff.signer}</strong>
            {signOff.credential ? ` (${signOff.credential})` : ''} el {formatDateTime(signOff.signedAt)}
          </>
        }
        actions={
          <>
            <a href={`/api/backend/sign-offs/${id}/report.pdf`} className={buttonStyles.primary}>
              Descargar informe PDF
            </a>
            <a href={`/api/backend/sign-offs/${id}/earl?download=1`} className={buttonStyles.secondary}>
              Descargar EARL (JSON-LD)
            </a>
          </>
        }
      />

      {signOff.stillMatches === false ? (
        <p role="note" className="mb-6 rounded-md border border-moderate/30 bg-moderate-soft px-4 py-3 text-sm text-moderate">
          Algún hallazgo de esta muestra ha cambiado después de firmar. Lo de aquí es lo que se firmó; para que valga lo
          actual hay que volver a firmar.
        </p>
      ) : signOff.stillMatches === null ? (
        <p role="note" className="mb-6 rounded-md border border-line bg-surface-muted px-4 py-3 text-sm">
          Ya no se puede comprobar si lo firmado sigue vigente: se ha borrado alguna auditoría de la muestra.
        </p>
      ) : (
        <p className="mb-6 rounded-md border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
          Lo firmado coincide con los hallazgos actuales.
        </p>
      )}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Requisitos legales que cumplen', snapshot.conformance.passed],
          ['Que no cumplen', snapshot.conformance.failed],
          ['Que no aplican', snapshot.conformance.inapplicable],
          ['WCAG 2.2 que no cumplen', snapshot.wcag22.failed],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-surface px-3 py-2">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Card className="mb-8 p-5">
        <h2 className="mb-2 font-semibold">Declaración</h2>
        <p className="whitespace-pre-line text-sm">{signOff.statement}</p>
        <p className="mt-3 break-all text-xs text-ink-muted">
          Huella de lo firmado (SHA-256): <code>{signOff.findingsHash}</code>
        </p>
      </Card>

      <section className="mb-8" aria-labelledby="h-muestra">
        <h2 id="h-muestra" className="mb-3 text-lg font-semibold">
          Muestra ({snapshot.pages.length})
        </h2>
        <Card>
          <ul className="divide-y divide-line">
            {snapshot.pages.map((page) => (
              <li key={page.id} className="px-5 py-3 text-sm">
                <span className="mr-2 font-medium tabular-nums">P{pageIndex.get(page.id)}</span>
                {displayUrl(page.url)} · {screenLabel(page)}
                {page.include ? ` · solo ${page.include}` : ''}
                <span className="text-ink-muted"> · escaneada el {formatDateTime(page.finishedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section aria-labelledby="h-criterios">
        <h2 id="h-criterios" className="mb-3 text-lg font-semibold">
          Resultado por criterio
        </h2>
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Criterio</th>
                <th scope="col" className="px-4 py-2 font-medium">Nivel</th>
                <th scope="col" className="px-4 py-2 font-medium">Resultado</th>
                <th scope="col" className="px-4 py-2 font-medium">Falla en</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.criteria.map((criterion) => (
                <tr key={criterion.checkId} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 font-normal">
                    {criterion.criterion} {criterion.name}
                    {criterion.legal ? null : <span className="ml-2 text-xs text-ink-muted">WCAG 2.2</span>}
                  </th>
                  <td className="px-4 py-2">{criterion.level}</td>
                  <td className="px-4 py-2">
                    <OutcomeBadge outcome={criterion.outcome} />
                  </td>
                  <td className="px-4 py-2 text-ink-muted">
                    {criterion.scope === 'site'
                      ? criterion.outcome === 'failed'
                        ? 'Sitio'
                        : ''
                      : Object.entries(criterion.byPage)
                          .filter(([, outcome]) => outcome === 'failed')
                          .map(([pageId]) => `P${pageIndex.get(pageId) ?? '?'}`)
                          .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </>
  );
}
