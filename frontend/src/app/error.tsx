'use client';

import { buttonStyles } from '@/components/ui';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-critical/30 bg-critical-soft px-6 py-10 text-center">
      <h1 className="text-lg font-semibold text-critical">Algo ha fallado</h1>
      <p className="mx-auto mt-2 max-w-lg text-sm text-ink-muted">{error.message}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-ink-muted">
        Comprueba que la API está levantada y vuelve a intentarlo.
      </p>
      <button type="button" onClick={reset} className={`${buttonStyles.secondary} mt-5`}>
        Reintentar
      </button>
    </div>
  );
}
