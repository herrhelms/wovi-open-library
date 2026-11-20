import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'nationaal-archief',
  name: 'Nationaal Archief (Netherlands)',
  homepage: 'https://www.nationaalarchief.nl',
  group: 'libraries',
  filter: 'incategory:"Images_from_Nationaal_Archief"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
