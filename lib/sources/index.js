import * as commons from './commons.js';
import * as openverse from './openverse.js';
import * as flickrCommons from './flickr-commons.js';
import * as flickrCc from './flickr-cc.js';
import * as archive from './archive.js';
import * as europeana from './europeana.js';
import * as dpla from './dpla.js';
import * as japanSearch from './japan-search.js';
import * as ksamsok from './ksamsok.js';
import * as digitalnz from './digitalnz.js';
import * as pixabay from './pixabay.js';
import * as pexels from './pexels.js';
import * as unsplash from './unsplash.js';

import * as met from './met.js';
import * as smithsonian from './smithsonian.js';
import * as rijksmuseum from './rijksmuseum.js';
import * as nga from './nga.js';
import * as aic from './aic.js';
import * as cleveland from './cleveland.js';
import * as getty from './getty.js';
import * as mia from './mia.js';
import * as smk from './smk.js';
import * as parisMusees from './paris-musees.js';
import * as walters from './walters.js';
import * as brooklyn from './brooklyn.js';
import * as auckland from './auckland.js';
import * as princeton from './princeton.js';
import * as harvard from './harvard.js';

import * as loc from './loc.js';
import * as nypl from './nypl.js';
import * as britishLibrary from './british-library.js';
import * as gallica from './gallica.js';
import * as trove from './trove.js';
import * as nara from './nara.js';
import * as nationaalArchief from './nationaal-archief.js';
import * as bundesarchiv from './bundesarchiv.js';
import * as ethLibrary from './eth-library.js';
import * as slq from './slq.js';
import * as nbNorway from './nb-norway.js';
import * as digitalCommonwealth from './digital-commonwealth.js';
import * as rumsey from './rumsey.js';

import * as nasa from './nasa.js';
import * as esaHubble from './esa-hubble.js';
import * as esaWebb from './esa-webb.js';
import * as eso from './eso.js';
import * as wellcome from './wellcome.js';
import * as bhl from './bhl.js';
import * as noaa from './noaa.js';
import * as inaturalist from './inaturalist.js';
import * as gbif from './gbif.js';
import * as nhm from './nhm.js';

export const GROUPS = [
  { id: 'aggregators', label: 'Open-licence aggregators' },
  { id: 'museums', label: 'Museums and galleries' },
  { id: 'libraries', label: 'Libraries and archives' },
  { id: 'science', label: 'Science, nature and medicine' },
];

export const sources = [
  commons,
  openverse,
  flickrCommons,
  flickrCc,
  archive,
  europeana,
  dpla,
  japanSearch,
  ksamsok,
  digitalnz,
  pixabay,
  pexels,
  unsplash,

  met,
  smithsonian,
  rijksmuseum,
  nga,
  aic,
  cleveland,
  getty,
  mia,
  smk,
  parisMusees,
  walters,
  brooklyn,
  auckland,
  princeton,
  harvard,

  loc,
  nypl,
  britishLibrary,
  gallica,
  trove,
  nara,
  nationaalArchief,
  bundesarchiv,
  ethLibrary,
  slq,
  nbNorway,
  digitalCommonwealth,
  rumsey,

  nasa,
  esaHubble,
  esaWebb,
  eso,
  wellcome,
  bhl,
  noaa,
  inaturalist,
  gbif,
  nhm,
];

export function getSource(id) {
  return sources.find((source) => source.id === id) ?? null;
}
