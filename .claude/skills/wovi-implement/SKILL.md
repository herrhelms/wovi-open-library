---
name: wovi-implement
description: Step-by-step workflow for rebuilding the Open Library Fetch UI into the WOVI design from design-handoff/. Use when asked to implement, continue, or check the WOVI redesign, or any single step of it (header, sources fieldset, wall, detail, sources modal, saves).
---

# Implementing the WOVI redesign

Source of truth: `design-handoff/HANDOFF.md` (plan + acceptance checklist),
`design-handoff/design/screens/*.md` (specs), `design-handoff/reference/*.html` (runnable design).
Visual rules: the `wovi-design` skill.

## Every session

1. Read `design-handoff/HANDOFF.md` §3 and find the first unchecked step in
   `design-handoff/PROGRESS.md` (create it from §3 if missing: one `- [ ]` line per step).
2. If this is the first session, do HANDOFF §2 (map the codebase) and write the findings to the
   top of `PROGRESS.md` so later sessions don't redo it.
3. Do **one** step per commit. Keep the app runnable after each.
4. Tick the step in `PROGRESS.md` with a one-line note (files touched, anything deferred).

## Per step

1. Open the matching spec section and the reference file. Run the reference locally
   (`open design-handoff/reference/01-search.html`, or serve the folder:
   `npx serve design-handoff/reference`) and click through the states listed in the spec.
2. Find the existing component/code that owns that UI. Change it in place; reuse existing
   state, data fetching and adaptor logic. Don't fork a parallel app.
3. Lift CSS values from the reference / `tokens.css`. Never invent colours, sizes or fonts.
   If a value is missing, pick the nearest token and note it in `PROGRESS.md`.
4. Keep behaviour that exists today (HANDOFF §5) even if the reference doesn't show it.
5. Wire only real data. Sample numbers and names in the reference are not data.

## Verify (each step)

- Run the app and the existing tests.
- If Playwright is available, screenshot the app and the reference at 1440×1000 and at
  390×844, and compare them by eye. Script sketch:

  ```js
  const { chromium } = require('playwright');
  (async () => {
    const b = await chromium.launch();
    for (const [name, url] of [['app', 'http://localhost:PORT/?q=woodcut'],
                               ['ref', 'file://' + process.cwd() + '/design-handoff/reference/01-search.html']]) {
      for (const [w, h] of [[1440, 1000], [390, 844]]) {
        const p = await b.newPage({ viewport: { width: w, height: h } });
        await p.goto(url); await p.waitForTimeout(800);
        await p.screenshot({ path: `shots/${name}-${w}.png`, fullPage: true });
        await p.close();
      }
    }
    await b.close();
  })();
  ```
- Keyboard pass: Tab through the changed UI; focus visible; Esc closes overlays.
- Grep for leftovers: old fonts, old navy (`#1f3a5f`-like), any blue hex, `!important` added by you.

## When unsure

Ask the user rather than guess on: repo/Sponsors URLs, whether Explore/Collections routes
should exist, whether "More like this" has a data source, and anything that would change
server or adaptor behaviour.
