import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  AuditStatus,
  Compliance,
  Counters,
  Impact,
  Meta,
  PageStatus,
  RuleLevel,
  ScanScope,
} from '@/lib/types';
import {
  AUDIT_STATUS_LABEL,
  COMPLIANCE_LABEL,
  IMPACT_LABEL,
  LEVEL_LABEL,
  PAGE_STATUS_LABEL,
  sectionLabel,
} from '@/lib/format';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55';

export const buttonStyles = {
  primary: `${BUTTON_BASE} bg-accent text-on-accent hover:opacity-90`,
  secondary: `${BUTTON_BASE} border border-line bg-surface text-ink hover:bg-surface-muted`,
  danger: `${BUTTON_BASE} border border-critical/40 bg-surface text-critical hover:bg-critical-soft`,
};

const STATUS_STYLE: Record<AuditStatus | PageStatus, string> = {
  queued: 'bg-surface-muted text-ink-muted border-line',
  pending: 'bg-surface-muted text-ink-muted border-line',
  running: 'bg-accent-soft text-accent border-accent/30',
  completed: 'bg-ok-soft text-ok border-ok/30',
  failed: 'bg-critical-soft text-critical border-critical/30',
};

export function StatusBadge({ status, kind = 'audit' }: { status: AuditStatus | PageStatus; kind?: 'audit' | 'page' }) {
  const label =
    kind === 'audit'
      ? AUDIT_STATUS_LABEL[status as AuditStatus] ?? status
      : PAGE_STATUS_LABEL[status as PageStatus] ?? status;

  const live = status === 'running' || status === 'queued';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {live ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}

/**
 * Ámbito del escaneo de una página. No pinta nada en el caso normal (página
 * completa y sin exclusiones) para no meter ruido en la tabla.
 */
export function ScopeBadge({
  scope,
  sections = [],
}: {
  scope: ScanScope;
  sections?: Meta['sections'];
}) {
  if (!scope.include && !scope.exclude) return null;

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      {scope.include ? (
        <span
          title={scope.include}
          className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 font-medium text-accent"
        >
          {sectionLabel(scope.include, sections)}
        </span>
      ) : null}
      {scope.exclude ? (
        <span className="text-ink-muted">
          excluye <code>{scope.exclude}</code>
        </span>
      ) : null}
    </span>
  );
}

const IMPACT_STYLE: Record<Impact, string> = {
  critical: 'bg-critical-soft text-critical border-critical/30',
  serious: 'bg-serious-soft text-serious border-serious/30',
  moderate: 'bg-moderate-soft text-moderate border-moderate/30',
  minor: 'bg-minor-soft text-minor border-minor/30',
};

export function ImpactBadge({ impact }: { impact: Impact | null }) {
  if (!impact) {
    return (
      <span className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
        Sin clasificar
      </span>
    );
  }
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${IMPACT_STYLE[impact]}`}>
      {IMPACT_LABEL[impact]}
    </span>
  );
}

/** Desglose de incumplimientos por severidad. Oculta los ceros para no meter ruido. */
export function ImpactBreakdown({
  counters,
  size = 'sm',
}: {
  counters: Pick<Counters, Impact>;
  size?: 'sm' | 'md';
}) {
  const entries = (['critical', 'serious', 'moderate', 'minor'] as Impact[])
    .map((impact) => ({ impact, count: counters[impact] }))
    .filter((entry) => entry.count > 0);

  if (entries.length === 0) {
    return <span className="text-sm text-ok">Sin incumplimientos</span>;
  }

  const padding = size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs';

  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map(({ impact, count }) => (
        <li key={impact}>
          <span className={`inline-block rounded border font-medium tabular-nums ${padding} ${IMPACT_STYLE[impact]}`}>
            <span className="sr-only">{IMPACT_LABEL[impact]}: </span>
            {count}
            <span aria-hidden="true" className="ml-1 opacity-75">
              {IMPACT_LABEL[impact].charAt(0)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreDial({ score, size = 56 }: { score: number | null; size?: number }) {
  if (score === null) {
    return <span className="text-sm text-ink-muted">—</span>;
  }

  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const tone = score >= 95 ? 'var(--color-ok)' : score >= 80 ? 'var(--color-moderate)' : 'var(--color-critical)';

  return (
    <div className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${score}% de reglas superadas`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size / 4}
          fontWeight="600"
          fill="currentColor"
        >
          {Math.round(score)}
        </text>
      </svg>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <Card className="px-6 py-14 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{description}</p>
      {action ? (
        <Link href={action.href} className={`${buttonStyles.primary} mt-5`}>
          {action.label}
        </Link>
      ) : null}
    </Card>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    // Dentro de un <dl>, un <div> solo puede contener grupos <dt>/<dd>: la nota
    // va dentro del <dd>, no como hermano (regla axe `definition-list`).
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1">
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="mt-0.5 block text-xs font-normal text-ink-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

const LEVEL_STYLE: Record<RuleLevel, string> = {
  A: 'border-accent/30 bg-accent-soft text-accent',
  AA: 'border-accent/30 bg-accent-soft text-accent',
  AAA: 'border-line bg-surface-muted text-ink-muted',
  'best-practice': 'border-line bg-surface-muted text-ink-muted',
};

export function LevelBadge({ level }: { level: RuleLevel }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

/**
 * Cumplimiento legal (A/AA) y mejoras (AAA, buenas prácticas) por separado, el
 * legal siempre primero: mezclarlos daba una imagen equivocada de lo exigible.
 */
export function ComplianceSummary({
  compliance,
  averaged = false,
}: {
  compliance: Compliance | null;
  /** En la auditoría el porcentaje es la media de sus páginas. */
  averaged?: boolean;
}) {
  if (!compliance) {
    return (
      <Card className="mb-6 px-5 py-4 text-sm text-ink-muted">
        Desglose legal / mejoras no disponible: no se conserva el resultado crudo de este escaneo.
      </Card>
    );
  }

  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2">
      {(['legal', 'improvements'] as const).map((key) => {
        const group = compliance[key];
        const { title, hint } = COMPLIANCE_LABEL[key];
        return (
          <Card key={key} className="p-4">
            <div className="flex items-start gap-4">
              <ScoreDial score={group.score} size={64} />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{title}</h2>
                <p className="text-xs text-ink-muted">{hint}</p>
                {group.score === null ? (
                  <p className="mt-2 text-sm text-ink-muted">
                    No evaluado: las normas elegidas no incluyen reglas de este grupo.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm">
                      {averaged ? 'Media de reglas superadas por página · ' : ''}
                      {group.passes} de {group.passes + group.violations} reglas superadas
                    </p>
                    <p className="mt-1 text-sm">
                      {group.violations} incumplimiento(s) en {group.violationNodes} elemento(s)
                      {group.incomplete > 0 ? ` · ${group.incomplete} a revisar a mano` : ''}
                    </p>
                    <div className="mt-2">
                      <ImpactBreakdown counters={group} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Lo excluido no se audita. Solo tiene sentido excluir contenido de terceros
 * (un banner de cookies de OneTrust, un widget externo): si es propio, forma
 * parte del sitio y cuenta legalmente, así que hay que revisarlo por separado.
 */
export function ExcludeNotice({ selectors, className = '' }: { selectors: string[]; className?: string }) {
  if (selectors.length === 0) return null;
  return (
    <div
      role="note"
      className={`rounded-md border border-moderate/30 bg-moderate-soft px-4 py-3 text-sm text-moderate ${className}`}
    >
      <p>
        <strong>Contenido excluido:</strong>{' '}
        {selectors.map((selector, index) => (
          <span key={selector}>
            {index > 0 ? ', ' : ''}
            <code>{selector}</code>
          </span>
        ))}
        . Lo excluido no se audita y no aparece en los resultados.
      </p>
      <p className="mt-1">
        Si es contenido propio y no de un tercero, forma parte del sitio, cuenta para el cumplimiento
        legal y debe revisarse por separado.
      </p>
    </div>
  );
}
