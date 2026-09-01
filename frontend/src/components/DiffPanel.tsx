import Link from 'next/link';
import type { PageDiff } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { Card, ImpactBadge } from '@/components/ui';

/** Comparacion contra el escaneo anterior de la misma URL. */
export function DiffPanel({ diff }: { diff: PageDiff }) {
  if (!diff.previous) {
    return (
      <Card className="px-5 py-6 text-sm text-ink-muted">
        Es el primer escaneo de esta URL, así que todavía no hay nada con lo que compararla.
      </Card>
    );
  }

  const clean = diff.added.length === 0 && diff.resolved.length === 0 && diff.changed.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Comparado con el escaneo del {formatDateTime(diff.previous.finishedAt)} (
        <Link
          href={`/auditorias/${diff.previous.auditId}/paginas/${diff.previous.pageId}`}
          className="text-accent underline underline-offset-2"
        >
          ver aquella auditoría
        </Link>
        ).
      </p>

      {clean ? (
        <Card className="px-5 py-6 text-sm">
          Sin cambios respecto al escaneo anterior: las mismas {diff.unchanged} reglas siguen incumpliéndose.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DiffGroup
            title="Resueltos"
            tone="ok"
            empty="Nada resuelto desde el escaneo anterior."
            items={diff.resolved.map((issue) => ({
              key: issue.ruleId,
              impact: issue.impact,
              text: issue.help,
              detail: `${issue.nodeCount} elemento(s) ya no fallan`,
            }))}
          />
          <DiffGroup
            title="Nuevos"
            tone="critical"
            empty="No ha aparecido ningún incumplimiento nuevo."
            items={diff.added.map((issue) => ({
              key: issue.ruleId,
              impact: issue.impact,
              text: issue.help,
              detail: `${issue.nodeCount} elemento(s) afectados`,
            }))}
          />
          {diff.changed.length > 0 ? (
            <div className="lg:col-span-2">
              <DiffGroup
                title="Cambios en el número de elementos"
                tone="neutral"
                empty=""
                items={diff.changed.map((issue) => ({
                  key: issue.ruleId,
                  impact: issue.impact,
                  text: issue.help,
                  detail: `${issue.previousNodeCount} → ${issue.nodeCount} elementos`,
                  worse: issue.nodeCount > issue.previousNodeCount,
                }))}
              />
            </div>
          ) : null}
        </div>
      )}

      <p className="text-sm text-ink-muted">{diff.unchanged} regla(s) siguen igual que antes.</p>
    </div>
  );
}

interface DiffItem {
  key: string;
  impact: PageDiff['added'][number]['impact'];
  text: string;
  detail: string;
  worse?: boolean;
}

const TONE = {
  ok: 'border-ok/30 bg-ok-soft',
  critical: 'border-critical/30 bg-critical-soft',
  neutral: 'border-line bg-surface',
};

function DiffGroup({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: keyof typeof TONE;
  items: DiffItem[];
  empty: string;
}) {
  return (
    <section className={`rounded-lg border p-4 ${TONE[tone]}`}>
      <h3 className="mb-3 text-sm font-semibold">
        {title} <span className="font-normal text-ink-muted">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline gap-2 text-sm">
              <ImpactBadge impact={item.impact} />
              <span>{item.text}</span>
              <span className={`text-xs ${item.worse ? 'text-critical' : 'text-ink-muted'}`}>{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
