import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { devices } from 'playwright';
import config from '../config/config';
import { DEFAULT_VIEWPORT } from '../types/audit.types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audits (
  id                TEXT PRIMARY KEY,
  label             TEXT,
  status            TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  browser           TEXT NOT NULL,
  device            TEXT,
  viewport_width    INTEGER,
  viewport_height   INTEGER,
  wait_until        TEXT NOT NULL,
  timeout_ms        INTEGER NOT NULL,
  tags              TEXT NOT NULL,
  total_pages       INTEGER NOT NULL DEFAULT 0,
  completed_pages   INTEGER NOT NULL DEFAULT 0,
  failed_pages      INTEGER NOT NULL DEFAULT 0,
  violations        INTEGER NOT NULL DEFAULT 0,
  violation_nodes   INTEGER NOT NULL DEFAULT 0,
  critical          INTEGER NOT NULL DEFAULT 0,
  serious           INTEGER NOT NULL DEFAULT 0,
  moderate          INTEGER NOT NULL DEFAULT 0,
  minor             INTEGER NOT NULL DEFAULT 0,
  passes            INTEGER NOT NULL DEFAULT 0,
  incomplete        INTEGER NOT NULL DEFAULT 0,
  inapplicable      INTEGER NOT NULL DEFAULT 0,
  score             REAL,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits (status);

CREATE TABLE IF NOT EXISTS audit_pages (
  id                TEXT PRIMARY KEY,
  audit_id          TEXT NOT NULL REFERENCES audits (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  url               TEXT NOT NULL,
  host              TEXT NOT NULL,
  status            TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  duration_ms       INTEGER,
  violations        INTEGER NOT NULL DEFAULT 0,
  violation_nodes   INTEGER NOT NULL DEFAULT 0,
  critical          INTEGER NOT NULL DEFAULT 0,
  serious           INTEGER NOT NULL DEFAULT 0,
  moderate          INTEGER NOT NULL DEFAULT 0,
  minor             INTEGER NOT NULL DEFAULT 0,
  passes            INTEGER NOT NULL DEFAULT 0,
  incomplete        INTEGER NOT NULL DEFAULT 0,
  inapplicable      INTEGER NOT NULL DEFAULT 0,
  score             REAL,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_pages_audit ON audit_pages (audit_id, position);
CREATE INDEX IF NOT EXISTS idx_pages_host ON audit_pages (host);

CREATE TABLE IF NOT EXISTS page_issues (
  page_id      TEXT NOT NULL REFERENCES audit_pages (id) ON DELETE CASCADE,
  rule_id      TEXT NOT NULL,
  impact       TEXT,
  node_count   INTEGER NOT NULL,
  help         TEXT NOT NULL,
  help_url     TEXT NOT NULL,
  description  TEXT NOT NULL,
  PRIMARY KEY (page_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_rule ON page_issues (rule_id);

CREATE TABLE IF NOT EXISTS sites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Una pagina es del sitio cuyo host coincide con audit_pages.host. Se casa al
-- leer, sin columna en audit_pages, para que las auditorias anteriores a crear
-- el sitio entren solas. PRIMARY KEY: un host no puede ser de dos sitios.
CREATE TABLE IF NOT EXISTS site_hosts (
  host     TEXT PRIMARY KEY,
  site_id  TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_hosts_site ON site_hosts (site_id);

CREATE TABLE IF NOT EXISTS manual_findings (
  id                     TEXT PRIMARY KEY,
  page_id                TEXT REFERENCES audit_pages (id) ON DELETE CASCADE,
  site_id                TEXT REFERENCES sites (id) ON DELETE CASCADE,
  check_id               TEXT NOT NULL,
  catalog_version        INTEGER NOT NULL,
  source_kind            TEXT NOT NULL,
  axe_rule_id            TEXT,
  outcome                TEXT NOT NULL,
  targets                TEXT NOT NULL,
  target_count           INTEGER NOT NULL,
  description            TEXT NOT NULL,
  recommendation         TEXT,
  evidence_refs          TEXT NOT NULL,
  asserted_by            TEXT NOT NULL,
  review_status          TEXT NOT NULL,
  reviewed_by            TEXT,
  reviewed_at            TEXT,
  review_note            TEXT,
  inherited_from         TEXT,
  inherited_fingerprint  TEXT,
  created_at             TEXT NOT NULL,
  -- De una pagina o de un sitio, nunca de los dos ni de ninguno.
  CHECK ((page_id IS NULL) <> (site_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_findings_page ON manual_findings (page_id);
CREATE INDEX IF NOT EXISTS idx_findings_site ON manual_findings (site_id);
-- Las propuestas de axe se crean al abrir la revision, que puede pedirse dos
-- veces a la vez: el indice hace que la segunda no duplique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_axe
  ON manual_findings (page_id, axe_rule_id, check_id) WHERE source_kind = 'axe-needs-review';
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_applicability
  ON manual_findings (page_id, check_id) WHERE source_kind = 'applicability';
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_false_positive
  ON manual_findings (page_id, axe_rule_id, check_id) WHERE source_kind = 'axe-false-positive';
`;

/**
 * Cambios de esquema sobre bases ya creadas.
 *
 * No hay sistema de migraciones: el esquema se aplica con CREATE TABLE IF NOT
 * EXISTS, que no toca una tabla que ya existe. Todo lo que se anada despues
 * tiene que pasar por aqui, y ser idempotente.
 */
const migrate = (instance: Db): void => {
  const addColumn = (table: string, column: string, type: string) => {
    const columns = instance.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) {
      instance.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  };

  // Seccion analizada de la pagina. NULL en las filas antiguas = pagina entera.
  addColumn('audit_pages', 'include_selector', 'TEXT');
  addColumn('audit_pages', 'exclude_selector', 'TEXT');

  // Desglose legal (A/AA) / mejoras (AAA, buenas practicas), en JSON: solo se
  // lee entero, nunca se filtra por el. NULL en filas antiguas hasta que
  // `auditService.backfillCompliance()` lo recalcula desde el JSON crudo.
  addColumn('audit_pages', 'compliance', 'TEXT');
  addColumn('audits', 'compliance', 'TEXT');
  // NULL en filas antiguas: se deduce del id de regla al leer.
  addColumn('page_issues', 'level', 'TEXT');

  // Pantalla de cada pagina: una auditoria puede escanear la misma URL en
  // varias resoluciones. `audits.viewports` es la lista pedida, en JSON.
  addColumn('audit_pages', 'viewport_width', 'INTEGER');
  addColumn('audit_pages', 'viewport_height', 'INTEGER');
  addColumn('audit_pages', 'device', 'TEXT');
  addColumn('audits', 'viewports', 'TEXT');
  // Recoger evidencia para la revision manual. NULL en filas antiguas = no.
  addColumn('audits', 'evidence', 'INTEGER');
  // Selector de `appliesWhen` con el que se propuso un no aplicable (source_kind = 'applicability').
  addColumn('manual_findings', 'source_selector', 'TEXT');
  backfillPageScreens(instance);

  // El historico y el diff van por URL + seccion + pantalla, no solo por URL.
  instance.exec(`
    DROP INDEX IF EXISTS idx_pages_url;
    DROP INDEX IF EXISTS idx_pages_url_scope;
    CREATE INDEX IF NOT EXISTS idx_pages_series
      ON audit_pages (url, include_selector, viewport_width, viewport_height, device, finished_at DESC);
  `);
};

/**
 * Las paginas anteriores a los viewports multiples no guardan su pantalla, pero
 * se puede saber cual fue: la de su auditoria, que era unica. Sin viewport ni
 * dispositivo se escaneaba siempre con DEFAULT_VIEWPORT. Asi las series
 * antiguas siguen casando con los escaneos nuevos de la misma resolucion.
 *
 * Solo toca filas sin pantalla ni dispositivo, que desde este cambio ya no se
 * crean, asi que es idempotente.
 */
const backfillPageScreens = (instance: Db): void => {
  instance
    .prepare(`
      UPDATE audit_pages
      SET viewport_width  = COALESCE((SELECT a.viewport_width  FROM audits a WHERE a.id = audit_pages.audit_id), @width),
          viewport_height = COALESCE((SELECT a.viewport_height FROM audits a WHERE a.id = audit_pages.audit_id), @height)
      WHERE viewport_width IS NULL AND device IS NULL
        AND (SELECT a.device FROM audits a WHERE a.id = audit_pages.audit_id) IS NULL
    `)
    .run(DEFAULT_VIEWPORT);

  const withDevice = instance
    .prepare(`
      SELECT DISTINCT a.device AS device FROM audit_pages p JOIN audits a ON a.id = p.audit_id
      WHERE p.viewport_width IS NULL AND p.device IS NULL AND a.device IS NOT NULL
    `)
    .all() as Array<{ device: string }>;

  const update = instance.prepare(`
    UPDATE audit_pages SET device = @device, viewport_width = @width, viewport_height = @height
    WHERE viewport_width IS NULL AND device IS NULL
      AND audit_id IN (SELECT id FROM audits WHERE device = @device)
  `);
  for (const { device } of withDevice) {
    // Si el dispositivo ya no existe en esta version de Playwright, queda el nombre sin tamano.
    const viewport = devices[device]?.viewport ?? null;
    update.run({ device, width: viewport?.width ?? null, height: viewport?.height ?? null });
  }
};

export type Db = Database.Database;

/** Esquema base + migraciones. Separado de getDb() para poder probarlo sobre una BD cualquiera. */
export const applySchema = (instance: Db): void => {
  instance.exec(SCHEMA);
  migrate(instance);
};

let db: Db | null = null;

export const getDb = (): Db => {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = config.isTest ? ':memory:' : path.join(config.dataDir, 'audits.db');

  const instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  applySchema(instance);

  db = instance;
  return instance;
};

export const closeDb = (): void => {
  db?.close();
  db = null;
};
