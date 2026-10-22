'use client';

import { buttonStyles } from '@/components/ui';
import { ListCheckIcon } from '@/components/icons';

/**
 * Pone el último escaneo de cada página en la muestra sin enviar el formulario:
 * quien firma ajusta después lo que quiera y comprueba. El último es la primera
 * opción con valor de cada desplegable (la vacía es «No incluir»).
 */
export function SelectLatestButton({ name }: { name: string }) {
  return (
    <button
      type="button"
      className={buttonStyles.secondary}
      onClick={(event) => {
        const form = event.currentTarget.form;
        if (!form) return;
        for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)) {
          if (control instanceof HTMLSelectElement) {
            const latest = [...control.options].find((option) => option.value !== '');
            if (latest) control.value = latest.value;
          } else if (control.type === 'checkbox') {
            control.checked = true;
          }
        }
      }}
    >
      <ListCheckIcon />
      Elegir el último escaneo de todas
    </button>
  );
}
