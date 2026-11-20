import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'brooklyn',
  name: 'Brooklyn Museum',
  homepage: 'https://www.brooklynmuseum.org',
  group: 'museums',
  filter: 'deepcat:"Media contributed by the Brooklyn Museum"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
