'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CUSTOM_SECTION } from '@/lib/format';
import { REVIEWER_COOKIE } from '@/lib/reviewer';
import type { Audit, SignOffBlocker, Site, SignOff } from '@/lib/types';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

interface ApiErrorBody {
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

const readError = async (res: Response): Promise<string> => {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  if (body?.details?.length) {
    return body.details.map((d) => `${d.field}: ${d.message}`).join(' · ');
  }
  return body?.error ?? `La API devolvió ${res.status}`;
};

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

// Un despiste habitual: pegar "avantio.com" sin protocolo.
const withProtocol = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

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

  let audit: Audit;
  try {
    const res = await fetch(`${API_URL}/api/audits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!res.ok) return { error: await readError(res) };
    audit = (await res.json()) as Audit;
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  revalidatePath('/');
  redirect(`/auditorias/${audit.id}`);
}

export async function deleteAuditAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const res = await fetch(`${API_URL}/api/audits/${id}`, { method: 'DELETE', cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));

  revalidatePath('/');
  redirect('/');
}

export async function rerunAuditAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const res = await fetch(`${API_URL}/api/audits/${id}/rerun`, { method: 'POST', cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));

  const audit = (await res.json()) as Audit;
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

const send = async (path: string, method: string, body: unknown): Promise<Response> =>
  fetch(`${API_URL}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

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

  try {
    const res = await send(`/findings/${encodeURIComponent(findingId)}/review`, 'PATCH', body);
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

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

  try {
    const res = await send(
      `/audits/${encodeURIComponent(auditId)}/pages/${encodeURIComponent(pageId)}/false-positives`,
      'POST',
      { checkId: text(formData, 'checkId'), ruleId: text(formData, 'ruleId'), by, note },
    );
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

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

  let site: Site;
  try {
    const res = await send('/sites', 'POST', { name, hosts });
    if (!res.ok) return { error: await readError(res) };
    site = (await res.json()) as Site;
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  revalidatePath('/sitios');
  redirect(`/sitios/${site.id}`);
}

export async function deleteSiteAction(formData: FormData): Promise<void> {
  const id = text(formData, 'id');
  const res = await fetch(`${API_URL}/api/sites/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' });
  if (!res.ok) throw new Error(await readError(res));

  revalidatePath('/sitios');
  redirect('/sitios');
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

  try {
    const res = await send(target, 'POST', {
      checkId: text(formData, 'checkId'),
      outcome: text(formData, 'outcome'),
      description,
      recommendation: recommendation || null,
      assertedBy: { type: 'human', name: by, assistiveTech: assistiveTech || null },
    });
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

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

  let signOff: SignOff;
  try {
    const res = await send(`/sites/${encodeURIComponent(siteId)}/sign-offs`, 'POST', {
      pageIds,
      signer,
      credential: credential || null,
      statement,
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { error?: string; details?: SignOffBlocker[] } | null;
      const first = body?.details?.slice(0, 3).map((blocker) => blocker.message).join(' · ');
      return { error: `${body?.error ?? 'No se puede firmar todavía'}${first ? `: ${first}` : ''}` };
    }
    if (!res.ok) return { error: await readError(res) };
    signOff = (await res.json()) as SignOff;
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  await rememberReviewer(signer);
  revalidatePath(`/sitios/${siteId}`);
  redirect(`/firmas/${signOff.id}`);
}

/** Enlazar (o recalcular) la línea base de una página: hereda hallazgos validados a nombre de quien enlaza. */
export async function linkBaselineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const by = text(formData, 'by');
  const baselinePageId = text(formData, 'baselinePageId');
  if (!by) return { error: 'Indica quién enlaza la línea base.' };
  if (!baselinePageId) return { error: 'Elige la página de línea base.' };

  try {
    const res = await send(
      `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/baseline`,
      'PUT',
      { baselinePageId, by },
    );
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}

export async function unlinkBaselineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const res = await fetch(
      `${API_URL}/api/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/baseline`,
      { method: 'DELETE', cache: 'no-store' },
    );
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }
  revalidatePath(internalPath(formData));
  return { error: null };
}

/** Valida de una vez los «No aplica» automáticos pendientes de una página (capa 3). */
export async function validateInapplicableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const by = text(formData, 'by');
  if (!by) return { error: 'Indica quién revisa.' };

  try {
    const res = await send(
      `/audits/${encodeURIComponent(text(formData, 'auditId'))}/pages/${encodeURIComponent(text(formData, 'pageId'))}/findings/validate-inapplicable`,
      'POST',
      { by },
    );
    if (!res.ok) return { error: await readError(res) };
  } catch {
    return { error: `No se pudo conectar con la API en ${API_URL}.` };
  }

  await rememberReviewer(by);
  revalidatePath(internalPath(formData));
  return { error: null };
}
