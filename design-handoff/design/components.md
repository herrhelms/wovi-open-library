# WOVI components

Values reference `tokens.css`. "Ref" points at the class or markup in `reference/*.html`
you can lift. Sizes are CSS px at 1×.

---

## Logo

```
🔭 WOVI │ WORLD OF
          VISUAL INSPIRATION
```

| Part | Spec |
|---|---|
| Wrapper | `<a href="/" aria-label="WOVI — World of Visual Inspiration, home">`, flex, `align-items:center`, gap 14 px, no underline. Inner parts `aria-hidden`. |
| Telescope | 🔭, 26 px, letter-spacing 0 |
| Wordmark | "WOVI", Geist 800, 30 px, letter-spacing −.05em, line-height 1, `--wovi-ink`. Gap 10 px after telescope. |
| Divider | 1.5 × 30 px, `--wovi-ink` |
| Tagline | Two lines `World of<br>Visual Inspiration`, Geist 600, 11 px, line-height 1.25, uppercase, tracking .12em, `--wovi-ink` |
| On dark (detail stage) | Telescope 19 px, wordmark 22 px white, divider 1.5 × 24 px white with 12 px side margin, tagline 9.5 px white |
| Phone | Hide the tagline + divider under 420 px. |

Ref: `01-search.html` header, `02-detail.html` top-left.

---

## Buttons

| Variant | Spec | Ref |
|---|---|---|
| Primary | `--wovi-green` bg, white 15–16 px/600, radius 12 (16 for Search), min-height 48 (76 for Search, 56 for Download), hover `--wovi-green-hover` | `.btn.pri`, Search, Download, Done |
| Secondary | white bg, 1 px `--wovi-line-strong`, ink text 14–15/500, radius 12, min-h 48, hover border → ink | `.btn.sec`, `.btn` in detail |
| Ghost | transparent, ink 13.5/500, radius 8, min-h 40, padding 8×10, hover `--wovi-hover` | `.ghost` (nav, All/None, dropdown triggers) |
| Mini link-button | transparent, green 12.5 px, radius 6, min-h 28, hover `--wovi-green-tint` | `.mini` (per-group All/None) |
| Icon (round) | 40–44 px circle. On tiles: white bg → hover ink bg/white icon. In panels: white + border. Always `aria-label`. | `.ibtn`, close buttons |
| Text action | green 13/600, no bg (e.g. "Copy" in attribution box) | detail attribution |

Focus (all): `outline: none; box-shadow: var(--wovi-focus-ring)` or a 2 px green outline with 2 px offset. Never remove focus without a replacement.

---

## Switch (toggle)

Track 36 × 22, radius pill, off `#CFCFC8`, on `--wovi-green`. Knob 16 px white, 3 px inset, slides 14 px, 150 ms.
Implemented as `<button aria-pressed="true|false">` with visible text label next to it
("Open licences only") or an `aria-label` ("Europeana on"). Hit area ≥ 40 px.
Ref: `.switch` in `01-search.html` and `03-sources.html`.

---

## Search field

Label wraps everything (`<label class="sbox">`, visually-hidden text "Search images").
White, 1 px `--wovi-line-strong`, radius 16, min-height 76, padding-left 22. Search icon 24 px
ink. Input: Geist 500 28 px, tracking −.02em, no border/outline. Placeholder `--wovi-ink-muted`:
"Search 45 open libraries — prints, maps, specimens, stars…". Right: `⌘K` hint (mono 12, 1 px
border, radius 6). Focus-within: green border + focus ring.
Search button sits beside it (flex 1 1 140px) and wraps below on narrow screens.
`⌘K` / `Ctrl K` focuses the field (bind on the search field's page only; don't steal from inputs).

---

## Source chip

`<button aria-pressed>` · white, 1 px `--wovi-line-strong`, radius 10, min-h 38, padding 8 12 8 10, gap 8.
Content: 8 px dot · name 13.5 px · count (mono 12, `--wovi-ink-4`).

| State | Look |
|---|---|
| On, has results | dot green, white bg |
| Off (user turned off) | transparent bg, text `--wovi-ink-5`, grey dot |
| Zero results | transparent bg, text `--wovi-ink-5`, border `#E2E2DC`, still clickable |
| Needs key (not configured) | dashed border, no count, rust `KEY` tag (mono 11, `--wovi-warn` on `--wovi-warn-tint`, radius 5). Not toggleable — clicking may open the Sources modal at that row. |

Hover: border → ink. Active: `scale(.97)`. Sort chips by hits desc inside each group.
Ref: `.chip` in `01-search.html`.

> Fix vs reference: the reference uses `#8A8A84` for counts on "off" chips. Use `--wovi-ink-5` instead (contrast).

---

## Sources fieldset (collapsible)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [›] Sources  44 of 51 on   Art Institute…, Japan Search… + 27 more   ⏻ Open licences only │ All  None │
├──────────────────────────────────────────────────────────────────────────┤  ← only when open
│ Aggregators            ● Japan Search 31,467  ● Europeana 511  …        │
│ 1,717 hits  All None                                                     │
│ Museums & galleries    …                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

- `<fieldset>` panel: `--wovi-panel`, 1 px `--wovi-line`, radius 18, padding 8.
- `<legend>` is the whole header row (`float:left; width:100%` so it lays out normally).
- Disclosure: `<button aria-expanded aria-controls="src-panel">`, ink 24 px rounded-square caret
  (white chevron) that rotates 90° when open; then "Sources" 600 and mono "{on} of 51 on".
- Summary text: top 3 sources with results, by hits, then "+ N more with results"; ellipsis on overflow; "No sources selected" when empty.
- Right cluster: open-licence switch · 1 px divider · All · None.
- Body (open): one nested `<fieldset>` per group; legend column 210 px (group name 600 14 px,
  mono "{hits} hits", mini All/None); chips flow in the remaining space. Groups separated by
  1 px `--wovi-line-faint`.
- Default: **collapsed**. Remember open/closed in localStorage (`wovi:sources-open:v1`).

---

## Results header + source bar

- h1: `{query}` Geist 600 40 px tracking −.035em, then `· {total} images` in `--wovi-ink-muted` 400.
- Sub: "from {n} of 51 sources" 14 px `--wovi-ink-3`.
- Right: ghost dropdown triggers "Most relevant ▾", "Any orientation ▾", "Any colour ▾".
- Source bar: 6 px tall pill, segments with 2 px gaps, widths ∝ hits. Colours: #1 green, #2
  `--wovi-green-on-dark`, rest `#C9C9C2` merged as "{N} other sources". Legend below: 8 px square,
  name, mono count, 12.5 px, gap 18 px. `aria-label="Results by source"`.

---

## Masonry tile

```html
<a class="tile" href="/item/…">               <!-- whole tile opens detail -->
  <div class="img"> <img …> <div class="ov">[save][download] … title / source</div></div>
  <div class="meta"><span>Source name</span><span class="lic">CC BY 4.0</span></div>
</a>
```

- Column layout: `columns: 250px; column-gap: 20px`; tile `break-inside: avoid; margin-bottom: 20px`.
- Image: radius 6, natural aspect ratio (set `aspect-ratio` from width/height when known to avoid
  layout shift). Placeholder bg rotates through `--wovi-ph-*` while loading. `loading="lazy"`,
  `decoding="async"`.
- Hover/focus-within: image lifts −3 px + `--wovi-shadow-tile`; overlay fades in (200 ms): scrim
  `linear-gradient(to top, rgba(10,10,10,.62), transparent 55%)`, top-right 40 px round white
  buttons Save (bookmark) and Download (arrow-down), bottom-left title 13/600 white + mono
  11.5 source line.
- The overlay buttons must be real `<button>`s **outside** the `<a>` in production (nest a
  positioned button layer as a sibling) — buttons inside links are invalid. In the reference they
  are decorative spans.
- Saved state: bookmark button filled green with white icon, visible without hover.
- Meta row: source (12.5, `--wovi-ink-3`, ellipsis) + licence tag (mono 11, 1 px `#D4D4CE`,
  radius 5). "Rights reserved" tag uses a dashed border and `--wovi-ink-5`.
- Skeleton tiles: `--wovi-skeleton`, radius 6, 1.6 s opacity pulse, varied heights 200–340.

---

## Infinite-load row

Centered, 14 px `--wovi-ink-3`: three 7 px green dots pulsing with .2 s stagger + "Pulling more
from {source}, {source} and {n} others". `role="status"`. When exhausted: "That's everything
from {n} sources." (no dots).

---

## Back to top

Fixed, right 28 / bottom 28, 48 px circle, `rgba(251,251,249,.9)` + `backdrop-filter: blur(10px)`,
1 px `--wovi-line-strong`, `--wovi-shadow-float`, up-arrow 18 px. Hidden (opacity 0, translateY 12,
`pointer-events:none`) until `scrollY > 600`, then 200 ms fade/slide in. Hover: ink bg, white icon.
`<a href="#top" aria-label="Back to top">` or a button calling `scrollTo({top:0})`; move focus to
the search field afterwards.

---

## Pills / tags

| Tag | Spec |
|---|---|
| Status pill (sources modal) | mono 11 uppercase tracking .04em, padding 4×8, radius 6. No key needed: ink-2 on `#ECECE6`. Key set: `--wovi-green-hover` on `--wovi-green-tint`. Key missing: `--wovi-warn` on `--wovi-warn-tint`. |
| untested | mono 11 `--wovi-ink-5`, 1 px dashed `#C9C9C2`, radius 5 |
| Licence | see tile meta |

---

## Segmented control

Track `--wovi-track`, radius pill, padding 3. Segment: 13.5/500 `--wovi-ink-3`, min-h 36,
padding 0 12, radius pill; active = ink bg + white text; mono count at 70% opacity.
`role="group"` + `aria-pressed` on each segment. On dark (detail Fit/Actual): track
`rgba(255,255,255,.08)`, inactive `#C9C9C2`, active white bg + ink text.

---

## Dialog (modal)

Scrim `--wovi-scrim` + `backdrop-filter: blur(4–6px)` over the page. Panel `--wovi-panel`, radius
20, `--wovi-shadow-modal`. `role="dialog" aria-modal="true" aria-labelledby`. Focus trap, Esc and
scrim click close (except the first-save notice: Esc = "Not now"). Return focus to trigger.
Body scroll locked while open. Phone: full-screen sheet, radius 20 on top corners only.

---

## Toast

Bottom-center, 36 px from bottom. Ink bg, white 14 px, radius 14, padding 10 10 10 18,
`--wovi-shadow-toast`, gap 14. Link in `--wovi-green-on-dark`; action button
`rgba(255,255,255,.12)`. `role="status"`. Auto-hide after 5 s; pause on hover/focus.

---

## GitHub footer strip

Used at the bottom of the Sources modal and the first-save notice.
`--wovi-bg` background, 1 px top border `--wovi-line`, padding 16 28 18/20, flex gap 12.
GitHub mark (stroke SVG, 20 px, ink, `aria-hidden`) + paragraph 13.5 px/1.55 `--wovi-ink-2`:

> Let me know what you think about this project **[on GitHub]**.<br>
> If you want to support its continuous development, consider **[becoming a GitHub Sponsor]** ♥

Links green; ♥ `--wovi-heart`, `aria-hidden`. Note the line break after the first sentence.
URLs: ask the maintainer (repo URL, `https://github.com/sponsors/<user>`).
