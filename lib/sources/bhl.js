import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'bhl',
  name: 'Biodiversity Heritage Library',
  homepage: 'https://www.biodiversitylibrary.org',
  group: 'science',
  filter: 'insource:"biodiversitylibrary.org"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
