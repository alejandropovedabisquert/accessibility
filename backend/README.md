TODO: En caso de no tener el archivo scan results el reportService debe devolvernos un null o algo asi

TODO: Hacer un makefile para poder facilitarme la ejecucion de comandos

TODO: Sí, te recomiendo reorganizarlo, y no juntar todo en un único PDF cuando hay muchas URLs.

La razón práctica es que tu generador actual está pensado por resultado individual, no por lote completo: en storage.service.ts:36 se construye HTML con el primer resultado, y en reportHtmlBuilder.ts:66 el detalle ya es extenso por regla y nodos. Si metes todo en un solo documento, el PDF crece mucho y se vuelve poco usable.

Estructura recomendada por ejecución:

Carpeta por run.
Un índice general en JSON.
Un reporte por URL (PDF y JSON).
Un meta de ejecución.
Ejemplo de organización:

scan-results/
run-2026-06-03T18-10-00Z/
meta.json
summary.json
urls/
www.avantio.com/
report.json
report.pdf
www.otro.com/
report.json
report.pdf
Qué te conviene hacer con el builder:

Mantener reportHtmlBuilder como está para una sola URL.
No rehacerlo para multi-URL gigante.
Si quieres vista global, generar un PDF corto de resumen (tabla y métricas), y dejar el detalle técnico en PDFs por URL.
Además, ahora que ya tienes tolerancia a fallos en el workflow con allSettled en scanWorkflow.service.ts:28, esta estructura encaja perfecto porque puedes guardar:

Resultados exitosos por URL.
Fallos por URL en summary.json y meta.json.