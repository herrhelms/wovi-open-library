import test from 'node:test';
import assert from 'node:assert/strict';

import { mediaIdFor, normalizeMediaUrl } from '../lib/media-id.js';
import { sources } from '../lib/sources/index.js';

test('source IDs are unique and valid', () => {
  const ids = sources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/);
  }
});

test('normalizeMediaUrl changes http to https', () => {
  assert.equal(normalizeMediaUrl('http://a.example/x.jpg'), 'https://a.example/x.jpg');
});

test('normalizeMediaUrl removes the fragment', () => {
  assert.equal(normalizeMediaUrl('https://a.example/x.jpg#frag'), 'https://a.example/x.jpg');
});

test('normalizeMediaUrl keeps the query', () => {
  assert.equal(
    normalizeMediaUrl('https://a.example/x.jpg?w=400&h=2'),
    'https://a.example/x.jpg?w=400&h=2',
  );
});

test('normalizeMediaUrl returns a trimmed unparsable string', () => {
  assert.equal(normalizeMediaUrl('  not a url  '), 'not a url');
});

test('normalizeMediaUrl returns null for bad input', () => {
  assert.equal(normalizeMediaUrl(''), null);
  assert.equal(normalizeMediaUrl('   '), null);
  assert.equal(normalizeMediaUrl(null), null);
  assert.equal(normalizeMediaUrl(5), null);
});

test('mediaIdFor gives the same ID for equivalent URLs', () => {
  assert.equal(mediaIdFor('http://a.example/x.jpg'), mediaIdFor('https://a.example/x.jpg#top'));
});

test('mediaIdFor gives different IDs for different queries', () => {
  assert.notEqual(
    mediaIdFor('https://a.example/x.jpg?w=1'),
    mediaIdFor('https://a.example/x.jpg?w=2'),
  );
});

test('mediaIdFor has the expected shape', () => {
  assert.match(mediaIdFor('https://a.example/x.jpg'), /^m[0-9a-f]{24}$/);
});

test('mediaIdFor returns null for bad input', () => {
  assert.equal(mediaIdFor(undefined), null);
  assert.equal(mediaIdFor(''), null);
});
