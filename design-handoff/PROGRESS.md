# WOVI redesign — progress

Branch: `wovi-redesign`. One commit per step. Source of truth: `HANDOFF.md`, `design/`, `reference/`.

## Codebase map (HANDOFF §2)

**Stack.** Node 26, zero runtime dependencies, no build step. `server.js` serves `public/` as static files and the JSON API. Frontend = plain ES modules and plain CSS files, all loaded from `public/index.html`:

| File | Owns |
|---|---|
| `public/index.html` | Static shell: header (title, subtitle, "Adaptors" button), search form, source bar (All/None, "Open licences only" checkbox, `#source-groups`), error list, empty state with example queries, status line, `#results`, "Load more", sentinel, selection bar ("Download selected" / clear). |
| `public/app.js` | Entry module. Source chips, search state, infinite loading, masonry, card cache, selection + batch download, URL state (`?q=&sources=&open=1`). |
| `public/lib.js` | Pure helpers (tested in `test/public-lib.test.js`): `el()`, `itemKey`, `columnCount`, `pickColumn`, `distribute`, `thumbCandidates`, `viewerPlan`, `isUpgrade`, `keyStatus`, `filterAdapters`, `retryDelay`, … |
| `public/viewer.js` + `viewer.css` | Detail viewer (native `<dialog>`). |
| `public/settings.js` + `settings.css` | "Adaptors" modal (native `<dialog>`). |
| `public/styles.css` | Global tokens (`:root`: `--bg`, `--ink`, `--accent` navy `#1f3a5f`, `--font-display` Fraunces serif, `--font-ui` Inter, `--space-*`, `--radius: 2px`), a dark-mode block, all page components. |

Fonts today: Google Fonts `<link>` (Fraunces + Inter) in `index.html`.

**Search flow.** `app.js` sends one `GET /api/search?source=<id>&q=&page=&open=1` per selected source (parallel), with a per-source token against stale answers. Items go into one masonry (`.masonry` → N `.masonry-col`; each new card goes into the shortest column; existing cards never move). Infinite loading: `IntersectionObserver` on `#sentinel` (rootMargin 800 px) calls `loadMore()`; auto-load stops when pages add no visible cards ("Load more" button then). Errors per source in `#error-list`; `PREPARING` and `RATE_LIMIT` retry automatically. A card cache in the tab restores sources on toggle / Back / filter change without new requests.

**Adaptor registry.** One folder per adaptor: `adapters/<id>/adapter.json` (+ `index.js`, or `"base"` + `"options"` for config-only adaptors). `lib/adapters.js` loads them at start; groups in `adapters/groups.json`. `GET /api/sources` → enabled adaptors `{ id, name, homepage, group, needsKey, keyConfigured, keyEnv, openLicenses, … }`; `GET /api/groups`.

**Adaptor metadata** (`GET /api/adapters` → `{ groups, adapters, invalid }`): `id, name, homepage, group, description, enabled, defaultEnabled, openLicenses, docsUrl, notes[], base, key: null | { env, required, default, signupUrl, steps[], limits, configured }`. Never contains key values.

**Active flag persistence.** `POST /api/adapters/<id>` `{ enabled }` → SQLite `data/settings.sqlite` (table `adapter_settings`). Deactivated adaptors are not in `/api/sources` and answer `DISABLED`. The per-search chip selection is separate: `localStorage` `olf.sources` + the URL. Open filter: `localStorage` `olf.openOnly` + `open=1`.

**Result item shape** (from `/api/search`): `id, uid (source:id), source, mediaId, title, creator, date, description, license, licenseUrl, open, thumb, thumbSource, thumbCached, thumbFallback, preview, previewFallback, full, fullTiff, width, height, pageUrl, provider ("via …"), note, sets, directDownload`.

**Detail viewer** (`openViewer(list, index)`): dark image area + side panel. Thumbnail first, then the larger image only when wider. Prev/next buttons and ←/→, Esc / × closes, "n of N", Fit / Actual size, Download full resolution (or "Open full resolution" for `directDownload`), Download TIFF (very large), Copy image URL, View on <source>, licence link, "via <provider>", notes, preloads the next image.

**Adaptors modal** (`initSettings`): "Find adaptor" filter, "N of M active", one section per group, per row: name link, description, switch (`role="switch"`), key badge (No key needed / Key set / Key required, not set / Optional key not set), "How to get a key" `<details>` (sign-up link, steps, limits, `.env` line), notes, "no licence data" note, invalid adaptor folders.

**Tests.** `npm test` (node:test, 717 tests, offline). Pure UI logic is tested through `public/lib.js`.

## Decisions and deviations

- **Masonry (step 6).** The design says CSS `columns`. The user asked for a wall where infinite loading only adds cards and never moves existing ones. CSS columns re-balance on each append. Keep the JS column masonry and match the look: min column width 250 px, gap 20 px, tile styles from the reference. To be confirmed by the user before step 6.
- **Dark mode.** The design is light only (no dark tokens). Step 1 removes the old `prefers-color-scheme: dark` block. The detail stage stays dark by design.
- **Fonts.** Geist + Geist Mono from Google Fonts, the same way the reference and the old app load fonts. (Self-hosting the OFL font files is possible later if no third-party request is wanted.)
- **Screenshots.** Playwright is not installed; use `agent-browser` for 1440×1000 and 390×844 shots.
- **Code changes** are written by Hermes (project workflow); Claude plans, checks and ticks this file.
- **Repo and Sponsors URLs (step 11):** `https://github.com/herrhelms/wovi-open-library` and `https://github.com/sponsors/herrhelms`. Push to the public repo only when the redesign is done.
- **Open questions for later steps:** Explore / Collections routes (step 2), "More like this" data (step 8: no data source exists today).

## Steps (HANDOFF §3)

- [x] 1. Tokens + fonts — `public/tokens.css` (copy of `design/tokens.css` without `@import`), Geist + Geist Mono `<link>` in `index.html`, old variables in `styles.css` now point to WOVI tokens, dark mode and old hex/rgba values removed (`styles.css`, `viewer.css`, `settings.css`). Deferred: the viewer stage stays light until step 8 (dark text on it would fail contrast now).
- [ ] 2. App shell + header
- [ ] 3. Search bar
- [ ] 4. Sources fieldset
- [ ] 5. Results header + source bar
- [ ] 6. Masonry wall + infinite loading
- [ ] 7. Back-to-top button
- [ ] 8. Detail view
- [ ] 9. Sources modal
- [ ] 10. Saves (new)
- [ ] 11. GitHub footer strip
- [ ] 12. Pass: keyboard, focus, contrast, 390 px, reduced motion
