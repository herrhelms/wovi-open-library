# Open Library Fetch

A local web app that searches 51 open image libraries in one grid and downloads
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
- Japan Search
- Swedish heritage (K-samsök)
- DigitalNZ
- Pixabay
- Pexels
- Unsplash

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
- Princeton University Art Museum
- Harvard Art Museums

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
- National Library of Norway
- Digital Commonwealth (Massachusetts)
- David Rumsey Map Collection

### Science, nature and medicine

- NASA Image Library
- ESA/Hubble
- ESA/Webb
- ESO
- Wellcome Collection
- Biodiversity Heritage Library
- NOAA Photo Library
- iNaturalist
- GBIF
- Natural History Museum, London

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
PIXABAY_KEY=...
PEXELS_KEY=...
UNSPLASH_KEY=...
HARVARD_KEY=...
DIGITALNZ_KEY=...
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
- `PIXABAY_KEY` — required for Pixabay. Get one at
  <https://pixabay.com/api/docs/>.
- `PEXELS_KEY` — required for Pexels. Get one at
  <https://www.pexels.com/api/>.
- `UNSPLASH_KEY` — required for Unsplash. Use the "Access Key" from
  <https://unsplash.com/developers>.
- `HARVARD_KEY` — required for Harvard Art Museums. Get one at
  <https://harvardartmuseums.org/collections/api>.
- `DIGITALNZ_KEY` — optional for DigitalNZ. Get one at
  <https://digitalnz.org/developers>. The API works without it now. On HTTP
  401/403 the app asks for it.
- `PARIS_MUSEES_TOKEN` — planned. Get one at
  <https://apicollections.parismusees.paris.fr>.
- `PORT` — default `5173`.

Flickr Commons, Flickr (open licenses), DPLA, Trove, Pixabay, Pexels, Unsplash
and Harvard Art Museums are built from the public API documentation. They are
NOT yet tested live (no key yet).

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
- **David Rumsey Map Collection**: license CC BY-NC-SA 3.0 — NON-COMMERCIAL. It
  is the only non-commercial source. The viewer shows a note. "Download full
  resolution" gets the full width from the IIIF server (for example 8007 px; it
  can take some seconds).
- **Princeton University Art Museum**: only objects whose primary image is not
  restricted. One search needs one request for each object (24), so it is
  slower.
- **GBIF**: the photo license is checked for each photo (the GBIF license filter
  is for the record, not the photo); only CC0, CC BY, CC BY-SA and public
  domain photos.
- **Japan Search**: only public domain (`pdm`) items with an image.
- **K-samsök**: only images with license public domain mark, CC0, CC BY or
  CC BY-SA.
- **Digital Commonwealth**: only items marked "no restrictions" (the "creative
  commons" items include NC and ND licenses and are left out).
- **DigitalNZ** and **Trove**: some records give only a thumbnail; the viewer
  then shows a note.
- **Pixabay**: max 1280 px (the original needs special approval).
  **Unsplash**: a download calls the Unsplash download endpoint, as Unsplash
  requires.
- **Natural History Museum**: the item page (`data.nhm.ac.uk/object/…`) can
  answer HTTP 403 to scripts; in a browser it works.

## Checked, not supported

- Gallica direct API, Finna (Finland), Museums Victoria, Science Museum Group,
  Auckland Museum, Brooklyn Museum, Walters Art Museum, State Library of NSW,
  Cambridge Digital Library: blocked (Cloudflare or HTTP 403) from this
  machine. Gallica, Auckland Museum, Brooklyn Museum and Walters Art Museum
  come through Wikimedia Commons instead.
- Paris Musées direct API: needs a token; schema not tested (planned). Today it
  comes through Wikimedia Commons.
- Deutsche Digitale Bibliothek, BHL API, DigitaltMuseum: need a key. Trove is
  supported with a key; BHL comes through Wikimedia Commons.
- V&A: the API works, but the images are low resolution.
- Te Papa: the API works with a guest token, but most images are "All Rights
  Reserved".
- Yale LUX, NLM Digital Collections: answer HTTP 202 with no content (needs more
  work).
- Harvard Library (LibraryCloud): works, but the rights statements are not
  machine-readable.
- Encyclopedia of Life: works, but its images are mostly already in GBIF,
  iNaturalist and Wikimedia Commons.

## Paris Musées

Paris Musées' own API (GraphQL) needs `PARIS_MUSEES_TOKEN`. It is planned. Today
Paris Musées comes through Wikimedia Commons.

## Root certificates

The app adds two public root certificates from `certs/` to the default list of
Node at start: "SSL.com TLS RSA Root CA 2022" and "HARICA TLS RSA Root CA
2021". Node 26 does not have them, so the TLS check fails without them. The
hosts that need them are `data.getty.edu`, `kulturarvsdata.se` and
`data.artmuseum.princeton.edu`. Certificate checks stay enabled.

The Commons-based sources share a limit of 2 requests at the same time. On
HTTP 429 the app waits (the `Retry-After` seconds, else 2 s, at most 5 s) and
tries one more time.

## Open licences only

The search has a filter "Open licences only". It is OFF by default. When it is
ON, the app sends `open=1` to `/api/search`. The server removes the items whose
licence is not open. This lowers the number of results and can make `total`
unknown, because a source gives the total before the filter runs. When the item
count changes, `total` is `null` and the status line shows only the number of
results shown.

The rule is in `lib/license.js`. An item is open when its licence label or URL
says one of these:

- public domain, CC0 or Public Domain Mark (`pdm`)
- a Creative Commons licence, also NC and ND (`creativecommons.org/licenses/`)
- rightsstatements.org `NoC-*` or `NKC/`, "no known copyright restrictions"
- Pixabay, Pexels or Unsplash licence

An item is not open when its licence is "In copyright" (rightsstatements
`InC*`), "Copyright not evaluated" (`CNE`), "Undetermined" (`UND`), or when the
text is unknown (for example "See item page").

Trove and Harvard have no usable licence data. The app does not search them
when the filter is ON, and their chips are disabled.

## Downloads

The server streams files through `/api/download`. Only hosts of the libraries
are allowed, so the app is not an open proxy. Europeana, Openverse, DPLA,
Trove, GBIF, Japan Search, K-samsök, DigitalNZ and Unsplash files come from the
record API of the source (their files can be on any host).

## Development

- `npm test` — unit tests, offline, with fixtures in `test/fixtures/`.
- `npm run smoke` — live check, one call to each source.

## Project structure

```
server.js            HTTP server, static files and API routes
lib/
  env.js             .env loader
  http.js            fetch with timeout and User-Agent
  tls.js             adds two public root certificates
  wikimedia.js       Commons request limiter and 429 retry
  csv.js             streaming CSV parser
  download.js        download stream and host allow list
  sources/
    index.js         source registry
    <id>.js          one module for each library
public/              plain HTML, CSS and JavaScript frontend
scripts/smoke.js     live smoke check
test/                unit tests and fixtures
```
