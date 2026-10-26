---
name: revision-codigo
description: Barrido del código existente de la herramienta de accesibilidad buscando refactors, duplicación, código muerto y violaciones de las convenciones del repo. Reparte el código en zonas, lanza un agente revisor-codigo por zona y consolida un informe priorizado. Úsala cuando pidan revisar el código, buscar mejoras o refactors, o deuda técnica. Para revisar solo un diff, mejor /simplify o /code-review.
---

# Revisión de código por zonas

Tú coordinas; los agentes `revisor-codigo` revisan. No revises tú el código a fondo: tu trabajo es
repartir, consolidar y presentar.

## 1. Ámbito

Si el usuario nombra una zona o una ruta, revisa solo eso. Si no, todas. Zonas por defecto (sus
tamaños están equilibrados, unas 3-4k líneas cada una):

| Zona | Rutas |
|---|---|
| backend-núcleo | `backend/src/{app,server}.ts`, `routes/`, `controllers/`, `schemas/`, `middlewares/`, `utils/`, `config/`, `db/`, `services/{audit,scanner,storage,shared}/` |
| backend-revisión | `backend/src/services/{review,evidence,export,report}/` |
| frontend | `frontend/src/` |
| mcp-y-tipos | `mcp/src/`, más la comparación `backend/src/types/audit.types.ts` ↔ `frontend/src/lib/types.ts` |

Antes de lanzar nada, avisa del coste en una línea: un barrido completo son 4 agentes leyendo unas
15k líneas.

## 2. Lanzar

Lanza **todos los agentes en un solo mensaje** (en paralelo), con `subagent_type: revisor-codigo`. El
prompt de cada uno lleva:

- El nombre de la zona y sus rutas exactas.
- Las rutas de las otras zonas, para que pueda consultarlas al comprobar duplicación o código muerto,
  pero sin reportar hallazgos que estén solo allí.
- Si el usuario pidió algo concreto (por ejemplo, "solo duplicación"), ese foco.

No le pases tus sospechas: queremos una lectura sin sesgo.

## 3. Consolidar

Con todos los informes:

1. **Verifica por encima** los hallazgos de impacto alto o confianza baja: abre las líneas citadas.
   Descarta los que no se sostienen o que choquen con los Gotchas de `CLAUDE.md`, y di cuántos
   descartaste.
2. **Une los duplicados** entre zonas (un mismo patrón visto desde backend y frontend es un hallazgo).
3. **Ordena** por impacto, de mayor a menor, y dentro del mismo impacto por esfuerzo, de menor a
   mayor.

## 4. Presentar

En el chat, en castellano:

- Una tabla con todos los hallazgos: `#`, título, zona, `fichero:línea`, impacto, esfuerzo.
- Debajo, el detalle (problema, propuesta, riesgo) solo de los de impacto alto y medio.
- Al final, pregunta **cuáles aplicar**. No apliques nada sin respuesta.

## 5. Aplicar (si te lo piden)

- Uno por uno o por grupos pequeños, no todo de golpe.
- Respeta las convenciones de `CLAUDE.md` (comentarios en castellano, sin `any`, tipos sincronizados,
  `make mcp` si tocas `mcp/src`).
- Al terminar, ejecuta la skill `verify`. Si algo falla, dilo con la salida.
