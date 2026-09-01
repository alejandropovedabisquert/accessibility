import { AppError } from './errors';

/** Normaliza una URL a su forma canonica, descartando el hash. */
export const normalizeUrl = (raw: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new AppError(`URL no valida: ${raw}`, 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('Solo se permiten los protocolos http y https', 400);
  }

  parsed.hash = '';
  return parsed.toString();
};

/** Devuelve el host de una URL, para agrupar y mostrar en la UI. */
export const hostOf = (raw: string): string => {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
};

/** Version corta y legible de una URL, sin protocolo ni barra final. */
export const displayUrl = (raw: string): string =>
  raw.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * Convierte una URL en un fragmento seguro para nombres de fichero.
 * Nunca produce separadores de ruta ni "..".
 */
export const slugifyUrl = (raw: string): string => {
  const slug = displayUrl(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'url';
};
