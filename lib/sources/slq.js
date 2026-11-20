import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'slq',
  name: 'State Library of Queensland',
  homepage: 'https://www.slq.qld.gov.au',
  group: 'libraries',
  filter: 'incategory:"Images_from_the_State_Library_of_Queensland"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
