import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'bundesarchiv',
  name: 'German Federal Archive',
  homepage: 'https://www.bundesarchiv.de',
  group: 'libraries',
  filter: 'incategory:"Images_from_the_German_Federal_Archive"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
