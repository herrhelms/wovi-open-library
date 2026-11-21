import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attributionText,
  backToTopBottom,
  columnCount,
  countActive,
  DEFAULT_GROUPS,
  distribute,
  downloadUrl,
  estimateCardHeight,
  everythingText,
  filmstripRange,
  filterAdapters,
  firstLoaded,
  groupShortLabel,
  groupSources,
  imageCandidates,
  imagesText,
  imagesTotal,
  isSearchable,
  isUpgrade,
  isUsable,
  itemKey,
  keyStatus,
  licenceMeaning,
  needsAttribution,
  parseSavedSelection,
  pickColumn,
  placeholderTone,
  pullingText,
  rateLimitWaitText,
  rememberLimited,
  retryDelay,
  savedCount,
  isShortcut,
  searchKey,
  searchPlaceholder,
  searchWithoutItem,
  serializeSelection,
  shortcutLabel,
  sortChipIds,
  sourceBarSegments,
  sourceSummary,
  shouldAutoLoad,
  subtitleText,
  thumbCandidates,
  VIEWER_PROBE_TIMEOUT_MS,
  viewerPlan,
  showBackToTop,
  wallLayout,
  withItemParam,
  statusPill,
  adaptorMatchesFilter,
  adaptorFilterCounts,
  sourcesSubline,
  splitNotes,
  linkParts,
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
  assert.equal(estimateCardHeight({ width: 400, height: 200 }, 240), 152);
  assert.equal(estimateCardHeight({ width: '400', height: '200' }, 240), 152);
  assert.equal(estimateCardHeight({}, 240), 272);
  assert.equal(estimateCardHeight({ width: 0, height: 100 }, 240), 272);
  assert.equal(estimateCardHeight(null, 200), 232);
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

test('savedCount returns the length of a saved array', () => {
  assert.equal(savedCount('[1,2,3]'), 3);
  assert.equal(savedCount('[]'), 0);
});

test('savedCount gives 0 for missing or empty input', () => {
  assert.equal(savedCount(null), 0);
  assert.equal(savedCount(undefined), 0);
  assert.equal(savedCount(''), 0);
});

test('savedCount gives 0 for invalid or non-array JSON', () => {
  assert.equal(savedCount('not json'), 0);
  assert.equal(savedCount('{"a":1}'), 0);
  assert.equal(savedCount('"text"'), 0);
  assert.equal(savedCount('42'), 0);
});

test('shortcutLabel uses the command key on Apple platforms', () => {
  assert.equal(shortcutLabel('MacIntel'), '⌘K');
  assert.equal(shortcutLabel('macOS'), '⌘K');
  assert.equal(shortcutLabel('iPhone'), '⌘K');
  assert.equal(shortcutLabel('iPad'), '⌘K');
});

test('shortcutLabel uses Ctrl K elsewhere', () => {
  assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  assert.equal(shortcutLabel('Linux x86_64'), 'Ctrl K');
  assert.equal(shortcutLabel(''), 'Ctrl K');
  assert.equal(shortcutLabel(undefined), 'Ctrl K');
});

test('isShortcut accepts meta or ctrl with k', () => {
  assert.equal(
    isShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: false }),
    true,
  );
  assert.equal(
    isShortcut({ key: 'K', metaKey: false, ctrlKey: true, altKey: false }),
    true,
  );
});

test('isShortcut rejects other combinations', () => {
  assert.equal(
    isShortcut({ key: 'k', metaKey: true, ctrlKey: true, altKey: false }),
    false,
  );
  assert.equal(
    isShortcut({ key: 'k', metaKey: false, ctrlKey: false, altKey: false }),
    false,
  );
  assert.equal(
    isShortcut({ key: 'k', metaKey: true, ctrlKey: false, altKey: true }),
    false,
  );
  assert.equal(
    isShortcut({ key: 'j', metaKey: true, ctrlKey: false, altKey: false }),
    false,
  );
});

test('isShortcut handles a missing event', () => {
  assert.equal(isShortcut(null), false);
  assert.equal(isShortcut(undefined), false);
});

test('searchPlaceholder names the number of usable sources', () => {
  assert.equal(
    searchPlaceholder(42),
    'Search 42 open libraries — prints, maps, specimens, stars…',
  );
  assert.equal(
    searchPlaceholder(1234),
    'Search 1,234 open libraries — prints, maps, specimens, stars…',
  );
});

test('searchPlaceholder falls back for counts that are not positive numbers', () => {
  const generic = 'Search open libraries — prints, maps, specimens, stars…';
  assert.equal(searchPlaceholder(0), generic);
  assert.equal(searchPlaceholder(-3), generic);
  assert.equal(searchPlaceholder(NaN), generic);
  assert.equal(searchPlaceholder(undefined), generic);
});

test('sourceSummary names the top sources with results', () => {
  assert.equal(sourceSummary([]), 'No sources selected');
  assert.equal(sourceSummary(null), 'No sources selected');
  assert.equal(
    sourceSummary([
      { name: 'A', hits: null },
      { name: 'B', hits: 0 },
    ]),
    '',
  );
  assert.equal(
    sourceSummary([
      { name: 'A', hits: 5 },
      { name: 'B', hits: 50 },
      { name: 'C', hits: 0 },
    ]),
    'B, A',
  );
  assert.equal(
    sourceSummary([
      { name: 'A', hits: 1 },
      { name: 'B', hits: 4 },
      { name: 'C', hits: 3 },
      { name: 'D', hits: 2 },
      { name: 'E', hits: 9 },
    ]),
    'E, B, C + 2 more with results',
  );
  assert.equal(
    sourceSummary([
      { name: 'A', hits: 3 },
      { name: 'B', hits: 3 },
      { name: 'C', hits: 3 },
    ]),
    'A, B, C',
  );
});

test('sortChipIds puts counted ids first and keeps the rest in input order', () => {
  assert.deepEqual(
    sortChipIds(['a', 'b', 'c', 'd'], new Map([['a', 2], ['b', null], ['c', 10]])),
    ['c', 'a', 'b', 'd'],
  );
  assert.deepEqual(sortChipIds(['a', 'b'], { a: 1, b: 1 }), ['a', 'b']);
  assert.deepEqual(sortChipIds([], new Map()), []);

  const ids = ['a', 'b', 'c'];
  sortChipIds(ids, new Map([['c', 4]]));
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('groupShortLabel uses the short group labels', () => {
  assert.equal(groupShortLabel('museums', 'Museums and galleries'), 'Museums & galleries');
  assert.equal(groupShortLabel('aggregators', 'Open-licence aggregators'), 'Aggregators');
  assert.equal(groupShortLabel('libraries', 'Libraries and archives'), 'Libraries & archives');
  assert.equal(groupShortLabel('science', 'Science, nature and medicine'), 'Science & nature');
  assert.equal(groupShortLabel('other', 'Other'), 'Other');
});

test('imagesTotal sums the known totals and never drops below the shown count', () => {
  assert.equal(imagesTotal([10, 20], 5), 30);
  assert.equal(imagesTotal([10, null], 5), 10);
  assert.equal(imagesTotal([null, null], 7), 7);
  assert.equal(imagesTotal([3], 12), 12);
  assert.equal(imagesTotal([], 0), 0);
  assert.equal(imagesTotal([10, undefined, -4, Infinity], 2), 10);
  assert.equal(imagesTotal([5], 0), 5);
  assert.equal(imagesTotal([5], null), 5);
});

test('imagesText formats the image count', () => {
  assert.equal(imagesText(1), '1 image');
  assert.equal(imagesText(0), '0 images');
  assert.equal(imagesText(1234), '1,234 images');
  assert.equal(imagesText(2), '2 images');
});

test('sourceBarSegments builds the bar segments', () => {
  assert.deepEqual(sourceBarSegments([]), []);
  assert.deepEqual(
    sourceBarSegments([
      { name: 'A', hits: 0 },
      { name: 'B', hits: null },
    ]),
    [],
  );
  assert.deepEqual(
    sourceBarSegments([
      { name: 'A', hits: 30 },
      { name: 'B', hits: 10 },
    ]),
    [
      { name: 'A', hits: 30, share: 0.75, tone: 'first' },
      { name: 'B', hits: 10, share: 0.25, tone: 'second' },
    ],
  );
  assert.deepEqual(
    sourceBarSegments([
      { name: 'A', hits: 10 },
      { name: 'B', hits: 50 },
      { name: 'C', hits: 20 },
      { name: 'D', hits: 20 },
    ]),
    [
      { name: 'B', hits: 50, share: 0.5, tone: 'first' },
      { name: 'C', hits: 20, share: 0.2, tone: 'second' },
      { name: '2 other sources', hits: 30, share: 0.3, tone: 'rest' },
    ],
  );
  assert.deepEqual(
    sourceBarSegments([
      { name: 'A', hits: 5 },
      { name: 'B', hits: 3 },
      { name: 'C', hits: 2 },
    ]),
    [
      { name: 'A', hits: 5, share: 0.5, tone: 'first' },
      { name: 'B', hits: 3, share: 0.3, tone: 'second' },
      { name: '1 other source', hits: 2, share: 0.2, tone: 'rest' },
    ],
  );
});

test('pullingText', () => {
  assert.equal(pullingText([]), '');
  assert.equal(pullingText(['A']), 'Pulling more from A');
  assert.equal(pullingText(['A', 'B']), 'Pulling more from A and B');
  assert.equal(pullingText(['A', 'B', 'C']), 'Pulling more from A, B and 1 other');
  assert.equal(
    pullingText(['A', 'B', 'C', 'D', 'E']),
    'Pulling more from A, B and 3 others',
  );
});

test('everythingText', () => {
  assert.equal(everythingText(1), 'That’s everything from 1 source.');
  assert.equal(everythingText(12), 'That’s everything from 12 sources.');
  assert.equal(everythingText(1200), 'That’s everything from 1,200 sources.');
});

test('wallLayout', () => {
  assert.deepEqual(wallLayout(1440), { minColumn: 250, gap: 20, maxColumns: Infinity });
  assert.deepEqual(wallLayout(601), { minColumn: 250, gap: 20, maxColumns: Infinity });
  assert.deepEqual(wallLayout(600), { minColumn: 160, gap: 12, maxColumns: Infinity });
  assert.deepEqual(wallLayout(390), { minColumn: 160, gap: 12, maxColumns: Infinity });
  assert.deepEqual(wallLayout(380), { minColumn: 160, gap: 12, maxColumns: 1 });
  assert.deepEqual(wallLayout(NaN), { minColumn: 250, gap: 20, maxColumns: Infinity });
});

test('placeholderTone', () => {
  assert.equal(placeholderTone(0), 1);
  assert.equal(placeholderTone(9), 10);
  assert.equal(placeholderTone(10), 1);
  assert.equal(placeholderTone(-1), 1);
});

test('showBackToTop', () => {
  assert.equal(showBackToTop(0), false);
  assert.equal(showBackToTop(600), false);
  assert.equal(showBackToTop(601), true);
  assert.equal(showBackToTop(NaN), false);
  assert.equal(showBackToTop(undefined), false);
});

test('backToTopBottom', () => {
  assert.equal(backToTopBottom(0, 0), 28);
  assert.equal(backToTopBottom(64, 24), 100);
  assert.equal(backToTopBottom(64, NaN), 76);
  assert.equal(backToTopBottom(0, 24, 16), 16);
  assert.equal(backToTopBottom(-5, 24), 28);
});

test('licenceMeaning reads the licence text and the URL', () => {
  assert.equal(licenceMeaning('Public Domain Mark 1.0', '', true), 'no restrictions');
  assert.equal(licenceMeaning('CC0 1.0', '', true), 'no restrictions');
  assert.equal(
    licenceMeaning('', 'https://creativecommons.org/publicdomain/zero/1.0/', true),
    'no restrictions',
  );
  assert.equal(licenceMeaning('No known copyright restrictions', '', true), 'no restrictions');
  assert.equal(licenceMeaning('CC BY 4.0', '', true), 'credit required');
  assert.equal(
    licenceMeaning('', 'https://creativecommons.org/licenses/by/4.0/', true),
    'credit required',
  );
  assert.equal(licenceMeaning('CC-BY-SA', '', true), 'credit & share alike');
  assert.equal(
    licenceMeaning('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', true),
    'credit & share alike',
  );
  assert.equal(licenceMeaning('cc by-nc 3.0', '', false), 'credit, non-commercial');
  assert.equal(licenceMeaning('CC BY-NC-SA 4.0', '', false), 'credit, non-commercial');
  assert.equal(licenceMeaning('CC BY-ND 4.0', '', false), 'credit, no changes');
  assert.equal(licenceMeaning('Standby license', '', false), 'check with source');
  assert.equal(licenceMeaning('', '', false), 'check with source');
});

test('needsAttribution is true only for the BY family', () => {
  assert.equal(needsAttribution('CC BY 4.0', ''), true);
  assert.equal(needsAttribution('CC BY-NC-ND 4.0', ''), true);
  assert.equal(
    needsAttribution('', 'https://creativecommons.org/licenses/by-sa/4.0/'),
    true,
  );
  assert.equal(needsAttribution('CC0 1.0', ''), false);
  assert.equal(needsAttribution('Public Domain', ''), false);
  assert.equal(needsAttribution('', ''), false);
  assert.equal(needsAttribution('Standby', ''), false);
});

test('attributionText builds the credit line', () => {
  assert.equal(
    attributionText({ title: ' Moon ', creator: 'NASA', source: 'NASA Images', license: 'CC BY 4.0' }),
    '\u201cMoon\u201d, NASA, via NASA Images, CC BY 4.0',
  );
  assert.equal(
    attributionText({ title: '', creator: '', source: 'Met', license: 'CC BY 4.0' }),
    '\u201cUntitled\u201d, via Met, CC BY 4.0',
  );
});

test('filmstripRange clamps the window around the current item', () => {
  assert.deepEqual(filmstripRange(0, 20), { start: 0, end: 5 });
  assert.deepEqual(filmstripRange(10, 20), { start: 6, end: 15 });
  assert.deepEqual(filmstripRange(19, 20), { start: 15, end: 20 });
  assert.deepEqual(filmstripRange(1, 3), { start: 0, end: 3 });
  assert.deepEqual(filmstripRange(2, 10, 1), { start: 1, end: 4 });
  assert.deepEqual(filmstripRange(-1, 10), { start: 0, end: 0 });
  assert.deepEqual(filmstripRange(10, 10), { start: 0, end: 0 });
  assert.deepEqual(filmstripRange(NaN, 10), { start: 0, end: 0 });
  assert.deepEqual(filmstripRange(0, 0), { start: 0, end: 0 });
});

test('withItemParam sets and removes the i parameter', () => {
  assert.equal(withItemParam('?q=cat', 'met:42'), '?q=cat&i=met%3A42');
  assert.equal(withItemParam('?i=old&q=cat', 'new'), '?i=new&q=cat');
  assert.equal(withItemParam('q=cat&open=1', 'x'), '?q=cat&open=1&i=x');
  assert.equal(withItemParam('?q=cat&i=x', ''), '?q=cat');
  assert.equal(withItemParam('?i=x', null), '');
  assert.equal(withItemParam('', ''), '');
});

test('searchWithoutItem drops the i parameter', () => {
  assert.equal(searchWithoutItem('?q=cat&i=x&open=1'), '?q=cat&open=1');
  assert.equal(searchWithoutItem(''), '');
});

const freeAdapter = { enabled: true, key: null };
const setAdapter = { enabled: true, key: { required: true, configured: true } };
const missingAdapter = { enabled: true, key: { required: true, configured: false } };
const optionalAdapter = { enabled: false, key: { required: false, configured: false, default: 'DEMO' } };
const offFreeAdapter = { enabled: false, key: null };

test('statusPill maps the key status to a short pill', () => {
  assert.deepEqual(statusPill(freeAdapter), { kind: 'free', text: 'No key needed' });
  assert.deepEqual(statusPill(setAdapter), { kind: 'set', text: 'Key set' });
  assert.deepEqual(statusPill(missingAdapter), { kind: 'missing', text: 'Key missing' });
  assert.deepEqual(statusPill(optionalAdapter), { kind: 'optional', text: 'Key optional' });
  assert.deepEqual(statusPill(null), { kind: 'free', text: 'No key needed' });
});

test('adaptorMatchesFilter ready needs an on adaptor without a missing key', () => {
  assert.equal(adaptorMatchesFilter(freeAdapter, 'ready'), true);
  assert.equal(adaptorMatchesFilter(setAdapter, 'ready'), true);
  assert.equal(adaptorMatchesFilter(missingAdapter, 'ready'), false);
  assert.equal(adaptorMatchesFilter(optionalAdapter, 'ready'), false);
  assert.equal(adaptorMatchesFilter(null, 'ready'), false);
});

test('adaptorMatchesFilter key shows missing keys only', () => {
  assert.equal(adaptorMatchesFilter(missingAdapter, 'key'), true);
  assert.equal(adaptorMatchesFilter(optionalAdapter, 'key'), false);
  assert.equal(adaptorMatchesFilter(null, 'key'), false);
});

test('adaptorMatchesFilter off shows disabled adaptors', () => {
  assert.equal(adaptorMatchesFilter(offFreeAdapter, 'off'), true);
  assert.equal(adaptorMatchesFilter(freeAdapter, 'off'), false);
  assert.equal(adaptorMatchesFilter(null, 'off'), true);
});

test('adaptorMatchesFilter all matches everything', () => {
  assert.equal(adaptorMatchesFilter(freeAdapter, 'all'), true);
  assert.equal(adaptorMatchesFilter(freeAdapter, 'bogus'), true);
  assert.equal(adaptorMatchesFilter(null, 'all'), true);
});

test('adaptorFilterCounts counts each filter', () => {
  assert.deepEqual(
    adaptorFilterCounts([freeAdapter, setAdapter, missingAdapter, optionalAdapter, offFreeAdapter]),
    { all: 5, ready: 2, key: 1, off: 2 },
  );
  assert.deepEqual(adaptorFilterCounts(null), { all: 0, ready: 0, key: 0, off: 0 });
  assert.deepEqual(adaptorFilterCounts([null, 3, freeAdapter]), {
    all: 1,
    ready: 1,
    key: 0,
    off: 0,
  });
});

test('sourcesSubline counts on and missing keys', () => {
  assert.equal(
    sourcesSubline([freeAdapter, setAdapter, missingAdapter, optionalAdapter, offFreeAdapter]),
    '3 of 5 adaptors on · 1 needs a key',
  );
  assert.equal(
    sourcesSubline([freeAdapter, missingAdapter, missingAdapter]),
    '3 of 3 adaptors on · 2 need a key',
  );
  assert.equal(sourcesSubline([freeAdapter, offFreeAdapter]), '1 of 2 adaptors on');
  assert.equal(sourcesSubline(null), '0 of 0 adaptors on');
});

test('sourcesSubline groups big numbers', () => {
  const list = Array.from({ length: 1200 }, () => freeAdapter);
  assert.equal(sourcesSubline(list), '1,200 of 1,200 adaptors on');
});

test('splitNotes pulls out the untested note', () => {
  assert.deepEqual(splitNotes(['Not yet tested live.', ' Uses IIIF. ', '', 3]), {
    untested: true,
    notes: ['Uses IIIF.'],
  });
  assert.deepEqual(splitNotes(['A']), { untested: false, notes: ['A'] });
  assert.deepEqual(splitNotes(undefined), { untested: false, notes: [] });
});

test('linkParts splits text and links', () => {
  assert.deepEqual(linkParts('Sign up at https://example.org/key.'), [
    { text: 'Sign up at ' },
    { text: 'https://example.org/key', href: 'https://example.org/key' },
    { text: '.' },
  ]);
  assert.deepEqual(linkParts('(see http://a.b/c), then go'), [
    { text: '(see ' },
    { text: 'http://a.b/c', href: 'http://a.b/c' },
    { text: '), then go' },
  ]);
  assert.deepEqual(linkParts('no link'), [{ text: 'no link' }]);
  assert.deepEqual(linkParts(''), []);
  assert.deepEqual(linkParts(null), []);
  assert.deepEqual(linkParts('https://x.org'), [
    { text: 'https://x.org', href: 'https://x.org' },
  ]);
});
