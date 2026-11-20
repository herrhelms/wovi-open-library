import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openSettings } from '../lib/settings-db.js';

test('new database is empty', () => {
  const settings = openSettings(':memory:');
  try {
    assert.equal(settings.getAdapterEnabled('dpla'), null);
    assert.deepEqual(settings.listAdapterSettings(), []);
  } finally {
    settings.close();
  }
});

test('meta has schema_version 1', () => {
  // A fresh in-memory DB cannot be inspected after close, so inspect a file DB.
  const root = mkdtempSync(join(tmpdir(), 'olf-settings-'));
  try {
    const file = join(root, 'settings.sqlite');
    const handle = openSettings(file);
    handle.close();

    const db = new DatabaseSync(file);
    try {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
      assert.equal(row.value, '1');
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('set and read adapter settings', () => {
  const settings = openSettings(':memory:');
  try {
    settings.setAdapterEnabled('dpla', false);
    assert.equal(settings.getAdapterEnabled('dpla'), false);

    settings.setAdapterEnabled('dpla', true);
    assert.equal(settings.getAdapterEnabled('dpla'), true);

    const rows = settings.listAdapterSettings();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'dpla');
    assert.equal(rows[0].enabled, true);
    assert.equal(typeof rows[0].updatedAt, 'string');
    assert.equal(new Date(rows[0].updatedAt).toISOString(), rows[0].updatedAt);
  } finally {
    settings.close();
  }
});

test('list sorts by id', () => {
  const settings = openSettings(':memory:');
  try {
    settings.setAdapterEnabled('zeta', true);
    settings.setAdapterEnabled('alpha', false);
    settings.setAdapterEnabled('mike', true);
    assert.deepEqual(
      settings.listAdapterSettings().map((row) => row.id),
      ['alpha', 'mike', 'zeta'],
    );
  } finally {
    settings.close();
  }
});

test('setAdapterEnabled refuses a non-boolean and writes nothing', () => {
  const settings = openSettings(':memory:');
  try {
    for (const bad of ['no', 1, null, undefined, 0, 'true']) {
      assert.throws(() => settings.setAdapterEnabled('dpla', bad), TypeError);
    }
    assert.equal(settings.getAdapterEnabled('dpla'), null);
    assert.deepEqual(settings.listAdapterSettings(), []);
  } finally {
    settings.close();
  }
});

test('setAdapterEnabled refuses a bad id', () => {
  const settings = openSettings(':memory:');
  try {
    for (const bad of ['Bad Id', 'DPLA', 'a_b', '', '../x', 'a b']) {
      assert.throws(() => settings.setAdapterEnabled(bad, true), TypeError);
    }
    assert.deepEqual(settings.listAdapterSettings(), []);
  } finally {
    settings.close();
  }
});

test('values stay after close and open of a temporary file, missing directory is made', () => {
  const root = mkdtempSync(join(tmpdir(), 'olf-settings-'));
  try {
    const file = join(root, 'nested', 'dir', 'settings.sqlite');

    const first = openSettings(file);
    first.setAdapterEnabled('dpla', false);
    first.close();

    const second = openSettings(file);
    try {
      assert.equal(second.getAdapterEnabled('dpla'), false);
      assert.deepEqual(second.listAdapterSettings(), [
        { id: 'dpla', enabled: false, updatedAt: second.listAdapterSettings()[0].updatedAt },
      ]);
    } finally {
      second.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a row for an unknown adaptor stays', () => {
  const settings = openSettings(':memory:');
  try {
    settings.setAdapterEnabled('does-not-exist', false);
    assert.equal(settings.getAdapterEnabled('does-not-exist'), false);
    assert.equal(settings.listAdapterSettings().length, 1);
  } finally {
    settings.close();
  }
});
