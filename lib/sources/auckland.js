import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'auckland',
  name: 'Auckland Museum',
  homepage: 'https://www.aucklandmuseum.com',
  group: 'museums',
  filter: 'incategory:"Images_from_Auckland_Museum"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
