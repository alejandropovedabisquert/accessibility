'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AUDIT_STATUS_LABEL } from '@/lib/format';
import type { AuditStatus } from '@/lib/types';

const STATUSES: AuditStatus[] = ['queued', 'running', 'completed', 'failed'];

export function AuditFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const isFirstRender = useRef(true);

  const apply = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    query.delete('page'); // cualquier filtro nuevo vuelve a la primera pagina
    router.push(`/?${query.toString()}`);
  };

  // Debounce del buscador para no lanzar una peticion por tecla.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const id = setTimeout(() => apply({ search }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <label htmlFor="filtro-busqueda" className="mb-1 block text-xs font-medium text-ink-muted">
          Buscar por URL o nombre
        </label>
        <input
          id="filtro-busqueda"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="avantio.com"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="filtro-estado" className="mb-1 block text-xs font-medium text-ink-muted">
          Estado
        </label>
        <select
          id="filtro-estado"
          defaultValue={params.get('status') ?? ''}
          onChange={(event) => apply({ status: event.target.value })}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {AUDIT_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
