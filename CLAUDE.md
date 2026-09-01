# CLAUDE.md

Herramienta interna de escaneo y auditoría de accesibilidad web (Playwright + axe-core).
Monorepo de dos servicios: `backend/` (API) y `frontend/` (Next.js). Uso local, sin autenticación.

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

Una **auditoría** tiene N **páginas** (una por URL). Cada página produce contadores en SQLite y un
JSON crudo de axe en disco.

```
POST /api/audits → 202 {id}          El escaneo corre en segundo plano
  audit.service.create()             Inserta filas y lanza run() sin await
  audit.service.run()                Encola todas las páginas
  scan.service.enqueue()             Cola con límite de concurrencia
  browserPool.acquire()              Navegador reutilizado, contexto nuevo por escaneo
  summarize()                        Contadores + score + issues aplanados
  repository.completePage()          Persiste; rawStore guarda el JSON
```

El frontend sondea `GET /api/audits/:id` mientras el estado sea `queued` o `running`.

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
- Tipos compartidos del backend en `src/types/audit.types.ts`; el frontend tiene su copia en
  `src/lib/types.ts` (no hay paquete compartido). **Si cambias uno, cambia el otro.**
- Los tests de flujo escanean de verdad con Chromium contra fixtures locales. No metas dependencias
  de red en los tests.

## Gotchas (cosas que ya han mordido)

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

**El esquema de SQLite no tiene migraciones.** Se aplica con `CREATE TABLE IF NOT EXISTS` al arrancar.
Si cambias `src/db/client.ts` con datos existentes, usa la skill `db-change`.

**Un fallo de una URL no debe tumbar la auditoría.** `runPage` captura el error y marca esa página
como `failed`; el resto sigue.

## Métrica "reglas superadas"

Es `passes / (passes + violations) × 100`, deliberadamente **no** un score ponderado inventado. Las
reglas `inapplicable` no cuentan (no había nada que evaluar) y las `incomplete` tampoco (axe no pudo
decidir). Si tocas esto, mantén la propiedad de que el número sea verificable contra el JSON crudo.
