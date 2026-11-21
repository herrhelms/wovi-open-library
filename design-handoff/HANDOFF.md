# WOVI — Design handoff

> Brief for a coding agent (Claude Code) working in the existing **Open Library Fetch** codebase.
> Goal: re-skin and restructure the existing app into **WOVI — World of Visual Inspiration**,
> keeping every feature it already has and adding the few new behaviours listed below.

Read this file first, then the `wovi-design` skill (`.claude/skills/wovi-design/SKILL.md`, the design rules)
and the `wovi-implement` skill (the workflow), then the screen spec for whatever you are building.

---

## 1. What you are given

| Path | What it is |
|---|---|
| `design-handoff/reference/01-search.html` … `04-first-save.html` | **The design, runnable.** Open in a browser. Interactive: filters, switches, copy buttons, the save flow. |
| `design-handoff/reference/wovi-preview.js` | Tiny viewer that makes the reference files run. **Not production code — never import it.** |
| `design-handoff/design/tokens.css` / `tokens.json` | Colours, type, radii, spacing, shadows, motion. Single source of truth. |
| `design-handoff/design/components.md` | Every component: anatomy, sizes, states, a11y. |
| `design-handoff/design/screens/*.md` | One spec per screen: layout, behaviour, data, copy, edge cases. |
| `.claude/skills/wovi-design/SKILL.md` | Rules to follow whenever you touch UI in this project (at the repo root, next to `design-handoff/`). |
| `.claude/skills/wovi-implement/SKILL.md` | Session-by-session workflow, progress file, verification. |

The reference files are written in a small template format (`{{ hole }}`, `<sc-for>`, `<sc-if>`,
`class Component extends DCLogic { renderVals() … }`). Read them as **spec + markup + CSS you can
lift**, not as an architecture to copy. Translate to whatever the app already uses.

The image tiles in the reference are grey placeholders on purpose. Real thumbnails replace them.
Counts and source lists in the reference are sample data from a real "Hokusai" query.

---

## 2. Before you change anything

1. Map the existing app. Find and note (in your reply, briefly):
   - the frontend stack and entry point, how styles are written (CSS files, modules, Tailwind…)
   - the search request → results flow, and how adaptors/sources are registered
   - the adaptor metadata shape (name, group, description, notes, key requirement, how-to steps, active flag)
   - the result item shape (title, creator, source, licence, thumbnail, full-res URL, dimensions)
   - the existing image viewer (prev/next, download, copy URL, fit/actual size, "n of N")
   - the existing "Adaptors" modal and where its active toggles are persisted
2. Do **not** change server/API behaviour or adaptor logic unless a step below says so.
   This is a UI rebuild. Every existing feature must still work afterwards.
3. Work on a branch. Commit per step below.

---

## 3. Implementation order

Each step should leave the app working.

1. **Tokens + fonts.** Add `design/tokens.css` (or convert to the project's system, e.g. a Tailwind
   theme). Load Geist + Geist Mono. Remove the old serif/cream/navy look globally.
2. **App shell + header.** Logo lockup, nav (Explore, Collections, Saved n, Sources). Sticky,
   translucent. → `screens/01-search.md §Header`, `components.md §Logo`.
3. **Search bar.** Big field + Search button, ⌘K focus. → `§Search`.
4. **Sources fieldset.** Replace the wall of source chips with the collapsible fieldset
   (collapsed by default, summary line, open-licence switch, All/None, grouped chips with
   per-group All/None). Reuse existing source state; just change the UI. → `§Sources`.
5. **Results header + source bar.** Query + total, "from N of 51 sources", sort/orientation/colour
   dropdowns (wire only what exists; others can be stubs hidden behind a flag), stacked bar.
6. **Masonry wall + infinite loading.** CSS columns, tile hover, skeletons, loader line,
   IntersectionObserver for next pages. → `§Results wall`.
7. **Back-to-top button.** → `components.md §Back to top`.
8. **Detail view.** Rebuild the viewer as dark stage + light side panel. Keep all existing actions.
   Add attribution box and "More like this" only if data exists (otherwise omit the block).
   → `screens/02-detail.md`.
9. **Sources modal.** Rebuild the Adaptors modal. → `screens/03-sources.md`.
10. **Saves (new).** localStorage-only saves + first-use notice + toast. → `screens/04-first-save.md`.
11. **GitHub footer strip** in the Sources modal and the first-save notice. Ask the user for the
    repo and Sponsors URLs if they are not in the codebase or README.
12. **Pass:** keyboard, focus rings, contrast, phone width (390 px), reduced motion.

---

## 4. New behaviour (does not exist in the current app)

| Feature | Rule |
|---|---|
| Saves | Stored **only** in `localStorage` (key suggestion: `wovi:saves:v1`, array of result snapshots). No server calls. |
| First-save notice | Shown once, on the first save attempt. Confirm → save + toast. "Not now" → no save. Remember the acknowledgement in `localStorage` (`wovi:saves-ack:v1`). If localStorage is unavailable (private mode throws), show a toast "Saving isn't available in this browser" and don't save. |
| Saved count | Header "Saved n" reads from localStorage; updates live (also listen to the `storage` event for other tabs). |
| Source summary | Collapsed fieldset shows "{on} of 51 on" + top 3 sources by hits + "+ N more with results". |
| Open-licence switch | Moved into the fieldset header. Same filter as the old checkbox. |
| Back to top | Appears after 600 px scroll. |

---

## 5. Things to keep from the current app (do not lose)

- All 51 adaptors, grouping, counts per source, "needs key" state, `.env` instructions,
  "not yet tested live" notes, Openverse rate-limit notes, "via <provider>".
- Detail viewer: prev/next, keyboard ←/→/Esc, Download full resolution, Copy image URL,
  Fit / Actual size, View on source, licence link, "n of N".
- Open licences only filter, All/None for sources.

---

## 6. Acceptance checklist

- [ ] Side by side with `reference/*.html` at 1440 px, the screens match in layout, spacing, type and colour.
- [ ] No blue left anywhere. Primary = `--wovi-green #0B6E4F`.
- [ ] No emoji in UI except the 🔭 in the logo.
- [ ] Every interactive thing is a real `<button>`, `<a href>` or `<input>`; visible focus ring.
- [ ] Text contrast ≥ 4.5:1 (tokens are chosen to pass; don't lighten greys).
- [ ] 390 px wide: header wraps, search button drops under the field, chips wrap, wall is 1 column, detail becomes stacked.
- [ ] `prefers-reduced-motion`: no tile lift, no smooth scroll, no skeleton pulse.
- [ ] Saves survive reload, never hit the network, notice appears exactly once.
- [ ] Existing tests pass; existing features listed in §5 still work.
