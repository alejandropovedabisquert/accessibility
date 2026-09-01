import type {
  Audit,
  AuditWithPages,
  AxeResults,
  HistoryPoint,
  Meta,
  PageDiff,
  AuditPage,
  PageIssue,
  Paginated,
  ScannedUrl,
} from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

/** Fetch desde el servidor de Next hacia la API. Nunca cachea: los datos cambian solos. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, cache: 'no-store' });
  } catch {
    throw new ApiError(`No se pudo conectar con la API en ${API_URL}`, 503);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `La API devolvio ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const getMeta = () => apiFetch<Meta>('/meta');

export const listAudits = (params: {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const qs = query.toString();
  return apiFetch<Paginated<Audit>>(`/audits${qs ? `?${qs}` : ''}`);
};

export const getAudit = (id: string) => apiFetch<AuditWithPages>(`/audits/${id}`);

export const getPage = (auditId: string, pageId: string) =>
  apiFetch<{ page: AuditPage; issues: PageIssue[] }>(`/audits/${auditId}/pages/${pageId}`);

export const getPageResults = (auditId: string, pageId: string) =>
  apiFetch<{ page: AuditPage; results: AxeResults }>(`/audits/${auditId}/pages/${pageId}/results`);

export const getPageDiff = (auditId: string, pageId: string) =>
  apiFetch<PageDiff>(`/audits/${auditId}/pages/${pageId}/diff`);

export const getHistory = (url: string, limit = 30) =>
  apiFetch<{ url: string; points: HistoryPoint[] }>(
    `/history?url=${encodeURIComponent(url)}&limit=${limit}`
  );

export const getScannedUrls = () => apiFetch<ScannedUrl[]>('/history/urls');
