import { createDjangoplicitySource } from './djangoplicity.js';

const source = createDjangoplicitySource({
  id: 'esa-webb',
  name: 'ESA/Webb',
  homepage: 'https://esawebb.org',
  origin: 'https://esawebb.org',
  imagesPath: '/images/',
  cdn: 'https://cdn.esawebb.org/archives/images/',
  creator: 'ESA/Webb',
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
