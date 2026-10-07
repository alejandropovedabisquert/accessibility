import type {
  Box,
  ControlItem,
  EvidenceElement,
  FormField,
  ImageItem,
  LayoutEvidence,
  MediaItem,
  ScanScope,
} from '../../types/audit.types';

/*
 * Codigo que corre DENTRO de la pagina, via `page.evaluate`.
 *
 * `installProbes` se serializa con `toString()` y se ejecuta en el navegador,
 * asi que no puede usar nada de fuera de su cuerpo: ni imports, ni constantes
 * del modulo. Solo los tipos, que desaparecen al compilar. Todo lo que necesita
 * le llega por `options`.
 *
 * El tsconfig del backend no carga la lib "dom" a proposito (ver `BrowserGlobal`
 * en scan.service), asi que aqui se declara a mano lo poco del DOM que se usa.
 */

interface ProbeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ProbeStyle {
  getPropertyValue(name: string): string;
  display: string;
  visibility: string;
  overflowX: string;
  overflowY: string;
}

interface ProbeElement {
  tagName: string;
  id: string;
  textContent: string | null;
  innerText?: string;
  parentElement: ProbeElement | null;
  children: ArrayLike<ProbeElement>;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  getBoundingClientRect(): ProbeRect;
  getClientRects(): { length: number };
  closest(selector: string): ProbeElement | null;
  contains(other: ProbeElement | null): boolean;
  matches(selector: string): boolean;
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): ArrayLike<ProbeElement>;
  appendChild(child: ProbeElement): void;
  remove(): void;
  blur?(): void;
}

interface ProbeDocument {
  documentElement: ProbeElement;
  body: ProbeElement | null;
  head: ProbeElement | null;
  title: string;
  activeElement: ProbeElement | null;
  createElement(tag: string): ProbeElement;
  getElementById(id: string): ProbeElement | null;
  elementFromPoint(x: number, y: number): ProbeElement | null;
  querySelector(selector: string): ProbeElement | null;
  querySelectorAll(selector: string): ArrayLike<ProbeElement>;
  getAnimations?(): Array<{ playState: string }>;
}

interface ProbeWindow {
  document: ProbeDocument;
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  getComputedStyle(element: ProbeElement): ProbeStyle;
  scrollTo(x: number, y: number): void;
  CSS: { escape(value: string): string };
  __a11yEvidence?: ProbeApi;
}

export interface ProbeOptions {
  scope: ScanScope;
  maxItems: number;
  maxTextLength: number;
}

export type FocusStepResult =
  | { kind: 'none' }
  | {
      kind: 'element';
      index: number;
      isNew: boolean;
      sameAsPrevious: boolean;
      isFrame: boolean;
      element: EvidenceElement;
      indicator: 'changed' | 'unchanged' | 'unknown';
      indicatorProperties: string[];
      obscured: 'none' | 'partial' | 'full' | 'offscreen';
      /** En coordenadas del viewport, para recortar la captura. null si no se ve. */
      clip: Box | null;
    };

export interface ProbeApi {
  textContent(): {
    title: string;
    lang: string | null;
    langParts: Array<{ selector: string; lang: string; text: string }>;
    text: string;
    truncated: boolean;
  };
  headings(): Array<{ level: number; text: string; selector: string; inScope: boolean }>;
  landmarks(): EvidenceElement[];
  forms(): { fields: FormField[]; total: number };
  controls(): { items: ControlItem[]; total: number };
  media(): { items: MediaItem[]; runningAnimations: number };
  images(): { items: Array<Omit<ImageItem, 'screenshot'>>; total: number };
  applicability(entries: Array<{ id: string; selector: string }>): Record<string, number>;
  prepareFocus(): void;
  focusStep(): FocusStepResult;
  layout(): Omit<LayoutEvidence, 'viewport' | 'screenshot'>;
  setTextSpacing(enabled: boolean): void;
  scrollHeight(): number;
  /**
   * Para la herencia de lineas base, sobre un DOM guardado: cada selector con
   * el HTML de su elemento y el indice de su region (el landmark que lo
   * contiene o, si no hay, el bloque hijo de body). El HTML de cada region va una sola vez.
   */
  resolveTargets(selectors: string[]): {
    targets: Array<{ selector: string; found: boolean; html: string; region: number }>;
    regions: Array<{ selector: string; role: string | null; html: string }>;
  };
  /** Todas las regiones del documento con su HTML, para comparar dos paginas. */
  regionsHtml(): Array<{ selector: string; role: string | null; html: string }>;
}

export const installProbes = (options: ProbeOptions): void => {
  const win = globalThis as unknown as ProbeWindow;
  const doc = win.document;

  const FOCUSABLE =
    'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable="true"], audio[controls], video[controls]';
  const CONTROLS =
    'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="combobox"], [role="slider"], [tabindex]:not([tabindex="-1"])';
  const LANDMARKS =
    'header, nav, main, aside, footer, form[aria-label], form[aria-labelledby], section[aria-label], section[aria-labelledby], [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"], [role="search"], [role="region"], [role="form"]';
  const FIELDS = 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea';
  // Estilos que suelen hacer de indicador de foco. Se comparan antes y despues de enfocar.
  const INDICATOR_PROPERTIES = [
    'outline-style',
    'outline-width',
    'outline-color',
    'outline-offset',
    'box-shadow',
    'border-top-color',
    'border-bottom-color',
    'border-left-color',
    'border-right-color',
    'border-top-width',
    'border-bottom-width',
    'background-color',
    'color',
    'text-decoration-line',
    'text-decoration-color',
    'transform',
    'opacity',
  ];
  const TEXT_SPACING_ID = '__a11y-evidence-text-spacing';

  const clean = (value: string | null | undefined, max = 150): string =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  const safeAll = (root: ProbeDocument | ProbeElement, selector: string): ProbeElement[] => {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const root = (options.scope.include && doc.querySelector(options.scope.include)) || doc.body || doc.documentElement;
  const excluded = options.scope.exclude ? safeAll(doc, options.scope.exclude) : [];
  const inScope = (element: ProbeElement): boolean =>
    root.contains(element) && !excluded.some((outside) => outside.contains(element));

  const isVisible = (element: ProbeElement): boolean => {
    if (element.getClientRects().length === 0) return false;
    const style = win.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };

  const escape = (value: string) => win.CSS.escape(value);
  const uniqueId = (element: ProbeElement) =>
    element.id !== '' && safeAll(doc, `#${escape(element.id)}`).length === 1;

  const selectorOf = (element: ProbeElement): string => {
    if (uniqueId(element)) return `#${escape(element.id)}`;
    const parts: string[] = [];
    let current: ProbeElement | null = element;
    while (current && current !== doc.documentElement && parts.length < 12) {
      if (uniqueId(current)) {
        parts.unshift(`#${escape(current.id)}`);
        break;
      }
      const tag = current.tagName.toLowerCase();
      const parent: ProbeElement | null = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const tagName = current.tagName;
      const siblings = Array.from(parent.children).filter((child) => child.tagName === tagName);
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
      current = parent;
    }
    return parts.join(' > ');
  };

  const IMPLICIT_ROLES: Record<string, string> = {
    button: 'button',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    aside: 'complementary',
    form: 'form',
    img: 'img',
    select: 'combobox',
    textarea: 'textbox',
    summary: 'button',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    ul: 'list',
    ol: 'list',
    table: 'table',
    dialog: 'dialog',
  };
  const INPUT_ROLES: Record<string, string> = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    search: 'searchbox',
  };

  const roleOf = (element: ProbeElement): string | null => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0] ?? null;
    const tag = element.tagName.toLowerCase();
    if ((tag === 'a' || tag === 'area') && element.hasAttribute('href')) return 'link';
    if (tag === 'input') return INPUT_ROLES[element.getAttribute('type') ?? 'text'] ?? 'textbox';
    if (tag === 'section') return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') ? 'region' : null;
    return IMPLICIT_ROLES[tag] ?? null;
  };

  const textOfIds = (ids: string): string =>
    clean(
      ids
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? '')
        .join(' '),
    );

  const labelOf = (element: ProbeElement): string | null => {
    const labels: string[] = [];
    if (element.id) {
      for (const label of safeAll(doc, `label[for="${escape(element.id)}"]`)) labels.push(clean(label.innerText ?? label.textContent));
    }
    const wrapping = element.closest('label');
    if (wrapping) labels.push(clean(wrapping.innerText ?? wrapping.textContent));
    const joined = labels.filter(Boolean).join(' ');
    return joined || null;
  };

  /** Aproximacion del calculo de nombre accesible: suficiente para comparar con el texto visible. */
  const nameOf = (element: ProbeElement): string => {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = textOfIds(labelledBy);
      if (text) return text;
    }
    const ariaLabel = clean(element.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const type = element.getAttribute('type') ?? 'text';
      if (tag === 'input' && type === 'image') return clean(element.getAttribute('alt'));
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) return clean(element.getAttribute('value'));
      const label = labelOf(element);
      if (label) return label;
    }
    if (tag === 'img' || tag === 'area') return clean(element.getAttribute('alt'));
    if (tag === 'svg') {
      const title = clean(element.querySelector('title')?.textContent);
      if (title) return title;
    }
    const text = clean(element.innerText ?? element.textContent);
    if (text) return text;
    return clean(element.getAttribute('title'));
  };

  const boxOf = (element: ProbeElement): Box | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      x: Math.round(rect.left + win.scrollX),
      y: Math.round(rect.top + win.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };

  const describe = (element: ProbeElement): EvidenceElement => ({
    selector: selectorOf(element),
    tag: element.tagName.toLowerCase(),
    role: roleOf(element),
    name: nameOf(element),
    box: boxOf(element),
    inScope: inScope(element),
  });

  const visibleInScope = (selector: string): ProbeElement[] =>
    safeAll(doc, selector).filter((element) => inScope(element) && isVisible(element));

  const styleSnapshot = (element: ProbeElement): Record<string, string> => {
    const style = win.getComputedStyle(element);
    return Object.fromEntries(INDICATOR_PROPERTIES.map((property) => [property, style.getPropertyValue(property)]));
  };

  const unfocused = new Map<ProbeElement, { self: Record<string, string>; parent: Record<string, string> | null }>();
  const seen: ProbeElement[] = [];
  let previous: ProbeElement | null = null;

  const api: ProbeApi = {
    textContent() {
      const text = (root.innerText ?? root.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
      const pageLang = doc.documentElement.getAttribute('lang');
      const langParts = safeAll(doc, '[lang]')
        .filter((element) => element !== doc.documentElement && inScope(element))
        .slice(0, options.maxItems)
        .map((element) => ({
          selector: selectorOf(element),
          lang: element.getAttribute('lang') ?? '',
          text: clean(element.innerText ?? element.textContent, 200),
        }));
      return {
        title: doc.title,
        lang: pageLang,
        langParts,
        text: text.slice(0, options.maxTextLength),
        truncated: text.length > options.maxTextLength,
      };
    },

    headings() {
      return safeAll(doc, 'h1, h2, h3, h4, h5, h6, [role="heading"]')
        .filter(isVisible)
        .slice(0, options.maxItems)
        .map((element) => {
          const tag = element.tagName.toLowerCase();
          const level = /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : Number(element.getAttribute('aria-level') ?? 2);
          return { level, text: clean(element.innerText ?? element.textContent, 200), selector: selectorOf(element), inScope: inScope(element) };
        });
    },

    landmarks() {
      return safeAll(doc, LANDMARKS).filter(isVisible).slice(0, options.maxItems).map(describe);
    },

    forms() {
      const fields = visibleInScope(FIELDS);
      return {
        total: fields.length,
        fields: fields.slice(0, options.maxItems).map((element): FormField => {
          const describedBy = element.getAttribute('aria-describedby');
          const fieldset = element.closest('fieldset');
          const group = fieldset
            ? clean(fieldset.querySelector('legend')?.textContent) || null
            : clean(element.closest('[role="group"], [role="radiogroup"]')?.getAttribute('aria-label')) || null;
          return {
            ...describe(element),
            type: element.tagName.toLowerCase() === 'input' ? (element.getAttribute('type') ?? 'text') : element.tagName.toLowerCase(),
            label: labelOf(element),
            placeholder: element.getAttribute('placeholder'),
            required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
            autocomplete: element.getAttribute('autocomplete'),
            invalid: element.getAttribute('aria-invalid') === 'true',
            description: describedBy ? textOfIds(describedBy) || null : null,
            group,
          };
        }),
      };
    },

    controls() {
      const controls = visibleInScope(CONTROLS);
      return {
        total: controls.length,
        items: controls.slice(0, options.maxItems).map((element): ControlItem => {
          const states: Record<string, string> = {};
          for (const state of ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-current', 'aria-disabled', 'aria-haspopup']) {
            const value = element.getAttribute(state);
            if (value !== null) states[state] = value;
          }
          const block = element.closest('p, li, td, dd, blockquote');
          const blockText = clean(block?.innerText ?? block?.textContent, 10_000);
          const ownText = clean(element.innerText ?? element.textContent, 10_000);
          return {
            ...describe(element),
            visibleText: clean(element.innerText ?? element.textContent),
            href: element.getAttribute('href'),
            states,
            // Enlace en mitad de un texto: el bloque tiene bastante mas texto que el propio enlace.
            inline: element.tagName.toLowerCase() === 'a' && blockText.length > ownText.length + 20,
          };
        }),
      };
    },

    media() {
      const items = visibleInScope('video, audio, iframe').flatMap((element): MediaItem[] => {
        const tag = element.tagName.toLowerCase();
        const src = element.getAttribute('src') ?? element.querySelector('source')?.getAttribute('src') ?? null;
        if (tag === 'iframe' && !/youtube|youtu\.be|vimeo|dailymotion|wistia|jwplayer|soundcloud|spotify/i.test(src ?? '')) return [];
        return [
          {
            ...describe(element),
            kind: tag === 'iframe' ? 'iframe' : (tag as 'video' | 'audio'),
            src,
            autoplay: element.hasAttribute('autoplay') || /[?&]autoplay=1/.test(src ?? ''),
            muted: element.hasAttribute('muted') || /[?&]mute=1/.test(src ?? ''),
            controls: element.hasAttribute('controls'),
            tracks: safeAll(element, 'track').map((track) => ({
              kind: track.getAttribute('kind') ?? 'subtitles',
              srclang: track.getAttribute('srclang'),
              label: track.getAttribute('label'),
            })),
          },
        ];
      });
      const runningAnimations = doc.getAnimations ? doc.getAnimations().filter((animation) => animation.playState === 'running').length : 0;
      return { items: items.slice(0, options.maxItems), runningAnimations };
    },

    images() {
      const images = visibleInScope('img, svg, canvas, object, area, input[type="image"], [role="img"]').filter(
        // Los svg dentro de un [role=img] o de otro svg ya cuentan por su contenedor.
        (element) => !(element.tagName.toLowerCase() !== 'svg' ? false : element.parentElement?.closest('svg, [role="img"]')),
      );
      return {
        total: images.length,
        items: images.slice(0, options.maxItems).map((element) => {
          const alt = element.hasAttribute('alt') ? (element.getAttribute('alt') ?? '') : null;
          const role = element.getAttribute('role');
          return {
            ...describe(element),
            src: element.getAttribute('src'),
            alt,
            decorative:
              alt === '' || element.getAttribute('aria-hidden') === 'true' || role === 'presentation' || role === 'none',
          };
        }),
      };
    },

    applicability(entries) {
      return Object.fromEntries(
        entries.map(({ id, selector }) => {
          try {
            return [id, Array.from(doc.querySelectorAll(selector)).filter(inScope).length];
          } catch {
            // Selector que este navegador no entiende: no se puede afirmar que no aplica.
            return [id, -1];
          }
        }),
      );
    },

    /** Estilos de reposo de todo lo enfocable, para comparar al enfocarlo con el tabulador. */
    prepareFocus() {
      doc.activeElement?.blur?.();
      win.scrollTo(0, 0);
      unfocused.clear();
      seen.length = 0;
      previous = null;
      for (const element of safeAll(doc, FOCUSABLE)) {
        unfocused.set(element, {
          self: styleSnapshot(element),
          parent: element.parentElement ? styleSnapshot(element.parentElement) : null,
        });
      }
    },

    focusStep() {
      const element = doc.activeElement;
      if (!element || element === doc.body || element === doc.documentElement) return { kind: 'none' };

      let index = seen.indexOf(element);
      const isNew = index === -1;
      if (isNew) {
        seen.push(element);
        index = seen.length - 1;
      }
      const sameAsPrevious = element === previous;
      previous = element;

      const before = unfocused.get(element);
      let indicator: 'changed' | 'unchanged' | 'unknown' = 'unknown';
      const indicatorProperties: string[] = [];
      if (before) {
        const self = styleSnapshot(element);
        for (const property of INDICATOR_PROPERTIES) {
          if (self[property] !== before.self[property]) indicatorProperties.push(property);
        }
        if (before.parent && element.parentElement) {
          const parent = styleSnapshot(element.parentElement);
          for (const property of INDICATOR_PROPERTIES) {
            if (parent[property] !== before.parent[property]) indicatorProperties.push(`parent:${property}`);
          }
        }
        indicator = indicatorProperties.length > 0 ? 'changed' : 'unchanged';
      }

      const rect = element.getBoundingClientRect();
      const outside =
        rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= win.innerHeight || rect.left >= win.innerWidth;
      let obscured: 'none' | 'partial' | 'full' | 'offscreen' = 'offscreen';
      let clip: Box | null = null;
      if (!outside) {
        const points: Array<[number, number]> = [
          [0.5, 0.5],
          [0.2, 0.2],
          [0.8, 0.2],
          [0.2, 0.8],
          [0.8, 0.8],
        ];
        const covered = points.filter(([fx, fy]) => {
          const x = Math.min(Math.max(rect.left + rect.width * fx, 0), win.innerWidth - 1);
          const y = Math.min(Math.max(rect.top + rect.height * fy, 0), win.innerHeight - 1);
          const hit = doc.elementFromPoint(x, y);
          return !(hit && (element.contains(hit) || hit.contains(element)));
        }).length;
        obscured = covered === 0 ? 'none' : covered === points.length ? 'full' : 'partial';

        // Margen alrededor para que se vea el indicador (outline, sombra).
        const margin = 16;
        const x = Math.max(0, Math.floor(rect.left - margin));
        const y = Math.max(0, Math.floor(rect.top - margin));
        clip = {
          x,
          y,
          width: Math.max(1, Math.min(win.innerWidth, Math.ceil(rect.right + margin)) - x),
          height: Math.max(1, Math.min(win.innerHeight, Math.ceil(rect.bottom + margin)) - y),
        };
      }

      return {
        kind: 'element',
        index,
        isNew,
        sameAsPrevious,
        isFrame: element.tagName.toLowerCase() === 'iframe',
        element: describe(element),
        indicator,
        indicatorProperties,
        obscured,
        clip,
      };
    },

    layout() {
      const viewportWidth = doc.documentElement.clientWidth;
      const scrollWidth = doc.documentElement.scrollWidth;
      const all = safeAll(doc.body ?? doc.documentElement, '*').filter(isVisible);
      const scrolls = (element: ProbeElement) => {
        const style = win.getComputedStyle(element);
        return style.overflowX === 'auto' || style.overflowX === 'scroll';
      };
      const insideScroller = (element: ProbeElement) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (scrolls(parent)) return true;
        }
        return false;
      };
      const overflows = (element: ProbeElement) => element.getBoundingClientRect().right + win.scrollX > viewportWidth + 1;

      // Solo la raiz de cada desbordamiento: si el padre ya se sale, el hijo no aporta.
      const overflowing = all.filter(
        (element) => overflows(element) && !(element.parentElement && overflows(element.parentElement)) && !insideScroller(element),
      );
      const clipped = all.filter((element) => {
        const style = win.getComputedStyle(element);
        const hides = (value: string) => value === 'hidden' || value === 'clip';
        const cutX = hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
        const cutY = hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        return (cutX || cutY) && clean(element.innerText ?? element.textContent) !== '';
      });

      return {
        horizontalScroll: scrollWidth > viewportWidth + 1,
        scrollWidth,
        overflowing: overflowing.slice(0, options.maxItems).map(describe),
        clipped: clipped.slice(0, options.maxItems).map(describe),
      };
    },

    /** Los valores de 1.4.12, con !important para ganar a los estilos de la pagina. */
    setTextSpacing(enabled) {
      doc.getElementById(TEXT_SPACING_ID)?.remove();
      if (!enabled) return;
      const style = doc.createElement('style');
      style.id = TEXT_SPACING_ID;
      style.textContent =
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } ' +
        'p { margin-bottom: 2em !important; }';
      (doc.head ?? doc.documentElement).appendChild(style);
    },

    scrollHeight() {
      return doc.documentElement.scrollHeight;
    },

    resolveTargets(selectors) {
      const regionElements: ProbeElement[] = [];
      // Fuera de un landmark, la region es el bloque hijo de body que lo contiene:
      // banners de cookies, chats y modales globales suelen colgar de body, y con
      // body entero (distinto en cada pagina) nunca casarian entre paginas.
      const topBlock = (element: ProbeElement): ProbeElement | null => {
        let current: ProbeElement | null = element;
        while (current && current.parentElement && current.parentElement !== doc.body) current = current.parentElement;
        return current && current.parentElement === doc.body ? current : null;
      };
      const regionOf = (element: ProbeElement): number => {
        const region = element.closest(LANDMARKS) ?? topBlock(element) ?? doc.body ?? doc.documentElement;
        let index = regionElements.indexOf(region);
        if (index === -1) {
          regionElements.push(region);
          index = regionElements.length - 1;
        }
        return index;
      };
      const outer = (element: ProbeElement) => (element as unknown as { outerHTML: string }).outerHTML;
      const targets = selectors.map((selector) => {
        let element: ProbeElement | null = null;
        try {
          element = doc.querySelector(selector);
        } catch {
          element = null;
        }
        return element
          ? { selector, found: true, html: outer(element), region: regionOf(element) }
          : { selector, found: false, html: '', region: -1 };
      });
      return {
        targets,
        regions: regionElements.map((region) => ({ selector: selectorOf(region), role: roleOf(region), html: outer(region) })),
      };
    },

    regionsHtml() {
      return safeAll(doc, LANDMARKS).map((region) => ({
        selector: selectorOf(region),
        role: roleOf(region),
        html: (region as unknown as { outerHTML: string }).outerHTML,
      }));
    },
  };

  win.__a11yEvidence = api;
};

/** Acceso a la API instalada, para usar dentro de otros `page.evaluate`. */
export type ProbeHost = { __a11yEvidence: ProbeApi };
