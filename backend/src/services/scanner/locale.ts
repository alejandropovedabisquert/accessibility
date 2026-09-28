import axe from 'axe-core';
import base from 'axe-core/locales/es.json';
import overrides from './locales/es.overrides.json';

/**
 * Forma laxa de un fichero de `axe-core/locales`. El tipo `Locale` de axe no
 * sirve: exige `fail` en cada check y su propio `es.json` no lo cumple
 * (`no-implicit-explicit-label`), y ademas no recoge `failureSummaries`.
 */
type LocaleData = {
  rules?: Record<string, object>;
  checks?: Record<string, object>;
  [key: string]: unknown;
};

function mergeSection(
  from: Record<string, object> | undefined,
  extra: Record<string, object> | undefined,
): Record<string, object> {
  const merged: Record<string, object> = { ...from };
  for (const [id, entry] of Object.entries(extra ?? {})) {
    merged[id] = { ...merged[id], ...entry };
  }
  return merged;
}

export function mergeLocale(from: LocaleData, extra: LocaleData): LocaleData {
  return {
    ...from,
    ...extra,
    rules: mergeSection(from.rules, extra.rules),
    checks: mergeSection(from.checks, extra.checks),
  };
}

/**
 * La traduccion `es` que trae axe-core esta incompleta (en 4.13.0 falta ~1/4 de
 * reglas y checks) y lo que falta sale en ingles. `es.overrides.json` es el sitio
 * para completarla o corregirla sin tocar `node_modules`: sus entradas pisan a las
 * de axe campo a campo, asi que basta con escribir lo que falte o se quiera cambiar.
 *
 * Las claves son `ruleId` / id de check de la version de axe instalada. Al subir
 * axe-core, revisa que sigan existiendo: una clave huerfana se ignora sin avisar.
 */
export const SCAN_LOCALE = mergeLocale(base, overrides);

/**
 * `@axe-core/playwright` no expone `axe.configure`, pero inyecta `axeSource` tal
 * cual en cada frame y en la pagina en blanco donde `finishRun` compone los
 * mensajes. Anadir la configuracion al final del fuente cubre todos esos sitios.
 */
export const LOCALIZED_AXE_SOURCE = `${axe.source}
;axe.configure({ locale: ${JSON.stringify(SCAN_LOCALE)} });`;
