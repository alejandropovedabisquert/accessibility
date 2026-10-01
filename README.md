# accessibility

Herramienta interna de escaneo y auditoría automática de accesibilidad web. Ejecuta análisis WCAG con
Playwright + axe-core sobre una o varias URLs, guarda cada auditoría y permite volver a consultarla,
compararla con escaneos anteriores y descargar el informe.

- **Frontend**: http://localhost:3001
- **API**: http://localhost:3000

## Qué hace

- Lanza auditorías sobre varias URLs a la vez, eligiendo navegador, dispositivo o resolución, y qué
  normas WCAG comprobar (2.0 / 2.1 / 2.2 A y AA, 2.0 AAA, buenas prácticas).
- **Escanea cada URL en varias resoluciones** a la vez (por ejemplo escritorio 1366×768 y móvil
  390×844). Cada resolución es una serie propia en el histórico y en la comparación.
- **Separa el cumplimiento legal de las mejoras**: las reglas WCAG A/AA (lo que exigen la Ley 11/2023
  y EN 301 549) tienen su propia métrica y contadores, aparte de las AAA y buenas prácticas.
- **Analiza la página entera o solo una sección**: cabecera, navegación, contenido principal, pie,
  formularios o cualquier selector CSS. Se puede pedir una sección distinta por URL, y excluir del
  análisis contenido de terceros que no controlas (un banner de cookies de OneTrust, por ejemplo;
  ver [Excluir contenido](#excluir-contenido-del-análisis)).
- Ejecuta el escaneo **en segundo plano**: la petición responde al instante con un identificador y la
  interfaz muestra el progreso. Puedes cerrar la pestaña y volver más tarde.
- Guarda el histórico completo en SQLite y permite filtrar, buscar y paginar el listado.
- Muestra por página los incumplimientos con su severidad, los elementos del DOM afectados, el
  selector y el enlace a la documentación de Deque.
- **Compara cada escaneo con el anterior de la misma URL, sección y resolución**: qué se ha resuelto,
  qué es nuevo y qué ha cambiado de volumen.
- Genera el informe **PDF bajo demanda** y lo cachea; también se puede descargar el JSON de axe.

## Arquitectura

```
accessibility/
├── backend/     API Express + TypeScript, Playwright, axe-core, SQLite
├── frontend/    Next.js (App Router) + Tailwind
├── mcp/         Servidor MCP para la revisión asistida por IA (capa 2)
└── docker-compose.yml
```

Los metadatos y contadores viven en SQLite (`backend/data/audits.db`); el JSON crudo de axe y los PDFs
se guardan en disco (`backend/scan-results/<auditId>/`), porque el array `passes` de una sola página
puede pesar varios MB y no tiene sentido meterlo en la base de datos.

## Arranque

### Con Docker (recomendado)

```bash
make up          # construye y levanta backend + frontend
make logs        # seguir los logs
make down        # parar
```

### En local, sin Docker

```bash
make install
make dev         # backend en :3000 y frontend en :3001
```

La primera vez, el backend necesita los navegadores de Playwright:

```bash
cd backend && pnpm exec playwright install chromium
```

### Modo desarrollo con Docker y recarga en caliente

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --watch
```

## Uso

1. Entra en http://localhost:3001 y pulsa **Nueva auditoría**.
2. Pega las URLs (una por línea; si omites el protocolo se asume `https://`).
3. Elige si quieres la página entera o solo una sección (cabecera, pie, un selector CSS…).
4. Elige normas y entorno de escaneo, y lanza.
5. El detalle se va actualizando solo mientras el escaneo corre.

## API

Base: `http://localhost:3000/api`

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/meta` | Navegadores, dispositivos, normas, atajos de sección y límites disponibles |
| `GET` | `/stats` | Estado de las colas y del pool de navegadores |
| `POST` | `/audits` | Crea una auditoría. Responde `202` con el id, sin esperar al escaneo |
| `GET` | `/audits` | Listado paginado (`page`, `pageSize`, `status`, `search`) |
| `GET` | `/audits/:id` | Auditoría con el estado de cada página |
| `POST` | `/audits/:id/rerun` | Relanza con la misma configuración |
| `GET` | `/audits/:id/export?format=compact` | Informe agregado de toda la auditoría para IA, con deduplicación entre URLs (`detail=full\|legal`) |
| `DELETE` | `/audits/:id` | Borra la auditoría y sus ficheros |
| `GET` | `/audits/:id/pages/:pageId` | Resumen e incumplimientos de una página |
| `GET` | `/audits/:id/pages/:pageId/results` | JSON completo de axe (`?download=1` para descargar) |
| `GET` | `/audits/:id/pages/:pageId/results?format=compact` | JSON compacto para análisis con IA (`maxNodes`, `download=1`) |
| `GET` | `/audits/:id/pages/:pageId/diff` | Comparación con el escaneo anterior de esa URL, sección y pantalla |
| `GET` | `/audits/:id/pages/:pageId/report.pdf` | Informe PDF (se genera la primera vez y se cachea) |
| `GET` | `/history?url=&include=&viewport=&device=` | Serie temporal de una URL, sección y pantalla |
| `GET` | `/history/urls` | Series auditadas (URL + sección + pantalla) con su número de ejecuciones |
| `GET` | `/health` | Estado del servicio |

### Ejemplo

Cada entrada de `urls` puede ser la URL sola (página completa) o un objeto con la sección a
analizar. La misma URL puede repetirse si cada vez se mira una parte distinta.

```bash
# Lanzar
curl -X POST http://localhost:3000/api/audits \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      "https://www.avantio.com",
      { "url": "https://www.avantio.com", "include": "header, [role=\"banner\"]" },
      { "url": "https://www.avantio.com/es/precios", "include": "footer", "exclude": "#onetrust-banner" }
    ],
    "label": "Home y precios",
    "browser": "chromium",
    "viewports": [{ "width": 1366, "height": 768 }, { "width": 390, "height": 844 }],
    "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
  }'
# -> 202 {"id":"a1b2...","status":"queued","totalPages":6, ...}   (3 objetivos × 2 resoluciones)

# Consultar progreso
curl http://localhost:3000/api/audits/a1b2...
```

`include` y `exclude` son selectores CSS (máximo 200 caracteres). `GET /api/meta` devuelve en
`sections` los atajos con su selector ya resuelto (`header`, `nav`, `main`, `footer`, `aside`,
`form`). Si el selector de `include` no casa con ningún elemento, esa página queda como `failed` con
el motivo, y el resto de la auditoría sigue.

Errores de validación devuelven `400` con el detalle campo a campo:

```json
{
  "error": "Datos de entrada no válidos",
  "details": [{ "field": "urls.0", "message": "Debe ser una URL http o https válida" }]
}
```

## Exportación compacta para IA

El JSON completo de axe pesa cerca de 1 MB por página real, y el 91 % es el array `passes`, que no
sirve para decidir qué arreglar. `GET /api/audits/:id/pages/:pageId/results?format=compact` (botón
**Descargar JSON para IA** en el detalle de la página) devuelve solo lo accionable, serializado sin
espacios:

```jsonc
{
  "schemaVersion": "1.0",
  "tool": { "axe": "4.13.0", "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  "page": { "url": "…", "include": null, "exclude": null,
            "viewport": { "width": 1366, "height": 768 }, "scannedAt": "…" },
  "warnings": [],                  // lo excluido y las reglas omitidas por la sección
  "summary": { "legal": { "score": 88.9, "violations": 3, … },
               "improvements": { "score": null, … },   // null = no evaluado
               "passes": 24, "inapplicable": 57 },     // solo recuentos
  "findings": [
    {
      "rule": "label",
      "status": "fail",              // "fail" (violations) o "needs-review" (incomplete)
      "level": "A",                  // "A" | "AA" | "AAA" | "best-practice"
      "wcag": ["4.1.2"],             // de los tags tipo wcag412
      "en301549": ["9.4.1.2"],       // de los tags tipo EN-9.4.1.2
      "impact": "critical",
      "help": "…", "helpUrl": "…",
      "count": 19,                   // nodos afectados en total
      "nodes": [                     // como mucho maxNodes (5 por defecto, máximo 50)
        { "selector": "#email",      // último elemento de target
          "html": "<input id=…",     // recortado a 150 caracteres
          "message": "…" }           // mensajes de los checks que fallan, recortados a 200
      ]
    }
  ]
}
```

- `findings` va ordenado así: primero los `fail`, luego por nivel (A, AA, AAA, best-practice) y
  luego por impacto.
- Parámetros: `maxNodes` (1–50, por defecto 5) y `download=1` para descargarlo como fichero.
- Sin `format`, el endpoint devuelve el JSON crudo de siempre.
- Tamaño en las fixtures de los tests: 598 KB → 1,7 KB (0,3 %) en una página con 300 elementos
  correctos y dos fallos, y 47 KB → 4,5 KB en una página mínima en la que casi todo falla.

### Informe agregado de toda la auditoría

Los componentes comunes (cabecera, menú, pie, banner de cookies) generan los mismos errores en todas
las URLs. `GET /api/audits/:id/export?format=compact` junta todas las páginas en un solo informe,
agrupando los fallos repetidos. En el detalle de la auditoría hay dos botones: **Descargar JSON para
IA** (`detail=legal`) y **JSON para IA completo** (`detail=full`).

Parámetros: `format=compact` (obligatorio), `detail=full|legal` (por defecto `full`), `maxNodes`
(1–50, por defecto 5) y `download=1`.

```jsonc
{
  "schemaVersion": "1.1",
  "detail": "legal",
  "tool": { "axe": "4.13.0", "tags": ["wcag2a", "wcag2aa", "best-practice"] },
  "audit": { "id": "…", "label": "…", "createdAt": "…", "status": "completed" },
  "pages": [                                    // los findings apuntan aquí por índice
    { "url": "…/", "include": null, "exclude": null, "viewport": { "width": 1366, "height": 768 }, "scannedAt": "…" },
    { "url": "…/", "include": null, "exclude": null, "viewport": { "width": 390, "height": 844 }, "scannedAt": "…" }
  ],
  "failedPages": [], "excluded": [], "warnings": [],
  "summary": { … },                             // ver "Qué cuenta cada contador"
  "findings": [
    {
      "rule": "label", "status": "fail", "level": "A", "wcag": ["4.1.2"], "en301549": ["9.4.1.2"],
      "impact": "critical", "help": "…", "helpUrl": "…",
      "fingerprint": "3f2a9c01b7e4",            // id corto y estable del grupo
      "count": 36,                              // nodos del grupo, en todas las páginas
      "nodes": [{ "selector": "…", "html": "…", "message": "…" }],
      "pages": [[0, 2], [1, 2]]                 // [índice en pages, nodos en esa página]
    }
  ],
  "improvements": [                             // solo con detail=legal
    {
      "rule": "region", "status": "fail", "level": "best-practice", "impact": "moderate",
      "help": "…", "helpUrl": "…",
      "groups": 14,                             // findings que tendría con detail=full
      "count": 212,                             // nodos, sumando esos grupos
      "pages": [0, 1, 5],                       // índices únicos en pages
      "nodes": [ … ]                            // como mucho 3 ejemplos, uno por grupo
    }
  ]
}
```

- **Cada finding es una regla + estado + huella del elemento.** Un mismo fallo del pie sale una sola
  vez con sus 20 URLs, en vez de 20 veces. Una regla que falla en tres elementos distintos da tres
  findings.
- **`findings[].pages`** son pares `[índice, nodos]` que apuntan al array `pages` de la raíz. De ahí
  salen la URL, la sección y la resolución de cada página afectada. Las resoluciones en las que
  aparece un grupo son los `viewport` de esas páginas.
- **`nodes`** trae ejemplos distintos del grupo (como mucho `maxNodes`), con el HTML real: el selector
  y el contenido cambian entre páginas aunque el componente sea el mismo.
- **Orden:** el mismo que en la exportación por página (estado, nivel, impacto). A igualdad, va
  primero lo que afecta a más páginas: suele ser un componente común, y arreglarlo una vez lo arregla
  en todas. `improvements` sigue el mismo orden.
- **`detail=legal`**: `findings` solo trae los grupos de nivel A y AA, exactamente los mismos que con
  `full`. Las reglas AAA y de buenas prácticas van resumidas en `improvements`, una entrada por regla
  y estado. `summary` es el mismo en los dos modos: describe siempre la auditoría entera.
- **`failedPages`** son las páginas que no se pudieron escanear, con el motivo; los findings no las
  cubren. **`excluded`** indica qué selectores se excluyeron y en cuántas páginas, y **`warnings`**
  reúne los avisos de todas las páginas, sin repetir.

**Cambios de la 1.0 a la 1.1** (solo en la agregada; la exportación por página sigue en 1.0):

- `findings[].pages` pasa de objetos `{url, include, viewport, count}` a pares `[índice, nodos]`.
- Desaparece `findings[].viewports`.
- `summary.legal` y `summary.improvements` añaden `ruleOccurrences`; `violations` se mantiene como
  alias con el mismo valor.
- Aparecen `detail` y el bloque `improvements`.
- La huella pasa a ser estructural (ver abajo), así que hay menos grupos.

#### Qué cuenta cada contador

Todo se cuenta **por página escaneada**: una regla que falla en las 18 páginas de una auditoría
suma 18. Una página es una URL + sección + resolución.

| Campo | Qué cuenta |
| --- | --- |
| `summary.legal` / `summary.improvements` | Lo mismo que el desglose de la auditoría, para las reglas A/AA y para las AAA y buenas prácticas, respectivamente |
| `…score` | Media, entre páginas, del porcentaje de reglas superadas del grupo. `null` si no se evaluó ninguna regla del grupo |
| `…passes` | Reglas superadas, sumadas página a página |
| `…ruleOccurrences` | Reglas incumplidas, sumadas página a página: una regla que falla en 18 páginas cuenta 18. No son reglas distintas: para eso, cuenta los `rule` de `findings` |
| `…violations` | Alias de `ruleOccurrences`, con el mismo valor. Se mantiene por compatibilidad con la 1.0 |
| `…violationNodes` | Elementos que incumplen alguna regla del grupo, sumados página a página, antes de agrupar. El mismo pie en 18 páginas cuenta 18 veces |
| `…critical`, `serious`, `moderate`, `minor` | `ruleOccurrences` desglosado por impacto |
| `…incomplete` | Reglas que axe no pudo decidir (revisión manual), sumadas página a página |
| `summary.passes`, `summary.inapplicable` | Reglas superadas y no aplicables de todos los niveles, sumadas página a página |
| `summary.nodes` | Nodos con algún hallazgo, incumplimientos y revisiones manuales de todos los niveles, antes de agrupar |
| `summary.groups` | Grupos después de agrupar: los `findings` que habría con `detail=full`, se pida el detalle que se pida |
| `findings[].count` | Nodos de ese grupo en todas las páginas; es la suma de los `nodos` de sus `pages` |
| `improvements[].groups` | Grupos (elementos distintos) de esa regla y estado |
| `improvements[].count` | Nodos de esa regla y estado en todas las páginas |

#### Huella del elemento

La huella es la **estructura** del HTML del nodo: etiquetas, clases estables y atributos, sin lo que
cambia de una instancia a otra del mismo componente. Así, doce tarjetas de la misma plantilla con
distinto enlace, foto y título quedan en un solo grupo. En concreto:

- Se quita el texto interno del elemento y de sus hijos.
- `href`, `src`, `srcset`, `alt`, `title` y `aria-label` se conservan sin valor. Que el atributo
  exista sigue contando, porque `<img alt>` no es lo mismo que `<img>`.
- Se quitan los identificadores que genera el CMS (tabla de abajo).
- Se ordenan las clases y los atributos y se normalizan los espacios.

La otra cara es que dos elementos distintos con la misma estructura y las mismas clases también se
juntan. Los ejemplos de `nodes` traen el HTML real para distinguirlos.

Los patrones están en `backend/src/services/export/fingerprint.ts`, cada uno con su motivo:

| Tipo | Patrón | Ejemplo |
| --- | --- | --- |
| sin valor | `href`, `src`, `srcset`, `alt`, `title`, `aria-label` | `href="/villa-rosa"` → `href` |
| clase | `e-xxxxxxx-xxxxxxx` | `e-7abb8a1-8bff8d3` (Elementor) |
| clase | `elementor-element-xxxxxxx` | `elementor-element-4332f88` |
| clase | `elementor-<número>` | `elementor-1234` (id del post o plantilla) |
| atributo | `data-id`, `data-interaction-id`, `data-elementor-id` | se quitan enteros |
| valor | `e-form-input-xxxxxxx`, `e-form-field-xxxxxxx` | `id`, `for` y `aria-*` pasan a `e-form-input-*` |

Si en otra web un mismo error sale partido en varios grupos, compara el `html` de esos grupos y añade
el patrón que falte.

## Varias resoluciones por URL

`viewports` es una lista de `{ width, height }` (máximo 4); cada URL, con su sección, se escanea en
todas. `GET /api/meta` devuelve en `viewports` los atajos del formulario (escritorio 1366×768, tablet
768×1024, móvil 390×844).

- **Compatibilidad**: `viewport` (una sola resolución) sigue funcionando y equivale a
  `viewports: [viewport]`. No se pueden mandar los dos, ni combinar ninguno de ellos con `device`. El
  dispositivo de Playwright sigue siendo único por auditoría: además del tamaño cambia el user-agent y
  activa el modo táctil.
- **Cada página guarda su pantalla** en `viewport` y `device`. `config.viewports` es la lista
  pedida, y `config.viewport` es el primero de ella (o `null` si no se pidió ninguna, como antes).
- **Límite**: `MAX_URLS_PER_AUDIT` cuenta escaneos totales, no URLs. 13 URLs en 2 resoluciones son
  26 escaneos, y eso ya supera el límite de 25.
- **El histórico y la comparación van por URL + sección + pantalla**, así que el móvil nunca se
  compara con el escritorio. En `/history`, `viewport=390x844` (y `device`, si se escaneó con uno)
  eligen la serie. Si no se pasan, se devuelven todas las pantallas mezcladas, como antes.
- **Auditorías antiguas**: al arrancar, cada página sin pantalla guardada recibe la de su auditoría,
  que entonces era única. Si no tenía ni resolución ni dispositivo, recibe 1366×768, que es con la que
  se escaneaba siempre por defecto. Así sus series continúan con los escaneos nuevos de esa misma
  resolución.
- El viewport aparece en el detalle, en el PDF y en `page.viewport` de la exportación compacta.

## Configuración

Copia `backend/.env.example` a `backend/.env`:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | `3000` | Puerto de la API |
| `CORS_ORIGIN` | `http://localhost:3001` | Orígenes permitidos, separados por coma (`*` para todos) |
| `DATA_DIR` | `./data` | Dónde vive el fichero SQLite |
| `RESULTS_DIR` | `./scan-results` | Dónde se guardan JSON y PDFs |
| `SCAN_CONCURRENCY` | `3` | Páginas escaneadas a la vez |
| `BROWSER_IDLE_TIMEOUT_MS` | `60000` | Cuánto sigue vivo un navegador sin trabajo |
| `MAX_URLS_PER_AUDIT` | `25` | Límite de escaneos por auditoría: URLs × secciones × resoluciones |
| `DEFAULT_TIMEOUT_MS` | `30000` | Tiempo máximo de carga por página |

En el frontend, `API_URL` (por defecto `http://localhost:3000`) es la URL interna de la API. El
navegador nunca la llama directamente: todo pasa por el proxy `/api/backend/*` de Next, así que el
front siempre es mismo-origen.

## Analizar solo una sección

En la interfaz, el desplegable **Sección a analizar** aplica a todas las URLs. Para pedir una
sección concreta en una línea suelta, se añade `| selector-css` al final:

```
https://www.avantio.com
https://www.avantio.com/es/precios | footer
```

Dos cosas que conviene saber:

- **axe omite las reglas de ámbito de página** (`html-has-lang`, `document-title`, `landmark-one-main`,
  `region`…) cuando el análisis se acota a una sección. No es que la página las cumpla: es que no se
  han comprobado. Para esas reglas hace falta un escaneo de página completa.
- **Excluir no es lo mismo que acotar**: ver [Excluir contenido](#excluir-contenido-del-análisis).
- **El histórico y la comparación van por URL + sección** (y resolución). La cabecera de la home solo
  se compara con escaneos anteriores de la cabecera de la home, nunca con los de la página entera. El selector de
  exclusión **no** parte la serie: se considera filtrado de ruido, no una sección distinta.

## Normas que se pueden comprobar

`GET /api/meta` devuelve en `tags` las opciones, que son tags de axe-core. Por defecto se usan
`wcag2a`, `wcag2aa`, `wcag21a` y `wcag21aa`.

| Tag | Qué añade |
| --- | --- |
| `wcag2a`, `wcag2aa` | WCAG 2.0 A y AA |
| `wcag21a`, `wcag21aa` | Criterios nuevos de WCAG 2.1 A y AA (EN 301 549 exige WCAG 2.1 AA) |
| `wcag22aa` | Criterios nuevos de WCAG 2.2 AA (objetivo interno) |
| `wcag2aaa` | WCAG AAA. En axe 4.13 son solo 3 reglas: `color-contrast-enhanced`, `identical-links-same-purpose` y `meta-refresh-no-exceptions` |
| `best-practice` | Buenas prácticas de Deque que no son criterios WCAG (landmarks, orden de encabezados…) |

`wcag2aaa` y `best-practice` están disponibles en el formulario pero no van marcados por defecto; el
botón "Marcar todas" sí los activa. Sus reglas nunca cuentan para el cumplimiento legal (ver abajo).

## Excluir contenido del análisis

`exclude` (campo **Excluir del análisis** en el formulario) quita del escaneo lo que casa con el
selector. **Lo excluido no se audita**: no aparece en los resultados ni en las métricas.

Solo tiene sentido para contenido de **terceros** que no controlas, como un banner de cookies de
OneTrust o Cookiebot o un widget externo. **Si el banner de cookies es propio** (hecho a medida, o un
plugin que controlas y puedes corregir), forma parte del sitio y cuenta para el cumplimiento legal
igual que el resto: no lo excluyas, o revísalo por separado.

Por eso:

- El formulario muestra un aviso en cuanto se escribe un selector de exclusión, y el detalle de la
  página y el de la auditoría indican qué se excluyó.
- El PDF lo recoge en la cabecera, con la advertencia de revisarlo aparte.
- La exportación compacta por página lleva `page.exclude` y un aviso en `warnings`. La agregada lleva
  `excluded: [{ selector, pages }]` y los mismos avisos. Un modelo que lea el JSON no puede tomar lo
  excluido por "sin fallos".

`warnings` también avisa cuando se ha acotado a una sección (`include`), porque en ese caso axe no
comprueba las reglas de ámbito de página.

## Sobre las métricas "reglas superadas"

No es un score ponderado inventado: es `reglas superadas / (superadas + incumplidas) × 100`. Las
reglas `inapplicable` no cuentan (no había nada que evaluar) y las `incomplete` tampoco (axe no pudo
decidir y necesitan revisión manual). Es un dato verificable contra el JSON crudo.

Se calcula tres veces con la misma fórmula:

- **Cumplimiento legal** (`compliance.legal`): solo reglas de nivel A y AA. Es la que importa para la
  Ley 11/2023 / EN 301 549 (WCAG 2.1 AA; el objetivo interno es 2.2 AA).
- **Mejoras** (`compliance.improvements`): reglas AAA y buenas prácticas.
- **Global** (`score`): todas mezcladas. Se mantiene por compatibilidad, pero la interfaz y el PDF ya
  enseñan las dos anteriores por separado.

El nivel de cada regla sale de sus tags de axe (`services/audit/levels.ts`): si tiene `wcag2aaa` es
AAA; si no, si tiene un tag de nivel AA (`wcag2aa`, `wcag21aa`, `wcag22aa`) es AA; si tiene uno de
nivel A, es A; y si no tiene ninguno, buena práctica. Cada incumplimiento de
`GET /audits/:id/pages/:pageId` lleva su `level`.

Cada grupo trae `score`, `passes`, `violations`, `violationNodes`, `critical`, `serious`,
`moderate`, `minor` e `incomplete`. En la auditoría, `score` es la media de sus páginas y el resto
son sumas. Si en un grupo no se evaluó ninguna regla (con las normas por defecto no se ejecuta
ninguna mejora), su `score` es `null` y la interfaz lo muestra como "No evaluado", no como 100 %.

Las auditorías anteriores a este desglose se recalculan solas al arrancar el backend, a partir del
JSON crudo guardado en disco. Si ese JSON ya no existe, `compliance` queda a `null`.

## Revisión manual: tres capas

El escaneo automático es la primera de tres capas. Las otras dos cubren lo que axe no puede decidir:

| Capa | Quién | Qué hace |
|---|---|---|
| 1. Detección automática | Esta herramienta (axe-core) | Escanea y guarda el histórico |
| 2. Revisión asistida | Claude, vía el MCP de la herramienta y el de Playwright | Revisa los criterios pendientes con la evidencia recogida y propone resultados |
| 3. Validación y firma | Una persona formada (idealmente IAAP) | Prueba con lectores de pantalla, valida o corrige cada propuesta y firma la web |

El vocabulario de resultados es el de [EARL](https://www.w3.org/TR/EARL10-Schema/) (`passed`,
`failed`, `cantTell`, `inapplicable`, `untested`), para poder exportarlo tal cual.

### Catálogo

`GET /api/checks`: los 55 criterios A/AA de WCAG 2.2, con qué comprobar en cada uno, qué evidencia
hace falta, si exige lector de pantalla y qué reglas de axe lo tocan (calculadas con la versión de
axe instalada). Axe toca 29 de los 55 y no cierra ninguno por sí solo: una violación da el criterio
por fallado, pero que pase sus reglas no basta. Los 6 criterios nuevos de 2.2 no están aún en EN 301
549 v3.2.1.

### Evidencia

Con `"evidence": true` al crear la auditoría, cada página guarda además (en
`scan-results/<auditId>/evidence/<pageId>/`): secuencia de foco con indicador y ocultación, reflujo
a 320 px, zoom al 200 %, espaciado de texto, orientación, imágenes con su alt y su captura,
formularios, controles, encabezados, regiones (árbol de accesibilidad de Chromium) y texto. Añade
unos segundos por página.

```
GET /api/audits/:id/pages/:pageId/evidence?kinds=focus-sequence,images
GET /api/audits/:id/pages/:pageId/evidence/files/focus-3.jpg
```

### Revisión y hallazgos

```
GET   /api/audits/:id/pages/:pageId/review     Estado de cada criterio de página y sus hallazgos
POST  /api/audits/:id/pages/:pageId/findings   Hallazgo de un criterio de página (capa 2)
POST  /api/sites/:id/findings                  Hallazgo de un criterio de sitio (2.4.5, 3.2.3, 3.2.4, 3.2.6)
PATCH /api/findings/:id                        Cambiar un hallazgo aún sin revisar
PATCH /api/findings/:id/review                 Validar, rechazar o corregir (capa 3)
POST  /api/audits/:id/pages/:pageId/false-positives   Declarar falso positivo una violación de axe (capa 3)
POST  /api/audits/:id/pages/:pageId/findings/validate-inapplicable   Validar en bloque los «No aplica» automáticos (capa 3)
GET/POST/DELETE /api/sites[/:id]               Webs: una página es del sitio cuyo host coincide
```

Al abrir la revisión de una página se crean solas dos clases de propuestas: un `cantTell` por cada
"requiere revisión manual" de axe, y un `inapplicable` por cada criterio cuyo contenido no aparece
en la página (sin vídeo, sin formularios...). Todo hallazgo nace `proposed`; solo la capa 3 lo pasa a
`validated`, `rejected` o `amended`, y a partir de ahí no se puede editar.

Una violación de axe da el criterio por fallado, salvo que la capa 3 la declare **falso positivo**
con una justificación. El falso positivo nace validado a nombre de quien lo declara y se deshace
rechazándolo. No cuenta como "cumple": solo deja de contar esa violación.

En la interfaz, cada página completada tiene su **Revisión manual**: evidencia (capturas, recorrido con
el tabulador, imágenes), los 51 criterios de página agrupados por principio con filtros por estado, y
en cada uno validar, rechazar, corregir, añadir un resultado propio o marcar un falso positivo.
**Sitios** agrupa las páginas de una web por host y recoge los 4 criterios de sitio. Quien revisa se
recuerda en una cookie; no hay autenticación.

### Líneas base: revisar una plantilla una vez

Si varias páginas comparten plantilla, se revisa y valida una y se enlaza como **línea base** de las
demás (desde su revisión, o `PUT /api/audits/:id/pages/:pageId/baseline` con `baselinePageId` y
`by`). Se heredan, ya validados a nombre de quien enlaza, los hallazgos cuyos elementos **y la región
que los contiene** (cabecera, navegación, pie…) son estructuralmente iguales en las dos páginas. La
comparación ignora textos, enlaces e ids generados (la misma huella de `fingerprint.ts`) y se hace
sobre el DOM guardado al escanear (`dom.html` de la evidencia), no sobre la web de ahora.

- Los hallazgos sin elementos concretos (p. ej. "el orden del foco es correcto") solo se heredan si
  la página entera es igual.
- Una "requiere revisión manual" de axe se resuelve con la de la línea base si todos sus elementos
  coinciden.
- Lo que no se hereda queda en el informe con su motivo, para revisarlo en la página.
- Lo heredado sigue al original: si se corrige o se rechaza allí, cambia en todas las copias. Quitar la
  línea base deja la página como estaba.
- Solo se comparan páginas de la misma pantalla, y ambas necesitan evidencia con DOM guardado.

### Firma de una web

Desde la página del sitio se elige la **muestra** de páginas (WCAG-EM) y se ve qué se firmaría y qué lo
impide: criterios sin revisar o sin decidir y hallazgos sin validar en esas páginas. Sin bloqueos se
puede firmar.

```
GET  /api/sites/:id/sign-off-preview?pageIds=a,b   Lo que se firmaría y lo que falta
POST /api/sites/:id/sign-offs                      Firmar (capa 3)
GET  /api/sign-offs/:id                            La firma, y si lo firmado sigue coincidiendo
GET  /api/sign-offs/:id/earl?download=1            EARL 1.0 en JSON-LD
GET  /api/sign-offs/:id/report.pdf                 Informe firmado
```

- **El estado de conformidad se calcula**, con los tres valores de la declaración del RD 1112/2018, y
  solo sobre los requisitos legales (WCAG 2.1 A/AA, por EN 301 549 v3.2.1). Los criterios nuevos de
  WCAG 2.2 se informan aparte. El RD no cuantifica "parcialmente": aquí es **no conforme** si falla la
  mitad o más de los requisitos que aplican, **parcialmente** si falla alguno y **plenamente** si
  ninguno.
- En la muestra, un criterio toma el peor resultado de sus páginas, y una página sin revisar pesa más
  que otra que cumple: el criterio no está evaluado en la web.
- **Lo firmado se congela** en `scan-results/sign-offs/<id>.json` con su huella SHA-256. El PDF y el
  EARL salen siempre de esa copia. Si después alguien corrige un hallazgo de la muestra, la firma sigue
  igual pero avisa de que ya no coincide con los datos actuales.
- Un sitio con firmas no se puede borrar.

### MCP para Claude Code

`.mcp.json` registra dos servidores: `accessibility` (esta API) y `playwright`. Con el backend
levantado y `make install` (que compila `mcp/`), una sesión de Claude Code en este repo puede hacer la
capa 2 con la skill `revision-manual`. El servidor `accessibility` **no expone ninguna herramienta
para validar**: eso es de la capa 3, a propósito.

Para usarlo desde otro proyecto, apunta a la API con `A11Y_API_URL`:

```bash
claude mcp add accessibility -e A11Y_API_URL=http://localhost:3000/api -- node /ruta/a/accessibility/mcp/dist/index.js
```

## Tests

```bash
make test        # validación de la API, funciones puras y flujo completo con navegador real
make typecheck
```

Los tests de flujo levantan un servidor local con páginas de fixture y escanean de verdad con
Chromium, así que no dependen de la red.

## Limitaciones conocidas

- **Sin autenticación**: pensado para uso interno en local. No lo expongas a internet tal cual.
- **La cola vive en memoria**: si el servicio se reinicia a mitad de una auditoría, esa auditoría se
  marca como fallida al arrancar (no se reanuda).
- Un escaneo automático **no sustituye una revisión manual**: axe detecta aproximadamente entre un
  30 % y un 40 % de los problemas de accesibilidad. Para eso están las capas 2 y 3 (ver
  [Revisión manual](#revisión-manual-tres-capas)), y ni la capa 2 sustituye a probar con lectores de
  pantalla reales.
- Solo se escanean las URLs que se indican; no hay descubrimiento automático de páginas.
- La sección se elige escribiendo o eligiendo un selector CSS: no hay selector visual sobre una
  captura de la página.

## Posibles siguientes pasos

- Crawler opcional para descubrir páginas de un dominio (el modelo de datos ya soporta N páginas por
  auditoría).
- Autenticación por token si deja de ser solo local.
- Integración en CI que falle el build si aparecen incumplimientos nuevos (el endpoint `/diff` ya da
  exactamente ese dato).
