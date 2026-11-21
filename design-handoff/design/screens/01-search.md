# 01 · Search, sources, wall

Reference: `reference/01-search.html` (open it; it's interactive).
Replaces the current single page (title, search, chip wall, results grid).

## Layout (desktop 1440)

```
┌ header (sticky, translucent, blur 14px, 1px bottom line) ─────────────────────────┐
│ 🔭 WOVI │ WORLD OF / VISUAL INSPIRATION          Explore  Collections  Saved 0  Sources │
└────────────────────────────────────────────────────────────────────────────────────┘
  40px
  [🔍  woodcut                                        ⌘K ] [  Search  ]     ← 76px tall
  28px
  ┌ Sources fieldset (collapsed by default) ─────────────────────────────────────────┐
  32px
  woodcut · 97,312 images                         Most relevant ▾  Any orientation ▾  Any colour ▾
  from 30 of 51 sources
  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ (source bar)
  ■ Art Institute of Chicago 62,220  ■ Japan Search 31,467  ■ 28 other sources 3,625
  28px
  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐      masonry, ~250px columns, 20px gaps
  │  │ │  │ └──┘ │  │ │  │
  …  skeleton tiles at the end
           ••• Pulling more from Japan Search, The Met and 9 others
                                                                   (↑) back to top
```

Container: `max-width: 1600px; margin: 0 auto; padding: 0 32px`. Page bg `--wovi-bg`.

## Header

- Sticky top, `background: rgba(244,244,241,.88); backdrop-filter: blur(14px)`, bottom 1 px `--wovi-line`, padding 14 32.
- Left: Logo (components.md §Logo). Right: `<nav aria-label="Main">` ghost links
  Explore · Collections · Saved `{n}` (mono count) · Sources (opens Sources modal).
- Explore / Collections: keep if routes exist; otherwise hide (don't ship dead links).

## Search

- components.md §Search field. Submitting runs the existing search. The query also becomes the h1.
- Keep the query in the URL (`?q=`) so results are shareable and Back works.

## Sources fieldset

components.md §Sources fieldset. Data = existing adaptor list + per-source hit counts from the
last search. Groups and their order:

1. Aggregators (`agg`) — label in modal: "Open-licence aggregators"
2. Museums & galleries (`mus`)
3. Libraries & archives (`lib`)
4. Science & nature (`sci`) — label in modal: "Science, nature & medicine"

Changing a source or the open-licence switch re-filters results (same as today).
"{on} of 51 on" counts sources that are on and usable (not "needs key").

## Results

- Header and source bar: components.md §Results header.
- Wall: components.md §Masonry tile. Clicking a tile opens Detail (02) for that item and keeps
  the wall's scroll position on close.
- Infinite load: IntersectionObserver on a sentinel ~800 px before the end; append next page;
  show 5 skeletons while loading. Status row text names the sources still being fetched.
- Empty state (0 results): h1 `{query} · 0 images`, then 16 px `--wovi-ink-3` line
  "Nothing in {n} sources. Try fewer words, or turn on more sources." with a ghost button
  "Show sources" that opens the fieldset.
- Error per source (e.g. Openverse 429): don't block the wall; show the source's chip with a
  rust count "limit" and a `title` tooltip with the existing message.

## Responsive

| Width | Change |
|---|---|
| < 1100 | Fieldset header wraps: summary line drops to its own row. |
| < 800 | Group legend column stacks above its chips. Dropdown triggers wrap under the h1. h1 32 px. |
| < 600 | Page padding 16. Search field 60 px tall, input 20 px, ⌘K hidden, Search button full width below. Wall 2 columns (`column-width: 160px`, gap 12). Tagline hidden. |
| < 380 | Wall 1 column. |

## States to build

- Fieldset collapsed / open
- Chip on / off / zero / needs key
- Switch on / off
- Tile default / hover-focus / saved
- Loading more / exhausted / empty / error
- Back-to-top hidden / shown
