import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as harvard from '../lib/sources/harvard.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/harvard.json'), 'utf8'));

test('harvard has no usable licence data', () => {
  assert.equal(harvard.openLicenses, false);
});

test('harvard normalize keeps the IIIF URLs', () => {
  const item = harvard.normalize(fixture.records[0]);
  assert.equal(item.source, 'harvard');
  assert.equal(item.id, '299843');
  assert.equal(
    item.thumb,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/400,/0/default.jpg',
  );
  assert.equal(
    item.preview,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/1600,/0/default.jpg',
  );
  assert.equal(
    item.full,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/full/0/default.jpg',
  );
  assert.equal(item.width, 2400);
  assert.equal(item.height, 1800);
});
