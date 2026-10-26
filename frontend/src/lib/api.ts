import type {
  BaselineReport,
  HeirsOverview,
  SignOff,
  SignOffDetail,
  SignOffPreview,
  CheckCatalog,
  CollectedEvidenceKind,
  PageEvidence,
  PageReview,
  Site,
  SiteDetail,
  AuditGroup,
  AuditWithPages,
  AxeResults,
  HistoryPoint,
  Meta,
  PageDiff,
  AuditPage,
  PageIssue,
  Paginated,
  ScannedUrl,
  ScanScreen,
} from './types';
import { screenQuery } from './format';
import { callApi } from './apiClient';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

/** Lectura desde el servidor de Next; lanza `ApiError` para que la recojan `notFound()` o `error.tsx`. */
async function apiFetch<T>(path: string): Promise<T> {
  const result = await callApi<T>(path);
  if (!result.ok) throw new ApiError(result.error, result.status);
  return result.data;
}

export const getMeta = () => apiFetch<Meta>('/meta');

/** Una fila por auditoría con sus lanzamientos: «volver a lanzar» no crea otra. */
export const listAuditGroups = (params: {
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
  return apiFetch<Paginated<AuditGroup>>(`/audit-groups${qs ? `?${qs}` : ''}`);
};

export const getAuditGroup = (groupId: string) => apiFetch<AuditGroup>(`/audit-groups/${groupId}`);

export const getAudit = (id: string) => apiFetch<AuditWithPages>(`/audits/${id}`);

export const getPage = (auditId: string, pageId: string) =>
  apiFetch<{ page: AuditPage; issues: PageIssue[] }>(`/audits/${auditId}/pages/${pageId}`);

export const getPageResults = (auditId: string, pageId: string) =>
  apiFetch<{ page: AuditPage; results: AxeResults }>(`/audits/${auditId}/pages/${pageId}/results`);

export const getPageDiff = (auditId: string, pageId: string) =>
  apiFetch<PageDiff>(`/audits/${auditId}/pages/${pageId}/diff`);

/** Serie de URL + sección + pantalla. Sin `screen`, la API mezcla todas las pantallas. */
export const getHistory = (url: string, include: string | null, screen: ScanScreen, limit = 30) => {
  const query = new URLSearchParams({ url, limit: String(limit), ...screenQuery(screen) });
  if (include) query.set('include', include);
  return apiFetch<{ url: string; include: string | null; points: HistoryPoint[] }>(
    `/history?${query.toString()}`
  );
};

export const getScannedUrls = () => apiFetch<ScannedUrl[]>('/history/urls');

export const getChecks = () => apiFetch<CheckCatalog>('/checks');

/** Abrirla crea en la API las propuestas automáticas (needs-review de axe, no aplicables). */
export const getPageReview = (auditId: string, pageId: string, maxTargets = 10) =>
  apiFetch<PageReview>(`/audits/${auditId}/pages/${pageId}/review?maxTargets=${maxTargets}`);

export const getPageEvidence = (auditId: string, pageId: string, kinds?: CollectedEvidenceKind[]) =>
  apiFetch<PageEvidence>(
    `/audits/${auditId}/pages/${pageId}/evidence${kinds ? `?kinds=${kinds.join(',')}` : ''}`,
  );

/** Ruta del proxy para una captura de evidencia: el navegador nunca llama a la API directamente. */
export const evidenceImageHref = (auditId: string, pageId: string, name: string) =>
  `/api/backend/audits/${auditId}/pages/${pageId}/evidence/files/${encodeURIComponent(name)}`;

export const listSites = () => apiFetch<Site[]>('/sites');

export const getSite = (id: string) => apiFetch<SiteDetail>(`/sites/${id}`);

export const getSignOffPreview = (siteId: string, pageIds: string[]) =>
  apiFetch<SignOffPreview>(`/sites/${siteId}/sign-off-preview?pageIds=${pageIds.map(encodeURIComponent).join(',')}`);

export const listSignOffs = (siteId: string) => apiFetch<SignOff[]>(`/sites/${siteId}/sign-offs`);

export const getSignOff = (id: string) => apiFetch<SignOffDetail>(`/sign-offs/${id}`);

/** null si la página no tiene línea base. */
export const getBaseline = async (auditId: string, pageId: string): Promise<BaselineReport | null> => {
  try {
    return await apiFetch<BaselineReport>(`/audits/${auditId}/pages/${pageId}/baseline`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};

/** Qué páginas pueden heredar de esta, y en qué situación está cada una. */
export const getHeirs = (auditId: string, pageId: string) =>
  apiFetch<HeirsOverview>(`/audits/${auditId}/pages/${pageId}/heirs`);
