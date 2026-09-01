import type { HistoryPoint } from '@/lib/types';
import { formatDateTime } from '@/lib/format';

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

/**
 * Evolucion de incumplimientos a lo largo del tiempo, en SVG plano.
 *
 * Sin libreria de graficos: son pocos puntos y asi controlamos el marcado
 * accesible. Debajo va siempre una tabla con los mismos datos, que es lo que
 * leen los lectores de pantalla.
 */
export function HistoryChart({ points, label }: { points: HistoryPoint[]; label: string }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-ink-muted">
        Hace falta al menos un segundo escaneo de esta URL para ver su evolución.
      </p>
    );
  }

  const values = points.map((point) => point.violations);
  const max = Math.max(...values, 1);
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;

  const x = (index: number) => PAD.left + (index / (points.length - 1)) * innerWidth;
  const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight;

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.violations)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${PAD.top + innerHeight} L ${PAD.left} ${PAD.top + innerHeight} Z`;

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = last - first;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-sm text-ink-muted">
        {label}
        {delta !== 0 ? (
          <span className={delta < 0 ? 'ml-2 font-medium text-ok' : 'ml-2 font-medium text-critical'}>
            {delta < 0 ? '↓' : '↑'} {Math.abs(delta)} desde el primer escaneo
          </span>
        ) : (
          <span className="ml-2">sin cambio neto desde el primer escaneo</span>
        )}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Evolución de incumplimientos en ${points.length} escaneos: de ${first} a ${last}`}
      >
        {[0, 0.5, 1].map((ratio) => {
          const value = Math.round(max * (1 - ratio));
          const lineY = PAD.top + ratio * innerHeight;
          return (
            <g key={ratio}>
              <line x1={PAD.left} y1={lineY} x2={WIDTH - PAD.right} y2={lineY} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PAD.left - 6} y={lineY} textAnchor="end" dominantBaseline="central" fontSize="10" fill="var(--color-ink-muted)">
                {value}
              </text>
            </g>
          );
        })}

        <path d={area} fill="var(--color-accent)" opacity="0.12" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />

        {points.map((point, index) => (
          <circle key={point.pageId} cx={x(index)} cy={y(point.violations)} r="3.5" fill="var(--color-accent)">
            <title>{`${formatDateTime(point.finishedAt)}: ${point.violations} incumplimientos`}</title>
          </circle>
        ))}
      </svg>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-ink-muted">Ver los datos en tabla</summary>
        <table className="mt-2 w-full border-collapse text-sm">
          <caption className="sr-only">Incumplimientos por escaneo</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="py-2 pr-4 font-medium">Fecha</th>
              <th scope="col" className="py-2 pr-4 font-medium">Incumplimientos</th>
              <th scope="col" className="py-2 pr-4 font-medium">Elementos</th>
              <th scope="col" className="py-2 font-medium">Reglas superadas</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((point) => (
              <tr key={point.pageId} className="border-b border-line last:border-0">
                <td className="py-2 pr-4">{formatDateTime(point.finishedAt)}</td>
                <td className="py-2 pr-4 tabular-nums">{point.violations}</td>
                <td className="py-2 pr-4 tabular-nums">{point.violationNodes}</td>
                <td className="py-2 tabular-nums">{point.score === null ? '—' : `${point.score}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
