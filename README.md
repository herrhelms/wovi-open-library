# Open Library Fetch

A local web app that searches 15 open image libraries in one grid and downloads
the highest available resolution of each image.

The libraries are:

- Wikimedia Commons
- Europeana
- Internet Archive
- Library of Congress (Free to Use)
- Smithsonian Open Access
- Rijksmuseum
- The Met
- New York Public Library
- NASA Image and Video Library
- National Gallery of Art
- Cleveland Museum of Art
- SMK – National Gallery of Denmark
- Minneapolis Institute of Art
- Wellcome Collection
- Openverse

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
PORT=5173
```

- `NYPL_TOKEN` — required for NYPL. Get one at <https://api.repo.nypl.org/>.
- `EUROPEANA_KEY` — default `api2demo`. A personal key is available at
  <https://pro.europeana.eu/page/get-api>.
- `SMITHSONIAN_KEY` — default `DEMO_KEY`. A personal key is available at
  <https://api.data.gov/signup/>.
- `PORT` — default `5173`.

The 5 new sources need no key: Cleveland Museum of Art, SMK, Minneapolis
Institute of Art, Wellcome Collection and Openverse.

The keys stay on the server. They are never sent to the browser.

## Known limits

- **Library of Congress (Free to Use)**: the general loc.gov search
  (`/photos/?fo=json` and the other JSON APIs) answers HTTP 403 with a
  Cloudflare challenge from some networks. The app does not try to bypass it.
  So the app searches the LoC "Free to Use" sets
  (<https://www.loc.gov/free-to-use/>): 101 sets with about 5000 items. The
  search text is the title, the description and the set names.
  The first LoC search reads the 101 sets (102 requests, about one minute) and
  saves them in `data/loc/free-to-use.json`. The file is used again for 7 days.
  While the data is prepared, the UI shows a message and tries again
  automatically.
  Resolution: for Prints & Photographs items the app gets the image from the
  LoC IIIF server (`tile.loc.gov`). Carol M. Highsmith items (`highsm`) come in
  the master size (often more than 3000 px). Other Prints & Photographs items
  (for example `cph`, `det`, `ppmsca`, `mrg`) come as reference images of about
  1024 px. All other items (for example HABS/HAER/HALS `hhh`, maps, sheet
  music) give only the small web-size image from the set (about 300 px).
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

## Downloads

The server streams files through `/api/download`. Only hosts of the libraries
are allowed, so the app is not an open proxy. Europeana and Openverse files come
from the record API of the source (their files can be on any host).

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
