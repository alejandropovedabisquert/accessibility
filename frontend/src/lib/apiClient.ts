// Solo servidor: lo usan `lib/api.ts` (lecturas) y `app/actions.ts` (mutaciones). El navegador va
// por el proxy /api/backend/* de next.config.ts.

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

interface ApiErrorBody {
  error?: string;
  /** Errores de zod (`field` + `message`) o bloqueos de una firma (solo `message`). */
  details?: Array<{ field?: string; message: string }>;
}

/** El mismo texto venga de una lectura o de un formulario. */
const errorText = (status: number, body: ApiErrorBody | null): string => {
  const details = body?.details ?? [];
  if (details.length > 0 && details.every((detail) => detail.field)) {
    return details.map((detail) => `${detail.field}: ${detail.message}`).join(' · ');
  }
  const base = body?.error ?? `La API devolvió ${status}`;
  const first = details.slice(0, 3).map((detail) => detail.message).join(' · ');
  return first ? `${base}: ${first}` : base;
};

/** Nunca cachea: los datos cambian solos. Nunca lanza: un fallo de red también es un `error`. */
export async function callApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? 'GET',
      ...(init.body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }
        : {}),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 503, error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, status: res.status, error: errorText(res.status, body) };
  }
  if (res.status === 204) return { ok: true, data: undefined as T };
  return { ok: true, data: (await res.json()) as T };
}
