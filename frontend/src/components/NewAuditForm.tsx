'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createAuditAction, type FormState } from '@/app/actions';
import { CUSTOM_SECTION } from '@/lib/format';
import { buttonStyles, Card } from '@/components/ui';
import type { Meta } from '@/lib/types';

const FIELD = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-sm font-medium';
const HINT = 'mt-1 text-xs text-ink-muted';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonStyles.primary}>
      {pending ? 'Lanzando…' : 'Lanzar auditoría'}
    </button>
  );
}

export function NewAuditForm({ meta }: { meta: Meta }) {
  const [state, formAction] = useActionState<FormState, FormData>(createAuditAction, { error: null });
  const [useDevice, setUseDevice] = useState(false);
  const [section, setSection] = useState('');

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical"
        >
          {state.error}
        </div>
      ) : null}

      <Card className="space-y-5 p-5">
        <div>
          <label htmlFor="urls" className={LABEL}>
            URLs a escanear <span className="text-critical">*</span>
          </label>
          <textarea
            id="urls"
            name="urls"
            rows={6}
            required
            aria-describedby="urls-hint"
            placeholder={'https://www.avantio.com\nhttps://www.avantio.com/es/precios'}
            className={`${FIELD} font-mono`}
          />
          <p id="urls-hint" className={HINT}>
            Una por línea (o separadas por comas). Máximo {meta.limits.maxUrlsPerAudit}. Si omites el
            protocolo se asume <code>https://</code>. Para analizar una sección distinta en una línea
            concreta, añade <code>| selector-css</code> al final: <code>web.com/precios | footer</code>.
          </p>
        </div>

        <div>
          <label htmlFor="label" className={LABEL}>
            Nombre de la auditoría
          </label>
          <input
            id="label"
            name="label"
            type="text"
            maxLength={120}
            placeholder="Home y checkout, sprint 42"
            aria-describedby="label-hint"
            className={FIELD}
          />
          <p id="label-hint" className={HINT}>
            Opcional. Ayuda a reconocerla luego en el listado.
          </p>
        </div>
      </Card>

      <Card className="space-y-5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Sección a analizar
        </h2>

        <div>
          <label htmlFor="section" className={LABEL}>
            Ámbito del escaneo
          </label>
          <select
            id="section"
            name="section"
            value={section}
            onChange={(event) => setSection(event.target.value)}
            aria-describedby="section-hint"
            className={`${FIELD} max-w-md`}
          >
            <option value="">Página completa</option>
            {meta.sections.map((preset) => (
              <option key={preset.id} value={preset.selector}>
                {preset.label} ({preset.selector})
              </option>
            ))}
            <option value={CUSTOM_SECTION}>Selector CSS personalizado…</option>
          </select>
          <p id="section-hint" className={HINT}>
            Se aplica a todas las URLs que no lleven su propio selector tras <code>|</code>. Al
            analizar solo una sección, axe omite las reglas de ámbito de página (idioma del
            documento, landmarks, título).
          </p>
        </div>

        {section === CUSTOM_SECTION ? (
          <div>
            <label htmlFor="includeCustom" className={LABEL}>
              Selector CSS a incluir <span className="text-critical">*</span>
            </label>
            <input
              id="includeCustom"
              name="includeCustom"
              type="text"
              required
              maxLength={meta.limits.maxSelectorLength}
              placeholder=".booking-widget .filters"
              aria-describedby="includeCustom-hint"
              className={`${FIELD} max-w-md font-mono`}
            />
            <p id="includeCustom-hint" className={HINT}>
              Cualquier selector CSS válido. Si casa con varios elementos, se analizan todos.
            </p>
          </div>
        ) : null}

        <div>
          <label htmlFor="exclude" className={LABEL}>
            Excluir del análisis
          </label>
          <input
            id="exclude"
            name="exclude"
            type="text"
            maxLength={meta.limits.maxSelectorLength}
            placeholder="#onetrust-banner"
            aria-describedby="exclude-hint"
            className={`${FIELD} max-w-md font-mono`}
          />
          <p id="exclude-hint" className={HINT}>
            Opcional. Útil para quitar ruido que no controlas, como el banner de cookies. No parte la
            serie del histórico.
          </p>
        </div>
      </Card>

      <Card className="space-y-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Normas a comprobar
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const form = document.forms[0];
                meta.tags.forEach((tag) => {
                  const input = form.elements.namedItem(
                    "tags",
                  ) as RadioNodeList;
                  if (input) {
                    const checkbox = Array.from(input).find(
                      (el) =>
                        el instanceof HTMLInputElement && el.value === tag.id,
                    ) as HTMLInputElement | undefined;
                    if (checkbox) checkbox.checked = true;
                  }
                });
              }}
              className={buttonStyles.secondary}
            >
              Marcar todas
            </button>
            <button
              type="button"
              onClick={() => {
                const form = document.forms[0];
                meta.tags.forEach((tag) => {
                  const input = form.elements.namedItem(
                    "tags",
                  ) as RadioNodeList;
                  if (input) {
                    const checkbox = Array.from(input).find(
                      (el) =>
                        el instanceof HTMLInputElement && el.value === tag.id,
                    ) as HTMLInputElement | undefined;
                    if (checkbox) checkbox.checked = false;
                  }
                });
              }}
              className={buttonStyles.secondary}
            >
              Desmarcar todas
            </button>
          </div>
        </div>
        <fieldset>
          <legend className="sr-only">Conjuntos de reglas WCAG</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {meta.tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="tags"
                  value={tag.id}
                  defaultChecked={meta.defaults.tags.includes(tag.id)}
                  className="size-4"
                />
                {tag.label}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-5 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Entorno de escaneo</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="browser" className={LABEL}>
              Navegador
            </label>
            <select id="browser" name="browser" defaultValue={meta.defaults.browser} className={FIELD}>
              {meta.browsers.map((browser) => (
                <option key={browser.id} value={browser.id}>
                  {browser.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="waitUntil" className={LABEL}>
              Esperar hasta
            </label>
            <select
              id="waitUntil"
              name="waitUntil"
              defaultValue={meta.defaults.waitUntil}
              aria-describedby="waitUntil-hint"
              className={FIELD}
            >
              <option value="load">load — recursos cargados</option>
              <option value="domcontentloaded">domcontentloaded — más rápido</option>
              <option value="networkidle">networkidle — webs con mucho JS</option>
            </select>
            <p id="waitUntil-hint" className={HINT}>
              Usa <code>networkidle</code> si la página monta contenido tras cargar.
            </p>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className={LABEL}>Tamaño de pantalla</legend>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="sizeMode"
              checked={!useDevice}
              onChange={() => setUseDevice(false)}
              className="size-4"
            />
            Resolución concreta
          </label>

          {!useDevice ? (
            <div className="ml-6 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="viewportWidth" className="mb-1 block text-xs text-ink-muted">
                  Ancho (px)
                </label>
                <input
                  id="viewportWidth"
                  name="viewportWidth"
                  type="number"
                  min={240}
                  max={4096}
                  defaultValue={meta.defaults.viewport.width}
                  className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="viewportHeight" className="mb-1 block text-xs text-ink-muted">
                  Alto (px)
                </label>
                <input
                  id="viewportHeight"
                  name="viewportHeight"
                  type="number"
                  min={240}
                  max={4096}
                  defaultValue={meta.defaults.viewport.height}
                  className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                />
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="sizeMode"
              checked={useDevice}
              onChange={() => setUseDevice(true)}
              className="size-4"
            />
            Dispositivo de Playwright
          </label>

          {useDevice ? (
            <div className="ml-6">
              <label htmlFor="device" className="mb-1 block text-xs text-ink-muted">
                Dispositivo
              </label>
              <select id="device" name="device" className={`${FIELD} max-w-xs`} defaultValue="Desktop Chrome">
                {meta.devices.map((device) => (
                  <option key={device.name} value={device.name}>
                    {device.name}
                    {device.viewport ? ` (${device.viewport.width}×${device.viewport.height})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </fieldset>

        <div>
          <label htmlFor="timeout" className={LABEL}>
            Tiempo máximo de carga por página (ms)
          </label>
          <input
            id="timeout"
            name="timeout"
            type="number"
            min={1000}
            max={180000}
            step={1000}
            defaultValue={meta.defaults.timeout}
            className={`${FIELD} max-w-40`}
          />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton />
        <p className="text-xs text-ink-muted">
          El escaneo corre en segundo plano: puedes cerrar la pestaña y volver luego.
        </p>
      </div>
    </form>
  );
}
