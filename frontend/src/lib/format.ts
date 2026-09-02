import type { AuditStatus, Impact, Meta, PageStatus } from './types';

export const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatRelative = (iso: string | null): string => {
  if (!iso) return '—';
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ];

  let value = diffSeconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' }).format(Math.round(value), unit);
    }
    value /= size;
  }
  return formatDateTime(iso);
};

export const formatDuration = (ms: number | null): string => {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
};

export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  queued: 'En cola',
  running: 'Escaneando',
  completed: 'Completada',
  failed: 'Fallida',
};

export const PAGE_STATUS_LABEL: Record<PageStatus, string> = {
  pending: 'Pendiente',
  running: 'Escaneando',
  completed: 'Completada',
  failed: 'Fallida',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  critical: 'Crítico',
  serious: 'Grave',
  moderate: 'Moderado',
  minor: 'Leve',
};

export const isInProgress = (status: AuditStatus): boolean =>
  status === 'queued' || status === 'running';

/** Valor del desplegable de sección que abre el campo de selector libre. */
export const CUSTOM_SECTION = '__custom__';

/**
 * Nombre legible de una sección. En la BD se guarda el selector CSS resuelto y
 * no el id del atajo, así que se busca al revés contra la lista que sirve
 * `/api/meta`. Si no es un atajo conocido, se enseña el CSS tal cual.
 */
export const sectionLabel = (
  include: string | null,
  sections: Meta['sections'] = []
): string | null => {
  if (!include) return null;
  return sections.find((section) => section.selector === include)?.label ?? include;
};
