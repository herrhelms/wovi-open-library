import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'nara',
  name: 'US National Archives',
  homepage: 'https://www.archives.gov',
  group: 'libraries',
  filter: 'incategory:"Images_from_the_National_Archives_and_Records_Administration"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
