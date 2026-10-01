'use client';

import { useActionState, useId } from 'react';
import { useFormStatus } from 'react-dom';
import {
  createFindingAction,
  createSiteAction,
  falsePositiveAction,
  linkBaselineAction,
  unlinkBaselineAction,
  validateInapplicableAction,
  reviewFindingAction,
  signOffAction,
  type FormState,
} from '@/app/actions';
import { OUTCOME_LABEL } from '@/lib/format';
import type { FindingOutcome, ManualFinding } from '@/lib/types';
import { FIELD, HINT, LABEL, buttonStyles } from '@/components/ui';

const FINDING_OUTCOMES: FindingOutcome[] = ['passed', 'failed', 'cantTell', 'inapplicable'];
const INITIAL: FormState = { error: null };

function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
      {state.error}
    </p>
  );
}

function Submit({ children, value, variant = 'secondary', disabled = false, describedBy }: {
  children: React.ReactNode;
  value?: string;
  variant?: keyof typeof buttonStyles;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={value ? 'status' : undefined}
      value={value}
      disabled={pending || disabled}
      aria-describedby={describedBy}
      className={buttonStyles[variant]}
    >
      {children}
    </button>
  );
}

function ReviewerField({ id, reviewer }: { id: string; reviewer: string }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        Revisado por
      </label>
      <input id={id} name="by" defaultValue={reviewer} required autoComplete="name" className={FIELD} />
    </div>
  );
}

/**
 * Validar, rechazar o corregir un hallazgo (capa 3). Un solo formulario: el
 * botón pulsado decide el estado. Los campos de corrección van plegados y solo
 * se usan con "Guardar corrección".
 */
export function ReviewFindingForm({
  finding,
  path,
  reviewer,
}: {
  finding: ManualFinding;
  path: string;
  reviewer: string;
}) {
  const [state, action] = useActionState(reviewFindingAction, INITIAL);
  const id = useId();
  const undecided = finding.outcome === 'cantTell';
  const reviewed = finding.review.status !== 'proposed';

  const form = (
    <form action={action} className="space-y-3">
      <input type="hidden" name="findingId" value={finding.id} />
      <input type="hidden" name="path" value={path} />
      <FormError state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewerField id={`${id}-by`} reviewer={reviewer} />
        <div>
          <label htmlFor={`${id}-note`} className={LABEL}>
            Nota <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <input id={`${id}-note`} name="note" className={FIELD} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Submit value="validated" variant="primary" disabled={undecided} describedBy={undecided ? `${id}-undecided` : undefined}>
          Validar
        </Submit>
        <Submit value="rejected">Rechazar</Submit>
      </div>
      {undecided ? (
        <p id={`${id}-undecided`} className={HINT}>
          No se puede validar un &laquo;sin decidir&raquo;: corrígelo con el resultado que hayas comprobado.
        </p>
      ) : null}

      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Corregir el resultado o la descripción</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor={`${id}-outcome`} className={LABEL}>
              Resultado
            </label>
            <select id={`${id}-outcome`} name="outcome" defaultValue={finding.outcome} className={FIELD}>
              {FINDING_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {OUTCOME_LABEL[outcome]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-description`} className={LABEL}>
              Descripción
            </label>
            <textarea
              id={`${id}-description`}
              name="description"
              defaultValue={finding.description}
              rows={3}
              className={FIELD}
            />
          </div>
          <Submit value="amended">Guardar corrección</Submit>
        </div>
      </details>
    </form>
  );

  if (!reviewed) return form;
  // Ya revisado: se puede volver a revisar, pero sin que estorbe.
  return (
    <details>
      <summary className="cursor-pointer text-sm text-accent">Revisar de nuevo</summary>
      <div className="mt-3">{form}</div>
    </details>
  );
}

/** Declarar falso positivo una violación de axe para un criterio. La justificación es obligatoria. */
export function FalsePositiveForm({
  auditId,
  pageId,
  checkId,
  ruleId,
  path,
  reviewer,
}: {
  auditId: string;
  pageId: string;
  checkId: string;
  ruleId: string;
  path: string;
  reviewer: string;
}) {
  const [state, action] = useActionState(falsePositiveAction, INITIAL);
  const id = useId();
  return (
    <details>
      <summary className="cursor-pointer text-sm text-accent">Marcar como falso positivo</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="auditId" value={auditId} />
        <input type="hidden" name="pageId" value={pageId} />
        <input type="hidden" name="checkId" value={checkId} />
        <input type="hidden" name="ruleId" value={ruleId} />
        <input type="hidden" name="path" value={path} />
        <FormError state={state} />
        <ReviewerField id={`${id}-by`} reviewer={reviewer} />
        <div>
          <label htmlFor={`${id}-note`} className={LABEL}>
            Por qué no es un incumplimiento
          </label>
          <textarea id={`${id}-note`} name="note" required rows={2} className={FIELD} />
          <p className={HINT}>Queda validado a tu nombre. Para deshacerlo, recházalo después.</p>
        </div>
        <Submit>Marcar falso positivo</Submit>
      </form>
    </details>
  );
}

/** Resultado registrado por una persona, por ejemplo tras probar con un lector de pantalla. */
export function CreateFindingForm({
  checkId,
  target,
  path,
  reviewer,
}: {
  checkId: string;
  target: { auditId: string; pageId: string } | { siteId: string };
  path: string;
  reviewer: string;
}) {
  const [state, action] = useActionState(createFindingAction, INITIAL);
  const id = useId();
  return (
    <details>
      <summary className="cursor-pointer text-sm text-accent">Añadir un resultado</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="checkId" value={checkId} />
        <input type="hidden" name="path" value={path} />
        {'siteId' in target ? (
          <input type="hidden" name="siteId" value={target.siteId} />
        ) : (
          <>
            <input type="hidden" name="auditId" value={target.auditId} />
            <input type="hidden" name="pageId" value={target.pageId} />
          </>
        )}
        <FormError state={state} />
        <div className="grid gap-3 sm:grid-cols-2">
          <ReviewerField id={`${id}-by`} reviewer={reviewer} />
          <div>
            <label htmlFor={`${id}-at`} className={LABEL}>
              Producto de apoyo <span className="font-normal text-ink-muted">(opcional)</span>
            </label>
            <input id={`${id}-at`} name="assistiveTech" placeholder="NVDA 2025.1 + Firefox" className={FIELD} />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-outcome`} className={LABEL}>
            Resultado
          </label>
          <select id={`${id}-outcome`} name="outcome" defaultValue="failed" className={FIELD}>
            {FINDING_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABEL[outcome]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-description`} className={LABEL}>
            Qué has comprobado y qué has visto
          </label>
          <textarea id={`${id}-description`} name="description" required rows={3} className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${id}-recommendation`} className={LABEL}>
            Cómo corregirlo <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <textarea id={`${id}-recommendation`} name="recommendation" rows={2} className={FIELD} />
        </div>
        <Submit variant="primary">Guardar resultado</Submit>
      </form>
    </details>
  );
}

export function CreateSiteForm() {
  const [state, action] = useActionState(createSiteAction, INITIAL);
  return (
    <form action={action} className="space-y-4">
      <FormError state={state} />
      <div>
        <label htmlFor="site-name" className={LABEL}>
          Nombre
        </label>
        <input id="site-name" name="name" required className={FIELD} />
      </div>
      <div>
        <label htmlFor="site-hosts" className={LABEL}>
          Hosts
        </label>
        <textarea
          id="site-hosts"
          name="hosts"
          required
          rows={3}
          aria-describedby="site-hosts-hint"
          placeholder={'www.ejemplo.com\nen.ejemplo.com'}
          className={`${FIELD} font-mono`}
        />
        <p id="site-hosts-hint" className={HINT}>
          Uno por línea; vale pegar una URL entera. Las páginas ya escaneadas de esos hosts entran solas en el sitio.
        </p>
      </div>
      <Submit variant="primary">Crear sitio</Submit>
    </form>
  );
}

/** Firma de la web (capa 3). La muestra viene ya elegida y comprobada en la vista previa. */
export function SignOffForm({
  siteId,
  siteName,
  pageIds,
  reviewer,
  canSign,
}: {
  siteId: string;
  siteName: string;
  pageIds: string[];
  reviewer: string;
  canSign: boolean;
}) {
  const [state, action] = useActionState(signOffAction, INITIAL);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="siteId" value={siteId} />
      {pageIds.map((id) => (
        <input key={id} type="hidden" name="pageIds" value={id} />
      ))}
      <FormError state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="signer" className={LABEL}>
            Firma
          </label>
          <input id="signer" name="signer" defaultValue={reviewer} required autoComplete="name" className={FIELD} />
        </div>
        <div>
          <label htmlFor="credential" className={LABEL}>
            Certificación <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <input id="credential" name="credential" placeholder="IAAP WAS" className={FIELD} />
        </div>
      </div>
      <div>
        <label htmlFor="statement" className={LABEL}>
          Declaración
        </label>
        <textarea
          id="statement"
          name="statement"
          required
          rows={4}
          defaultValue={`Declaro que he evaluado la muestra de páginas de ${siteName} indicada en este informe frente a los criterios A y AA de WCAG 2.2, incluidas pruebas con lectores de pantalla, y que los resultados reflejan esa evaluación.`}
          className={FIELD}
        />
        <p className={HINT}>La firma no se puede modificar después. Si cambian los hallazgos, la firma lo indicará.</p>
      </div>
      <Submit variant="primary" disabled={!canSign}>
        Firmar la web
      </Submit>
    </form>
  );
}

/** Enlazar la línea base, o recalcularla si ya hay una (mismo formulario con la página fijada). */
export function BaselineForm({
  auditId,
  pageId,
  path,
  reviewer,
  candidates,
  current,
}: {
  auditId: string;
  pageId: string;
  path: string;
  reviewer: string;
  candidates: Array<{ id: string; label: string }>;
  /** Línea base actual: el formulario pasa a ser "Recalcular". */
  current?: string;
}) {
  const [state, action] = useActionState(linkBaselineAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="auditId" value={auditId} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="path" value={path} />
      <FormError state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        {current ? (
          <input type="hidden" name="baselinePageId" value={current} />
        ) : (
          <div>
            <label htmlFor={`${id}-baseline`} className={LABEL}>
              Página de línea base
            </label>
            <select id={`${id}-baseline`} name="baselinePageId" required className={FIELD}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <ReviewerField id={`${id}-by`} reviewer={reviewer} />
      </div>
      <Submit variant={current ? 'secondary' : 'primary'}>{current ? 'Recalcular la herencia' : 'Enlazar y heredar'}</Submit>
    </form>
  );
}

export function UnlinkBaselineForm({ auditId, pageId, path }: { auditId: string; pageId: string; path: string }) {
  const [state, action] = useActionState(unlinkBaselineAction, INITIAL);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="auditId" value={auditId} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="path" value={path} />
      <FormError state={state} />
      <Submit variant="danger">Quitar la línea base</Submit>
    </form>
  );
}

/**
 * Validar en bloque los «No aplica» que propuso el sistema porque no encontró
 * el contenido al que aplica el criterio. Enseña cuáles antes de validar.
 */
export function BulkInapplicableForm({
  auditId,
  pageId,
  path,
  reviewer,
  criteria,
}: {
  auditId: string;
  pageId: string;
  path: string;
  reviewer: string;
  criteria: Array<{ criterion: string; name: string; reason: string }>;
}) {
  const [state, action] = useActionState(validateInapplicableAction, INITIAL);
  const id = useId();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="auditId" value={auditId} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="path" value={path} />
      <p className="text-sm">
        <strong>{criteria.length}</strong> criterio(s) propuestos como &laquo;No aplica&raquo; porque la página no tiene el
        contenido al que se refieren. Revisa la lista y, si es así, valídalos de una vez.
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-accent">Ver cuáles</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {criteria.map((item) => (
            <li key={item.criterion}>
              <strong>
                {item.criterion} {item.name}
              </strong>
              <span className="text-ink-muted"> · {item.reason}</span>
            </li>
          ))}
        </ul>
      </details>
      <FormError state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <ReviewerField id={`${id}-by`} reviewer={reviewer} />
        </div>
        <Submit variant="primary">Validar los {criteria.length} «No aplica»</Submit>
      </div>
    </form>
  );
}
