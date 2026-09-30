---
name: verify
description: Comprobación antes de dar trabajo por terminado en la herramienta de accesibilidad - typecheck de backend y frontend, tests del backend y `next build`. Úsala al acabar cualquier cambio en backend/ o frontend/.
---

# Verificar la herramienta de accesibilidad

Ejecuta los tres pasos desde la raíz de `accessibility/`, en este orden, y no pares en el primer
fallo: informa de los tres.

```bash
make typecheck                 # tsc --noEmit en backend y frontend
make test                      # vitest del backend (escanea de verdad con Chromium)
cd frontend && pnpm build      # next build
```

## Por qué los tres

- `tsc --noEmit` **no** basta en el frontend: varios fallos reales solo aparecen en `next build`
  (límites Server/Client Component, `'use client'` que falta, imports de servidor en el cliente,
  prerender).
- Los tests de flujo lanzan Chromium contra fixtures locales. La primera vez en una máquina hace falta
  `cd backend && pnpm exec playwright install chromium`; si fallan con "Executable doesn't exist",
  es eso, no el cambio.
- `next build` no necesita la API levantada gracias a `dynamic = 'force-dynamic'` en el layout raíz.
  Si el build falla intentando llamar a la API, alguien ha quitado ese export o ha añadido un
  `generateStaticParams`.

## Cuidado

- `next build` sobrescribe `frontend/.next`. Si `make dev` está corriendo, el servidor de desarrollo
  del frontend se queda roto: avisa y reinícialo después.
- Los tests del backend comparten BD en memoria y pool de navegadores (`fileParallelism: false`); no
  los lances en paralelo con otra ejecución de vitest.

## Informe

Una línea por paso con ✅/❌. En los fallos, el error literal (fichero:línea y mensaje), no un
resumen. Si algo falla por el entorno y no por el cambio, dilo explícitamente.
