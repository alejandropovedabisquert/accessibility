import http from 'http';
import type { AddressInfo } from 'net';

/** Pagina con incumplimientos deterministas: contraste, img sin alt, sin lang, input sin label. */
export const BROKEN_PAGE = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Pagina con fallos</title></head>
  <body style="background:#ffffff">
    <p style="color:#eeeeee">Texto con contraste insuficiente</p>
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
