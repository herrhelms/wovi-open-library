# Open Library Fetch

A local web app that searches 38 open image libraries in one grid and downloads
the highest available resolution of each image.

## Sources

### Open-licence aggregators

- Wikimedia Commons
- Openverse
- Flickr Commons
- Flickr (open licenses)
- Internet Archive
- Europeana
- DPLA

### Museums and galleries

- The Met
- Smithsonian Open Access
- Rijksmuseum
- National Gallery of Art
- Art Institute of Chicago
- Cleveland Museum of Art
- Getty Museum
- Minneapolis Institute of Art
- SMK – National Gallery of Denmark
- Paris Musées
- Walters Art Museum
- Brooklyn Museum
- Auckland Museum

### Libraries and archives

- Library of Congress (Free to Use)
- New York Public Library
- British Library
- Gallica (BnF)
- Trove (National Library of Australia)
- US National Archives
- Nationaal Archief (Netherlands)
- German Federal Archive
- ETH Library Zurich
- State Library of Queensland

### Science, nature and medicine

- NASA Image Library
- ESA/Hubble
- ESA/Webb
- ESO
- Wellcome Collection
- Biodiversity Heritage Library
- NOAA Photo Library
- iNaturalist

## Requirements

- Node.js 26

There are no runtime dependencies. You do not need `npm install`.

## Start

```
npm start
```

Then open <http://127.0.0.1:5173/> (the port comes from `PORT` in `.env`).

## Configuration

Put a `.env` file in the project root:

```
NYPL_TOKEN=...
EUROPEANA_KEY=api2demo
SMITHSONIAN_KEY=DEMO_KEY
FLICKR_KEY=...
DPLA_KEY=...
TROVE_KEY=...
PORT=5173
```

- `NYPL_TOKEN` — required for NYPL. Get one at <https://api.repo.nypl.org/>.
- `EUROPEANA_KEY` — default `api2demo`. A personal key is available at
  <https://pro.europeana.eu/page/get-api>.
- `SMITHSONIAN_KEY` — default `DEMO_KEY`. A personal key is available at
  <https://api.data.gov/signup/>.
- `FLICKR_KEY` — required for Flickr Commons and Flickr (open licenses). Sign up
  at <https://www.flickr.com/services/apps/create/>.
- `DPLA_KEY` — required for DPLA. Get one with
  `curl -X POST https://api.dp.la/v2/api_key/<your email>`.
- `TROVE_KEY` — required for Trove. Get one at <https://trove.nla.gov.au>,
  Profile → API.
- `PARIS_MUSEES_TOKEN` — planned. Get one at
  <https://apicollections.parismusees.paris.fr>.
- `PORT` — default `5173`.

Flickr Commons, Flickr (open licenses), DPLA and Trove are built from the public
API documentation. They are NOT yet tested live (no key yet).

Without a key the chip shows "needs key" and the app sends no request.

The keys stay on the server. They are never sent to the browser.

## Known limits

- **Library of Congress (Free to Use)**: the general loc.gov search
  (`/photos/?fo=json` and the other JSON APIs) answers HTTP 403 with a
  Cloudflare challenge from some networks. The app does not try to bypass it.
  So the app searches the LoC "Free to Use" sets
  (<https://www.loc.gov/free-to-use/>): 101 sets with about 3400 items. The
  search text is the title, the description and the set names.
  The first LoC search reads the 101 sets (102 requests, about one minute) and
  saves them in `data/loc/free-to-use.json`. The file is used again for 7 days.
  Sets that failed during the first read are saved in the index file and read
  again in the background after 1 hour.
  While the data is prepared, the UI shows a message and tries again
  automatically.
  Resolution: for Prints & Photographs items the app gets the image from the
  LoC IIIF server (`tile.loc.gov`). Only Carol M. Highsmith (`highsm`) items
  come at the master size (often more than 3000 px). Other Prints & Photographs
  items (`cph`, `det`, `ppmsca`, `mrg`) come at about 1024 px. All other items
  (for example HABS/HAER/HALS `hhh`, maps, sheet music) give only the small
  web-size image from the set (about 300 px).
  The IIIF results are cached in `data/loc/iiif-cache.json`.
- **National Gallery of Art**: there is no search API. The first NGA search
  downloads the open data CSV files (~175 MB) into `data/nga/` and builds an
  index. This takes a few minutes. The files are refreshed after 30 days.
- **Smithsonian**: `DEMO_KEY` allows about 30 requests per hour. Put a personal
  key in `.env`.
- **The Met**: the search can return objects that are not public domain. The app
  removes them, so a page can have fewer than 24 items.
- **Rijksmuseum**: 12 items for each page (each item needs 3 requests).
- **Openverse**: without a key, the API allows about 20 requests in each minute
  and 200 in each day; results stop at about 240 (12 pages of 20). On HTTP 429
  the app shows `Openverse rate limit reached. Try again in a few minutes.`
  Openverse collects images from other sites (for example Flickr); the viewer
  shows "via <provider>".
- **Cleveland Museum of Art**: "Download full resolution" gives the print JPEG
  (about 3400 px). The TIFF master can be more than 200 MB; the viewer shows it
  as a separate link "Download TIFF (very large)".
- **Minneapolis Institute of Art**: the image server sends no `Content-Type`;
  the download proxy gets the type from the file extension.
- **Wikimedia Commons subsets**: British Library, Gallica, NOAA, BHL and the 9
  batch-5 sources (Paris Musées, Walters, Brooklyn, Auckland Museum, US National
  Archives, Nationaal Archief, German Federal Archive, ETH Library, State
  Library of Queensland) are searched through Wikimedia Commons with a category
  or source filter. The item page is the Commons file page. NOAA uses the
  category "Files from the NOAA Photo Library Flickr stream" (more hits than the
  source filter).
- **Art Institute of Chicago**: the AIC image server answers this server with a
  Cloudflare challenge. The browser loads the images directly. "Download full
  resolution" opens the image (max 3000 px wide) from artic.edu in a new tab;
  save it from there. "Download selected" skips AIC items.
- **Getty Museum**: search by title words only (SPARQL); one search takes about
  8 seconds.
- **ESA/Hubble, ESA/Webb, ESO**: "Download full resolution" gives the largest
  JPEG of the item page ("Large JPEG", else "Publication JPEG", else "Screensize
  JPEG"). The TIFF originals are not offered.
- **iNaturalist**: max 60 requests in each minute; only CC0, CC BY and CC BY-SA
  photos.
- **DPLA and Trove**: often only a thumbnail; the viewer links to the partner
  page.

## Paris Musées

Paris Musées' own API (GraphQL) needs `PARIS_MUSEES_TOKEN`. It is planned. Today
Paris Musées comes through Wikimedia Commons.

## Downloads

The server streams files through `/api/download`. Only hosts of the libraries
are allowed, so the app is not an open proxy. Europeana, Openverse, DPLA and
Trove files come from the record API of the source (their files can be on any
host).

## Development

- `npm test` — unit tests, offline, with fixtures in `test/fixtures/`.
- `npm run smoke` — live check, one call to each source.

## Project structure

```
server.js            HTTP server, static files and API routes
lib/
  env.js             .env loader
  http.js            fetch with timeout and User-Agent
  csv.js             streaming CSV parser
  download.js        download stream and host allow list
  sources/
    index.js         source registry
    <id>.js          one module for each library
public/              plain HTML, CSS and JavaScript frontend
scripts/smoke.js     live smoke check
test/                unit tests and fixtures
```
