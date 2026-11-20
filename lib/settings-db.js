import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ADAPTER_ID_PATTERN = /^[a-z0-9-]+$/;

function openDatabase(path) {
  if (typeof path !== 'string' || path === '') {
    throw new TypeError('path must be a non-empty string');
  }
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  return new DatabaseSync(path);
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS adapter_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
    'schema_version',
    '1',
  );
}

export function openSettings(path) {
  const db = openDatabase(path);
  createSchema(db);

  const selectEnabled = db.prepare('SELECT enabled FROM adapter_settings WHERE id = ?');
  const upsertEnabled = db.prepare(`
    INSERT INTO adapter_settings (id, enabled, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const selectAll = db.prepare(
    'SELECT id, enabled, updated_at FROM adapter_settings ORDER BY id',
  );

  let closed = false;

  return {
    getAdapterEnabled(id) {
      const row = selectEnabled.get(id);
      if (row === undefined) return null;
      return row.enabled === 1;
    },

    setAdapterEnabled(id, enabled) {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('enabled must be a boolean');
      }
      if (typeof id !== 'string' || !ADAPTER_ID_PATTERN.test(id)) {
        throw new TypeError('id must match /^[a-z0-9-]+$/');
      }
      upsertEnabled.run(id, enabled ? 1 : 0, new Date().toISOString());
    },

    listAdapterSettings() {
      return selectAll.all().map((row) => ({
        id: row.id,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at,
      }));
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
