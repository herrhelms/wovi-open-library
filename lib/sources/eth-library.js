import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'eth-library',
  name: 'ETH Library Zurich',
  homepage: 'https://library.ethz.ch',
  group: 'libraries',
  filter: 'incategory:"Media_contributed_by_the_ETH-Bibliothek"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
