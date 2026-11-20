import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  IIIF_PREFIX,
  SITE,
  LICENSE,
  LICENSE_URL,
  parseResourceId,
  splitTitle,
  iiifCandidates,
  normalize,
  applyIiif,
  parseSetList,
  parseSet,
  buildIndex,
  searchIndex,
} from '../lib/bases/loc-free.js';

const P = IIIF_PREFIX;

function readFixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}

const setListFixture = readFixture('loc-free-to-use.json');
const setFixture = readFixture('loc-set-lighthouses.json');

test('parseResourceId', () => {
  assert.equal(parseResourceId('/resource/highsm.12127/'), 'highsm.12127');
  assert.equal(parseResourceId('/resource/hhh.nc0497.photos/?sp=24'), 'hhh.nc0497.photos~sp=24');
  assert.equal(parseResourceId('/resource/g3721p.fi000169cr/'), 'g3721p.fi000169cr');
  assert.equal(parseResourceId('/resource/ihas.100005404.0/?sp=1'), 'ihas.100005404.0~sp=1');
  assert.equal(parseResourceId('https://www.loc.gov/resource/cph.3c36378/'), 'cph.3c36378');
  assert.equal(parseResourceId('/resource/x.1/?st=gallery'), 'x.1');
  assert.equal(parseResourceId('/item/2010630000/'), null);
  assert.equal(parseResourceId(''), null);
  assert.equal(parseResourceId(null), null);
  assert.equal(parseResourceId(42), null);
});

test('splitTitle', () => {
  assert.deepEqual(splitTitle('Map of Virginia inclusive, 1848. Geography & Map Division\n'), {
    title: 'Map of Virginia inclusive, 1848',
    creator: 'Geography & Map Division',
  });
  assert.deepEqual(splitTitle('"Song of the Sea," Sheet music cover, 1886. Music Division\n'), {
    title: '"Song of the Sea," Sheet music cover, 1886',
    creator: 'Music Division',
  });
  assert.deepEqual(splitTitle('Heceta Head Lighthouse, Pacific Ocean, Oregon'), {
    title: 'Heceta Head Lighthouse, Pacific Ocean, Oregon',
    creator: null,
  });
  assert.deepEqual(splitTitle('Mr. Smith at the lamp'), {
    title: 'Mr. Smith at the lamp',
    creator: null,
  });
  assert.deepEqual(splitTitle('Middle Bay Light,  Mobile Bay, Alabama'), {
    title: 'Middle Bay Light, Mobile Bay, Alabama',
    creator: null,
  });
  assert.deepEqual(splitTitle(''), { title: 'Untitled', creator: null });
  assert.deepEqual(splitTitle(null), { title: 'Untitled', creator: null });
});

test('iiifCandidates five digit ids', () => {
  assert.deepEqual(iiifCandidates('highsm.12127'), [
    `${P}highsm:12100:12127`,
    `${P}highsm:12100:12127v`,
  ]);
  assert.deepEqual(iiifCandidates('highsm.44760'), [
    `${P}highsm:44700:44760`,
    `${P}highsm:44700:44760v`,
  ]);
  assert.deepEqual(iiifCandidates('ppmsca.09037'), [
    `${P}ppmsca:09000:09037`,
    `${P}ppmsca:09000:09037v`,
  ]);
  assert.deepEqual(iiifCandidates('mrg.10350'), [
    `${P}mrg:10300:10350`,
    `${P}mrg:10300:10350v`,
  ]);
});

test('iiifCandidates prefixed ids', () => {
  assert.deepEqual(iiifCandidates('cph.3c36378'), [
    `${P}cph:3c30000:3c36000:3c36300:3c36378`,
    `${P}cph:3c30000:3c36000:3c36300:3c36378v`,
  ]);
  assert.deepEqual(iiifCandidates('det.4a24366'), [
    `${P}det:4a20000:4a24000:4a24300:4a24366`,
    `${P}det:4a20000:4a24000:4a24300:4a24366v`,
  ]);
});

test('iiifCandidates unsupported ids', () => {
  for (const value of [
    'hhh.nc0497.photos~sp=24',
    'g3721p.fi000169cr',
    'ihas.100005404.0~sp=1',
    'highsm.1212',
    'highsm.121270',
    'HIGHSM.12127',
    '',
    null,
  ]) {
    assert.deepEqual(iiifCandidates(value), [], String(value));
  }
});

test('parseSetList fixture', () => {
  const sets = parseSetList(setListFixture);
  assert.equal(sets.length, 2);
  assert.deepEqual(
    sets.find((set) => set.title === 'Lighthouses'),
    { title: 'Lighthouses', url: 'https://www.loc.gov/free-to-use/lighthouses/' },
  );
});

test('parseSetList filters bad urls and cleans titles', () => {
  const json = {
    content: {
      components: [
        {
          results: [
            {
              title: "Women's History\n",
              url: 'https://www.loc.gov/free-to-use/womens-history/',
            },
            {
              title: 'Evil',
              url: 'https://evil.example.com/free-to-use/x/',
            },
          ],
        },
      ],
    },
  };
  const sets = parseSetList(json);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0], {
    title: "Women's History",
    url: 'https://www.loc.gov/free-to-use/womens-history/',
  });
});

test('parseSetList missing content', () => {
  assert.deepEqual(parseSetList({}), []);
  assert.deepEqual(parseSetList(null), []);
});

test('parseSet fixture', () => {
  const set = parseSet(setFixture);
  assert.equal(set.title, 'Lighthouses');
  assert.equal(set.items.length, 9);
});

test('parseSet missing parts', () => {
  assert.deepEqual(parseSet({}), { title: null, items: [] });
  assert.deepEqual(parseSet(null), { title: null, items: [] });
});

const fixtureItems = setFixture.content.components[0].masonry_gallery[0].items;
const byLink = new Map(fixtureItems.map((item) => [item.link, item]));

test('normalize highsm item', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  const item = normalize(raw, ['Lighthouses']);

  assert.equal(item.source, 'loc');
  assert.equal(item.id, 'highsm.12127');
  assert.equal(item.title, 'Heceta Head Lighthouse, Pacific Ocean, Oregon');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.ok(item.description !== null);
  assert.ok(item.description.length <= 600);
  assert.equal(
    item.thumb,
    'https://www.loc.gov/static/portals/free-to-use/public-domain/lighthouses/lighthouses-1.jpg',
  );
  assert.equal(item.full, item.thumb);
  assert.equal(item.preview, item.thumb);
  assert.equal(item.pageUrl, 'https://www.loc.gov/resource/highsm.12127/');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, LICENSE);
  assert.equal(item.licenseUrl, LICENSE_URL);
  assert.deepEqual(item.sets, ['Lighthouses']);
});

test('normalize map item splits the division', () => {
  const raw = byLink.get('/resource/g3721p.fi000169cr/');
  const item = normalize(raw, ['Lighthouses']);
  assert.equal(item.creator, 'Geography & Map Division');
  assert.ok(!item.title.includes('Division'));
});

test('normalize keeps the query in the page url', () => {
  const raw = byLink.get('/resource/hhh.nc0497.photos/?sp=24');
  const item = normalize(raw, ['Lighthouses']);
  assert.equal(item.id, 'hhh.nc0497.photos~sp=24');
  assert.equal(
    item.pageUrl,
    'https://www.loc.gov/resource/hhh.nc0497.photos/?sp=24',
  );
});

test('normalize rejects bad items', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  assert.equal(normalize({ ...raw, image: undefined }, ['Lighthouses']), null);
  assert.equal(normalize({ ...raw, image: '' }, ['Lighthouses']), null);
  assert.equal(normalize({ ...raw, image: 'relative.jpg' }, ['Lighthouses']), null);
  assert.equal(normalize({ ...raw, link: '/item/1/' }, ['Lighthouses']), null);
  assert.equal(normalize(null), null);
});

test('normalize does not change its inputs', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  const snapshot = { ...raw };
  const setTitles = ['Lighthouses'];
  const item = normalize(raw, setTitles);

  assert.deepEqual(raw, snapshot);
  assert.deepEqual(setTitles, ['Lighthouses']);
  assert.notEqual(item.sets, setTitles);
});

test('applyIiif with a large image', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  const item = normalize(raw, ['Lighthouses']);
  const base = `${P}highsm:12100:12127`;

  const updated = applyIiif(item, { base, width: 3500, height: 4225 });

  assert.equal(updated.full, `${base}/full/full/0/default.jpg`);
  assert.equal(updated.preview, `${base}/full/1600,/0/default.jpg`);
  assert.equal(updated.width, 3500);
  assert.equal(updated.height, 4225);
  assert.equal(updated.thumb, item.thumb);
  assert.equal(item.full, item.thumb);
  assert.equal(item.width, null);
});

test('applyIiif with a small image', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  const item = normalize(raw, ['Lighthouses']);
  const base = `${P}highsm:12100:12127`;

  const updated = applyIiif(item, { base, width: 828, height: 1000 });

  assert.equal(updated.full, `${base}/full/full/0/default.jpg`);
  assert.equal(updated.preview, updated.full);
  assert.equal(updated.width, 828);
  assert.equal(updated.height, 1000);
});

test('applyIiif without info copies the item', () => {
  const raw = byLink.get('/resource/highsm.12127/');
  const item = normalize(raw, ['Lighthouses']);

  const copied = applyIiif(item, null);
  assert.deepEqual(copied, item);
  assert.notEqual(copied, item);

  const noBase = applyIiif(item, { width: 100, height: 100 });
  assert.deepEqual(noBase, item);
  assert.notEqual(noBase, item);
});

function lighthouseSets() {
  return [{ title: 'Lighthouses', items: fixtureItems }];
}

test('buildIndex adds a second set title', () => {
  const first = byLink.get('/resource/highsm.12127/');
  const sets = [
    ...lighthouseSets(),
    {
      title: 'Bridges',
      items: [
        { ...first },
        {
          title: 'Brooklyn Bridge, New York',
          alt: 'A photo of a bridge.',
          image: '/static/portals/free-to-use/public-domain/bridges/bridges-1.jpg',
          link: '/resource/highsm.99999/',
        },
      ],
    },
  ];

  const index = buildIndex(sets);
  assert.equal(index.items.length, 10);
  assert.equal(index.texts.length, 10);
  assert.equal(index.titles.length, 10);

  const item = index.items.find((entry) => entry.id === 'highsm.12127');
  assert.deepEqual(item.sets, ['Lighthouses', 'Bridges']);

  const bridge = index.items.find((entry) => entry.id === 'highsm.99999');
  assert.ok(bridge);
  assert.deepEqual(bridge.sets, ['Bridges']);
});

test('buildIndex does not add a title two times', () => {
  const sets = [...lighthouseSets(), ...lighthouseSets()];
  const index = buildIndex(sets);
  assert.equal(index.items.length, 9);

  for (const item of index.items) {
    assert.deepEqual(item.sets, ['Lighthouses']);
  }
});

test('searchIndex finds lighthouse items', () => {
  const index = buildIndex(lighthouseSets());
  const result = searchIndex(index, 'lighthouse', 1);
  assert.ok(result.total > 0);

  const normalizedTitles = result.items.map((item) => item.title.toLowerCase());
  const firstOther = normalizedTitles.findIndex((title) => !title.includes('lighthouse'));
  if (firstOther !== -1) {
    for (let i = firstOther; i < normalizedTitles.length; i += 1) {
      assert.ok(!normalizedTitles[i].includes('lighthouse'));
    }
  }
});

test('searchIndex matches set titles', () => {
  const sets = [
    ...lighthouseSets(),
    {
      title: 'Bridges',
      items: [
        { ...byLink.get('/resource/highsm.12127/') },
        {
          title: 'Brooklyn Bridge, New York',
          alt: 'A photo of a bridge.',
          image: '/static/portals/free-to-use/public-domain/bridges/bridges-1.jpg',
          link: '/resource/highsm.99999/',
        },
      ],
    },
  ];
  const index = buildIndex(sets);
  const result = searchIndex(index, 'bridges', 1);
  assert.ok(result.total > 0);
  assert.ok(result.items.some((item) => item.id === 'highsm.12127'));
});

test('searchIndex matches several words', () => {
  const index = buildIndex(lighthouseSets());
  const result = searchIndex(index, 'heceta oregon', 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'highsm.12127');
});

test('searchIndex finds nothing', () => {
  const index = buildIndex(lighthouseSets());
  assert.equal(searchIndex(index, 'xyzzy', 1).total, 0);
  assert.equal(searchIndex(index, '', 1).total, 0);
});

test('constants', () => {
  assert.equal(SITE, 'https://www.loc.gov');
  assert.equal(P, 'https://tile.loc.gov/image-services/iiif/service:pnp:');
});
