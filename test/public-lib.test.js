import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GROUPS,
  downloadUrl,
  firstLoaded,
  groupSources,
  imageCandidates,
  isSearchable,
  isUsable,
  parseSavedSelection,
  serializeSelection,
  shouldAutoLoad,
  subtitleText,
  VIEWER_PROBE_TIMEOUT_MS,
  viewerPlan,
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

test('isSearchable', () => {
  assert.equal(isSearchable({ needsKey: false }, true), true);
  assert.equal(isSearchable({ openLicenses: false }, true), false);
  assert.equal(isSearchable({ openLicenses: false }, false), true);
  assert.equal(isSearchable({ needsKey: true, keyConfigured: false }, false), false);
});

test('imageCandidates', () => {
  assert.deepEqual(
    imageCandidates({ preview: 'a', previewFallback: 'b', thumb: 'c', thumbFallback: 'd' }),
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(
    imageCandidates({ preview: 'a', thumb: 'a', thumbFallback: '' }),
    ['a'],
  );
  assert.deepEqual(imageCandidates({ preview: null, thumb: 'c' }), ['c']);
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

test('shouldAutoLoad allows the first automatic load', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 10,
      visibleAtLastAutoLoad: null,
      autoLoadsWithoutGain: 0,
    }),
    true,
  );
});

test('shouldAutoLoad allows automatic loading after a gain', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 30,
      visibleAtLastAutoLoad: 10,
      autoLoadsWithoutGain: 0,
    }),
    true,
  );
});

test('shouldAutoLoad allows one retry without a gain', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 10,
      visibleAtLastAutoLoad: 10,
      autoLoadsWithoutGain: 0,
    }),
    true,
  );
});

test('shouldAutoLoad stops after a retry without a gain', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 10,
      visibleAtLastAutoLoad: 10,
      autoLoadsWithoutGain: 1,
    }),
    false,
  );
});

test('shouldAutoLoad stops when no visible cards remain', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 0,
      visibleAtLastAutoLoad: 0,
      autoLoadsWithoutGain: 3,
    }),
    false,
  );
});

test('shouldAutoLoad honours maxWithoutGain', () => {
  assert.equal(
    shouldAutoLoad({
      visibleNow: 5,
      visibleAtLastAutoLoad: 5,
      autoLoadsWithoutGain: 1,
      maxWithoutGain: 3,
    }),
    true,
  );
  assert.equal(
    shouldAutoLoad({
      visibleNow: 5,
      visibleAtLastAutoLoad: 5,
      autoLoadsWithoutGain: 3,
      maxWithoutGain: 3,
    }),
    false,
  );
});

test('viewerPlan keeps thumb and preview groups apart', () => {
  assert.deepEqual(
    viewerPlan({ thumb: 't', thumbFallback: 'tf', preview: 'p', previewFallback: 'pf' }),
    { small: ['t', 'tf'], large: ['p', 'pf'] },
  );
  assert.deepEqual(
    viewerPlan({ thumb: 't', preview: 't', previewFallback: 'pf' }),
    { small: ['t'], large: ['pf'] },
  );
  assert.deepEqual(
    viewerPlan({ thumb: 't', thumbFallback: 't', preview: 'p', previewFallback: 'p' }),
    { small: ['t'], large: ['p'] },
  );
  assert.deepEqual(viewerPlan({ preview: 'p' }), { small: [], large: ['p'] });
  assert.deepEqual(viewerPlan({ thumb: '', thumbFallback: null, preview: 5 }), {
    small: [],
    large: [],
  });
  assert.deepEqual(viewerPlan(null), { small: [], large: [] });
});

test('VIEWER_PROBE_TIMEOUT_MS is 20 s', () => {
  assert.equal(VIEWER_PROBE_TIMEOUT_MS, 20000);
});

test('firstLoaded returns the first URL that loads', async () => {
  const result = await firstLoaded(['a', 'b'], async (url) => url === 'b');
  assert.equal(result, 'b');
});

test('firstLoaded skips a probe that does not answer in time', async () => {
  const signals = new Map();
  const result = await firstLoaded(
    ['a', 'b'],
    (url, signal) => {
      signals.set(url, signal);
      if (url === 'a') return new Promise(() => {});
      return Promise.resolve(true);
    },
    { timeoutMs: 20 },
  );
  assert.equal(result, 'b');
  assert.equal(signals.get('a').aborted, true);
});

test('firstLoaded returns null when all probes fail', async () => {
  assert.equal(await firstLoaded(['a', 'b'], async () => false), null);
});

test('firstLoaded does not probe an empty list', async () => {
  let calls = 0;
  const result = await firstLoaded([], async () => {
    calls += 1;
    return true;
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('firstLoaded stops when the outer signal aborts during a probe', async () => {
  const controller = new AbortController();
  const probed = [];
  let probeSignal = null;
  const promise = firstLoaded(
    ['a', 'b'],
    (url, signal) => {
      probed.push(url);
      probeSignal = signal;
      controller.abort();
      return new Promise(() => {});
    },
    { signal: controller.signal },
  );
  assert.equal(await promise, null);
  assert.deepEqual(probed, ['a']);
  assert.equal(probeSignal.aborted, true);
});

test('firstLoaded does not probe when the outer signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await firstLoaded(
    ['a'],
    async () => {
      calls += 1;
      return true;
    },
    { signal: controller.signal },
  );
  assert.equal(result, null);
  assert.equal(calls, 0);
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
