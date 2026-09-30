import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Pagina con incumplimientos deterministas: contraste, img sin alt, sin lang, input sin label.
 * El segundo parrafo (4.54:1) cumple AA pero no AAA: solo falla si se pide wcag2aaa.
 */
export const BROKEN_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Pagina con fallos</title></head>
  <body style="background:#ffffff">
    <p style="color:#eeeeee">Texto con contraste insuficiente</p>
    <p style="color:#767676">Contraste suficiente para AA pero no para AAA</p>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
    <input type="text">
  </body>
</html>`;

export const CLEAN_PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Pagina correcta</title></head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Titulo</h1>
      <p style="color:#111111">Contenido accesible.</p>
    </main>
  </body>
</html>`;

/**
 * Cabecera con fallos y contenido principal limpio, para comprobar que acotar
 * el escaneo a una seccion cambia el resultado.
 */
export const SECTIONED_PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Pagina por secciones</title></head>
  <body style="background:#ffffff">
    <header>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
      <p style="color:#eeeeee">Cabecera con contraste insuficiente</p>
    </header>
    <main>
      <h1 style="color:#111111">Titulo</h1>
      <p style="color:#111111">Contenido accesible.</p>
    </main>
    <footer>
      <input type="text">
    </footer>
  </body>
</html>`;

/**
 * Pagina larga, parecida en proporcion a una real: cientos de elementos que
 * pasan (y que axe vuelca enteros en `passes`) frente a un par de fallos.
 */
export const LONG_PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Pagina larga</title></head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Listado</h1>
      <ul>
${Array.from(
  { length: 150 },
  (_, i) => `        <li><a href="/alojamiento/${i}" style="color:#111111">Alojamiento ${i}</a> <button type="button" style="color:#111111">Reservar ${i}</button></li>`
).join('\n')}
      </ul>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
      <input type="text">
    </main>
  </body>
</html>`;

/**
 * Pagina responsive: la imagen sin alt solo se muestra por debajo de 600 px,
 * asi que el escaneo movil falla en image-alt y el de escritorio no.
 */
export const RESPONSIVE_PAGE = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8"><title>Pagina responsive</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>.solo-movil { display: none; } @media (max-width: 600px) { .solo-movil { display: block; } }</style>
  </head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Titulo</h1>
      <img class="solo-movil" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
    </main>
  </body>
</html>`;

/**
 * Dos paginas de un sitio Elementor con el mismo pie (enlace vacio y campo de
 * newsletter sin etiqueta) pero ids generados distintos en cada una, como pasa
 * en produccion. Solo la primera tiene ademas una imagen sin alt propia.
 */
const elementorPage = (ids: { element: string; style: string; field: string; interaction: string }, extra = '') => `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Elementor ${ids.element}</title></head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Pagina ${ids.element}</h1>
      ${extra}
    </main>
    <footer class="elementor elementor-${parseInt(ids.element, 16) % 1000}">
      <div class="elementor-element elementor-element-${ids.element} e-con e-${ids.style}" data-id="${ids.element}" data-element_type="container">
        <a href="/contacto" class="elementor-button elementor-element-${ids.element} e-${ids.style}" data-id="${ids.element}" data-interaction-id="${ids.interaction}"></a>
        <input type="email" id="e-form-input-${ids.field}" name="form_fields[email]" class="elementor-field">
      </div>
    </footer>
  </body>
</html>`;

export const ELEMENTOR_PAGE_A = elementorPage(
  { element: '4332f88', style: '7abb8a1-8bff8d3', field: '31a11f8', interaction: 'a1b2c3d4' },
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">'
);
export const ELEMENTOR_PAGE_B = elementorPage({
  element: '9c0d1e2',
  style: '1f2e3d4-5c6b7a8',
  field: '77aa0b1',
  interaction: 'ffee0011',
});

/**
 * Listado con tarjetas de la misma plantilla: cambia el enlace, la foto y el
 * texto, pero todas fallan igual (imagen sin alt, titulo vacio). En la
 * exportacion agregada tienen que acabar en un solo grupo por fallo.
 */
export const CARDS_PAGE = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><title>Alojamientos</title></head>
  <body style="background:#ffffff">
    <main>
      <h1 style="color:#111111">Alojamientos</h1>
${[
  ['villa-rosa', 'Villa Rosa', 1],
  ['casa-azul', 'Casa Azul junto al mar', 22],
  ['apartamento-centro', 'Apartamento en el centro', 303],
]
  .map(
    ([slug, name, photo]) => `      <article class="card">
        <a href="/alojamientos/${slug}" class="card-link" title="${name}"><img src="/fotos/${photo}.jpg" class="card-img"></a>
        <h2 class="card-title"></h2>
        <p class="card-text" style="color:#111111">${name}</p>
      </article>`
  )
  .join('\n')}
    </main>
  </body>
</html>`;

export interface FixtureServer {
  url(path?: string): string;
  close(): Promise<void>;
}

export const startFixtureServer = async (pages: Record<string, string>): Promise<FixtureServer> => {
  const server = http.createServer((req, res) => {
    const body = pages[req.url ?? '/'];
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: (path = '/') => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};
