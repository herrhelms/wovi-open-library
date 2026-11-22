import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ADAPTER_ID_PATTERN, loadAdapters, validateAdapterConfig } from '../lib/adapters.js';
import { GROUPS, getSource, sources } from '../lib/sources/index.js';
import { PROJECT_ROOT } from '../lib/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'adapters');
const fixtureBases = join(here, 'fixtures', 'adapters-bases');

const quiet = () => {};

async function loadFixtureDir() {
  return loadAdapters({ dir: fixtureDir, basesDir: fixtureBases, log: quiet });
}

test('ADAPTER_ID_PATTERN accepts the real ids', () => {
  assert.ok(ADAPTER_ID_PATTERN.test('dpla'));
  assert.ok(ADAPTER_ID_PATTERN.test('esa-hubble'));
  assert.equal(ADAPTER_ID_PATTERN.test('DPLA'), false);
  assert.equal(ADAPTER_ID_PATTERN.test('a_b'), false);
});

test('loadAdapters reads a valid code adaptor', async () => {
  const { adapters } = await loadFixtureDir();
  const source = adapters.find((entry) => entry.id === 'ok-code');
  assert.ok(source);
  assert.equal(source.name, 'OK Code');
  assert.equal(source.homepage, 'https://example.org/ok-code');
  assert.equal(source.group, 'alpha');
  assert.equal(source.keyEnv, 'OK_CODE_KEY');
  assert.equal(source.keyOptional, true);
  assert.equal(source.openLicenses, true);
  assert.equal(source.trustResolvedUrl, false);
  assert.equal(source.config.schema, 1);
  assert.equal(typeof source.search, 'function');
  assert.equal(typeof source.resolveDownload, 'function');
  const result = await source.search('moon', 2);
  assert.deepEqual(result.items, [{ id: 'moon-2' }]);
});

test('loadAdapters reads a valid config-only adaptor', async () => {
  const { adapters } = await loadFixtureDir();
  const source = adapters.find((entry) => entry.id === 'ok-config');
  assert.ok(source);
  assert.equal(source.keyEnv, null);
  assert.equal(source.keyOptional, false);
  assert.equal(source.config.base, 'demo');
  assert.equal(source.prefix, 'ok');
  const result = await source.search('moon', 3);
  assert.deepEqual(result.items, [{ id: 'ok-moon-3' }]);
});

test('loadAdapters gives every validation rule an invalid entry', async () => {
  const { invalid } = await loadFixtureDir();
  const byFolder = new Map(invalid.map((entry) => [entry.folder, entry.error]));

  assert.match(byFolder.get('bad-json'), /JSON/);
  assert.match(byFolder.get('bad-schema'), /schema/);
  assert.match(byFolder.get('bad-id'), /folder name/);
  assert.match(byFolder.get('bad-group'), /group/);
  assert.match(byFolder.get('bad-order'), /order/);
  assert.match(byFolder.get('bad-key'), /key\.env/);
  assert.match(byFolder.get('bad-options'), /base/);
  assert.match(byFolder.get('bad-notes'), /notes/);
  assert.match(byFolder.get('no-search'), /search/);
  assert.match(byFolder.get('import-error'), /boom/);
});

test('loadAdapters marks two adaptors with the same id as invalid', async () => {
  const { adapters, invalid } = await loadFixtureDir();
  const folders = invalid.map((entry) => entry.folder).sort();
  assert.deepEqual(folders.filter((folder) => folder.startsWith('dup-')), ['dup-one', 'dup-two']);
  assert.equal(adapters.some((entry) => entry.id === 'shared'), false);
});

test('a code id that is not the adapter.json id only invalidates that folder', async () => {
  const { adapters, invalid } = await loadFixtureDir();
  const entry = invalid.find((item) => item.folder === 'code-id-mismatch');
  assert.ok(entry);
  assert.match(entry.error, /code id "other" is not equal to adapter\.json id "code-id-mismatch"/);
  assert.equal(invalid.some((item) => item.folder === 'other'), false);
  assert.ok(adapters.some((source) => source.id === 'other'));
});

test('loadAdapters sorts by group order, then order, then name', async () => {
  const { adapters, groups } = await loadFixtureDir();
  assert.deepEqual(groups.map((group) => group.id), ['alpha', 'beta']);
  assert.deepEqual(
    adapters.map((entry) => entry.id),
    ['ok-config', 'ok-code', 'other'],
  );
});

test('loadAdapters ignores folders that start with _ or .', async () => {
  const { adapters, invalid } = await loadFixtureDir();
  const ids = adapters.map((entry) => entry.id);
  assert.equal(ids.includes('_ignored'), false);
  assert.equal(ids.includes('.ignored'), false);
  assert.equal(invalid.some((entry) => entry.folder.startsWith('_')), false);
});

test('loadAdapters writes one line for each invalid adaptor', async () => {
  const lines = [];
  await loadAdapters({
    dir: fixtureDir,
    basesDir: fixtureBases,
    log: (line) => lines.push(line),
  });
  assert.ok(lines.length >= 10);
  for (const line of lines) assert.ok(line.startsWith('[adapters] '));
});

test('validateAdapterConfig accepts the default values', () => {
  const result = validateAdapterConfig(
    {
      schema: 1,
      id: 'demo',
      name: 'Demo',
      homepage: 'https://example.org',
      group: 'alpha',
      description: 'A demo.',
    },
    { folder: 'demo', groupIds: ['alpha'] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.config.defaultEnabled, true);
  assert.equal(result.config.openLicenses, true);
  assert.equal(result.config.trustResolvedUrl, false);
  assert.equal(result.config.key, null);
  assert.deepEqual(result.config.notes, []);
});

test('validateAdapterConfig rejects options without base', () => {
  const result = validateAdapterConfig(
    {
      schema: 1,
      id: 'demo',
      name: 'Demo',
      homepage: 'https://example.org',
      group: 'alpha',
      description: 'A demo.',
      options: { a: 1 },
    },
    { folder: 'demo', groupIds: ['alpha'] },
  );
  assert.equal(result.ok, false);
});

test('every real adapter.json is valid and invalid is empty', async () => {
  const { adapters, groups, invalid } = await loadAdapters({ log: quiet });
  assert.deepEqual(invalid, []);
  const dir = join(PROJECT_ROOT, 'adapters');
  const folderCount = readdirSync(dir).filter((name) => {
    if (name.startsWith('_') || name.startsWith('.')) return false;
    return statSync(join(dir, name)).isDirectory();
  }).length;
  assert.equal(adapters.length, folderCount);
  assert.equal(adapters.length, 75);
  assert.equal(groups.length, 4);
  for (const source of adapters) {
    assert.ok(ADAPTER_ID_PATTERN.test(source.id));
    assert.equal(typeof source.search, 'function');
    assert.equal(typeof source.config.description, 'string');
    assert.ok(source.config.description.length > 0);
    assert.ok(groups.some((group) => group.id === source.group));
  }
});

test('every adaptor folder has an adapter.json and code or a base', () => {
  const dir = join(PROJECT_ROOT, 'adapters');
  const folders = readdirSync(dir).filter((name) => {
    if (name.startsWith('_') || name.startsWith('.')) return false;
    return statSync(join(dir, name)).isDirectory();
  });
  assert.equal(folders.length, 75);
  for (const folder of folders) {
    const config = JSON.parse(readFileSync(join(dir, folder, 'adapter.json'), 'utf8'));
    assert.equal(config.id, folder);
    if (config.base === undefined || config.base === null) {
      assert.equal(statSync(join(dir, folder, 'index.js')).isFile(), true);
    } else {
      assert.equal(config.options !== undefined, true, `${folder} has base without options`);
    }
  }
});

test('each process.env name in adaptor code is the adaptor key or PORT', () => {
  const dir = join(PROJECT_ROOT, 'adapters');

  const walk = (folder) => {
    const entries = readdirSync(folder, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) return [];
      return [path];
    });
  };

  for (const folder of readdirSync(dir)) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue;
    const adapterDir = join(dir, folder);
    if (!statSync(adapterDir).isDirectory()) continue;
    const config = JSON.parse(readFileSync(join(adapterDir, 'adapter.json'), 'utf8'));
    const allowed = new Set(['PORT']);
    if (config.key !== null && config.key !== undefined) allowed.add(config.key.env);

    for (const file of walk(adapterDir)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) {
        assert.ok(allowed.has(match[1]), `${file} uses process.env.${match[1]}`);
      }
      for (const match of text.matchAll(/process\.env\[(['"])([A-Za-z0-9_]+)\1\]/g)) {
        assert.ok(allowed.has(match[2]), `${file} uses process.env[${match[2]}]`);
      }
    }
  }
});

test('the real registry keeps the current 75 sources in order', async () => {
  const ids = sources.map((source) => source.id);
  assert.equal(ids.length, 75);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'commons');
  assert.equal(ids.at(-1), 'nhm');
  assert.deepEqual(GROUPS.map((group) => group.id), [
    'aggregators',
    'museums',
    'libraries',
    'science',
  ]);
  const source = getSource('dpla');
  assert.equal(source.name, 'DPLA');
  assert.equal(source.keyEnv, 'DPLA_KEY');
  assert.equal(source.keyOptional, false);
  assert.equal(source.trustResolvedUrl, true);
  assert.equal(getSource('nope'), null);
});

test('lib/sources only holds the registry module', () => {
  const dir = join(PROJECT_ROOT, 'lib', 'sources');
  assert.deepEqual(readdirSync(dir), ['index.js']);
});
