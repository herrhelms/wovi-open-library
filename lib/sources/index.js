import * as commons from './commons.js';
import * as europeana from './europeana.js';
import * as archive from './archive.js';
import * as loc from './loc.js';
import * as smithsonian from './smithsonian.js';
import * as rijksmuseum from './rijksmuseum.js';
import * as met from './met.js';
import * as nypl from './nypl.js';
import * as nasa from './nasa.js';
import * as nga from './nga.js';
import * as cleveland from './cleveland.js';
import * as smk from './smk.js';
import * as mia from './mia.js';
import * as wellcome from './wellcome.js';
import * as openverse from './openverse.js';

export const sources = [
  commons,
  europeana,
  archive,
  loc,
  smithsonian,
  rijksmuseum,
  met,
  nypl,
  nasa,
  nga,
  cleveland,
  smk,
  mia,
  wellcome,
  openverse,
];

export function getSource(id) {
  return sources.find((source) => source.id === id) ?? null;
}
