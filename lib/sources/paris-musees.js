import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'paris-musees',
  name: 'Paris Musées',
  homepage: 'https://www.parismusees.paris.fr',
  group: 'museums',
  filter: 'incategory:"Images_from_Paris_Musées"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
