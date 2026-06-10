# D38999 Toolbox — Improvement Plan

Status: **proposal / for review**
Scope: GUI, UX/UI, flow, design, color, content. Single-page offline app (`app/`), no build step required at runtime, no external dependencies.

## Guiding constraints

- **Offline-first, dependency-free.** No CDNs, no fetch, no frameworks. Everything ships in `app/`.
- **`app/` is source of truth.** Generated artifacts (`app/app-data.js`, `app/data/*.json`, `app/assets/svg/*`) come from `scripts/build_app.py`. Don't hand-edit generated files.
- **Validate without Node.** Node is not installed; use `python3 scripts/smoke_test_connectors.py` + Python JSON parse checks instead of `node tests/validate_app.js`.
- **No regressions to decoder accuracy.** Visual/UX changes must not alter decode/validation logic.

---

## Phase 1 — Design system & color (foundation)

Everything else rides on the token layer, so this goes first.

### 1.1 Token refactor + dark mode
- Replace hardcoded `color-scheme: light` with theme-aware tokens.
- Add `[data-theme="dark"]` overrides for every palette token in `:root` (`app/styles.css` L6–L70).
- Default to `prefers-color-scheme`; persist explicit choice in `localStorage` (`d38999.theme`).
- Header toggle button (sun/moon SVG) next to the Home button.
- **Acceptance:** all 8 panels legible in both themes; SVG viewer contrast verified; no FOUC on load.

### 1.2 Semantic / domain palette
- Add information-bearing tokens, reused across tabs:
  - Contact gender: pin vs socket.
  - Series I/II/III/IV shell type accents.
  - Environment class (consume existing `environment_tags` / `environment_score`).
  - Validation state: exact / verified / inferred / needs-review (reuse `.needs-review`).
- **Acceptance:** legend, decoded card, catalog cards, and mating card all use the same semantic tokens.

### 1.3 Pin-gauge colors
- `--pin-22d/20/16/12/special/other` are currently all `#111827`. Give each gauge a distinct, colorblind-safe hue.
- Update legend swatches + SVG `appendContactSymbol()` fills.
- **Acceptance:** gauge legend filters visually map 1:1 to rendered contacts.

### 1.4 Elevation/contrast pass
- Widen the steps between `--surface`, `--surface-2`, `--surface-3` and `--line` variants so panels separate on real monitors.
- Honor `prefers-reduced-motion` (gate the spring animations).

---

## Phase 2 — Flow & cross-tool continuity

### 2.1 Shared app state + deep-linking
- Encode `tab` + active PN/arrangement in `location.hash` (e.g. `#decode/D38999-26WE35PN`, `#catalog/17-26`).
- Parse on load → restore tab and re-run the relevant action.
- **Acceptance:** refresh and shared links restore state; back/forward navigates tabs.

### 2.2 "Send to →" actions
- On the decoded result card and converter result, add actions: **Mating**, **Arrangements**, **Build**, **Layout Designer** — each preloaded with the current PN/arrangement.
- **Acceptance:** decoding `26WE35PN` then "Send to Mating" lands on Mating with it already resolved.

### 2.3 Recent / favorites
- `localStorage`-backed history of decoded + converted PNs (`d38999.recent`, capped).
- Star to favorite (`d38999.favorites`).
- Surface on Home and the Decode sidebar.
- **Acceptance:** survives reload; click re-decodes.

### 2.4 Global smart search
- One header search box that routes by pattern:
  - Looks like a D38999/shorthand PN → Decode.
  - Looks like `NN-NN` or bare arrangement → Arrangements.
  - Manufacturer PN → Converter.
- **Acceptance:** each pattern routes to the right tab and runs.

---

## Phase 3 — Responsive / GUI layout

### 3.1 Breakpoints
- Decoder 3-column (`sidebar | main | right-panel`) → stack/drawer under ~1024px.
- Catalog 2-pane → collapsible filter drawer.
- Layout Designer 4-column workspace → tabbed/accordion on narrow screens.
- **Acceptance:** usable at 768px and 375px widths; no horizontal scroll.

### 3.2 Sticky context + keyboard
- Pin decoded PN + key fields in a sticky bar while scrolling the viewer.
- Shortcuts: `Enter` decode (exists), `Esc` clear, arrows step arrangements, number keys toggle gauge filters, `?` shortcut overlay.
- **Acceptance:** documented in `?` overlay; no conflicts with inputs.

---

## Phase 4 — Accessibility

- Consistent visible focus rings on all interactive elements.
- `aria-live` on decode/convert/mating result regions.
- Sync `aria-pressed` on gauge legend filters with state.
- Contrast audit of the new palette (target WCAG AA).
- `prefers-reduced-motion` respected (shared with 1.4).
- **Acceptance:** keyboard-only walkthrough of every tab; no dead ends.

---

## Phase 5 — Content

### 5.1 Inline "why" tooltips
- Hover/tap explainers on every decoded field (shell size, finish, polarization, contact style), sourced from existing Manual data.
- **Acceptance:** each decoded field has an explainer; works on touch.

### 5.2 Sourcing / confidence badges
- Surface provenance (verified catalog / QPL / federalconnectors / inferred) as a subtle badge on results.
- **Acceptance:** exact vs inferred is visually distinguishable and explained on hover.

### 5.3 Close documented data gaps
- Work `TODO_d38999_data_gaps.md` + repo-memory known holes:
  - 12 arrangements lacking `std1560` geometry audit.
  - QPL contact styles `L`/`I` missing from `defs.contact_styles`.
  - Accessory cap-size token `A1`; cap sheets `/51`,`/52`; Glenair `/00`.
- Flag still-unverified items in-UI with `.needs-review` styling.
- **Acceptance:** smoke test warnings reduced and/or each remaining warning intentionally surfaced in-app.

### 5.4 Manual & export
- Add a few annotated full-PN walkthroughs + searchable glossary to the Manual.
- Add CSV/print export to Decode and Mating (parity with Layout Designer).
- **Acceptance:** export produces valid CSV; glossary search filters terms.

---

## Phase 6 — Simplification & friendliness (in progress)

Goal: lower the barrier for non-expert users without changing decode/validation logic. Builds on the shipped phases; pure copy + layout + workflow.

### 6.A Language & text simplification (started)
- Pair every engineering term with plain language on first use: "Alignment key (polarization)", "Connector series (slash sheet)", "Shell style (plug or panel mount)", "Contact size (gauge)".
- Task-first microcopy: Home hero → "What do you want to do? / Pick a tool below."; Mating → "Find the connector that plugs into your part — same pin layout, opposite pins and sockets."; Manual → "Learn what each part of the code means, with examples."
- Keep data keys (`polarization`, `insert_arrangement`, etc.) untouched — display copy only.
- **Done so far:** `app/index.html` home hero, catalog `slashSheetFilter`/`shellStyleFilter`/`keyingFilter` labels, mating hero, manual source line.
- **Next:** centralize remaining strings via a small `COPY`/`GLOSSARY` map in `app.js`; reading-level pass on Manual + per-field "Why?" text.

### 6.B Reduce visual density
- Decode right rail: keep **Decoded** prominent; collapse **Guide** into a "How this P/N breaks down" disclosure; reveal **Pin** only on selection.
- Arrangements: keep Shell size + Arrangement + search visible; move Contacts/Size/Type/Gender into the existing `Advanced filters` `<details>`.
- Revisit 8 top-level tabs: consider grouping Mating/Build/Converter as contextual "Send to →" actions (deep-link plumbing already exists from Phase 2).

### 6.C Workflow guidance
- Home: one clear primary action ("Decode a part number") with a clickable example, instead of an even 8-card grid.
- After a decode: compact "Next: find its mate · browse this arrangement · build a variant" row (wire to existing `data-decoded-action` handlers).
- Better empty/error states: cause + suggested fix + a clickable example chip.
- Per-tab one-line "what is this for" caption under each tab H2.

### 6.D Design polish (tokens already exist)
- Make the decoded P/N the hero element (large mono, field-segmented via `--series-*`/`--gender-*`).
- One primary button per view; demote secondary actions to ghost/text.
- Tighten spacing/grouping rhythm on dense blocks (legend, filters, decoded grid).

### Sequencing within Phase 6
6.A (text) → 6.B (density) → 6.C (workflow) → 6.D (polish). Validate each with `python3 scripts/build_app.py` + `python3 scripts/smoke_test_connectors.py` and a manual light/dark pass.

---

## Sequencing

1. **Phase 1** (design tokens + dark mode) — unblocks everything visual.
2. **Phase 2** (flow + deep-linking) — highest UX payoff.
3. **Phase 3** (responsive) — leans on Phase 1 tokens.
4. **Phase 4** (a11y) — finalize against the settled palette.
5. **Phase 5** (content) — incremental, can interleave.

## Validation per phase

- After any change touching data or generated files: `python3 scripts/build_app.py` then `python3 scripts/smoke_test_connectors.py`.
- Manual smoke: open `app/index.html`, exercise each tab in light + dark.
- Keep decode/validation logic untouched unless a content task (5.3) explicitly requires it.

## Out of scope (for now)

- Backend/server features, accounts, telemetry.
- Framework migration (stays vanilla JS/CSS).
- Changing the data-generation pipeline architecture.
