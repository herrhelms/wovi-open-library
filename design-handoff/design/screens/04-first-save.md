# 04 · Saves + first-save notice (new)

Reference: `reference/04-first-save.html` (click "Got it, save", then "Undo" to replay).

## Storage model

- Saves live **only** in `localStorage`. Nothing is sent to a server.
- Key `wovi:saves:v1` → JSON array, newest first:
  `{ id, source, title, creator, thumbUrl, fullUrl, pageUrl, licence, width, height, savedAt }`
  (`id` = `${source}:${sourceId}`; snapshot enough to render the Saved page offline from the list).
- Key `wovi:saves-ack:v1` → `"1"` once the notice was confirmed.
- Wrap every read/write in try/catch (Safari private mode, quota). On failure: toast
  "Saving isn't available in this browser." and do not toggle the saved state.
- Listen to `window.storage` events so other tabs update the "Saved n" count and saved states.

## Flow

```
click Save (tile or detail) ─┬─ ack set? ── yes ─▶ save → toast
                             └─ no ─▶ notice ─┬─ "Got it, save" ─▶ set ack, save → toast
                                              └─ "Not now" / Esc / scrim ─▶ close, nothing saved
```

Clicking Save on an already-saved item removes it (toast "Removed from saved" + Undo). No notice.

## Notice (dialog)

480 px wide, padding 28, centered, `--wovi-panel`, radius 20, modal shadow, scrim + blur 4.
`role="dialog" aria-modal="true" aria-labelledby aria-describedby`. Initial focus: "Got it, save".

1. Icon chip 48 px, radius 14, `--wovi-green-tint` bg, green bookmark (stroke) 22 px.
2. Title (20 px below): **Your saves stay in this browser** — 24/600, tracking −.03em.
3. Body 15/1.55 `--wovi-ink-2`: "No account, no cloud. WOVI keeps your saved images in this
   browser’s local storage, only on this device."
4. Two warning bullets, 14 px, rust 18 px info-circle icon:
   - "Clearing site data or browsing privately removes them."
   - "They won’t show up on another browser or device."
5. Buttons (26 px above), side by side: secondary **Not now** (flex 1) · primary
   **Got it, save** (flex 1.4).
6. Mono 11.5 `--wovi-ink-5`, centered: "You’ll only see this once."
7. GitHub strip (components.md §GitHub footer strip), bleeding to the dialog edges, bottom radius 20.

The tile being saved stays visible behind the scrim with a 3 px green ring (optional polish).

## After saving

- Tile/detail bookmark button: green fill, white filled icon, visible without hover, `aria-pressed="true"`, label "Saved".
- Toast (components.md §Toast): "Saved to this browser" · link "View saved ({n})" · button "Undo".
- Header "Saved n" increments.

## Saved page (minimal, if no Collections feature exists yet)

Route `/saved`: same masonry wall built from the stored snapshots, h1 "Saved · {n} images",
sub "Stored in this browser only." + ghost buttons "Export JSON" and "Clear all" (confirm first).
Empty: "Nothing saved yet. Use the bookmark on any image."
