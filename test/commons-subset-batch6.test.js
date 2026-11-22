import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getSource } from '../lib/sources/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/commons-paris-musees.json'), 'utf8'),
);

const rows = [
  {
    id: 'pikiwiki',
    name: 'PikiWiki Israel',
    group: 'aggregators',
    order: 131,
    homepage: 'https://www.pikiwiki.org.il',
    filter: 'incategory:"Images_from_the_Pikiwiki_project"',
  },
  {
    id: 'kogl',
    name: 'Korean public institutions (KOGL Type 1)',
    group: 'aggregators',
    order: 132,
    homepage: 'https://www.kogl.or.kr',
    filter: 'incategory:"KOGL_Type_1"',
  },
  {
    id: 'museu-paulista',
    name: 'Museu Paulista (USP)',
    group: 'museums',
    order: 282,
    homepage: 'https://mp.usp.br',
    filter: 'incategory:"NeuroMat\'s_partnership_with_Museu_Paulista_USP"',
  },
  {
    id: 'npm-taiwan',
    name: 'National Palace Museum (Taiwan)',
    group: 'museums',
    order: 283,
    homepage: 'https://www.npm.gov.tw',
    filter: 'incategory:"National_Palace_Museum_Open_Data"',
  },
  {
    id: 'awm',
    name: 'Australian War Memorial',
    group: 'museums',
    order: 284,
    homepage: 'https://www.awm.gov.au',
    filter: 'incategory:"Images_from_the_Australian_War_Memorial"',
  },
  {
    id: 'nationalmuseum',
    name: 'Nationalmuseum Stockholm',
    group: 'museums',
    order: 285,
    homepage: 'https://www.nationalmuseum.se',
    filter: 'deepcat:"Images_from_the_Nationalmuseum_Stockholm"',
  },
  {
    id: 'helsinki-city-museum',
    name: 'Helsinki City Museum',
    group: 'museums',
    order: 286,
    homepage: 'https://www.helsinginkaupunginmuseo.fi',
    filter: 'incategory:"Files_from_the_Helsinki_City_Museum"',
  },
  {
    id: 'cmh',
    name: 'Canadian Museum of History',
    group: 'museums',
    order: 287,
    homepage: 'https://www.historymuseum.ca',
    filter: 'incategory:"Images_from_Canadian_Museum_of_History"',
  },
  {
    id: 'mccord',
    name: 'McCord Stewart Museum',
    group: 'museums',
    order: 288,
    homepage: 'https://www.musee-mccord-stewart.ca',
    filter: 'deepcat:"Images_from_McCord_Museum"',
  },
  {
    id: 'nli',
    name: 'National Library of Israel',
    group: 'libraries',
    order: 414,
    homepage: 'https://www.nli.org.il',
    filter: 'incategory:"Files_from_the_National_Library_of_Israel"',
  },
  {
    id: 'arquivo-nacional',
    name: 'Arquivo Nacional (Brazil)',
    group: 'libraries',
    order: 415,
    homepage: 'https://www.gov.br/arquivonacional',
    filter: 'deepcat:"Photographs_in_Arquivo_Nacional_(Brazil)"',
  },
  {
    id: 'ims',
    name: 'Instituto Moreira Salles',
    group: 'libraries',
    order: 416,
    homepage: 'https://ims.com.br',
    filter: 'incategory:"PD-Instituto_Moreira_Salles"',
  },
  {
    id: 'agn-argentina',
    name: 'Archivo General de la Nación (Argentina)',
    group: 'libraries',
    order: 417,
    homepage: 'https://www.argentina.gob.ar/interior/archivo-general-de-la-nacion',
    filter: 'incategory:"Images_from_Archivo_General_de_la_Nación_Argentina"',
  },
  {
    id: 'slnsw',
    name: 'State Library of NSW',
    group: 'libraries',
    order: 418,
    homepage: 'https://www.sl.nsw.gov.au',
    filter: 'deepcat:"Images_from_the_State_Library_of_NSW"',
  },
  {
    id: 'archives-nz',
    name: 'Archives New Zealand',
    group: 'libraries',
    order: 419,
    homepage: 'https://www.archives.govt.nz',
    filter: 'incategory:"Images_from_Archives_New_Zealand"',
  },
  {
    id: 'finnish-heritage',
    name: 'Finnish Heritage Agency',
    group: 'libraries',
    order: 420,
    homepage: 'https://www.museovirasto.fi',
    filter: 'incategory:"Historical_Picture_Collection_of_The_Finnish_Heritage_Agency|JOKA_Press_Photo_Archive"',
  },
  {
    id: 'banq',
    name: 'BAnQ (Québec)',
    group: 'libraries',
    order: 421,
    homepage: 'https://www.banq.qc.ca',
    filter: 'deepcat:"Images_from_Bibliothèque_et_Archives_nationales_du_Québec"',
  },
  {
    id: 'lac',
    name: 'Library and Archives Canada',
    group: 'libraries',
    order: 422,
    homepage: 'https://library-archives.canada.ca',
    filter: 'deepcat:"Images_from_Library_and_Archives_Canada"',
  },
  {
    id: 'toronto-archives',
    name: 'City of Toronto Archives',
    group: 'libraries',
    order: 423,
    homepage: 'https://www.toronto.ca/city-government/accountability-operations-customer-service/access-city-information-or-records/city-of-toronto-archives/',
    filter: 'deepcat:"Images_from_the_City_of_Toronto_Archives"',
  },
  {
    id: 'nac-poland',
    name: 'Narodowe Archiwum Cyfrowe (Poland)',
    group: 'libraries',
    order: 424,
    homepage: 'https://www.nac.gov.pl',
    filter: 'deepcat:"Images_from_Narodowe_Archiwum_Cyfrowe"',
  },
];

for (const entry of rows) {
  const { id, name, group, order, homepage, filter } = entry;

  test(`${id} exports the subset fields`, () => {
    const source = getSource(id);
    assert.ok(source);
    assert.equal(source.id, id);
    assert.equal(source.name, `${name} (via Wikimedia Commons)`);
    assert.equal(source.homepage, homepage);
    assert.equal(source.group, group);
    assert.equal(source.keyEnv, null);
    assert.equal(source.config.options.filter, filter);
    assert.equal(source.config.order, order);
    assert.equal(source.config.defaultEnabled, true);
    assert.equal(source.config.description, `${name} images (via Wikimedia Commons).`);
  });

  test(`${id} builds the Commons search URL with the filter`, () => {
    const source = getSource(id);
    const url = new URL(source.buildSearchUrl('moon', 1));
    assert.equal(url.host, 'commons.wikimedia.org');
    assert.equal(url.searchParams.get('gsrsearch'), `moon ${filter} filetype:bitmap`);
    assert.equal(url.searchParams.get('gsroffset'), '0');

    const page2 = new URL(source.buildSearchUrl('moon', 2));
    assert.equal(page2.searchParams.get('gsroffset'), '24');
  });
}

test('the twenty batch 6 ids are unique', () => {
  const ids = rows.map((entry) => getSource(entry.id).id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, ids.length);
});

test('awm search uses the injected fetchJson and sets the source', async () => {
  const source = getSource('awm');
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(url);
    return fixture;
  };

  const result = await source.search('moon', 1, { fetchJson });
  assert.equal(urls.length, 1);
  assert.ok(
    urls[0].includes('incategory%3A%22Images_from_the_Australian_War_Memorial%22'),
  );
  assert.ok(result.items.length > 0);
  for (const item of result.items) assert.equal(item.source, 'awm');
});
