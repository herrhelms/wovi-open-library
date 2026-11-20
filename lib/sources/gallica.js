import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'gallica',
  name: 'Gallica (BnF)',
  homepage: 'https://gallica.bnf.fr',
  group: 'libraries',
  filter: 'insource:"gallica.bnf.fr"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
