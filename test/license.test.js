import test from 'node:test';
import assert from 'node:assert/strict';

import { isOpenLicense } from '../lib/license.js';

const OPEN_CASES = [
  ['CC0', null],
  ['Public domain', null],
  ['Public Domain Mark', null],
  ['Public domain (NASA)', null],
  ['CC BY 4.0', null],
  ['CC BY-SA 2.0', null],
  ['CC BY-NC-SA 3.0 (non-commercial)', null],
  ['CC BY-NC-ND 4.0', null],
  ['Attribution 4.0 International (CC BY 4.0)', null],
  ['CC_BY_4_0', null],
  ['See item page', 'https://creativecommons.org/licenses/by-nd/4.0/'],
  ['See partner page', 'http://rightsstatements.org/vocab/NoC-US/1.0/'],
  ['No Copyright - Non-Commercial Use Only', null],
  ['No Known Copyright', null],
  ['No known copyright restrictions', null],
  ['No known restrictions', null],
  ['Free to use (no known restrictions)', null],
  ['United States Government Work', null],
  ['Pixabay Content License', null],
  ['Pexels License', null],
  ['Unsplash License', null],
  ['Open access', null],
  ['Getty Open Content (free to use)', null],
  ['Free to reuse (commercial use OK)', null],
];

const CLOSED_CASES = [
  ['In Copyright', null],
  ['In Copyright - Educational Use Permitted', null],
  ['In copyright', 'https://rightsstatements.org/vocab/InC/1.0/'],
  ['Copyright Not Evaluated', null],
  ['Copyright Undetermined', null],
  ['Rights statement: InC-RUU', null],
  ['See partner page', 'http://rightsstatements.org/vocab/InC-NC/1.0/'],
  ['Public domain', 'http://rightsstatements.org/vocab/UND/1.0/'],
  ['See partner page', null],
  ['See item page', null],
  [
    'See Harvard Art Museums image terms',
    'https://harvardartmuseums.org/collections/about',
  ],
  [null, null],
  [undefined, undefined],
  ['Acme Inc. photo archive', null],
];

test('isOpenLicense accepts open licences', () => {
  for (const [label, url] of OPEN_CASES) {
    assert.equal(isOpenLicense(label, url), true, `${label} / ${url}`);
  }
});

test('isOpenLicense rejects closed and unknown licences', () => {
  for (const [label, url] of CLOSED_CASES) {
    assert.equal(isOpenLicense(label, url), false, `${label} / ${url}`);
  }
});
