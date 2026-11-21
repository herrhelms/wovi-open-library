---
name: wovi-design
description: Design rules for WOVI (World of Visual Inspiration). Use whenever creating or changing any UI, CSS, component, copy or icon in this project, so it matches the handed-off design in design-handoff/.
---

# WOVI design rules

The full design lives in `design-handoff/` (if the folder was copied elsewhere, look for
`HANDOFF.md`). Runnable references: `design-handoff/reference/*.html`. Tokens:
`design-handoff/design/tokens.css`. Components: `design-handoff/design/components.md`.

When you build or change UI, open the matching reference file and match it. When the reference
and this file disagree, the reference wins; tell the user.

## Look in one paragraph

Calm, light, image-first. Warm-neutral greys (`#F4F4F1` page, `#FBFBF9` panels, `#FFFFFF` inputs),
near-black ink `#121212`, **one** accent: cool pine green `#0B6E4F`. Geist for everything,
Geist Mono for counts, licences, labels and keyboard hints. Generous whitespace, 1 px hairline
borders `#E3E3DD`, soft radii. The images are the colour; the chrome stays quiet.

## Hard rules

1. **Colour.** Use tokens only. Green is for: primary buttons, links, switches "on", selected
   dots, focus rings, loading dots, the saved state. Nothing else becomes green (not the logo,
   not hover backgrounds of icon buttons, not headings). Black `#121212` is used for secondary
   emphasis (disclosure caret, hover fills of icon buttons, back-to-top hover). Rust
   (`#A3360F` on `#FBE9E1`) only for "key missing" / warnings. No blue anywhere. No gradients
   except the tile hover scrim.
2. **Type.** Geist 400/500/600/800. Mono for numbers next to labels (`31,467`), licence tags,
   eyebrow labels (uppercase, tracking .06–.1em), `.env` lines, ⌘K. Headings use negative
   tracking (−.03em to −.05em). Never a serif.
3. **Logo.** `🔭 WOVI │ WORLD OF / VISUAL INSPIRATION` — see components.md §Logo. The telescope
   is the only emoji allowed in the UI.
4. **Icons.** Inline stroke SVG, 2 px stroke, round caps, `currentColor`, 14–22 px.
   Decorative icons get `aria-hidden="true"`. No icon fonts, no emoji icons.
5. **Accessibility.** Real `<button>`, `<a href>`, `<input>` + `<label>`. Icon-only buttons
   need `aria-label`. Toggles expose `aria-pressed`; disclosures `aria-expanded` +
   `aria-controls`. Dialogs: `role="dialog" aria-modal="true"`, labelled, focus trapped,
   Esc closes, focus returns to the trigger. Targets ≥ 40 px (44 px preferred). Text ≥ 4.5:1.
6. **Layout.** Max content width 1600 px, 32 px side padding (16 px on phones). Flex/grid with
   `gap`, not margins between siblings. Masonry = CSS `columns` with `column-width: 250px`,
   `column-gap: 20px`, tiles `break-inside: avoid`.
7. **Motion.** 120–250 ms, ease. Tile lift −3 px on hover. Respect
   `prefers-reduced-motion` (turn off lift, pulse, smooth scroll).
8. **Copy.** British spelling in UI ("licences", "colour"). Short, plain, no exclamation
   marks. Counts formatted `en-US` (`62,220`). See screen specs for exact strings.
9. **Persistence.** User saves live only in `localStorage`. Never send them to the server.
10. **Don't** add: emoji, gradients/glows, left-border accent cards, drop shadows on flat
    UI (only on floating things: dialogs, toast, back-to-top, hovered tile), new colours.

## Checklist before you finish a UI change

- Matches the reference at 1440 px and still works at 390 px.
- Only tokens used; no blue; green only where rule 1 allows.
- Keyboard: tab order sensible, focus visible, Esc closes overlays.
- Reduced motion respected.
