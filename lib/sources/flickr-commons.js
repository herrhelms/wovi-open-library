import { createFlickrSource } from './flickr.js';

const source = createFlickrSource({
  id: 'flickr-commons',
  name: 'Flickr Commons',
  homepage: 'https://www.flickr.com/commons',
  extraParams: { is_commons: 'true' },
});

export const id = source.id;
export const name = source.name;
export const homepage = source.homepage;
export const group = source.group;
export const keyEnv = source.keyEnv;
export const normalize = source.normalize;
export const parseSearch = source.parseSearch;
export const search = source.search;
