'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CUSTOM_SECTION } from '@/lib/format';
import { REVIEWER_COOKIE } from '@/lib/reviewer';
import { callApi } from '@/lib/apiClient';
import type { Audit, HeirResult, Site, SignOff } from '@/lib/types';

export interface FormState {
  error: string | null;
}

interface ScanTargetPayload {
  url: string;
  include?: string;
  exclude?: string;
}

/**
 * Resoluciones marcadas más las escritas a mano ("1920x1080, 360x800"). Una
 * entrada mal escrita se devuelve aparte para avisar en vez de ignorarla.
 */
const parseViewports = (presets: string[], custom: string) => {
  const entries = [...presets, ...custom.split(/[\s,;]+/)].map((entry) => entry.trim()).filter(Boolean);
  const viewports: Array<{ width: number; height: number }> = [];
  const invalid: string[] = [];

  for (const entry of entries) {
    const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(entry);
    if (!match) {
      invalid.push(entry);
      continue;
    }
    const viewport = { width: Number(match[1]), height: Number(match[2]) };
    if (!viewports.some((v) => v.width === viewport.width && v.height === viewport.height)) {
      viewports.push(viewport);
    }
  }
  return { viewports, invalid };
};

// Un despiste habitual: pegar "avantio.com" sin protocolo. Si trae otro (ftp://), se deja tal cual
// para que la API lo rechace; antes salía `https://ftp//…` y se escaneaba un dominio inexistente.
const withProtocol = (url: string) => (/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `https://${url}`);

/**
 * Convierte el textarea en objetivos de escaneo.
 *
 * Cada línea es una URL, con un selector CSS propio opcional tras `|`. El
 * selector de línea gana al del desplegable, que actúa como valor por defecto:
 * `https://web.com | .booking-widget`.
 */
const parseTargets = (raw: string, include: string, exclude: string): ScanTargetPayload[] =>
  raw
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf('|');
      const url = pipe === -1 ? line : line.slice(0, pipe).trim();
      const own = pipe === -1 ? '' : line.slice(pipe + 1).trim();
      const scope = own || include;

      return {
        url: withProtocol(url),
        ...(scope ? { include: scope } : {}),
        ...(exclude ? { exclude } : {}),
      };
    });

export async function createAuditAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const section = String(formData.get('section') ?? '').trim();
  const include = (
    section === CUSTOM_SECTION ? String(formData.get('includeCustom') ?? '') : section
  ).trim();
  const exclude = String(formData.get('exclude') ?? '').trim();

  const urls = parseTargets(String(formData.get('urls') ?? ''), include, exclude);

  if (urls.length === 0) {
    return { error: 'Indica al menos una URL.' };
  }
  if (section === CUSTOM_SECTION && !include) {
    return { error: 'Has elegido un selector CSS personalizado pero lo has dejado vacío.' };
  }

  const label = String(formData.get('label') ?? '').trim();
  const device = String(formData.get('device') ?? '');
  const tags = formData.getAll('tags').map(String);

  const payload: Record<string, unknown> = {
    urls,
    browser: String(formData.get('browser') ?? 'chromium'),
    waitUntil: String(formData.get('waitUntil') ?? 'load'),
    timeout: Number(formData.get('timeout')) || undefined,
  };

  if (label) payload.label = label;
  if (tags.length > 0) payload.tags = tags;
  if (formData.get('evidence') === 'on') payload.evidence = true;

  if (device) {
    payload.device = device;
  } else {
    const { viewports, invalid } = parseViewports(
      formData.getAll('viewportPreset').map(String),
      String(formData.get('viewportsCustom') ?? ''),
    );
    if (invalid.length > 0) {
      return { error: `Resolución no válida: ${invalid.join(', ')}. Usa el formato ANCHOxALTO, por ejemplo 1366x768.` };
    }
    if (viewports.length === 0) {
      return { error: 'Marca o escribe al menos una resolución.' };
    }
    payload.viewports = viewports;
  }

  const created = await callApi<Audit>('/audits', { method: 'POST', body: payload });
  if (!created.ok) return { error: created.error };

  revalidatePath('/');
  redirect(`/auditorias/${created.data.id}`);
}

/**
 * Botones sin formulario de error (borrar, relanzar): un fallo lanza y lo recoge `error.tsx`, ahora con
 * el mensaje de la API en vez de un «fetch failed».
 */
async function mustCall<T = undefined>(path: string, method: string): Promise<T> {
  const result = await callApi<T>(path, { method });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export async function deleteAuditAction(formData: FormData): Promise<void> {
  await mustCall(`/audits/${encodeURIComponent(String(formData.get('id')))}`, 'DELETE');

  revalidatePath('/');
  redirect('/');
}

export async function deleteAuditGroupAction(formData: FormData): Promise<void> {
  await mustCall(`/audit-groups/${encodeURIComponent(String(formData.get('id')))}`, 'DELETE');

  revalidatePath('/');
  redirect('/');
}

export async function rerunAuditAction(formData: FormData): Promise<void> {
  const audit = await mustCall<Audit>(`/audits/${encodeURIComponent(String(formData.get('id')))}/rerun`, 'POST');
  revalidatePath('/');
  redirect(`/auditorias/${audit.id}`);
}

// ---------------------------------------------------------------- revisión (capa 3)

const text = (formData: FormData, name: string): string => String(formData.get(name) ?? '').trim();

/** Solo rutas internas: el formulario dice qué página refrescar y no hay que fiarse de él. */
const internalPath = (formData: FormData): string => {
  const path = text(formData, 'path');
  return path.startsWith('/') && !path.startsWith('//') ? path : '/';
};

/** Recuerda quién revisa para no pedirlo en cada formulario. No es autenticación: no la hay. */
const rememberReviewer = async (name: string) => {
  (await cookies()).set(REVIEWER_COOKIE, name, { path: '/', maxAge: 60 * 60 * 24 * 180, sameSite: 'lax' });
};

/** Formularios: el error de la API (o de conexión) vuelve al formulario en vez de reventar la página. */
const send = async (path: string, method: string, body?: unknown): Promise<FormState> => {
  const result = await callApi(path, { method, body });
  return { error: result.ok ? null : result.error };
};

/**
 * Validar, rechazar o corregir un hallazgo. El estado viene del botón pulsado;
 * el resultado y la descripción solo se mandan al corregir, porque la API
 * rechaza cambios en una validación o un rechazo.
 */
export async function reviewFindingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const findingId = text(formData, 'findingId');
  const status = text(formData, 'status');
  const by = text(formData, 'by');
  const note = text(formData, 'note');
  if (!by) return { error: 'Indica quién revisa.' };

  const body: Record<string, unknown> = { status, by, note: note || null };
  if (status === 'amended') {
    body.outcome = text(formData, 'outcome');
    body.description = text(formData, 'description');
  }

  const sent = await send(`/findings/${encodeURIComponent(findingId)}/review`, 'PATCH', body);
  if (sent.error) return sent;

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}

export async function falsePositiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auditId = text(formData, 'auditId');
  const pageId = text(formData, 'pageId');
  const by = text(formData, 'by');
  const note = text(formData, 'note');
  if (!by) return { error: 'Indica quién revisa.' };
  if (!note) return { error: 'Explica por qué es un falso positivo.' };

  const sent = await send(
    `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/false-positives`,
    'POST',
    { checkId: text(formData, 'checkId'), ruleId: text(formData, 'ruleId'), by, note },
  );
  if (sent.error) return sent;

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}

export async function createSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = text(formData, 'name');
  const hosts = text(formData, 'hosts')
    .split(/[\s,;]+/)
    .map((host) => host.trim())
    .filter(Boolean);
  if (!name) return { error: 'Ponle un nombre al sitio.' };
  if (hosts.length === 0) return { error: 'Indica al menos un host o una URL del sitio.' };

  const site = await callApi<Site>('/sites', { method: 'POST', body: { name, hosts } });
  if (!site.ok) return { error: site.error };

  revalidatePath('/sitios');
  redirect(`/sitios/${site.data.id}`);
}

export async function deleteSiteAction(formData: FormData): Promise<void> {
  await mustCall(`/sites/${encodeURIComponent(text(formData, 'id'))}`, 'DELETE');

  revalidatePath('/sitios');
  redirect('/sitios');
}

export async function deleteSignOffAction(formData: FormData): Promise<void> {
  const siteId = text(formData, 'siteId');
  await mustCall(`/sign-offs/${encodeURIComponent(text(formData, 'id'))}`, 'DELETE');

  revalidatePath(`/sitios/${siteId}`);
  redirect(`/sitios/${siteId}`);
}

/**
 * Resultado que registra una persona (p. ej. tras probar con un lector de
 * pantalla). Nace propuesto, como todos: se valida después con la revisión.
 */
export async function createFindingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const by = text(formData, 'by');
  const description = text(formData, 'description');
  if (!by) return { error: 'Indica quién revisa.' };
  if (!description) return { error: 'Describe qué has comprobado y qué has visto.' };

  const siteId = text(formData, 'siteId');
  const target = siteId
    ? `/sites/${encodeURIComponent(siteId)}/findings`
    : `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/findings`;
  const assistiveTech = text(formData, 'assistiveTech');
  const recommendation = text(formData, 'recommendation');

  const sent = await send(target, 'POST', {
    checkId: text(formData, 'checkId'),
    outcome: text(formData, 'outcome'),
    description,
    recommendation: recommendation || null,
    assertedBy: { type: 'human', name: by, assistiveTech: assistiveTech || null },
  });
  if (sent.error) return sent;

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}

/**
 * Firmar la web con la muestra elegida. La API vuelve a comprobar todo: si
 * entre la vista previa y la firma alguien deja algo pendiente, lo rechaza y
 * aquí se enseña qué.
 */
export async function signOffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const siteId = text(formData, 'siteId');
  const signer = text(formData, 'signer');
  const statement = text(formData, 'statement');
  const credential = text(formData, 'credential');
  const pageIds = formData.getAll('pageIds').map(String).filter(Boolean);
  if (!signer) return { error: 'Indica quién firma.' };
  if (!statement) return { error: 'Escribe la declaración que firmas.' };

  // Un 409 trae los bloqueos en `details`: `callApi` añade los tres primeros al mensaje.
  const signOff = await callApi<SignOff>(`/sites/${encodeURIComponent(siteId)}/sign-offs`, {
    method: 'POST',
    body: { pageIds, signer, credential: credential || null, statement },
  });
  if (!signOff.ok) return { error: signOff.error };

  await rememberReviewer(signer);
  revalidatePath(`/sitios/${siteId}`);
  redirect(`/firmas/${signOff.data.id}`);
}

/** Enlazar (o recalcular) la línea base de una página: hereda hallazgos validados a nombre de quien enlaza. */
export async function linkBaselineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const by = text(formData, 'by');
  const baselinePageId = text(formData, 'baselinePageId');
  if (!by) return { error: 'Indica quién enlaza la línea base.' };
  if (!baselinePageId) return { error: 'Elige la página de línea base.' };

  const sent = await send(
    `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/baseline`,
    'PUT',
    { baselinePageId, by },
  );
  if (sent.error) return sent;

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}

export interface HeirsState extends FormState {
  results?: HeirResult[];
}

/**
 * Enlazar desde la línea base las páginas elegidas (o recalcular las que ya heredan). La API sigue con
 * las demás si una falla: el resultado de cada una vuelve al formulario.
 */
export async function linkHeirsAction(_prev: HeirsState, formData: FormData): Promise<HeirsState> {
  const by = text(formData, 'by');
  const pageIds = formData.getAll('heirs').map(String).filter(Boolean);
  if (!by) return { error: 'Indica quién enlaza.' };
  if (pageIds.length === 0) return { error: 'No has elegido ninguna página.' };

  const result = await callApi<HeirResult[]>(
    `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/heirs`,
    { method: 'POST', body: { pageIds, by } },
  );
  if (!result.ok) return { error: result.error };

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null, results: result.data };
}

export async function unlinkBaselineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const sent = await send(
    `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/baseline`,
    'DELETE',
  );
  if (sent.error) return sent;
  revalidatePath(internalPath(formData));
  return { error: null };
}

/** Valida de una vez los «No aplica» automáticos pendientes de una página (capa 3). */
export async function validateInapplicableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const by = text(formData, 'by');
  if (!by) return { error: 'Indica quién revisa.' };

  const sent = await send(
    `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/findings/validate-inapplicable`,
    'POST',
    { by },
  );
  if (sent.error) return sent;

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}
