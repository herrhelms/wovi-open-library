import { createDjangoplicitySource } from './djangoplicity.js';

const source = createDjangoplicitySource({
  id: 'esa-hubble',
  name: 'ESA/Hubble',
  homepage: 'https://esahubble.org',
  origin: 'https://esahubble.org',
  imagesPath: '/images/',
  cdn: 'https://cdn.esahubble.org/archives/images/',
  creator: 'ESA/Hubble',
});

export const id = source.id;
export const name = source.name;
export const homepage = source.homepage;
export const group = source.group;
export const keyEnv = source.keyEnv;
export const normalize = source.normalize;
export const parseSearch = source.parseSearch;
export const search = source.search;
export const resolveDownload = source.resolveDownload;
