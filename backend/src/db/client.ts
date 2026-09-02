import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import config from '../config/config';

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
`;

/**
 * Cambios de esquema sobre bases ya creadas.
 *
 * No hay sistema de migraciones: el esquema se aplica con CREATE TABLE IF NOT
 * EXISTS, que no toca una tabla que ya existe. Todo lo que se anada despues
 * tiene que pasar por aqui, y ser idempotente.
 */
const migrate = (instance: Db): void => {
  const columns = instance.prepare('PRAGMA table_info(audit_pages)').all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((column) => column.name === name);

  // Seccion analizada de la pagina. NULL en las filas antiguas = pagina entera.
  if (!has('include_selector')) {
    instance.exec('ALTER TABLE audit_pages ADD COLUMN include_selector TEXT');
  }
  if (!has('exclude_selector')) {
    instance.exec('ALTER TABLE audit_pages ADD COLUMN exclude_selector TEXT');
  }

  // El historico y el diff van por URL + seccion, no solo por URL.
  instance.exec(`
    DROP INDEX IF EXISTS idx_pages_url;
    CREATE INDEX IF NOT EXISTS idx_pages_url_scope
      ON audit_pages (url, include_selector, finished_at DESC);
  `);
};

export type Db = Database.Database;

let db: Db | null = null;

export const getDb = (): Db => {
  if (db) return db;

  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = config.isTest ? ':memory:' : path.join(config.dataDir, 'audits.db');

  const instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  instance.exec(SCHEMA);
  migrate(instance);

  db = instance;
  return instance;
};

export const closeDb = (): void => {
  db?.close();
  db = null;
};
