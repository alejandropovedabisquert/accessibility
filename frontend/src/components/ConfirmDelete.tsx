'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonStyles } from '@/components/ui';

/**
 * Botón de borrar que pide confirmación antes de enviar su formulario.
 *
 * Va dentro del `<form>` de la Server Action: el botón de confirmar es el
 * `submit` de ese formulario, así que la acción no cambia. `<dialog>` nativo
 * con `showModal()` atrapa el foco, se cierra con Esc y lo devuelve al botón.
 * El foco empieza en «Cancelar»: un Intro de más no debe borrar nada.
 */
export function ConfirmDelete({
  label,
  title,
  confirmLabel,
  children,
}: {
  label: ReactNode;
  title: string;
  confirmLabel: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button
        type="button"
        className={buttonStyles.danger}
        onClick={() => {
          dialog.current?.showModal();
          cancel.current?.focus();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-5 text-ink shadow-lg backdrop:bg-black/50"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm">
          {children}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancel} type="button" className={buttonStyles.secondary} onClick={() => dialog.current?.close()}>
            Cancelar
          </button>
          <ConfirmButton label={confirmLabel} />
        </div>
      </dialog>
    </>
  );
}

function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonStyles.danger}>
      {pending ? 'Borrando…' : label}
    </button>
  );
}
