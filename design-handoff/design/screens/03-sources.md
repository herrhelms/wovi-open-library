# 03 · Sources modal (was "Adaptors")

Reference: `reference/03-sources.html`. Opened from header "Sources" (and from a "needs key"
chip, scrolled to that row). Replaces the current Adaptors modal: find field, "51 of 51 active",
per-adaptor card with name link, Active checkbox, key badge, description, notes list,
"How to get a key" steps, `FLICKR_KEY=…` hint, "not yet tested live" note.

## Layout

Dialog 780 × up to 904 px (`max-height: calc(100vh - 96px)`), centered, top 48. Three parts:

```
┌ header ───────────────────────────────────────────────────────────┐
│ Sources                                                       (✕) │
│ 45 of 51 adaptors on · 6 need a key                               │
│ [🔍 Find a source            ]  ( All 51 | Ready 45 | Needs key 6 | Off 0 ) │
├ list (scrolls) ───────────────────────────────────────────────────┤
│ OPEN-LICENCE AGGREGATORS                               13 / 13 on │
│ Wikimedia Commons                          [NO KEY NEEDED]  (⏻)  │
│ Wikimedia Commons free media files.                               │
│ Flickr Commons  untested       Set up key ▴  [KEY MISSING]   (⏻)  │
│ Photos with no known copyright restrictions.                      │
│ ┌ 1. Create an app and get a key at flickr.com/services/apps/create │
│ │ 2. Add it to .env in the project root, then restart the server   │
│ │ ███ FLICKR_KEY=your-key                              [Copy] ███  │
│ └ Built from the public API docs, not yet tested with a live key.  │
├ footer ───────────────────────────────────────────────────────────┤
│ Keys live in .env on your server, never in the browser.   [Done]  │
├ GitHub strip ─────────────────────────────────────────────────────┤
│ (gh) Let me know what you think about this project on GitHub.     │
│      If you want to support … becoming a GitHub Sponsor ♥         │
└───────────────────────────────────────────────────────────────────┘
```

## Header

- Title "Sources" 26/600. Sub 14 `--wovi-ink-3`: "{on} of 51 adaptors on · {missing} need a key".
- Close: 44 px round, white, border.
- Find field: white, radius 12, min-h 46, search icon; filters rows by name (case-insensitive),
  live. Also match description text if available.
- Segmented filter (components.md §Segmented): All · Ready (usable and on) · Needs key · Off.
  Counts update live.

## Rows

Grid `1fr auto auto`, padding 14 16, radius 12, hover/expanded bg `--wovi-bg`.

| Column | Content |
|---|---|
| 1 | Name (15/600, link to the provider site), optional `untested` tag; description 13.5 `--wovi-ink-3` (from adaptor metadata); notes as one mono 11.5 line, joined with " · " (e.g. Openverse: "No key: ~20 req/min · 200/day · results stop near 240"). Long note lists: show first line + "More" disclosure. |
| 2 | For key-missing rows: "Set up key ▾" text button (rust, `aria-expanded`). Status pill. |
| 3 | Switch with `aria-label="{name} on|off"`. Persists exactly like the old Active checkbox. |

Key setup panel (expanded, spans all columns): white card radius 10, padding 16.
Ordered list from adaptor metadata ("how to get a key" steps; link the signup URL);
dark code row (`#121212`, radius 8) with mono `ENV_NAME=` + `your-key` in `--wovi-green-on-dark`
and a green **Copy** button (copies `ENV_NAME=`); note line 12.5 `--wovi-ink-3` when the adaptor is
marked untested. Default: the first key-missing row is collapsed (reference shows one open for
demo).

Group headers: mono 11.5 uppercase tracking .1em `--wovi-ink-4`, right side "{on} / {total} on".
Groups with no matching rows are hidden. No matches at all: centered "No source matches
“{query}”." + ghost "Clear".

## Footer + strip

- Footer row: "Keys live in `.env` on your server, never in the browser." 13 `--wovi-ink-3`;
  primary **Done** (closes).
- GitHub strip: components.md §GitHub footer strip.

## Behaviour notes

- Toggling a switch updates the Sources fieldset on the search page immediately.
- Changes are applied live; "Done" just closes (no save step).
- Key status is read-only here (keys come from `.env`); after the user edits `.env` and restarts,
  the pill flips to "Key set".
- Phone: full-screen sheet; segmented control scrolls horizontally; row grid becomes
  `1fr auto` with the pill moving under the name.
