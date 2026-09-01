# backend

API de escaneo de accesibilidad. Express + TypeScript, Playwright, axe-core y SQLite.

Documentación general, endpoints y configuración: [README de la raíz](../README.md).

## Estructura

```
src/
├── app.ts / server.ts        Express y arranque (incluye cierre ordenado)
├── config/                   Configuración por entorno
├── db/
│   ├── client.ts             Conexión SQLite y esquema
│   └── audit.repository.ts   Todas las consultas
├── schemas/                  Validación de entrada con zod
├── controllers/              Capa HTTP (sin lógica de negocio)
├── services/
│   ├── audit/                Orquestación de la auditoría y cálculo de métricas
│   ├── scanner/              Pool de navegadores y ejecución de axe
│   ├── report/               Generación de PDF (perezosa) y HTML del informe
│   ├── storage/              JSON crudo de axe en disco
│   └── shared/               Cola con límite de concurrencia
└── types/                    Tipos compartidos
```

## Decisiones que conviene conocer

**Pool de navegadores** (`services/scanner/browserPool.ts`). Se mantiene un navegador vivo por motor y
cada escaneo abre solo un `BrowserContext`. Arrancar un navegador por URL costaba ~175 ms extra por
URL (medido: 438 → 264 ms por URL en escaneos secuenciales sobre una página local). El navegador se
cierra solo tras `BROWSER_IDLE_TIMEOUT_MS` sin trabajo.

**PDF bajo demanda** (`services/report/pdf.service.ts`). Antes se generaba un PDF por URL en cada
escaneo, arrancando un Chromium dedicado para cada informe. La mayoría no se descargaba nunca. Ahora
se genera la primera vez que se pide y se cachea en disco (172 ms la primera vez, 9 ms después).

**El JSON de axe no va en la base de datos** (`services/storage/rawStore.ts`). Solo contadores y
metadatos, que es lo que se necesita para listar, filtrar y comparar. El resultado completo vive en
`scan-results/<auditId>/<pageId>.json`.

**Aplanado de incumplimientos** (tabla `page_issues`). Cada regla incumplida se guarda como fila, lo
que permite calcular el diff entre dos escaneos con una consulta en vez de leer y comparar dos JSON.

**Un fallo de una URL no tumba la auditoría.** Cada página se marca como `failed` con su mensaje y el
resto continúa.

## Desarrollo

```bash
pnpm install
pnpm exec playwright install chromium   # solo la primera vez
pnpm dev                                # recarga en caliente con tsx
pnpm test                               # vitest
pnpm lint                               # tsc --noEmit
```

## Base de datos

Tres tablas: `audits` (una por ejecución), `audit_pages` (una por URL) y `page_issues` (una por regla
incumplida). El esquema está en `src/db/client.ts` y se aplica solo al arrancar; no hay sistema de
migraciones porque todavía no hace falta. Si cambias el esquema con datos existentes, borra
`data/audits.db` o añade las migraciones antes.
