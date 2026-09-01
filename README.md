# accessibility

Herramienta interna de escaneo y auditoría automática de accesibilidad web. Ejecuta análisis WCAG con
Playwright + axe-core sobre una o varias URLs, guarda cada auditoría y permite volver a consultarla,
compararla con escaneos anteriores y descargar el informe.

- **Frontend**: http://localhost:3001
- **API**: http://localhost:3000

## Qué hace

- Lanza auditorías sobre varias URLs a la vez, eligiendo navegador, dispositivo o resolución, y qué
  normas WCAG comprobar (2.0 / 2.1 / 2.2 AA, buenas prácticas).
- Ejecuta el escaneo **en segundo plano**: la petición responde al instante con un identificador y la
  interfaz muestra el progreso. Puedes cerrar la pestaña y volver más tarde.
- Guarda el histórico completo en SQLite y permite filtrar, buscar y paginar el listado.
- Muestra por página los incumplimientos con su severidad, los elementos del DOM afectados, el
  selector y el enlace a la documentación de Deque.
- **Compara cada escaneo con el anterior de la misma URL**: qué se ha resuelto, qué es nuevo y qué ha
  cambiado de volumen.
- Genera el informe **PDF bajo demanda** y lo cachea; también se puede descargar el JSON de axe.

## Arquitectura

```
accessibility/
├── backend/     API Express + TypeScript, Playwright, axe-core, SQLite
├── frontend/    Next.js (App Router) + Tailwind
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
3. Elige normas y entorno de escaneo, y lanza.
4. El detalle se va actualizando solo mientras el escaneo corre.

## API

Base: `http://localhost:3000/api`

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/meta` | Navegadores, dispositivos, normas y límites disponibles |
| `GET` | `/stats` | Estado de las colas y del pool de navegadores |
| `POST` | `/audits` | Crea una auditoría. Responde `202` con el id, sin esperar al escaneo |
| `GET` | `/audits` | Listado paginado (`page`, `pageSize`, `status`, `search`) |
| `GET` | `/audits/:id` | Auditoría con el estado de cada página |
| `POST` | `/audits/:id/rerun` | Relanza con la misma configuración |
| `DELETE` | `/audits/:id` | Borra la auditoría y sus ficheros |
| `GET` | `/audits/:id/pages/:pageId` | Resumen e incumplimientos de una página |
| `GET` | `/audits/:id/pages/:pageId/results` | JSON completo de axe (`?download=1` para descargar) |
| `GET` | `/audits/:id/pages/:pageId/diff` | Comparación con el escaneo anterior de esa URL |
| `GET` | `/audits/:id/pages/:pageId/report.pdf` | Informe PDF (se genera la primera vez y se cachea) |
| `GET` | `/history?url=` | Serie temporal de una URL |
| `GET` | `/history/urls` | URLs auditadas con su número de ejecuciones |
| `GET` | `/health` | Estado del servicio |

### Ejemplo

```bash
# Lanzar
curl -X POST http://localhost:3000/api/audits \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://www.avantio.com", "https://www.avantio.com/es/precios"],
    "label": "Home y precios",
    "browser": "chromium",
    "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
  }'
# -> 202 {"id":"a1b2...","status":"queued","totalPages":2, ...}

# Consultar progreso
curl http://localhost:3000/api/audits/a1b2...
```

Errores de validación devuelven `400` con el detalle campo a campo:

```json
{
  "error": "Datos de entrada no válidos",
  "details": [{ "field": "urls.0", "message": "Debe ser una URL http o https válida" }]
}
```

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
| `MAX_URLS_PER_AUDIT` | `25` | Límite de URLs por auditoría |
| `DEFAULT_TIMEOUT_MS` | `30000` | Tiempo máximo de carga por página |

En el frontend, `API_URL` (por defecto `http://localhost:3000`) es la URL interna de la API. El
navegador nunca la llama directamente: todo pasa por el proxy `/api/backend/*` de Next, así que el
front siempre es mismo-origen.

## Sobre la métrica "reglas superadas"

No es un score ponderado inventado: es `reglas superadas / (superadas + incumplidas) × 100`. Las
reglas `inapplicable` no cuentan (no había nada que evaluar) y las `incomplete` tampoco (axe no pudo
decidir y necesitan revisión manual). Es un dato verificable contra el JSON crudo.

## Tests

```bash
make test        # 28 tests: validación de la API y flujo completo con navegador real
make typecheck
```

Los tests de flujo levantan un servidor local con páginas de fixture y escanean de verdad con
Chromium, así que no dependen de la red.

## Limitaciones conocidas

- **Sin autenticación**: pensado para uso interno en local. No lo expongas a internet tal cual.
- **La cola vive en memoria**: si el servicio se reinicia a mitad de una auditoría, esa auditoría se
  marca como fallida al arrancar (no se reanuda).
- Un escaneo automático **no sustituye una revisión manual**: axe detecta aproximadamente entre un
  30 % y un 40 % de los problemas de accesibilidad. La sección "requieren revisión manual" es
  justamente lo que hay que mirar a mano.
- Solo se escanean las URLs que se indican; no hay descubrimiento automático de páginas.

## Posibles siguientes pasos

- Crawler opcional para descubrir páginas de un dominio (el modelo de datos ya soporta N páginas por
  auditoría).
- Autenticación por token si deja de ser solo local.
- Exportar el informe agregado de toda la auditoría, no solo por página.
- Integración en CI que falle el build si aparecen incumplimientos nuevos (el endpoint `/diff` ya da
  exactamente ese dato).
