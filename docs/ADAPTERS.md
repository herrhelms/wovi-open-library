# Adaptors

Each image source is one adaptor. An adaptor is one folder in `adapters/`.
The server finds all adaptor folders at start. There is no list to edit.

## 1. Folder layout

```
adapters/
  groups.json                 # the groups, in the order of the app
  <id>/
    adapter.json              # config, always required
    index.js                  # code; not used when adapter.json has a "base"
    <id>.test.js              # tests for the adaptor (optional)
lib/bases/<name>.js           # shared factories for config-only adaptors
lib/adapters.js               # the loader
lib/sources/index.js          # registry: sources, GROUPS, getSource(id)
```

- `<id>` is the adaptor ID. It must match `/^[a-z0-9-]+$/`.
- The loader ignores folders whose name starts with `_` or `.`.
- Put the tests of an adaptor in the same folder, as `<id>.test.js`.
  Fixture files stay in `test/fixtures/`.
- `npm test` runs the tests in `test/` and in `adapters/`.

## 2. Add a code adaptor

1. Make the folder: `adapters/<id>/`.
2. Write `adapters/<id>/adapter.json` (section 4).
3. Write `adapters/<id>/index.js` with an async `search` (section 5).
4. Write `adapters/<id>/<id>.test.js` with fixtures in `test/fixtures/`.
5. Run `npm test`. Then start the server and search with the new source.

Do not add the adaptor to a list. The loader finds the folder.

## 3. Add a config-only adaptor

When the code is only a call of a shared factory, do not write `index.js`.
Use `base` and `options` instead:

```json
{
  "schema": 1,
  "id": "noaa",
  "name": "NOAA Photo Library (via Wikimedia Commons)",
  "homepage": "https://photolib.noaa.gov",
  "group": "science",
  "order": 480,
  "description": "NOAA Photo Library images (via Wikimedia Commons).",
  "base": "commons-subset",
  "options": {
    "filter": "incategory:\"Files_from_the_NOAA_Photo_Library_Flickr_stream\""
  }
}
```

The loader imports `lib/bases/commons-subset.js` and calls

```js
create({ id, name, homepage, group, ...options })
```

The current bases are:

| base | options |
|---|---|
| `commons-subset` | `filter` |
| `djangoplicity` | `origin`, `imagesPath`, `cdn`, `creator` |
| `flickr` | `extraParams` |

`lib/bases/` also holds modules that are not bases: `commons.js` (the code of
the Wikimedia Commons adaptor), `loc-free.js` (helpers for the Library of
Congress adaptor), `search-index.js` and `license-label.js` (small helpers that
two adaptors use). Only a module with an exported `create` can be a `base`.

To copy an adaptor: copy the folder, change `id` in `adapter.json` to the new
folder name, and change the options. Restart the server. The new adaptor
appears with no code change.

## 4. `adapter.json`

| field | type | rule |
|---|---|---|
| `schema` | number | must be `1` |
| `id` | string | must be equal to the folder name |
| `name` | string | required; the name in the app |
| `homepage` | string | required; the source website |
| `group` | string | required; an `id` in `adapters/groups.json` |
| `order` | number | optional; sort key inside the group. The current adaptors use `10, 20, 30, …`. An adaptor without `order` comes after the others of its group |
| `description` | string | required; one sentence for the Adaptors window |
| `defaultEnabled` | boolean | default `true` |
| `openLicenses` | boolean | default `true`; `false` when the source has no licence data |
| `trustResolvedUrl` | boolean | default `false`; `true` when `resolveDownload` gives a URL that the server can send to the browser unchanged |
| `key` | object or `null` | `null` when the adaptor needs no key |
| `key.env` | string | the environment variable name |
| `key.required` | boolean | `false` for an optional key (the code uses a public demo key) |
| `key.default` | string or `null` | the public demo key, for the text in the Adaptors window only |
| `key.signupUrl` | string or `null` | where to get a key |
| `key.steps` | string[] | how to get the key, one short step for each entry |
| `key.limits` | string or `null` | rate limits that the user must know |
| `docsUrl` | string or `null` | the API documentation, when it is known |
| `notes` | string[] | short facts for the user |
| `base` | string | optional; the name of a module in `lib/bases/` without `.js` |
| `options` | object | optional, only with `base`; the other arguments of the factory |

The loader puts metadata into the source object from `adapter.json` only.
Do not write `id`, `name`, `homepage`, `group`, `keyEnv`, `keyOptional`,
`openLicenses` or `trustResolvedUrl` in the code, unless the code itself uses
the value.

`adapters/groups.json` is a list of `{ "id", "label" }` objects. The order in
the file is the group order in the app.

## 5. The code contract

`adapters/<id>/index.js` or the factory must give:

```js
export async function search(q, page, deps)
// page starts at 1; returns { total, hasMore, items }
export async function resolveDownload(itemId, deps) // optional
// returns { url, filename }
```

- `deps` holds the test doubles: `fetch`, `fetchJson`. Use them and do not call
  the global `fetch` directly. Read `deps.fetchJson ?? fetchJson` from
  `lib/http.js`.
- Return 24 items for each page when the source permits it.
- Remove records that have no image.
- Export a pure `normalize(raw)` that changes one raw record into an item.
  The tests use it.

An item:

```js
{
  source: 'met',                 // the adaptor id
  id: '436535',                  // id inside the source, string
  title: 'Wheat Field with Cypresses',
  creator: 'Vincent van Gogh' | null,
  date: '1889' | null,
  description: string | null,    // max 600 chars
  thumb: 'https://…',            // about 400 px wide
  preview: 'https://…',          // about 1600 px wide, for the viewer
  full: 'https://…' | null,      // null = call resolveDownload
  width: number | null,          // size of `full`, when known
  height: number | null,
  license: 'CC0' | 'Public domain' | 'CC BY-SA 4.0' | … ,
  licenseUrl: string | null,
  pageUrl: 'https://…'           // the item page on the source website
}
```

Other optional exports are the same as today: `parseSearch`, `buildSearchUrl`,
`normalize`, `clearCache`, and module constants that the tests use.

Rules that stay in effect:

- Zero runtime dependencies.
- The fixed User-Agent from `lib/http.js`.
- Never log a key and never send a key value to the browser.
- `process.env` in adaptor code may only read the adaptor's own `key.env`
  (or `PORT`). `test/adapters.test.js` checks this.

## 6. The loader

`lib/adapters.js`:

```js
const { groups, adapters, invalid } = await loadAdapters({ dir, basesDir });
```

- `groups` is the content of `groups.json`.
- `adapters` is the source list, sorted by group order, then `order`, then
  `name`.
- `invalid` is a list of `{ folder, error }`. An invalid adaptor does not stop
  the server: the loader writes one line to stderr and continues.
- An adaptor is invalid when: the folder name is not valid, `adapter.json` is
  missing or is bad JSON, a field breaks a rule, `index.js` does not import,
  the code has no `search`, or two adaptors have the same `id`.

`lib/sources/index.js` is a small module on top of the loader:

```js
import { GROUPS, sources, getSource } from './lib/sources/index.js';
```

`server.js` and `scripts/smoke.js` use this module.

## 7. Test an adaptor

```bash
node --test adapters/<id>/<id>.test.js   # one adaptor
npm test                                 # all tests
```

- Keep one fixture file for each answer of the API in `test/fixtures/`.
- Test `parseSearch` and `normalize` with the fixture. Test `search` with an
  injected `fetch` or `fetchJson`; make no live request in a test.
- Test the metadata through the registry when the test needs it:
  `getSource('<id>')` gives the merged source object (`id`, `name`, `homepage`,
  `group`, `keyEnv`, `keyOptional`, `openLicenses`, `trustResolvedUrl`,
  `config`, `search`, …).

`test/adapters.test.js` checks the loader and all real adaptors:

- every `adapters/*/adapter.json` is valid and `invalid` is empty,
- the count is 51 and the group list has 4 groups,
- each folder has `adapter.json` and `index.js` or a `base`,
- each `process.env` name in adaptor code is the adaptor's `key.env` or `PORT`.

## 8. The Adaptors window

The app has an Adaptors window. It shows one row for each adaptor: the name
with a link to `homepage`, the `description`, a switch to turn the adaptor on or
off, and the key status.

- The key status uses `key.env`, `key.required` and `key.default`: no key
  needed, key set, key required but not set, or optional key not set (with
  "uses demo key" when `key.default` is not `null`).
- "How to get a key" shows `key.signupUrl`, `key.steps` and `key.limits`.
  The window never shows a key value. Keys stay in `.env`.
- `notes` are short facts for the user. When `openLicenses` is `false`, the row
  says "No licence data. Not searched with Open licences only."
- Invalid adaptor folders are shown at the end with the folder name and the
  error text.
