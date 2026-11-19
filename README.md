# Open Library Fetch

A local web app that searches 10 open image libraries in one grid and downloads
the highest available resolution of each image.

The libraries are:

- Wikimedia Commons
- Europeana
- Internet Archive
- Library of Congress
- Smithsonian Open Access
- Rijksmuseum
- The Met
- New York Public Library
- NASA Image and Video Library
- National Gallery of Art

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

The keys stay on the server. They are never sent to the browser.

## Known limits

- **Library of Congress**: loc.gov can answer with a Cloudflare challenge
  (HTTP 403). The app then shows an error for LoC. The app does not try to
  bypass it.
- **National Gallery of Art**: there is no search API. The first NGA search
  downloads the open data CSV files (~175 MB) into `data/nga/` and builds an
  index. This takes a few minutes. The files are refreshed after 30 days.
- **Smithsonian**: `DEMO_KEY` allows about 30 requests per hour. Put a personal
  key in `.env`.
- **The Met**: the search can return objects that are not public domain. The app
  removes them, so a page can have fewer than 24 items.
- **Rijksmuseum**: 12 items for each page (each item needs 3 requests).

## Downloads

The server streams files through `/api/download`. Only hosts of the 10 libraries
are allowed, so the app is not an open proxy. Europeana files come from the
record API.

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
