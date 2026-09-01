'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresca los Server Components mientras haya una auditoria en curso.
 *
 * Sondeo en vez de websockets: el estado cambia cada pocos segundos como mucho
 * y asi el backend no necesita mantener conexiones abiertas.
 */
export function AutoRefresh({ intervalMs = 3000, label }: { intervalMs?: number; label: string }) {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setTicks((value) => value + 1);
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return (
    <p className="flex items-center gap-2 text-xs text-ink-muted" role="status" aria-live="polite">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent" />
      {label}
      <span className="sr-only">
        {ticks > 0 ? `Actualizado ${ticks} ${ticks === 1 ? 'vez' : 'veces'}.` : ''}
      </span>
    </p>
  );
}
