'use client';

import { useMemo, useState } from 'react';
import type { AxeRule, Impact } from '@/lib/types';
import { IMPACT_LABEL } from '@/lib/format';
import { Card, ImpactBadge } from '@/components/ui';

const ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const FILTERS: Array<Impact | 'all'> = ['all', 'critical', 'serious', 'moderate', 'minor'];

/** Un nodo puede traer un HTML enorme; en pantalla no aporta pasar de esto. */
const MAX_HTML = 400;
const MAX_NODES_SHOWN = 10;

export function ViolationList({ rules, emptyMessage }: { rules: AxeRule[]; emptyMessage: string }) {
  const [filter, setFilter] = useState<Impact | 'all'>('all');

  const sorted = useMemo(
    () =>
      [...rules].sort(
        (a, b) =>
          (ORDER[a.impact ?? ''] ?? 9) - (ORDER[b.impact ?? ''] ?? 9) || b.nodes.length - a.nodes.length
      ),
    [rules]
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: rules.length };
    for (const rule of rules) {
      const key = rule.impact ?? 'sin';
      result[key] = (result[key] ?? 0) + 1;
    }
    return result;
  }, [rules]);

  const visible = filter === 'all' ? sorted : sorted.filter((rule) => rule.impact === filter);

  if (rules.length === 0) {
    return (
      <Card className="px-5 py-8 text-center text-sm text-ok">{emptyMessage}</Card>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span id="filtro-impacto" className="text-xs font-medium text-ink-muted">
          Filtrar por severidad:
        </span>
        <div role="group" aria-labelledby="filtro-impacto" className="flex flex-wrap gap-1.5">
          {FILTERS.filter((key) => key === 'all' || (counts[key] ?? 0) > 0).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === key
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-line bg-surface text-ink-muted hover:bg-surface-muted'
              }`}
            >
              {key === 'all' ? 'Todas' : IMPACT_LABEL[key]} ({counts[key] ?? 0})
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        Mostrando {visible.length} de {rules.length} reglas.
      </p>

      <ul className="space-y-3">
        {visible.map((rule) => (
          <li key={rule.id}>
            <Card>
              <details className="group">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                  <ImpactBadge impact={rule.impact} />
                  <span className="font-medium">{rule.help}</span>
                  <span className="ml-auto whitespace-nowrap text-xs text-ink-muted">
                    {rule.nodes.length} {rule.nodes.length === 1 ? 'elemento' : 'elementos'}
                  </span>
                </summary>

                <div className="space-y-4 border-t border-line px-4 py-4 text-sm">
                  <p className="text-ink-muted">{rule.description}</p>

                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-ink-muted">
                      Regla: <code className="rounded bg-surface-muted px-1.5 py-0.5">{rule.id}</code>
                    </span>
                    <a
                      href={rule.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline underline-offset-2"
                    >
                      Cómo corregirlo (Deque) <span className="sr-only">(se abre en una pestaña nueva)</span>
                    </a>
                  </p>

                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Elementos afectados
                    </h3>
                    <ul className="space-y-3">
                      {rule.nodes.slice(0, MAX_NODES_SHOWN).map((node, index) => (
                        <li key={index} className="rounded-md border border-line bg-surface-muted p-3">
                          <pre className="overflow-x-auto text-xs">
                            <code>
                              {node.html.length > MAX_HTML ? `${node.html.slice(0, MAX_HTML)}…` : node.html}
                            </code>
                          </pre>
                          {node.target.length > 0 ? (
                            <p className="mt-2 text-xs">
                              <span className="text-ink-muted">Selector: </span>
                              <code className="break-all rounded bg-surface px-1.5 py-0.5">
                                {node.target.join(' ')}
                              </code>
                            </p>
                          ) : null}
                          {node.failureSummary ? (
                            <p className="mt-2 whitespace-pre-line text-xs text-ink-muted">
                              {node.failureSummary}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {rule.nodes.length > MAX_NODES_SHOWN ? (
                      <p className="mt-2 text-xs text-ink-muted">
                        y {rule.nodes.length - MAX_NODES_SHOWN} elemento(s) más. Descarga el JSON o el PDF
                        para verlos todos.
                      </p>
                    ) : null}
                  </div>
                </div>
              </details>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
