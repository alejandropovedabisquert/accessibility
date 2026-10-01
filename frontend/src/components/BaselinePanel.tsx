import Link from 'next/link';
import { displayUrl, formatDateTime, screenLabel } from '@/lib/format';
import type { AuditPage, BaselineReport, NotInheritedReason } from '@/lib/types';
import { Card } from '@/components/ui';
import { BaselineForm, UnlinkBaselineForm } from '@/components/ReviewForms';

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
  candidates,
  auditId,
  pageId,
  path,
  reviewer,
}: {
  report: BaselineReport | null;
  candidates: Array<{ page: AuditPage; decidedFindings: number }>;
  auditId: string;
  pageId: string;
  path: string;
  reviewer: string;
}) {
  if (!report) {
    const usable = candidates
      .filter((candidate) => candidate.decidedFindings > 0)
      .map((candidate) => ({
        id: candidate.page.id,
        label: `${displayUrl(candidate.page.url)}${candidate.page.include ? ` · ${candidate.page.include}` : ''} · ${screenLabel(candidate.page)} · ${candidate.decidedFindings} hallazgo(s) decidido(s)`,
      }));
    return (
      <Card className="space-y-3 p-5">
        <p className="text-sm">
          Si esta página comparte plantilla con otra ya revisada, enlázala como línea base: se heredan, ya validados, los
          hallazgos cuyos elementos y región (cabecera, navegación, pie…) son estructuralmente iguales en las dos. Lo que
          cambie se queda para revisar aquí.
        </p>
        {usable.length > 0 ? (
          <BaselineForm auditId={auditId} pageId={pageId} path={path} reviewer={reviewer} candidates={usable} />
        ) : (
          <p className="text-sm text-ink-muted">
            No hay ninguna página de la misma pantalla, en esta auditoría o en su sitio, con hallazgos ya decididos.
          </p>
        )}
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
        nuevos, recalcula para traerlos.
      </p>
      <div className="flex flex-wrap items-start gap-6">
        <BaselineForm auditId={auditId} pageId={pageId} path={path} reviewer={reviewer} candidates={[]} current={report.baseline.pageId} />
        <UnlinkBaselineForm auditId={auditId} pageId={pageId} path={path} />
      </div>
    </Card>
  );
}
