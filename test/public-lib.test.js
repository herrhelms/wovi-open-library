import test from 'node:test';
import assert from 'node:assert/strict';

import {
  columnCount,
  countActive,
  DEFAULT_GROUPS,
  distribute,
  downloadUrl,
  estimateCardHeight,
  filterAdapters,
  firstLoaded,
  groupSources,
  imageCandidates,
  isSearchable,
  isUpgrade,
  isUsable,
  itemKey,
  keyStatus,
  parseSavedSelection,
  pickColumn,
  rateLimitWaitText,
  rememberLimited,
  retryDelay,
  searchKey,
  serializeSelection,
  shouldAutoLoad,
  subtitleText,
  thumbCandidates,
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
  assert.deepEqual(viewerPlan(undefined), { small: [], large: [] });
});

test('viewerPlan keeps a partner fallback that equals the thumb fallback', () => {
  assert.deepEqual(
    viewerPlan({ thumb: 'd', thumbFallback: 'o', preview: 'd', previewFallback: 'o' }),
    { small: ['d', 'o'], large: ['o'] },
  );
  assert.deepEqual(
    viewerPlan({ thumbFallback: 'o', preview: 'o' }),
    { small: ['o'], large: ['o'] },
  );
});

test('isUpgrade accepts only a positive, finite, larger candidate', () => {
  assert.equal(isUpgrade(0, 0), false);
  assert.equal(isUpgrade(0, 400), true);
  assert.equal(isUpgrade(400, 400), false);
  assert.equal(isUpgrade(400, 1536), true);
  assert.equal(isUpgrade(1536, 88), false);
  assert.equal(isUpgrade(400, NaN), false);
  assert.equal(isUpgrade(400, Infinity), false);
  assert.equal(isUpgrade(undefined, 400), true);
  assert.equal(isUpgrade(400, null), false);
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

test('columnCount counts columns for a window width', () => {
  assert.equal(columnCount(1000, 240, 24), 3);
  assert.equal(columnCount(504, 240, 24), 2);
  assert.equal(columnCount(503, 240, 24), 1);
  assert.equal(columnCount(240), 1);
  assert.equal(columnCount(0, 240, 24), 1);
  assert.equal(columnCount(NaN), 1);
  assert.equal(columnCount(1000), 4);
  assert.equal(columnCount(1000, 240, -5), 4);
});

test('pickColumn gives the first smallest index', () => {
  assert.equal(pickColumn([10, 5, 5]), 1);
  assert.equal(pickColumn([0, 0]), 0);
  assert.equal(pickColumn([]), 0);
  assert.equal(pickColumn(null), 0);
});

test('estimateCardHeight uses the image ratio and adds card text', () => {
  assert.equal(estimateCardHeight({ width: 400, height: 200 }, 240), 192);
  assert.equal(estimateCardHeight({ width: '400', height: '200' }, 240), 192);
  assert.equal(estimateCardHeight({}, 240), 312);
  assert.equal(estimateCardHeight({ width: 0, height: 100 }, 240), 312);
  assert.equal(estimateCardHeight(null, 200), 272);
});

test('distribute fills the shortest column', () => {
  assert.deepEqual(distribute([100, 50, 30, 40], 2), [0, 1, 1, 1]);
  assert.deepEqual(distribute([100, 50, 30, 40], 2, 30), [0, 1, 1, 0]);
  assert.deepEqual(distribute([], 3), []);
  assert.deepEqual(distribute([10, 10, 10], 1), [0, 0, 0]);
  assert.deepEqual(distribute([10, 10, 10], 0), [0, 0, 0]);
  assert.deepEqual(distribute([5, 5, 5], 3), [0, 1, 2]);
});

test('thumbCandidates keeps non-empty URLs in order', () => {
  assert.deepEqual(
    thumbCandidates({ thumb: '/api/thumb/m1', thumbSource: 's', thumbFallback: 'f' }),
    ['/api/thumb/m1', 's', 'f'],
  );
  assert.deepEqual(thumbCandidates({ thumb: 's', thumbSource: 's', thumbFallback: '' }), [
    's',
  ]);
  assert.deepEqual(thumbCandidates({ thumb: 't', thumbFallback: 'f' }), ['t', 'f']);
  assert.deepEqual(thumbCandidates(null), []);
});

test('itemKey prefers uid and falls back to source:id', () => {
  assert.equal(itemKey({ uid: 'a:1', source: 'b', id: '2' }), 'a:1');
  assert.equal(itemKey({ uid: '', source: 'b', id: '2' }), 'b:2');
  assert.equal(itemKey({ source: 'b', id: 2 }), 'b:2');
});

test('viewerPlan uses the thumb candidates and drops thumb URLs', () => {
  assert.deepEqual(
    viewerPlan({ thumb: '/api/thumb/m1', thumbSource: 's', preview: 's', previewFallback: 'p' }),
    { small: ['/api/thumb/m1', 's'], large: ['p'] },
  );
  assert.deepEqual(
    viewerPlan({
      thumb: '/api/thumb/m1',
      thumbSource: 's',
      thumbFallback: 'f',
      preview: 'f',
    }),
    { small: ['/api/thumb/m1', 's', 'f'], large: ['f'] },
  );
  assert.deepEqual(viewerPlan({ thumb: 't', thumbSource: 't', preview: 'p' }), {
    small: ['t'],
    large: ['p'],
  });
});

test('searchKey includes the open filter and the exact query', () => {
  assert.equal(searchKey(true, 'moon'), '1|moon');
  assert.equal(searchKey(false, 'Moon Base'), '0|Moon Base');
});

test('rememberLimited drops the oldest keys', () => {
  const map = new Map();
  rememberLimited(map, 'a', 1, 2);
  rememberLimited(map, 'b', 2, 2);
  rememberLimited(map, 'c', 3, 2);
  assert.deepEqual([...map.keys()], ['b', 'c']);
});

test('rememberLimited makes an existing key the newest', () => {
  const map = new Map();
  rememberLimited(map, 'a', 1, 2);
  rememberLimited(map, 'b', 2, 2);
  rememberLimited(map, 'a', 3, 2);
  rememberLimited(map, 'c', 4, 2);
  assert.deepEqual([...map.keys()], ['a', 'c']);
  assert.equal(map.get('a'), 3);
});

test('rememberLimited returns nothing and uses the default max', () => {
  const map = new Map();
  const before = new Map([['x', 0]]);
  assert.equal(rememberLimited(map, 'a', 1), undefined);
  for (let index = 0; index < 20; index += 1) {
    rememberLimited(map, `k${index}`, index);
  }
  assert.equal(map.size, 10);
  assert.deepEqual([...before.keys()], ['x']);
});

test('keyStatus reports an adaptor without a key', () => {
  assert.deepEqual(keyStatus({ key: null }), { kind: 'none', text: 'No key needed' });
  assert.deepEqual(keyStatus({}), { kind: 'none', text: 'No key needed' });
});

test('keyStatus reports a configured key as set', () => {
  assert.deepEqual(
    keyStatus({ key: { env: 'A', required: true, configured: true } }),
    { kind: 'set', text: 'Key set' },
  );
  assert.equal(
    keyStatus({ key: { env: 'A', required: false, configured: true, default: 'DEMO_KEY' } })
      .kind,
    'set',
  );
});

test('keyStatus reports a missing required key', () => {
  assert.deepEqual(
    keyStatus({ key: { env: 'A', required: true, configured: false } }),
    { kind: 'missing', text: 'Key required, not set' },
  );
});

test('keyStatus reports an optional key without a demo key', () => {
  assert.deepEqual(
    keyStatus({ key: { env: 'A', required: false, configured: false, default: null } }),
    { kind: 'optional', text: 'Optional key not set' },
  );
});

test('keyStatus names the demo key for an optional key', () => {
  assert.deepEqual(
    keyStatus({
      key: { env: 'A', required: false, configured: false, default: 'DEMO_KEY' },
    }),
    { kind: 'optional', text: 'Optional key not set, uses demo key' },
  );
});

test('filterAdapters returns a copy for an empty text', () => {
  const list = [
    { id: 'dpla', name: 'DPLA', description: 'Digital Public Library of America' },
    { id: 'esa-hubble', name: 'Hubble', description: 'Art Museum collection' },
    { id: 'nasa', name: 'NASA', description: null },
  ];
  const all = filterAdapters(list, '');
  assert.deepEqual(all, list);
  assert.notEqual(all, list);
  assert.deepEqual(filterAdapters(list, '  '), list);
  assert.deepEqual(
    filterAdapters(list, 'DPLA').map((entry) => entry.name),
    ['DPLA'],
  );
  assert.deepEqual(
    filterAdapters(list, 'esa-').map((entry) => entry.id),
    ['esa-hubble'],
  );
  assert.deepEqual(
    filterAdapters(list, 'museum').map((entry) => entry.id),
    ['esa-hubble'],
  );
  assert.deepEqual(filterAdapters(list, 'zzz'), []);
});

test('filterAdapters rejects a value that is not an array', () => {
  assert.deepEqual(filterAdapters(null, 'x'), []);
  assert.deepEqual(filterAdapters(undefined, ''), []);
});

test('countActive counts enabled adaptors', () => {
  assert.equal(countActive([{ enabled: true }, { enabled: false }, { enabled: true }]), 2);
  assert.equal(countActive([]), 0);
  assert.equal(countActive(undefined), 0);
  assert.equal(countActive([{}, { enabled: 'true' }]), 0);
});

test('retryDelay computes the rate limit delay', () => {
  assert.equal(retryDelay('RATE_LIMIT', 12, 0, 0), 15000);
  assert.equal(retryDelay('RATE_LIMIT', 20, 0, 0), 20000);
  assert.equal(retryDelay('RATE_LIMIT', 20, 1, 0.5), 21500);
  assert.equal(retryDelay('RATE_LIMIT', null, 2, 0.999), 17997);
  assert.equal(retryDelay('RATE_LIMIT', 5, 3, 0), null);
});

test('retryDelay keeps the PREPARING behaviour', () => {
  assert.equal(retryDelay('PREPARING', undefined, 0, 0.7), 15000);
  assert.equal(retryDelay('PREPARING', undefined, 20, 0), null);
});

test('retryDelay gives null for other codes', () => {
  assert.equal(retryDelay('HTTP', 10, 0, 0), null);
  assert.equal(retryDelay(null, null, 0, 0), null);
});

test('rateLimitWaitText names Wikimedia Commons', () => {
  assert.equal(
    rateLimitWaitText(
      'Wikimedia Commons rate limit reached. Try again in a minute.',
      17,
    ),
    'Wikimedia Commons rate limit reached. Trying again in 17 s.',
  );
});

test('rateLimitWaitText is generic for other adaptors', () => {
  assert.equal(
    rateLimitWaitText('Pixabay rate limit reached.', 15),
    'Rate limit reached. Trying again in 15 s.',
  );
  assert.equal(
    rateLimitWaitText(null, 15),
    'Rate limit reached. Trying again in 15 s.',
  );
});
