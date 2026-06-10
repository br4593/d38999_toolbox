# D38999 Toolbox — Improvement Plan

Status: **proposal / for review**
Scope: GUI, UX/UI, flow, design, color, content. Single-page offline app (`app/`), no build step required at runtime, no external dependencies.

## Guiding constraints

- **Offline-first, dependency-free.** No CDNs, no fetch, no frameworks. Everything ships in `app/`.
- **`app/` is source of truth.** Generated artifacts (`app/app-data.js`, `app/assets/svg/*`) come from `scripts/build_app.py`. Don't hand-edit generated files.
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

## Phase 7 — Data consolidation & structure simplification

Goal: shrink the shipped bundle and de-duplicate datasets **without changing decode/validation behaviour or data keys**. Grounded in how the app loads data: `app/index.html` loads only `app-data.js` + `app.js` + `converter.js`; the runtime reads everything from the embedded `window.D38999_TOOLBOX_DATA` and never `fetch()`es a JSON file.

### 7.A Zero-risk cleanup (DONE)
- Deleted stray 0-byte root files `Binary`, `Mutex`, `Queue`.
- Dropped `connector_engineering_reference.json` + `high_speed_interface_wiring_reference.json` from `DATA_FILES` in `scripts/build_app.py` (never embedded, never fetched; `HIGH_SPEED_PROTOCOLS` is hardcoded in `layout-designer.js`). Originals stay in `data/` as cited references; `build_app.py` now also prunes any stale copies from `app/data/`.
- Validated: build + `smoke_test_connectors.py --full` + `manufacturer_catalog_smoke_test.py --full` → 0 failures.

### 7.B Remove the `app/data/` runtime duplication (DONE)
- `app/data/*.json` was a 100% duplicate of the embedded bundle (every file had a `data/` counterpart) and nothing fetched it at runtime. `build_app.py` no longer generates the mirror and now `shutil.rmtree`s any stale `app/data/` on build; the directory was removed (17 tracked files staged for deletion).
- Proof functionality is unchanged: `app/app-data.js` is **byte-identical** before/after (sha256 `c04928b5…`), because the embed reads from canonical `data/`, not the mirror. SVG assets under `app/assets/` are untouched. Root `index.html` only meta-refreshes to `./app/`, so no direct-file access depended on the mirror.
- Validated: build (idempotent — mirror does not reappear) + `smoke_test_connectors.py --full` + `manufacturer_catalog_smoke_test.py --full` → 0 failures.

### 7.C Retire the Layout Designer (DONE)
- The 71 KB `app/layout-designer.js` was never referenced by `app/index.html` (dead in the shipped app), so the feature was removed: deleted `app/layout-designer.js`, the `#layoutPanel` markup block in `app/index.html`, the `.ld-*` CSS section + dark-theme `.ld-*` overrides in `app/styles.css`, and the stale init comment in `app/app.js`.
- Follow-on exposed: `pinout_rules.json` (embedded `pinout.pinoutRules`) was only consumed by the Layout Designer, so it is now runtime-orphaned — a candidate to drop from the embedded bundle in 7.E. `high_speed_interface_wiring_reference.json` (already dropped in 7.A) was likewise only a companion reference.
- Validated: build + `smoke_test_connectors.py --full` + `manufacturer_catalog_smoke_test.py --full` → 0 failures; no editor errors in the touched files.

### 7.G Merge the two SVG asset trees into one (DONE)
- The shipped app carried two parallel SVG folders: `app/assets/svg/` (63 insert-arrangement files `d38999_NN-NN.svg`) and `app/assets/d38999/svg/` (77 connector face/profile/shell graphics). Only the second was live — the insert viewer renders each arrangement **inline** via `createElementNS`, and no code referenced `assets/svg/` (the 63 paths existed only as the dead `"svg"` field inside embedded `insert_arrangements.json`).
- Collapsed to a single `app/assets/svg/` holding just the 77 used graphics: renamed source `assets/d38999/svg/` → `assets/svg/`; rewrote the contiguous `assets/d38999/svg/` prefix to `assets/svg/` across `app/app.js` (11 refs), `app/converter.js` (2), and the `file` fields in `data/d38999_visual_assets.json` (43) + 3 research docs; updated `scripts/build_app.py` to copy the single `assets/svg/` source and `rmtree` `app/assets/` each build (idempotent, no stale files); fixed the `SRC_SVG`/`APP_SVG` path constants in `scripts/smoke_test_connectors.py`.
- Verified: `app/assets/` now contains only `svg/` (77 files); zero residual `assets/d38999` strings in `app/`/`data/`/`scripts/`; all 20 code-referenced + all `visual_assets` SVG paths resolve on disk.
- Validated: build + `smoke_test_connectors.py --full` + `manufacturer_catalog_smoke_test.py --full` → 0 failures (5 + 4 benign warnings); no editor errors.
- Known follow-up (data pipeline, out of scope): `scripts/extract_arrangements.py` still writes insert SVGs to `app/assets/svg/` and a stale `app/data/`; both are reset by the next `build_app.py` (rebuilds `app/assets/` clean, prunes `app/data/`). The dead `"svg"` field in `insert_arrangements.json` remains harmless metadata.

### 7.D Slim large embedded datasets
- `federalconnectors_secondary_source.json` (2.6 MB): emit a build-time slim variant carrying only the fields the app reads (`entries[].normalizedPartNumber`/`partNumber` + `importableOverlaps`), dropping raw crawl metadata.
- `d38999_valid_part_numbers.json` (14.5 MB): audit render/validate fields vs. provenance-only fields; move provenance to a build-time sidecar so the embedded copy stays lean.

### 7.E Consolidate the PN-source family
- `d38999_verified_part_numbers.json`, `d38999_part_number_examples.json`, `d38999_federalconnectors_secondary_source.json`, and `qpl_1122_part_numbers.json` all feed `build_valid_d38999_pns.py`. Keep them as source-of-truth inputs in `data/`, but once 7.D's provenance sidecar exists, stop embedding the cross-check sources separately — `validPartNumbers` becomes the single merged runtime DB.

### 7.F Repo hygiene for the 54 MB environment audit
- `d38999_environment_classification.json` is regenerable from `scripts/d38999_environment.py` and already excluded from the app. Option: gitignore + document regeneration, or store gzipped, to drop 54 MB from the working tree.

### Sequencing within Phase 7
7.A (done) → 7.C (done) → 7.B (done) → 7.G (done) → 7.D → 7.E → 7.F. Validate every step with `python3 scripts/build_app.py`, `smoke_test_connectors.py --full`, `manufacturer_catalog_smoke_test.py --full`, and `environment_smoke_test.py` (for 7.F).

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
