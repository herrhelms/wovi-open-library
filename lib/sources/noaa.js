import { createCommonsSubset } from './commons-subset.js';

const subset = createCommonsSubset({
  id: 'noaa',
  name: 'NOAA Photo Library',
  homepage: 'https://photolib.noaa.gov',
  group: 'science',
  filter: 'incategory:"Files_from_the_NOAA_Photo_Library_Flickr_stream"',
});

export const { id, name, homepage, group, keyEnv, filter } = subset;
export const { buildSearchUrl, normalize, parseSearch, search } = subset;
