---
name: revision-manual
description: Capa 2 de la auditoría de accesibilidad - revisión asistida por IA de los criterios WCAG 2.2 A, AA y AAA que axe no resuelve, con la evidencia recogida por la herramienta y el MCP de Playwright para lo interactivo. Úsala cuando pidan revisar a mano una auditoría, una página o una web, cerrar las "revisiones manuales" de axe o preparar una web para su validación y firma.
---

# Revisión manual asistida (capa 2)

Tú propones; una persona valida y firma (capa 3). Todo lo que registres queda `proposed` hasta que
alguien lo revise. **No hay ni debe haber forma de que valides tus propios hallazgos.**

Herramientas: MCP `accessibility` (la API de la herramienta) y MCP `playwright` (solo para lo que
exige manejar la página). El backend tiene que estar levantado (`make dev` o `make up`); si el MCP
responde "¿Está arrancado el backend?", dilo y para.

## Entrada

Un `auditId`, una URL o un sitio. Si te dan URLs sin auditoría, lánzala con `create_audit` (la
evidencia va activada por defecto) y espera con `get_audit` a que esté `completed`.

Si la auditoría tiene `evidence: false`, avisa: sin evidencia casi todo acaba en `cantTell` o
exige el navegador, que es mucho más caro. Propón relanzarla con evidencia antes de seguir.

## Proceso por página

El catálogo tiene los 86 criterios de WCAG 2.2: 55 A/AA y 31 AAA. **Los AAA bloquean la firma igual
que los A/AA**, aunque no cuentan para la conformidad legal. Revisa primero los A/AA
(`levels: ["A", "AA"]`) y después los AAA (`levels: ["AAA"]`): muchos reaprovechan la evidencia de su
pareja A/AA (1.4.6 con 1.4.3, 2.4.9 con 2.4.4, 2.4.12 con 2.4.11, 2.5.5 con 2.5.8, 3.3.6 con 3.3.4,
3.3.9 con 3.3.8), así que juzga cada pareja con la misma evidencia en vez de pedirla dos veces.

1. **Lo pendiente.** `get_page_review` con `outcomes: ["untested", "cantTell"]` y el nivel que toque. Los `failed` por
   violación de axe y los `inapplicable` propuestos ya tienen resultado: no los repitas. Los
   hallazgos con `inherited: true` vienen de una línea base y ya están validados: no los toques.
   Si varias páginas comparten plantilla, revisa a fondo una, y sugiere a la persona que la valide
   y la enlace como línea base de las demás antes de seguir con ellas: ahorra repetir trabajo.
2. **Qué mirar.** `get_checks` con los `checkIds` pendientes, **una vez por sesión**: trae las
   instrucciones de cada criterio, la evidencia que necesita y si exige lector de pantalla.
3. **La evidencia justa.** `get_evidence` pidiendo solo los `kinds` de los criterios que vas a
   juzgar ahora. Cada tipo puede ocupar mucho; no pidas todos "por si acaso". Las capturas, con
   `get_evidence_image` y solo cuando la decisión dependa de verla (indicador de foco, alt de una
   imagen concreta, reflujo con elementos desbordados).
4. **Decide y registra** (ver abajo).
5. **Lo interactivo** al final, con Playwright (ver abajo), agrupando criterios en una sola visita.

### Cómo registrar

- **Propuesta de axe (`source.kind: "axe-needs-review"`) o de no aplicable (`"applicability"`)**:
  ciérrala con `update_finding` sobre ese hallazgo. No crees otro para el mismo criterio.
- **Criterio sin hallazgos**: `create_finding` con su `checkId`.
- **Criterios de sitio** (`multiple-ways`, `consistent-navigation`, `consistent-identification`,
  `consistent-help`): una vez por sitio con `create_site_finding`, comparando la evidencia
  `landmarks`/`controls` de varias páginas del sitio (`get_site` para verlas).
- **Un hallazgo por región, no uno por criterio**, si el criterio toca elementos compartidos
  (cabecera, pie, banner de cookies, chat) y contenido propio de la página: p. ej. en 1.1.1, uno para
  los logos del pie y otro para las imágenes del contenido. Las demás páginas solo heredan de la línea
  base los hallazgos cuyos elementos existen también en ellas; un `passed` que mezcla regiones no se
  hereda nunca, y un `failed` se hereda recortado a lo común.
- Siempre: `description` en castellano diciendo **qué has comprobado y qué has visto**, no solo el
  veredicto; `evidenceRefs` con lo que la sostiene (`focus-sequence#4`, `reflow-320.jpg`);
  `targets` con unos pocos elementos de ejemplo y `targetCount` si hay más; `recommendation` en los
  fallos; y `model` con tu id de modelo.

### Resultados: sé honesto

- `passed` solo si la evidencia lo demuestra. "No he visto nada raro" no es `passed`.
- `failed` con el elemento concreto y el porqué.
- `inapplicable` si no hay contenido al que aplique (sin vídeo, sin formularios...).
- `cantTell` cuando la evidencia no basta. Di exactamente qué falta, para que la capa 3 sepa qué
  probar. Es mejor un `cantTell` bien explicado que un `passed` dudoso.
- Los criterios con `requiresAssistiveTech: true` (1.3.1, 1.3.2, 4.1.2, 4.1.3) los puedes
  proponer, pero indica en la descripción que necesitan confirmación con lector de pantalla.

## Evidencia: qué sale de cada tipo

| Criterio | Evidencia | Qué mirar |
|---|---|---|
| 1.1.1, 1.4.5 | `images` + capturas `image-N.jpg` | `alt: null` es falta de alt; `''` es decorativa. Mira la imagen antes de juzgar un alt. |
| 2.4.3, 2.1.2, 3.2.1 | `focus-sequence` | Orden de `stops` frente al visual; `stoppedBecause: "stuck"` es posible trampa. |
| 2.4.7, 1.4.11 | `focus-sequence` + `focus-N.jpg` | `indicator: "unchanged"` casi seguro falla; `"changed"` hay que verlo (puede ser invisible). |
| 2.4.11 | `focus-sequence` | `obscured: "full"` falla; `"partial"` mira la captura. |
| 1.4.10 | `reflow-320` | `horizontalScroll` y `overflowing`. Tablas, mapas y diagramas pueden desplazarse. |
| 1.4.4 | `zoom-200` | Igual que el reflujo, a la mitad del viewport. |
| 1.4.12 | `text-spacing` | `clipped`: texto cortado con los espaciados aplicados. |
| 1.3.4 | `orientation` | Capturas en vertical y en horizontal. |
| 1.3.5, 3.3.2, 2.4.6 | `forms` | `label: null`, `autocomplete` ausente o incorrecto en datos personales. |
| 2.5.3, 2.5.8, 4.1.2 | `controls` | `name` frente a `visibleText`; `box` menor de 24×24 salvo `inline`. |
| 1.3.1, 2.4.1 | `headings`, `landmarks` | `ariaSnapshot` es el árbol de Chromium: fíate más de él que de `name`. |
| 2.4.2, 3.1.1, 3.1.2, 1.3.3 | `text-content` | Título, idioma de la página y de las partes, instrucciones sensoriales. |
| 1.4.6 (AAA) | `screenshot` | 7:1 (4,5:1 en texto grande). axe solo lo mide si la auditoría incluye el tag `wcag2aaa`. |
| 2.4.12, 2.4.13 (AAA) | `focus-sequence` + `focus-N.jpg` | 2.4.12: cualquier `obscured` distinto de `"none"` falla. 2.4.13: grosor y contraste del indicador en la captura. |
| 2.5.5 (AAA) | `controls` | `box` menor de 44×44 salvo `inline`. |
| 2.4.9 (AAA) | `controls` | El texto del enlace solo, sin contexto: "Leer más" repetido falla. |
| 2.4.10 (AAA) | `headings` | El contenido largo está dividido en secciones con encabezado. |
| 1.4.8, 3.1.3–3.1.6 (AAA) | `text-content` | Ancho de línea, justificado, interlineado; jerga, siglas sin expandir, nivel de lectura de condiciones y políticas. |
| 2.4.8 (AAA) | `landmarks`, `controls` | Migas de pan o `aria-current` en la navegación. |

`name` en los elementos es una aproximación calculada en el DOM. Si dudas del nombre accesible,
manda `landmarks.ariaSnapshot` o un `browser_snapshot`.

## Lo interactivo: Playwright

Para criterios con evidencia `interaction` (1.4.13, 2.1.1, 2.1.4, 2.2.1, 2.2.2, 2.5.1, 2.5.2, 2.5.4,
2.5.7, 3.2.2, 3.3.1, 3.3.3, 3.3.4, 3.3.7, 3.3.8, 4.1.3, multimedia; y en AAA 2.1.3, 2.2.3–2.2.6,
2.3.3, 2.5.6, 3.2.5, 3.3.6, 3.3.9) y para confirmar lo que la evidencia deja en duda. Para 2.3.3,
`browser_emulate_media` con `reducedMotion: "reduce"` y comprueba que las animaciones se apagan.

- `browser_resize` al `viewport` de la página **antes** de `browser_navigate` a su `url`: la
  evidencia es de esa pantalla.
- `browser_snapshot` es caro (árbol entero). Úsalo para orientarte una vez; luego `browser_press_key`
  (Tab, Escape, Enter), `browser_hover`, `browser_fill_form`, `browser_click` y otra snapshot solo
  si la página cambió. `browser_take_screenshot` cuando haya que ver algo.
- Formularios: envíalos vacíos y con datos erróneos para ver mensajes de error (3.3.1, 3.3.3) y si
  se anuncian (`role="alert"`, `aria-live`: 4.1.3). **Nunca completes un pago, una reserva ni nada
  que cree datos reales**: en 3.3.4 basta con llegar al paso de revisión/confirmación.
- Si una prueba requiere credenciales o no es segura en producción, deja `cantTell` explicándolo.

## Al terminar

Si la página es de un sitio, `get_sign_off_preview` con la muestra que te hayan indicado (o las
páginas que has revisado) dice qué queda para que una persona pueda firmar. Inclúyelo en el resumen.
Tú no firmas: no hay herramienta para eso.

Resume por página, separando A/AA de AAA: cuántos criterios has cerrado por resultado, los `failed` con su elemento, los
`cantTell` con lo que falta, y cuáles necesitan lector de pantalla en la capa 3. No digas que la
web "cumple": eso solo lo puede decir la firma.
