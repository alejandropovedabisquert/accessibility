import { createHash } from 'crypto';

/**
 * "Huella" de un nodo de axe: su estructura HTML sin lo que cambia de una
 * instancia a otra del mismo componente. Se queda con las etiquetas, las clases
 * estables y los atributos; quita el texto, los valores de contenido (enlace,
 * imagen, textos alternativos) y los identificadores que genera el CMS.
 *
 * Sirve para que el mismo fallo del pie o del banner de cookies salga una vez
 * con 20 URLs en la exportacion agregada, no 20 veces. Si una web deduplica
 * mal (el mismo error sale partido en varios grupos), casi siempre es que le
 * falta aqui un patron: compara el `html` de dos grupos que deberian ser uno.
 *
 * Asi, 12 tarjetas de la misma plantilla con distinto enlace y titulo son un
 * solo grupo. El precio es que dos elementos distintos con la misma estructura
 * y clases tambien se juntan: los ejemplos de `nodes` siguen trayendo el HTML
 * real para distinguirlos.
 *
 * Tipos de patron:
 * - `class`: quita del atributo class los tokens que casan.
 * - `attribute`: quita entero el atributo cuyo nombre casa.
 * - `dropValue`: conserva el atributo pero sin valor (`href="/a"` → `href`).
 *   Que exista o no sigue contando: `<img alt>` y `<img>` no son lo mismo.
 * - `value`: dentro de cualquier atributo, sustituye lo que casa por `*`,
 *   conservando el grupo 1 si lo hay (`e-form-input-31a11f8` → `e-form-input-*`).
 *   Asi un id generado y el `for` / `aria-labelledby` que lo referencian
 *   quedan igual en todas las paginas. Tiene que llevar el flag `g`.
 */
export type FingerprintPattern =
  | { kind: 'class'; pattern: RegExp; why: string }
  | { kind: 'attribute'; pattern: RegExp; why: string }
  | { kind: 'dropValue'; pattern: RegExp; why: string }
  | { kind: 'value'; pattern: RegExp; why: string };

export const FINGERPRINT_PATTERNS: FingerprintPattern[] = [
  // ---- Contenido: cambia en cada instancia de una plantilla (tarjeta, item de menu...)
  {
    kind: 'dropValue',
    pattern: /^(href|src|srcset|alt|title|aria-label)$/,
    why: 'Destino, imagen y textos de cada instancia; la estructura del componente es la misma',
  },

  // ---- WordPress: el menu marca la pagina en la que se esta. El mismo menu es
  // distinto en cada pagina, y sin esto la cabecera y el pie nunca casan entre
  // paginas (lineas base) ni se agrupan en la exportacion.
  {
    kind: 'class',
    pattern: /^(current[-_](menu|page)[-_](item|parent|ancestor)|page[-_]item(-\d+)?|elementor-item-active)$/,
    why: 'WordPress/Elementor: elemento de menu de la pagina actual (current-menu-item, current_page_item, page-item-1365, elementor-item-active)',
  },
  {
    kind: 'attribute',
    pattern: /^aria-current$/,
    why: 'Pagina actual en el menu: cambia de enlace en cada pagina. Va con las clases de arriba; que se marque bien es cosa de 2.4.8, no de la huella',
  },
  {
    kind: 'attribute',
    pattern: /^data-smartmenus-id$/,
    why: 'SmartMenus (menus de Elementor): id aleatorio en cada carga de la pagina',
  },

  // ---- Elementor
  {
    kind: 'class',
    pattern: /^e-[0-9a-f]{7}-[0-9a-f]{7}$/,
    why: 'Elementor: clase de estilos por instancia del elemento (e-7abb8a1-8bff8d3)',
  },
  {
    kind: 'class',
    pattern: /^elementor-element-[0-9a-f]{7,8}$/,
    why: 'Elementor: id del elemento dentro de la plantilla (elementor-element-4332f88)',
  },
  {
    kind: 'class',
    pattern: /^elementor-\d+$/,
    why: 'Elementor: id del post o plantilla que contiene el elemento (elementor-1234)',
  },
  {
    kind: 'attribute',
    pattern: /^data-(id|interaction-id|elementor-id)$/,
    why: 'Elementor: data-id, data-interaction-id y data-elementor-id repiten esos mismos ids',
  },
  {
    kind: 'value',
    pattern: /\b(e-form-(?:input|field)-)[0-9a-f]{7}\b/g,
    why: 'Elementor Forms: id de campo generado (e-form-input-31a11f8) y sus referencias en for/aria-*',
  },
];

const TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const normalizeTag = (patterns: readonly FingerprintPattern[]) =>
  (_match: string, name: string, rawAttributes: string, selfClosing: string): string => {
    const attributes: Array<[string, string | null]> = [];

    for (const match of rawAttributes.matchAll(ATTRIBUTE)) {
      const attribute = (match[1] ?? '').toLowerCase();
      let value: string | null = match[2] ?? match[3] ?? match[4] ?? null;

      if (patterns.some((p) => p.kind === 'attribute' && p.pattern.test(attribute))) continue;
      if (value !== null && patterns.some((p) => p.kind === 'dropValue' && p.pattern.test(attribute))) {
        attributes.push([attribute, null]);
        continue;
      }

      if (value !== null && attribute === 'class') {
        value = value
          .split(/\s+/)
          .filter((token) => token && !patterns.some((p) => p.kind === 'class' && p.pattern.test(token)))
          .sort()
          .join(' ');
        if (!value) continue;
      }
      for (const pattern of patterns) {
        if (pattern.kind === 'value' && value !== null) {
          value = value.replace(pattern.pattern, (_match, keep: unknown) => `${typeof keep === 'string' ? keep : ''}*`);
        }
      }
      attributes.push([attribute, value]);
    }

    // El orden de los atributos no cambia el elemento, pero si el texto.
    attributes.sort(([a], [b]) => a.localeCompare(b));
    const serialized = attributes.map(([attr, value]) => (value === null ? ` ${attr}` : ` ${attr}="${value}"`)).join('');
    return `<${name.toLowerCase()}${serialized}${selfClosing ? ' /' : ''}>`;
  };

const CLOSING_TAG = /<\/[a-zA-Z][\w:-]*\s*>/g;

/**
 * Solo etiquetas, sin texto: el texto interno ("Villa Rosa", "Ver mas") es lo
 * que distingue una instancia de otra, no el componente. Se reconstruye con
 * las etiquetas encontradas en orden en vez de borrar lo que hay entre `>` y
 * `<`, porque un valor de atributo puede contener esos caracteres.
 */
const tagsOnly = (html: string): string => {
  const tags = [...html.matchAll(new RegExp(`${TAG.source}|${CLOSING_TAG.source}`, 'g'))].map((match) => match[0]);
  return tags.length > 0 ? tags.join('') : html.trim();
};

export const normalizeHtml = (html: string, patterns: readonly FingerprintPattern[] = FINGERPRINT_PATTERNS): string =>
  tagsOnly(html)
    .replace(CLOSING_TAG, (tag) => tag.replace(/\s+/g, '').toLowerCase())
    .replace(TAG, normalizeTag(patterns))
    .replace(/\s+/g, ' ')
    .trim();

/** Id corto y estable de un grupo, para poder citarlo ("el grupo 3f2a…"). */
export const fingerprint = (rule: string, html: string, patterns?: readonly FingerprintPattern[]): string =>
  createHash('sha1').update(`${rule}\n${normalizeHtml(html, patterns)}`).digest('hex').slice(0, 12);
