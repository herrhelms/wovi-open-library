import { createDjangoplicitySource } from './djangoplicity.js';

const source = createDjangoplicitySource({
  id: 'eso',
  name: 'ESO',
  homepage: 'https://www.eso.org',
  origin: 'https://www.eso.org',
  imagesPath: '/public/images/',
  cdn: 'https://cdn.eso.org/images/',
  creator: 'ESO',
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
