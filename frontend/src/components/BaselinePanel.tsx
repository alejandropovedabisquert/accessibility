import Link from 'next/link';
import { displayUrl, formatDateTime, screenLabel } from '@/lib/format';
import type { AuditPage, BaselineReport, HeirsOverview, NotInheritedReason } from '@/lib/types';
import { Card } from '@/components/ui';
import { BaselineForm, HeirsForm, RecalculateHeirsForm, UnlinkBaselineForm } from '@/components/ReviewForms';

const REGION_LABEL = { same: 'Igual', changed: 'Cambia', 'only-baseline': 'Solo en la línea base', 'only-page': 'Solo en esta página' } as const;
const REGION_STYLE = { same: 'text-ok', changed: 'text-moderate', 'only-baseline': 'text-ink-muted', 'only-page': 'text-ink-muted' } as const;
const FOCUS_LABEL = { same: 'igual que en la línea base', different: 'distinto al de la línea base', unavailable: 'sin datos' } as const;

const REASON_LABEL: Record<NotInheritedReason, string> = {
  'targets-changed': 'los elementos o su región no son iguales',
  'page-changed': 'no tiene elementos concretos y la página no es igual entera',
  'already-reviewed': 'esta página ya tiene su propia revisión',
  'not-in-page': 'la regla de axe de la que sale no aparece aquí',
  'not-inheritable': 'es una propuesta automática que cada página calcula',
};

/**
 * Línea base de la página: de qué página hereda, qué regiones coinciden, qué
 * se ha heredado y por qué no lo demás.
 */
export function BaselinePanel({
  report,
  auditId,
  pageId,
  path,
  reviewer,
}: {
  report: BaselineReport | null;
  auditId: string;
  pageId: string;
  path: string;
  reviewer: string;
}) {
  if (!report) {
    return (
      <Card className="p-5">
        <p className="text-sm text-ink-muted">
          No hereda de ninguna página. Las herencias se reparten desde la línea base: abre la revisión de la página que
          ya está revisada y elige allí cuáles heredan de ella.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm">
        Hereda de{' '}
        <Link
          href={`/auditorias/${report.baseline.auditId}/paginas/${report.baseline.pageId}/revision`}
          className="text-accent underline underline-offset-2"
        >
          {displayUrl(report.baseline.url)}
        </Link>{' '}
        · enlazada por {report.linkedBy} el {formatDateTime(report.linkedAt)}.{' '}
        {report.wholePageMatch ? 'La página es estructuralmente igual entera.' : null} Recorrido con el tabulador:{' '}
        {FOCUS_LABEL[report.focusSequence]}.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="h-regiones">
          <h3 id="h-regiones" className="mb-2 text-sm font-semibold">
            Regiones
          </h3>
          <ul className="space-y-1 text-sm">
            {report.regions.map((region) => (
              <li key={`${region.selector}-${region.status}`}>
                <span className={`font-medium ${REGION_STYLE[region.status]}`}>{REGION_LABEL[region.status]}</span>{' '}
                {region.role ?? 'región'} <code className="text-xs text-ink-muted">{region.selector}</code>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-heredado">
          <h3 id="h-heredado" className="mb-2 text-sm font-semibold">
            Heredado: {report.inherited.length} · No heredado: {report.notInherited.length}
          </h3>
          {report.inherited.length > 0 ? (
            <p className="text-sm">{report.inherited.map((item) => item.criterion).join(', ')}</p>
          ) : null}
          {report.notInherited.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-ink-muted">
              {report.notInherited.map((item) => (
                <li key={item.fromFindingId}>
                  {item.criterion}: {REASON_LABEL[item.reason]}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <p className="text-xs text-ink-muted">
        Lo heredado sigue al original: si se corrige o se rechaza allí, cambia aquí también. Si la línea base tiene hallazgos
        nuevos, recalcula para traerlos (aquí, o para todas sus herederas desde la línea base).
      </p>
      <div className="flex flex-wrap items-start gap-6">
        <BaselineForm auditId={auditId} pageId={pageId} path={path} reviewer={reviewer} current={report.baseline.pageId} />
        <UnlinkBaselineForm auditId={auditId} pageId={pageId} path={path} />
      </div>
    </Card>
  );
}

const pageLabel = (page: AuditPage) =>
  `${displayUrl(page.url)}${page.include ? ` · ${page.include}` : ''} · ${screenLabel(page)}`;

/**
 * Herederas: las páginas que heredan de esta, elegidas desde aquí. Una heredera no puede ser línea base
 * (sin cadenas: lo heredado viene siempre de una página revisada a mano).
 */
export function HeirsPanel({
  overview,
  auditId,
  pageId,
  path,
  reviewer,
}: {
  overview: HeirsOverview;
  auditId: string;
  pageId: string;
  path: string;
  reviewer: string;
}) {
  const heirs = overview.candidates.filter((candidate) => candidate.status === 'heir');
  const others = overview.candidates.filter((candidate) => candidate.status !== 'heir');

  return (
    <Card className="space-y-4 p-5">
      {overview.chain ? (
        <p role="alert" className="rounded-md border border-moderate/30 bg-moderate-soft px-3 py-2 text-sm text-moderate">
          Esta página hereda y a la vez tiene herederas, una cadena de antes de que se prohibieran. Quítale su herencia o
          quita la de sus herederas: mientras tanto no se pueden recalcular.
        </p>
      ) : null}

      {heirs.length > 0 ? (
        <section aria-labelledby="h-herederas" className="space-y-3">
          <h3 id="h-herederas" className="text-sm font-semibold">
            Heredan de esta: {heirs.length}
          </h3>
          <ul className="space-y-2">
            {heirs.map(({ page, inherited, notInherited }) => (
              <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  <Link
                    href={`/auditorias/${page.auditId}/paginas/${page.id}/revision`}
                    className="text-accent underline underline-offset-2"
                  >
                    {pageLabel(page)}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {inherited ?? 0} heredado(s) · {notInherited ?? 0} sin heredar, a revisar en la página
                  </span>
                </span>
                <UnlinkBaselineForm auditId={page.auditId} pageId={page.id} path={path} label="Quitar herencia" />
              </li>
            ))}
          </ul>
          {!overview.inheritsFrom ? (
            <RecalculateHeirsForm
              auditId={auditId}
              pageId={pageId}
              path={path}
              reviewer={reviewer}
              heirIds={heirs.map(({ page }) => page.id)}
            />
          ) : null}
        </section>
      ) : null}

      {overview.inheritsFrom ? (
        <p className="text-sm text-ink-muted">
          Esta página hereda de {displayUrl(overview.inheritsFrom.url)}, así que no puede ser línea base de otras. Para
          repartir desde aquí, quítale antes su herencia.
        </p>
      ) : overview.decidedFindings === 0 ? (
        <p className="text-sm text-ink-muted">
          Aún no tiene hallazgos propios decididos: valida o corrige alguno para poder repartirlo.
        </p>
      ) : others.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {heirs.length > 0
            ? 'Todas las páginas comparables heredan ya de esta.'
            : 'No hay más páginas de la misma pantalla en esta auditoría o en su sitio.'}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Elige las páginas que comparten plantilla con esta: heredan, ya validados, sus {overview.decidedFindings}{' '}
            hallazgo(s) decididos cuyos elementos y región (cabecera, navegación, pie…) sean estructuralmente iguales. Lo que
            cambie se queda para revisar en cada una. Cada página tarda unos segundos.
          </p>
          <HeirsForm
            auditId={auditId}
            pageId={pageId}
            path={path}
            reviewer={reviewer}
            options={others.map((candidate) => ({
              id: candidate.page.id,
              label: pageLabel(candidate.page),
              disabledReason:
                candidate.status === 'other-baseline'
                  ? `Ya hereda de ${displayUrl(candidate.baselineUrl ?? '')}: quítale esa herencia para moverla aquí.`
                  : candidate.status === 'has-heirs'
                    ? 'Es línea base de otras páginas: no puede heredar.'
                    : undefined,
            }))}
          />
        </>
      )}
    </Card>
  );
}
