import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'british-library',
  name: 'British Library',
  homepage: 'https://www.bl.uk',
  group: 'libraries',
  filter: 'incategory:"Images_from_the_British_Library_Mechanical_Curator_collection"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
