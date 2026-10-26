'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AUDIT_STATUS_LABEL } from '@/lib/format';
import type { AuditStatus } from '@/lib/types';
import { FIELD } from '@/components/ui';

const STATUSES: AuditStatus[] = ['queued', 'running', 'completed', 'failed'];

export function AuditFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const urlSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(urlSearch);
  // Lo ultimo que ha mandado el propio buscador, para distinguirlo de un cambio de fuera.
  const pushed = useRef(urlSearch);

  const apply = (next: Record<string, string>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    query.delete('page'); // cualquier filtro nuevo vuelve a la primera pagina
    if ('search' in next) pushed.current = next.search ?? '';
    router.push(`/?${query.toString()}`);
  };

  // «Quitar filtros» o volver atras cambian la URL sin volver a montar esto: el campo la sigue.
  // Lo que viene de nuestro propio debounce no, que pisaria lo tecleado mientras navegaba.
  useEffect(() => {
    if (urlSearch !== pushed.current) {
      pushed.current = urlSearch;
      setSearch(urlSearch);
    }
  }, [urlSearch]);

  // Debounce del buscador para no lanzar una peticion por tecla.
  useEffect(() => {
    if (search === pushed.current) return;
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
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="filtro-estado" className="mb-1 block text-xs font-medium text-ink-muted">
          Estado
        </label>
        <select
          id="filtro-estado"
          value={params.get('status') ?? ''}
          onChange={(event) => apply({ status: event.target.value })}
          className={`${FIELD} w-auto!`}
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
