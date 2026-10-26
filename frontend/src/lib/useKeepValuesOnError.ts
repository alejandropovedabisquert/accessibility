import { useLayoutEffect, useRef, type FormEvent } from 'react';
import type { FormState } from '@/app/actions';

/**
 * React 19 vacía los campos no controlados de un `<form action={fn}>` al terminar la acción, también
 * cuando devuelve `{ error }`: un 400 de la API borraba las URLs o la descripción ya escritas. Esto
 * vuelve a poner lo enviado si hubo error. Tras un éxito se deja el vaciado, que es lo que se quiere
 * (el formulario de nuevo hallazgo, por ejemplo). Se usa como `<form {...keep} action={action}>`.
 */
export function useKeepValuesOnError(state: FormState) {
  const ref = useRef<HTMLFormElement>(null);
  const submitted = useRef<FormData | null>(null);

  // Layout effect: React aplica el vaciado en el mismo commit que el nuevo estado, antes de esto,
  // así que se restaura sin que llegue a pintarse el formulario vacío.
  useLayoutEffect(() => {
    const form = ref.current;
    const data = submitted.current;
    if (!state.error || !form || !data) return;
    for (const element of Array.from(form.elements)) restore(element, data);
  }, [state]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    submitted.current = new FormData(event.currentTarget);
  };

  return { ref, onSubmit };
}

function restore(element: Element, data: FormData) {
  if (element instanceof HTMLInputElement) {
    if (!element.name || ['hidden', 'submit', 'button', 'reset', 'file'].includes(element.type)) return;
    if (element.type === 'checkbox' || element.type === 'radio') {
      element.checked = data.getAll(element.name).includes(element.value);
    } else {
      element.value = String(data.get(element.name) ?? '');
    }
  } else if (element instanceof HTMLTextAreaElement) {
    if (element.name) element.value = String(data.get(element.name) ?? '');
  } else if (element instanceof HTMLSelectElement && element.name) {
    const values = data.getAll(element.name);
    for (const option of Array.from(element.options)) option.selected = values.includes(option.value);
  }
}
