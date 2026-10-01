import { evidenceImageHref } from '@/lib/api';
import { formatViewport } from '@/lib/format';
import type { PageEvidence } from '@/lib/types';
import { Card } from '@/components/ui';

const INDICATOR_LABEL = { changed: 'Cambia', unchanged: 'No cambia', unknown: 'Desconocido' } as const;
const OBSCURED_LABEL = { none: 'Visible', partial: 'Tapado en parte', full: 'Tapado', offscreen: 'Fuera de pantalla' } as const;
const STOP_LABEL = {
  cycle: 'recorrido completo',
  limit: 'se paró en el límite de paradas',
  stuck: 'el foco dejó de avanzar (posible trampa)',
  'no-focusable': 'no hay nada enfocable',
} as const;

function Shot({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a href={href} className="block rounded-md border border-line p-1 hover:border-accent">
        {/* Captura de evidencia servida por el proxy: no pasa por next/image. */}
        <img src={href} alt="" loading="lazy" className="h-28 w-full rounded object-cover object-top" />
        <span className="mt-1 block px-1 text-xs">{label}</span>
      </a>
    </li>
  );
}

/**
 * La evidencia recogida al escanear, para que quien valida vea lo mismo que vio
 * la capa 2. Los listados largos van plegados.
 */
export function EvidencePanel({
  evidence,
  auditId,
  pageId,
}: {
  evidence: PageEvidence;
  auditId: string;
  pageId: string;
}) {
  const href = (name: string) => evidenceImageHref(auditId, pageId, name);
  const { items } = evidence;
  const shots: Array<{ name: string; label: string }> = [];
  if (items.screenshot?.viewport) shots.push({ name: items.screenshot.viewport, label: 'Primera pantalla' });
  if (items.screenshot?.fullPage) {
    shots.push({ name: items.screenshot.fullPage, label: items.screenshot.fullPageTruncated ? 'Página (recortada)' : 'Página entera' });
  }
  for (const [kind, label] of [
    ['reflow-320', 'Reflujo a 320 px'],
    ['zoom-200', 'Zoom al 200 %'],
    ['text-spacing', 'Espaciado de texto'],
  ] as const) {
    const layout = items[kind];
    if (layout?.screenshot) {
      shots.push({ name: layout.screenshot, label: `${label}${layout.horizontalScroll ? ' · scroll horizontal' : ''}` });
    }
  }
  if (items.orientation) {
    for (const side of ['portrait', 'landscape'] as const) {
      const shot = items.orientation[side];
      if (shot.screenshot) shots.push({ name: shot.screenshot, label: `${side === 'portrait' ? 'Vertical' : 'Horizontal'} ${formatViewport(shot.viewport)}` });
    }
  }

  const errors = Object.entries(evidence.errors);
  const focus = items['focus-sequence'];
  const images = items.images;

  return (
    <Card className="space-y-5 p-5">
      {errors.length > 0 ? (
        <div role="note" className="rounded-md border border-moderate/30 bg-moderate-soft px-4 py-3 text-sm text-moderate">
          <p>Parte de la evidencia no se pudo recoger:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map(([kind, message]) => (
              <li key={kind}>
                <code>{kind}</code>: {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {shots.length > 0 ? (
        <section aria-labelledby="h-capturas">
          <h3 id="h-capturas" className="mb-2 text-sm font-semibold">
            Capturas
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shots.map((shot) => (
              <Shot key={shot.name} href={href(shot.name)} label={shot.label} />
            ))}
          </ul>
        </section>
      ) : null}

      {focus ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Recorrido con el tabulador: {focus.stops.length} parada(s), {STOP_LABEL[focus.stoppedBecause]}
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">#</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Elemento</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Indicador de foco</th>
                  <th scope="col" className="py-1 pr-3 font-medium">Visibilidad</th>
                  <th scope="col" className="py-1 font-medium">Captura</th>
                </tr>
              </thead>
              <tbody>
                {focus.stops.map((stop) => (
                  <tr key={stop.index} className="border-t border-line">
                    <td className="py-1 pr-3 tabular-nums">{stop.index + 1}</td>
                    <td className="py-1 pr-3">
                      <span className="block">{stop.name || <em className="text-ink-muted">sin nombre</em>}</span>
                      <code className="text-xs text-ink-muted">{stop.selector}</code>
                    </td>
                    <td className={`py-1 pr-3 ${stop.indicator === 'unchanged' ? 'text-critical' : ''}`}>{INDICATOR_LABEL[stop.indicator]}</td>
                    <td className={`py-1 pr-3 ${stop.obscured === 'full' ? 'text-critical' : ''}`}>{OBSCURED_LABEL[stop.obscured]}</td>
                    <td className="py-1">
                      {stop.screenshot ? (
                        <a href={href(stop.screenshot)} className="text-accent underline underline-offset-2">
                          Ver<span className="sr-only"> la parada {stop.index + 1}</span>
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {images && images.items.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Imágenes: {images.total}
            {images.total > images.items.length ? ` (se muestran ${images.items.length})` : ''}
          </summary>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {images.items.map((image) => (
              <li key={image.selector} className="flex gap-3 rounded-md border border-line p-2 text-sm">
                {image.screenshot ? (
                  <img src={href(image.screenshot)} alt="" loading="lazy" className="size-16 shrink-0 rounded object-contain" />
                ) : null}
                <div className="min-w-0">
                  <p>
                    {image.alt === null ? (
                      <span className="text-critical">Sin atributo alt</span>
                    ) : image.alt === '' ? (
                      <span className="text-ink-muted">alt vacío (decorativa)</span>
                    ) : (
                      <>alt: &laquo;{image.alt}&raquo;</>
                    )}
                  </p>
                  <code className="block truncate text-xs text-ink-muted">{image.selector}</code>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
