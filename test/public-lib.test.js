import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GROUPS,
  downloadUrl,
  groupSources,
  isUsable,
  parseSavedSelection,
  serializeSelection,
  subtitleText,
} from '../public/lib.js';

const source = (id, extra = {}) => ({
  id,
  name: id,
  homepage: `https://example.org/${id}`,
  group: 'museums',
  needsKey: false,
  keyConfigured: true,
  keyEnv: null,
  ...extra,
});

test('DEFAULT_GROUPS has the four groups', () => {
  assert.deepEqual(
    DEFAULT_GROUPS.map((group) => group.id),
    ['aggregators', 'museums', 'libraries', 'science'],
  );
});

test('isUsable', () => {
  assert.equal(isUsable({ needsKey: false }), true);
  assert.equal(isUsable({ needsKey: true, keyConfigured: true }), true);
  assert.equal(isUsable({ needsKey: true, keyConfigured: false }), false);
});

test('groupSources keeps group order and source order, drops empty groups', () => {
  const registry = [
    source('m1', { group: 'museums' }),
    source('a1', { group: 'aggregators' }),
    source('m2', { group: 'museums' }),
    source('s1', { group: 'science' }),
    source('x1', { group: 'x' }),
  ];
  const rows = groupSources(registry, DEFAULT_GROUPS);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['aggregators', 'museums', 'science', 'other'],
  );
  assert.deepEqual(
    rows.find((row) => row.id === 'museums').sources.map((entry) => entry.id),
    ['m1', 'm2'],
  );
  assert.deepEqual(
    rows.find((row) => row.id === 'other').sources.map((entry) => entry.id),
    ['x1'],
  );
  assert.equal(rows.some((row) => row.id === 'libraries'), false);
});

test('groupSources puts sources with a null group into Other', () => {
  const rows = groupSources([source('n1', { group: null })]);
  assert.deepEqual(rows.map((row) => row.id), ['other']);
});

test('subtitleText counts usable sources', () => {
  const usable = [source('a'), source('b'), source('c')];
  assert.equal(
    subtitleText(usable),
    'Search 3 open image libraries and download the full resolution.',
  );
  assert.equal(
    subtitleText([...usable, source('d', { needsKey: true, keyConfigured: false })]),
    'Search 3 open image libraries and download the full resolution (1 more needs a key).',
  );
  assert.equal(
    subtitleText([
      ...usable,
      source('d', { needsKey: true, keyConfigured: false }),
      source('e', { needsKey: true, keyConfigured: false }),
    ]),
    'Search 3 open image libraries and download the full resolution (2 more need a key).',
  );
});

test('subtitleText falls back to the static text for an empty registry', () => {
  assert.equal(
    subtitleText([]),
    'Search open image libraries and download the full resolution.',
  );
});

test('parseSavedSelection rejects missing and broken input', () => {
  assert.equal(parseSavedSelection(null, [source('a')]), null);
  assert.equal(parseSavedSelection('{bad', [source('a')]), null);
  assert.equal(parseSavedSelection('{"foo":1}', [source('a')]), null);
});

test('parseSavedSelection adds usable sources that were not known', () => {
  const registry = [source('a'), source('b'), source('c')];
  const raw = JSON.stringify({ selected: ['a'], known: ['a', 'b'] });
  assert.deepEqual(parseSavedSelection(raw, registry), ['a', 'c']);
});

test('parseSavedSelection removes unknown and unusable ids', () => {
  const registry = [
    source('a'),
    source('b', { needsKey: true, keyConfigured: false }),
  ];
  const raw = JSON.stringify({
    selected: ['a', 'b', 'zzz'],
    known: ['a', 'b'],
  });
  assert.deepEqual(parseSavedSelection(raw, registry), ['a']);
});

test('parseSavedSelection reads the old array format', () => {
  const registry = [source('met'), source('cleveland'), source('getty')];
  assert.deepEqual(parseSavedSelection('["met"]', registry), ['met', 'getty']);
});

test('serializeSelection round-trips through parseSavedSelection', () => {
  const registry = [source('a'), source('b')];
  const json = serializeSelection(['a'], registry);
  assert.deepEqual(JSON.parse(json), { selected: ['a'], known: ['a', 'b'] });
  assert.deepEqual(parseSavedSelection(json, registry), ['a']);
});

test('downloadUrl keeps the existing behaviour', () => {
  const europeana = downloadUrl({
    source: 'europeana',
    id: '1',
    title: 'T',
    full: 'https://example.org/full.jpg',
  });
  assert.equal(europeana.includes('url='), false);
  assert.equal(europeana.includes('source=europeana'), true);

  const other = downloadUrl(
    { source: 'met', id: '2', title: 'U', full: 'https://example.org/a.jpg' },
    'https://example.org/b.jpg',
  );
  const params = new URLSearchParams(other.split('?')[1]);
  assert.equal(params.get('url'), 'https://example.org/b.jpg');
  assert.equal(params.get('id'), '2');
});
