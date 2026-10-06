# CLAUDE.md

Herramienta interna de escaneo y auditoría de accesibilidad web (Playwright + axe-core).
Monorepo: `backend/` (API), `frontend/` (Next.js) y `mcp/` (servidor MCP sobre la API, para la
revisión asistida por IA). Uso local, sin autenticación.

Documentación de producto y endpoints: `README.md`. Decisiones de backend: `backend/README.md`.

## Comandos

```bash
make dev         # backend :3000 + frontend :3001 en local
make up          # todo con Docker
make test        # tests del backend (vitest)
make typecheck   # tsc --noEmit en ambos
```

Antes de dar trabajo por terminado, ejecuta la skill `verify` (typecheck + tests + `next build`).
`tsc --noEmit` **no** basta en el frontend: varios fallos reales solo aparecen en `next build`.

Primera vez en local: `cd backend && pnpm exec playwright install chromium`.

## Arquitectura

Una **auditoría** tiene N **páginas** (una por URL, o por URL + sección). Cada página produce
contadores en SQLite y un JSON crudo de axe en disco.

El **ámbito** (`include`/`exclude`, selectores CSS) vive en la página, no en `AuditConfig`: una misma
auditoría puede mirar la cabecera de una URL y el pie de otra. `include` a null = página completa.

```
POST /api/audits → 202 {id}          El escaneo corre en segundo plano
  audit.service.create()             Inserta filas y lanza run() sin await
  audit.service.run()                Encola todas las páginas
  scan.service.enqueue()             Cola con límite de concurrencia
                                     AxeBuilder.include()/.exclude() si hay sección
  browserPool.acquire()              Navegador reutilizado, contexto nuevo por escaneo
  summarize()                        Contadores + score + issues aplanados
  repository.completePage()          Persiste; rawStore guarda el JSON
```

El frontend sondea `GET /api/audits/:id` mientras el estado sea `queued` o `running`.

### Revisión manual (capas 2 y 3)

El escaneo es la capa 1. La capa 2 (Claude, vía `mcp/` y la skill `revision-manual`) propone
resultados para los 86 criterios WCAG 2.2 A, AA y AAA del catálogo (`services/review/catalog/`); la
capa 3 (una persona) los valida y firma. Resultados en vocabulario EARL. Los AAA bloquean la firma
como los demás, pero **nunca cuentan para la conformidad legal** (`legal` = tiene apartado de EN 301 549).

```
evidence: true en la auditoría       scan.service → evidenceService.collect() tras axe, misma página
GET .../review                       Crea propuestas del sistema (needs-review de axe, appliesWhen)
                                     y deriva el estado de cada criterio
POST/PATCH findings                  Capa 2: nacen y se editan como `proposed`
PATCH /findings/:id/review           Capa 3: validated / rejected / amended; después, inmutable
```

Una página es de un sitio por su `host` (`site_hosts`), sin columna en `audit_pages`.

### Capas del backend (no las saltes)

```
routes/ → controllers/ → services/ → db/audit.repository.ts
             ↑
        schemas/ (zod)
```

- **controllers**: solo HTTP. Parsean con zod, llaman a un servicio, responden. Cero lógica.
- **services**: la lógica. No conocen `req`/`res`.
- **repository**: el único sitio con SQL. Ningún servicio hace queries por su cuenta.
- Los errores se lanzan con `AppError` / `badRequest()` / `notFound()` de `utils/errors.ts`; el
  `errorHandler` los traduce a JSON. No llames a `res.status(...)` para errores.

### Frontend

- Server Components para leer datos (`lib/api.ts`). Client Components solo donde hay interacción.
- Las mutaciones son Server Actions (`app/actions.ts`), no `fetch` desde el cliente.
- El navegador nunca llama a la API directamente: va por el proxy `/api/backend/*` (rewrite en
  `next.config.ts`). Si añades una descarga o un enlace a la API, usa esa ruta.

## Convenciones

- Comentarios y textos de cara al usuario **en castellano**. Nombres de código en inglés.
- Comenta el *por qué*, no el *qué*. La mayoría del código no necesita comentario.
- Sin `any`. El backend tiene `noUncheckedIndexedAccess`, así que `array[0]` es `T | undefined`.
- Si cambias `mcp/src`, `make mcp`: Claude Code arranca `mcp/dist/index.js`.
- Tipos compartidos del backend en `src/types/audit.types.ts`; el frontend tiene su copia en
  `src/lib/types.ts` (no hay paquete compartido). **Si cambias uno, cambia el otro.**
- Los tests de flujo escanean de verdad con Chromium contra fixtures locales. No metas dependencias
  de red en los tests.

## Gotchas (cosas que ya han mordido)

**Al acotar el escaneo a una sección, axe deja de ejecutar las reglas de ámbito de página**
(`html-has-lang`, `document-title`, `landmark-one-main`, `region`…). No es un fallo: es que con
`include` el contexto ya no es el documento. Si alguien reporta que "la sección pasa todo", casi
siempre es esto. La UI y el PDF lo avisan explícitamente; no quites ese aviso.

**El histórico y el diff se llavean por URL + `include` + pantalla (viewport y `device`), no solo por
URL.** Sin eso, comparar un escaneo de la cabecera con el anterior de la página entera marcaba media
web como "resuelta", y lo mismo pasa comparando móvil con escritorio. `findPreviousPage` y `history`
usan `IS` en vez de `=` porque NULL (página completa, sin dispositivo) tiene que casar con NULL.
**`exclude` queda deliberadamente fuera de la clave**: filtra ruido puntual (banners de cookies) y
partir la serie por él daría series de un solo punto.

**Un selector que no casa con nada aborta el escaneo entero de esa página.** axe lanza "No elements
found for include in Context", que no dice nada al usuario. `scan.service.assertSelector()` lo
comprueba antes con `document.querySelectorAll` (lo mismo que usa axe por dentro) y lanza un
`ScopeError`, cuyo mensaje sí está escrito para la UI y se salta `describeFailure`.

**Tailwind 4: `@theme` no puede ir dentro de `@media`.** Tailwind lo eleva fuera y solo sobrevive la
última definición, así que la app se renderiza siempre con la paleta equivocada. La paleta clara va
en `@theme`; la oscura redefine las custom properties en `:root` dentro del media query. Ver
`frontend/src/app/globals.css`.

**No añadas `loading.tsx` en la raíz de `app/`.** Crea un límite de Suspense que hace que Next envíe
la cabecera antes de que `notFound()` se ejecute, y las páginas inexistentes devuelven 200 en vez de
404.

**`export const dynamic = 'force-dynamic'` está en el layout raíz y hace falta.** Sin él, Next intenta
prerenderizar en build, la API no está levantada y el build falla.

**No metas el JSON de axe en SQLite.** El array `passes` de una página puede pesar varios MB. En la
BD solo contadores y metadatos; el crudo va a `scan-results/<auditId>/<pageId>.json` vía `rawStore`.

**No devuelvas la generación de PDF a la ruta de escaneo.** Es perezosa a propósito
(`report/pdf.service.ts`): antes se generaba un PDF por URL en cada escaneo y casi ninguno se
descargaba.

**No lances un navegador por escaneo.** Usa `browserPool.acquire()/release()`. Arrancar uno por URL
costaba ~175 ms extra por URL.

**El esquema de SQLite no tiene migraciones.** Se aplica con `CREATE TABLE IF NOT EXISTS` al arrancar,
que **no toca una tabla que ya existe**. Todo cambio posterior sobre una tabla creada va en
`migrate()` (`src/db/client.ts`), y tiene que ser idempotente: se ejecuta en cada arranque. Ese es el
único sitio donde poner un `ALTER TABLE`.

**Los textos de axe salen en castellano vía `axeSource`, no vía `.configure()`.** `@axe-core/playwright`
4.13 no expone `configure`; `scanner/locale.ts` añade `axe.configure({ locale })` al final del fuente de
axe. La traducción `es` de axe está incompleta y lo que falta sale en inglés: se completa en
`scanner/locales/es.overrides.json`, nunca editando `node_modules`. `ruleId` y `helpUrl` no se traducen.

**El MCP no puede validar hallazgos, y no debe poder.** `mcp/src/tools.ts` no expone
`PATCH /findings/:id/review` a propósito: es la capa 3. Un test falla si aparece una herramienta así.

**El código de `services/evidence/probes.ts` corre en el navegador.** `installProbes` se serializa, así
que no puede usar nada de fuera de su cuerpo. Se manda como texto con un `__name` vacío delante porque
`tsx` (y por tanto `make dev`) mete llamadas a ese helper de esbuild y en la página no existe; los
tests con vitest no lo reproducen. Los métodos se llaman por nombre con `page.evaluate`, nunca
construyendo código en la página (`new Function`): el CSP de muchas webs lo bloquea.

**La herencia de líneas base compara DOMs guardados, no la web en vivo.** `baseline.service` carga el
`dom.html` de la evidencia de cada página sin red y sin `<script>` (podrían rehacer el DOM) y compara
cada elemento y su landmark con `normalizeHtml` de `fingerprint.ts`. Un hallazgo heredado es una copia
con `inherited_from`; las propuestas de axe resueltas por herencia se modifican en su sitio y
`clearInheritance` las devuelve a `cantTell` al quitar o recalcular. `reviewFinding` propaga cada
revisión a las copias (`propagateToCopies`): si añades otra forma de cambiar un hallazgo, propágala.

**Una firma se recalcula con su versión del catálogo, no con la actual.** `stillMatches` rehace el
snapshot con `checksOfVersion(signOff.catalogVersion)`: la v1 (`wcag22-aa`) no tenía AAA, y sin eso
todas las firmas anteriores pasarían a `stillMatches: false`. Si una versión nueva cambia textos o
criterios existentes (no solo añade), `checksOfVersion` ya no basta: hay que conservar la anterior.

**Lo firmado sale de la copia congelada, nunca de la BD.** `signoff.service` guarda el `SignOffSnapshot`
en `scan-results/sign-offs/<id>.json` y su hash (JSON con claves ordenadas) en `sign_offs`. El PDF y el
EARL se generan desde esa copia; `stillMatches` recalcula con los datos actuales para avisar si algo
cambió. Si cambias la forma del snapshot, las firmas antiguas pasarán a `stillMatches: false`. Un sitio
con firmas no se borra (`sign_offs` sin `ON DELETE CASCADE` a propósito).

**La evidencia, como el JSON de axe, va a disco** (`scan-results/<auditId>/evidence/<pageId>/`), nunca a
SQLite. Un recolector que falla se anota en `errors` y no tumba ni la evidencia ni el escaneo.

**Un fallo de una URL no debe tumbar la auditoría.** `runPage` captura el error y marca esa página
como `failed`; el resto sigue.

## Métrica "reglas superadas"

Es `passes / (passes + violations) × 100`, deliberadamente **no** un score ponderado inventado. Las
reglas `inapplicable` no cuentan (no había nada que evaluar) y las `incomplete` tampoco (axe no pudo
decidir). Si tocas esto, mantén la propiedad de que el número sea verificable contra el JSON crudo.
