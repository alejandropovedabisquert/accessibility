import { describe, expect, it } from 'vitest';
import { fingerprint, normalizeHtml, type FingerprintPattern } from '../src/services/export/fingerprint';

describe('huella de un nodo', () => {
  it('quita clases, atributos e ids que genera Elementor', () => {
    const a =
      '<a href="/c" class="elementor-button elementor-element-4332f88 e-7abb8a1-8bff8d3" data-id="4332f88" data-interaction-id="a1b2">';
    const b =
      '<a class="e-1f2e3d4-5c6b7a8 elementor-button elementor-element-9c0d1e2"  data-interaction-id="ffee" href="/c" data-id="9c0d1e2">';

    expect(normalizeHtml(a)).toBe('<a class="elementor-button" href>');
    expect(normalizeHtml(b)).toBe(normalizeHtml(a));
    expect(fingerprint('link-name', a)).toBe(fingerprint('link-name', b));
  });

  it('sustituye el id generado de un campo y sus referencias', () => {
    const html = '<label for="e-form-input-31a11f8">Email</label><input id="e-form-input-31a11f8" aria-describedby="e-form-input-31a11f8-help">';
    expect(normalizeHtml(html)).toBe(
      '<label for="e-form-input-*"></label><input aria-describedby="e-form-input-*-help" id="e-form-input-*">'
    );
  });

  it('junta las tarjetas de una plantilla aunque cambien enlace, imagen y texto', () => {
    const card = (slug: string, title: string, photo: string) =>
      `<a href="/alojamientos/${slug}" class="card-link" title="Ver ${title}" aria-label="${title}">` +
      `<img src="/fotos/${photo}.jpg" srcset="/fotos/${photo}@2x.jpg 2x" alt="${title}" class="card-img">` +
      `<span class="card-title">${title}</span></a>`;

    const cards = [
      card('villa-rosa', 'Villa Rosa', '1'),
      card('casa-azul', 'Casa Azul junto al mar', '22'),
      card('apartamento-centro-3', 'Apartamento centro', '303'),
    ];
    const normalized = new Set(cards.map((html) => normalizeHtml(html)));

    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe(
      '<a aria-label class="card-link" href title><img alt class="card-img" src srcset><span class="card-title"></span></a>'
    );
    expect(new Set(cards.map((html) => fingerprint('link-name', html))).size).toBe(1);
  });

  it('distingue si un atributo de contenido esta o no', () => {
    // Para image-alt no es lo mismo una imagen sin alt que una con alt.
    expect(normalizeHtml('<img src="/a.jpg">')).not.toBe(normalizeHtml('<img src="/b.jpg" alt="B">'));
  });

  it('no mezcla estructuras distintas ni reglas distintas', () => {
    expect(normalizeHtml('<a class="card-link">')).not.toBe(normalizeHtml('<a class="menu-link">'));
    expect(normalizeHtml('<a><img></a>')).not.toBe(normalizeHtml('<a><span></span></a>'));
    expect(normalizeHtml('<input type="text">')).not.toBe(normalizeHtml('<input type="email">'));
    expect(fingerprint('label', '<input>')).not.toBe(fingerprint('autocomplete-valid', '<input>'));
  });

  it('no se confunde con > dentro de un valor de atributo', () => {
    expect(normalizeHtml('<div data-x="a>b" class="c">texto</div>')).toBe('<div class="c" data-x="a>b"></div>');
  });

  it('acepta una lista de patrones propia', () => {
    const patterns: FingerprintPattern[] = [{ kind: 'value', pattern: /\bwp-block-\d+\b/g, why: 'prueba' }];
    expect(normalizeHtml('<div id="wp-block-12">', patterns)).toBe('<div id="*">');
    // Con la lista propia no se aplican los patrones por defecto.
    expect(normalizeHtml('<div data-id="1">', patterns)).toBe('<div data-id="1">');
    expect(normalizeHtml('<a href="/x">', patterns)).toBe('<a href="/x">');
  });

  it('respeta atributos sin valor y etiquetas autocerradas', () => {
    expect(normalizeHtml('<INPUT disabled   type="text"/>')).toBe('<input disabled type="text" />');
    expect(normalizeHtml("<a href='/x' rel=nofollow>")).toBe('<a href rel="nofollow">');
  });
});
