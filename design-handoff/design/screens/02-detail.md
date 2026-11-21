# 02 · Detail view

Reference: `reference/02-detail.html`. Replaces the current viewer (light stage, arrows,
right panel with Europeana title, description, Source, License, View on…, Download, Copy URL,
Fit/Actual, "7 of 204").

## Layout (1440 × 900, full-viewport overlay)

```
┌ stage (#141413, flex 1) ─────────────────────────────────┬ panel 440px (#FBFBF9) ─────┐
│ 🔭 WOVI │ WORLD OF…        [ Fit | Actual size ]    7 / 204 │ EUROPEANA          (🔖) (✕) │
│                                                           │                              │
│  (‹)            ┌──────────────────────┐            (›)   │ Vogelschaukarte von Paris,   │
│                 │       image          │                  │ Holzschnitt, 1550            │
│                 └──────────────────────┘                  │ description…                 │
│                                                           │ [ ⬇ Download full resolution ]│
│        ▫ ▫ ▫ ▫ ■ ▫ ▫ ▫ ▫   (filmstrip, current outlined)  │ [Copy image URL][View on …↗] │
│ ← → browse · esc close                                    │ LICENCE  CC BY-SA 4.0 · credit… │
│                                                           │ SOURCE / PUBLISHER / SIZE    │
│                                                           │ ┌ Attribution        Copy ┐ │
│                                                           │ └ “Title”, via X, CC BY-SA ┘ │
│                                                           │ MORE LIKE THIS ▢ ▢ ▢ ▢        │
└───────────────────────────────────────────────────────────┴──────────────────────────────┘
```

## Stage

- Bg `--wovi-stage`. Top bar padding 20 24: logo (on-dark variant, links back to results),
  segmented Fit / Actual size (on-dark), mono `{i} / {N}` in `--wovi-on-dark-2`.
- Image: centered, `object-fit: contain`, max 86% width in Fit; Actual = natural size inside a
  scrollable/pannable area (drag to pan, keep existing behaviour if there is one).
  Shadow `0 40px 80px -30px rgba(0,0,0,.6)`, radius 3.
- Prev/next: 52 px circles `rgba(255,255,255,.1)`, white chevron; hover white bg + ink icon.
  `aria-label` "Previous image" / "Next image". Hidden at the ends.
- Filmstrip: 56 px squares, gap 10, opacity .45 → hover .9; current = opacity 1 + 2 px white
  outline offset 2. Shows current ±4. Each is a link with `aria-label="Image {n} of {N}"`.
- Hint bottom-left: mono 11.5 `#8E8E87` "← → browse · esc close". Hide on touch devices.

## Panel

- Width 440, `--wovi-panel`, left border 1 px `--wovi-line`, scrolls independently.
- Top row: eyebrow = source name (mono 12, uppercase, tracking .08em, `--wovi-ink-3`);
  right: Save (bookmark, 44 px round, `aria-label="Save"`, toggles saved state — see 04) and
  Close (✕, 44 px round).
- Title: Geist 600 30 px, line-height 1.12, tracking −.03em.
- Description: 14.5 px / 1.6 `--wovi-ink-2`. Clamp to 8 lines with "Show more" if longer.
- Actions: primary **Download full resolution** (56 px, full width, download icon). Below, 2-col
  grid: Copy image URL (shows "Copied ✓" for 1.4 s) · View on {source} ↗ (external link,
  `target="_blank" rel="noopener"`).
- Metadata `<dl>`: grid 96 px label column, gap 14 16; labels mono 11.5 uppercase `--wovi-ink-5`;
  values 14.5 ink. Rows shown only when data exists: Licence (link + short meaning,
  e.g. "credit & share alike"), Source, Creator, Date, Publisher, Size, Dimensions (px).
- Attribution box (only for licences that require credit — CC BY, CC BY-SA, etc.): white card,
  1 px line, radius 12, padding 16; mono eyebrow "Attribution", text action "Copy"; body mono
  12.5 `“{title}”, via {source}, {licence}` (add creator when known).
- More like this: only if the app can provide it; 4-col grid of square thumbnails, radius 6.
  Otherwise omit the whole block.

## Keyboard & a11y

- Open as `role="dialog" aria-modal="true"` labelled by the title. Focus lands on Close.
- ← / → previous / next, Esc closes, F toggles Fit/Actual. Update the URL (`/item/:id` or `?i=`)
  so Back closes the viewer.

## Responsive

- < 1000: panel 360 px.
- < 760: stacked — stage on top (60vh), panel below as a scrolling sheet; arrows overlay the
  image; filmstrip hidden; logo hidden in stage (header is enough).

## Licence meaning strings

| Licence | Short meaning |
|---|---|
| Public domain / PDM | no restrictions |
| CC0 | no restrictions |
| CC BY | credit required |
| CC BY-SA | credit & share alike |
| CC BY-NC | credit, non-commercial |
| Rights reserved / unknown | check with source |
