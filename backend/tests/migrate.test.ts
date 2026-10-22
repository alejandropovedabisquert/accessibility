import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { devices } from 'playwright';
import { applySchema } from '../src/db/client';

/**
 * Una fila antigua es una fila sin pantalla: las columnas de viewport se
 * anadieron despues con ALTER TABLE, asi que en una BD existente quedan a NULL.
 */
const insertOldAudit = (db: Database.Database, id: string, screen: { width?: number; height?: number; device?: string }) => {
  db.prepare(`
    INSERT INTO audits (id, status, created_at, browser, device, viewport_width, viewport_height,
                        wait_until, timeout_ms, tags, total_pages)
    VALUES (?, 'completed', '2026-01-01T00:00:00.000Z', 'chromium', ?, ?, ?, 'load', 30000, '["wcag2a"]', 1)
  `).run(id, screen.device ?? null, screen.width ?? null, screen.height ?? null);
  db.prepare(`
    INSERT INTO audit_pages (id, audit_id, position, url, host, status)
    VALUES (?, ?, 0, 'https://web.test/', 'web.test', 'completed')
  `).run(`${id}-page`, id);
};

const pageScreen = (db: Database.Database, auditId: string) =>
  db
    .prepare('SELECT viewport_width AS width, viewport_height AS height, device FROM audit_pages WHERE audit_id = ?')
    .get(auditId);

describe('migracion de pantallas de auditorias antiguas', () => {
  const db = new Database(':memory:');
  applySchema(db);
  insertOldAudit(db, 'por-defecto', {});
  insertOldAudit(db, 'resolucion', { width: 800, height: 600 });
  insertOldAudit(db, 'dispositivo', { device: 'iPhone 15' });
  insertOldAudit(db, 'desaparecido', { device: 'Nokia 3310' });
  // Se vuelve a aplicar, como en el siguiente arranque.
  applySchema(db);

  it('usa la resolucion por defecto si la auditoria no pidio ninguna', () => {
    expect(pageScreen(db, 'por-defecto')).toEqual({ width: 1366, height: 768, device: null });
  });

  it('copia la resolucion unica de la auditoria', () => {
    expect(pageScreen(db, 'resolucion')).toEqual({ width: 800, height: 600, device: null });
  });

  it('usa el tamano del dispositivo de Playwright', () => {
    const { width, height } = devices['iPhone 15']!.viewport;
    expect(pageScreen(db, 'dispositivo')).toEqual({ width, height, device: 'iPhone 15' });
  });

  it('conserva el nombre de un dispositivo que ya no existe, sin tamano', () => {
    expect(pageScreen(db, 'desaparecido')).toEqual({ width: null, height: null, device: 'Nokia 3310' });
  });

  it('es idempotente', () => {
    applySchema(db);
    expect(pageScreen(db, 'resolucion')).toEqual({ width: 800, height: 600, device: null });
  });
});

describe('migracion de lanzamientos de auditorias antiguas', () => {
  const db = new Database(':memory:');
  applySchema(db);
  // Sin grupo, como quedan las filas de antes de anadir la columna.
  const insert = (id: string, createdAt: string, label: string | null, urls: string[]) => {
    db.prepare(`
      INSERT INTO audits (id, label, status, created_at, browser, wait_until, timeout_ms, tags, total_pages)
      VALUES (?, ?, 'completed', ?, 'chromium', 'load', 30000, '["wcag2a"]', ?)
    `).run(id, label, createdAt, urls.length);
    urls.forEach((url, position) =>
      db.prepare(`
        INSERT INTO audit_pages (id, audit_id, position, url, host, status, viewport_width, viewport_height)
        VALUES (?, ?, ?, ?, 'web.test', 'completed', 1366, 768)
      `).run(`${id}-${position}`, id, position, url),
    );
  };
  insert('original', '2026-01-01T00:00:00.000Z', 'Web', ['https://web.test/', 'https://web.test/b']);
  // Mismas paginas en otro orden: es un «volver a lanzar».
  insert('relanzada', '2026-02-01T00:00:00.000Z', 'Web', ['https://web.test/b', 'https://web.test/']);
  insert('otro-nombre', '2026-03-01T00:00:00.000Z', 'Otra', ['https://web.test/', 'https://web.test/b']);
  insert('otras-urls', '2026-04-01T00:00:00.000Z', 'Web', ['https://web.test/']);
  insert('sin-nombre-1', '2026-05-01T00:00:00.000Z', null, ['https://web.test/c']);
  insert('sin-nombre-2', '2026-06-01T00:00:00.000Z', null, ['https://web.test/c']);
  db.prepare('UPDATE audits SET group_id = NULL').run();
  applySchema(db);

  const groupOf = (id: string) => (db.prepare('SELECT group_id FROM audits WHERE id = ?').get(id) as { group_id: string }).group_id;

  it('agrupa las que tienen el mismo nombre y las mismas paginas, con el id de la mas antigua', () => {
    expect(groupOf('original')).toBe('original');
    expect(groupOf('relanzada')).toBe('original');
    expect(groupOf('sin-nombre-2')).toBe('sin-nombre-1');
  });

  it('no agrupa si cambia el nombre o las paginas', () => {
    expect(groupOf('otro-nombre')).toBe('otro-nombre');
    expect(groupOf('otras-urls')).toBe('otras-urls');
  });

  it('es idempotente', () => {
    applySchema(db);
    expect(groupOf('relanzada')).toBe('original');
  });
});
