'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CUSTOM_SECTION } from '@/lib/format';
import type { Audit } from '@/lib/types';

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

  if (device) {
    payload.device = device;
  } else {
    const width = Number(formData.get('viewportWidth'));
    const height = Number(formData.get('viewportHeight'));
    if (width > 0 && height > 0) payload.viewport = { width, height };
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
