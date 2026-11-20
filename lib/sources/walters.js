import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'walters',
  name: 'Walters Art Museum',
  homepage: 'https://art.thewalters.org',
  group: 'museums',
  filter: 'deepcat:"Media contributed by the Walters Art Museum"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
