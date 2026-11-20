import { createFlickrSource } from './flickr.js';

const source = createFlickrSource({
  id: 'flickr-cc',
  name: 'Flickr (open licenses)',
  homepage: 'https://www.flickr.com/creativecommons/',
  extraParams: { license: '4,5,7,8,9,10' },
});

export const id = source.id;
export const name = source.name;
export const homepage = source.homepage;
export const group = source.group;
export const keyEnv = source.keyEnv;
export const normalize = source.normalize;
export const parseSearch = source.parseSearch;
export const search = source.search;
