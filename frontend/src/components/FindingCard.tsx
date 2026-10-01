import { evidenceImageHref } from '@/lib/api';
import { assertorLabel, formatDateTime } from '@/lib/format';
import type { ManualFinding } from '@/lib/types';
import { OutcomeBadge, ReviewStatusBadge } from '@/components/ui';
import { ReviewFindingForm } from '@/components/ReviewForms';

const SOURCE_LABEL: Record<ManualFinding['source']['kind'], string> = {
  check: 'Revisión',
  'axe-needs-review': 'Propuesta de axe',
  applicability: 'Propuesta automática',
  'axe-false-positive': 'Falso positivo de axe',
};

/**
 * Un hallazgo con quién lo propuso, en qué se apoya y su revisión. Las
 * referencias a capturas (`focus-3.jpg`) enlazan a la imagen por el proxy.
 */
export function FindingCard({
  finding,
  path,
  reviewer,
  page,
}: {
  finding: ManualFinding;
  path: string;
  reviewer: string;
  /** Para enlazar las capturas de evidencia; los hallazgos de sitio no tienen. */
  page?: { auditId: string; pageId: string };
}) {
  const { review } = finding;
  return (
    <article className={`rounded-md border border-line p-4 ${review.status === 'rejected' ? 'opacity-70' : ''}`}>
      <header className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={finding.outcome} />
        <ReviewStatusBadge status={review.status} />
        {finding.inheritedFrom ? (
          <span className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-muted">
            Heredado de la línea base
          </span>
        ) : null}
        <span className="text-xs text-ink-muted">
          {SOURCE_LABEL[finding.source.kind]}
          {'ruleId' in finding.source ? <> · <code>{finding.source.ruleId}</code></> : null} · {assertorLabel(finding.assertedBy)} ·{' '}
          {formatDateTime(finding.createdAt)}
        </span>
      </header>

      <p className="mt-2 whitespace-pre-line text-sm">{finding.description}</p>
      {finding.recommendation ? (
        <p className="mt-2 text-sm">
          <strong>Cómo corregirlo:</strong> {finding.recommendation}
        </p>
      ) : null}

      {finding.targets.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-muted">
            {finding.targetCount > finding.targets.length
              ? `${finding.targets.length} de ${finding.targetCount} elementos`
              : `${finding.targetCount} elemento(s)`}
          </p>
          <ul className="mt-1 space-y-1">
            {finding.targets.map((target, index) => (
              <li key={`${target.selector}-${index}`} className="overflow-x-auto text-xs">
                <code className="text-accent">{target.selector}</code>
                {target.html ? <code className="ml-2 text-ink-muted">{target.html}</code> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {finding.evidenceRefs.length > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          Evidencia:{' '}
          {finding.evidenceRefs.map((ref, index) => (
            <span key={ref}>
              {index > 0 ? ', ' : ''}
              {page && /^[a-z0-9-]+\.jpg$/.test(ref) ? (
                <a href={evidenceImageHref(page.auditId, page.pageId, ref)} className="text-accent underline underline-offset-2">
                  {ref}
                </a>
              ) : (
                <code>{ref}</code>
              )}
            </span>
          ))}
        </p>
      ) : null}

      {review.status !== 'proposed' ? (
        <p className="mt-3 text-xs text-ink-muted">
          {review.by} · {formatDateTime(review.at)}
          {review.note ? <> · &laquo;{review.note}&raquo;</> : null}
        </p>
      ) : null}

      <div className="mt-3 border-t border-line pt-3">
        <ReviewFindingForm finding={finding} path={path} reviewer={reviewer} />
      </div>
    </article>
  );
}
