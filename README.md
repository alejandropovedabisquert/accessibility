# accessibility

API para escaneo automatizado de accesibilidad web con Playwright + axe-core, orientada a ejecutar auditorias WCAG sobre una o varias URLs y generar reportes descargables.

## Que hace el proyecto

- Recibe una o varias URLs a escanear.
- Ejecuta un analisis de accesibilidad con `@axe-core/playwright`.
- Permite seleccionar navegador (`chromium`, `firefox`, `webkit`) y dispositivo Playwright opcional.
- Devuelve resultados en JSON por API.
- Genera y almacena reportes en PDF dentro de `backend/scan-results`.
- Expone endpoints para listar y descargar reportes generados.

## Problema que resuelve

Centraliza la validacion de accesibilidad de sitios web en un servicio reproducible. Evita revisiones manuales repetitivas y permite:

- Detectar incumplimientos WCAG de forma consistente.
- Ejecutar escaneos multi-URL bajo una misma peticion.
- Guardar evidencia (reportes) para seguimiento y comunicacion con equipos.

## Stack usado

- Node.js + TypeScript
- Express
- Playwright (`chromium`, `firefox`, `webkit`)
- `@axe-core/playwright` para auditoria de accesibilidad
- Docker + Docker Compose
- Cola en memoria para tareas asincronas (escaneo y guardado de reportes)

## Como arrancarlo

Desde la raiz del proyecto:

1. Primera ejecucion (build completo):

```bash
docker compose up --build
```

2. Ejecuciones posteriores con watch:

```bash
docker compose up --watch
```

La API queda expuesta en:

- `http://localhost:3000`
- Base de endpoints: `http://localhost:3000/api/accessibility`

## Endpoints actuales

Base path: `/api/accessibility`

- `POST /scan`
	- Ejecuta escaneo de accesibilidad para una o varias URLs.
- `GET /devices`
	- Lista dispositivos disponibles de Playwright.
- `GET /browsers`
	- Lista navegadores soportados por la API.
- `GET /reports`
	- Lista carpetas de reportes y sus archivos.
- `GET /reports/:type/:directoryName`
	- Descarga un reporte por tipo (`pdf` o `json`) y nombre de carpeta.

## Ejemplo de request a `/scan`

```bash
curl -X POST 'http://localhost:3000/api/accessibility/scan' \
	-H 'Content-Type: application/json' \
	-d '{
		"urls": [
			"https://www.avantio.com",
			"https://www.heartoffantasy.com"
		],
		"browser": "chromium",
		"device": "Desktop Chrome"
	}'
```

## Ejemplo de respuesta

Respuesta simplificada (el objeto real incluye mas campos de axe en `passes`, `violations`, `incomplete`, etc.):

```json
{
	"timestamp": "2026-06-03T12:34:56.789Z",
	"url": "www.avantio.com",
	"results": [
		{
			"url": "https://www.avantio.com/",
			"violations": [
				{
					"id": "color-contrast",
					"impact": "serious",
					"description": "Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds"
				}
			],
			"passes": [],
			"incomplete": [],
			"inapplicable": []
		}
	]
}
```

Errores tipicos:

- `400`: faltan `urls`.
- `400`: protocolo no permitido (solo `http`/`https`).
- `400`: navegador no soportado.

## Como descargar reportes

1. Lista reportes disponibles:

```bash
curl 'http://localhost:3000/api/accessibility/reports'
```

2. Descarga un PDF:

```bash
curl -L 'http://localhost:3000/api/accessibility/reports/pdf/2026-06-02T10:54:41.095Z_www.avantio.com' -o reporte.pdf
```

3. Descarga JSON (si existe en la carpeta):

```bash
curl -L 'http://localhost:3000/api/accessibility/reports/json/2026-06-02T10:54:41.095Z_www.avantio.com' -o reporte.json
```

## Limitaciones actuales

- Actualmente el flujo de almacenamiento genera PDF; la descarga de JSON esta expuesta por endpoint pero no se genera de forma explicita en el proceso actual.
- No hay persistencia en base de datos; los reportes viven en filesystem (`scan-results`).
- La cola de trabajos es en memoria (si reinicia el servicio, se pierde estado en curso).
- No hay autenticacion/autorizacion en la API.
- El escaneo depende de la accesibilidad de la URL destino en tiempo de ejecucion.

## Roadmap corto

- Guardar tambien reporte JSON de forma nativa para que `/reports/json/:directoryName` sea funcional en todos los casos.
- Anadir paginacion y filtros en `GET /reports`.
- Incluir autenticacion basica por token para proteger endpoints.
- Mejorar trazabilidad (IDs de trabajo, estado de ejecucion y metricas).
- Anadir tests de integracion para endpoints principales (`/scan`, `/reports`, `/reports/:type/:directoryName`).