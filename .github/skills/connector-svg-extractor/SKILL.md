---
name: connector-svg-extractor
description: >
  Extracts connector drawings (mating face views, side / profile views, isometric
  shape views) from PDFs in the d38999_toolbox repository, converts them to clean
  SVG, renames them with the project's connector naming convention, and — when the
  drawing is a face view — emits pin / contact center coordinates as JSON. Use this
  skill whenever the user asks to "rip", "extract", "crop", "vectorize", "make an
  SVG of", or "find pin coordinates for" a connector drawing in any of the PDFs
  under `docs/pdfs/`.
allowed-tools: shell
---

# Connector SVG Extractor Skill

Pull connector drawings out of source PDFs and turn them into curated SVG assets
that fit alongside the existing icons in `app/assets/svg/`.

This skill reuses the PyMuPDF (`fitz`) plumbing already used by
`scripts/extract_arrangements.py` and the `pdf-parser` skill — but is targeted at
**individual connector drawings** in catalogs and datasheets, not the
arrangement chart in `d38999-contact-arrangements.pdf`.

---

## Inputs you usually have

PDFs live under `docs/pdfs/` in the new tree:

| Group | Where | Typical drawings |
|-------|-------|------------------|
| Specs | `docs/pdfs/specs/` (+ `slash-sheets/`, `ms-sheets/`) | Figure 1–6 face views, polarization keys, contact arrangements. |
| Manufacturer catalogs | `docs/pdfs/catalogs/<vendor>/` | Plug / receptacle profile views, mating-face renders, accessory side views. |
| Product datasheets | `docs/pdfs/datasheets/...` | Per-part-number side / face / iso views with pin tables. |
| Reference visuals | `docs/pdfs/reference/` | `d38999-shell-keying.pdf` (Series III key angles), arrangement charts. |
| DLA shell-type catalogs | `docs/pdfs/specs/slash-sheets/` | Per-slash-sheet face + profile drawings. |

The user usually points at one PDF and one or more pages or part numbers.

---

## Quick-start

```bash
# 1. Probe the PDF first (page count, drawings per page, candidate vector blocks)
python .github/skills/connector-svg-extractor/extract_connector_svg.py \
    docs/pdfs/catalogs/glenair/Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf --probe

# 2. Dump every candidate vector cluster on a specific page as raw SVG + JSON metadata
python .github/skills/connector-svg-extractor/extract_connector_svg.py \
    docs/pdfs/catalogs/glenair/Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf \
    --page 14 --out-dir /tmp/glenair_p14

# 3. Crop a specific clip rectangle (PDF points: x0 y0 x1 y1) and label the view
python .github/skills/connector-svg-extractor/extract_connector_svg.py \
    docs/pdfs/catalogs/amphenol/Amphenol_D38999_Series_III.pdf \
    --page 7 --clip 72 110 320 320 \
    --view face --vendor amphenol --series 3 --shell 17 --arrangement 17-26 \
    --out app/assets/svg/

# 4. Face view → also write pin coordinates JSON next to the SVG
python .github/skills/connector-svg-extractor/extract_connector_svg.py \
    docs/pdfs/specs/slash-sheets/dtl38999ss20.pdf \
    --page 3 --view face --pins \
    --vendor mil --series 3 --shell 11 --arrangement 11-35 \
    --out app/assets/svg/
```

The script never overwrites an existing file unless `--force` is given.

---

## Naming convention

All emitted SVGs follow this kebab-case scheme so they slot into
`app/assets/svg/` cleanly. Match what's already there before inventing new tokens.

```
<vendor>-<family>-[<shell>-]<arrangement-or-product>-<view>.svg
```

| Token | Allowed values | Notes |
|-------|----------------|-------|
| `vendor` | `mil`, `amphenol`, `conesys`, `eaton`, `glenair`, `itt`, `souriau`, `te` | `mil` for DLA / spec drawings. |
| `family` | `d38999`, `supernine`, `superseal`, `8d`, `dts`, `act`, `tv`, `ctv`, `mighty-mouse` | Use the manufacturer's family name when present, otherwise `d38999`. |
| `shell` | `09`–`25` (two-digit) or letter code (`a`–`j`) | Optional. Omit for non-D38999 products. |
| `arrangement-or-product` | e.g. `11-35`, `17-26`, `233-350`, `rj45`, `usb3`, `hdmi` | Use the arrangement ID for face views, the part-family suffix for product views. |
| `view` | `face`, `profile`, `iso`, `plug`, `receptacle`, `jam-nut-receptacle`, `wall-mount-receptacle`, `straight-plug`, `backshell`, `keying` | Required. |

Examples (existing assets, copy this style):

- `d38999-jam-nut-receptacle.svg`
- `d38999-wall-mount-receptacle.svg`
- `glenair-supernine-hdmi-face.svg`
- `glenair-superseal-usb3-face.svg`

If the user gives a free-form description, ask for the missing tokens (vendor /
view / arrangement) before writing files.

---

## Cleaning rules

PyMuPDF's `page.get_svg_image()` produces a faithful but noisy SVG. The
extractor pipeline applies these passes — keep them when extending the script:

1. **Crop to clip rectangle.** Either the user-supplied `--clip x0 y0 x1 y1`
   or an auto-detected vector cluster (largest connected vector group whose
   aspect ratio falls in `[0.5, 2.0]`). The crop becomes the SVG `viewBox`.
2. **Strip surrounding text.** Remove `<text>` elements whose bbox lies
   outside the connector body — they are usually callouts, page numbers, or
   table headers. Keep pin labels (single-character tokens inside the body).
3. **Normalize stroke / fill.** Replace black fills with `currentColor` and
   set a single `stroke-width="1"` group attribute, mirroring the curated
   icons already in `app/assets/svg/`.
4. **Re-origin viewBox.** Translate so the body starts at `(0, 0)` and round
   coordinates to 2 decimals. Preserve aspect ratio.
5. **Drop PyMuPDF metadata.** Remove `<title>`, `<desc>`, `id="page0"`, and
   the surrounding `<g transform="...">` wrapper if it only re-applies the
   page CTM.
6. **Pretty-print.** Two-space indent, one element per line, so diffs are
   reviewable.

Anything the cleaner cannot resolve (e.g., raster image embedded in the page)
is logged to `data/review_needed.json` with `reason: "raster_only_drawing"`.

> **Known size caveat.** PyMuPDF's `page.get_svg_image()` always emits the
> entire page's vector content, even when the cropbox is narrowed. The
> cleaner sets the correct `viewBox`, so only the connector renders, but the
> raw byte size can still be hundreds of KB for dense catalog pages. For
> assets that ship in `app/assets/svg/`, hand-prune unused `<path>`/`<defs>`
> after extraction or run a passthrough like `svgo`.

---

## Pin / contact coordinates (face views only)

When `--pins` is set and `--view face`, the script:

1. Locates the outer connector circle the same way `extract_arrangements.py`
   does — largest near-square stroked path inside the clip whose width is in
   `[12, 200]` pt.
2. Detects contact circles inside it (small near-circular paths, < 65 % of the
   shell radius, ≥ 2 cubic curves OR a 4-item path).
3. Clusters near-duplicate detections (same approach as
   `detect_contacts()` in `extract_arrangements.py`).
4. Reads single-character labels (`A`, `B`, …, `1`, `2`, …) within the outer
   circle and Hungarian-matches them to MIL-STD-1560 reference positions when
   `data/reference/std1560.pdf` is available.

Pin output JSON sits next to the SVG with the same stem:

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-06-11T07:42:08Z",
  "source_pdf": "docs/pdfs/specs/slash-sheets/dtl38999ss20.pdf",
  "source_pdf_sha256": "…",
  "source_page": 3,
  "view": "face",
  "arrangement": "11-35",
  "shell_size": "11",
  "viewBox": [0, 0, 100, 100],
  "outer_circle": { "cx": 50.0, "cy": 50.0, "r": 41.5 },
  "contacts": [
    { "label": "A", "x": 35.21, "y": 41.88, "diameter": 4.2,
      "size": "20", "type": "signal", "confidence": "high",
      "standard_x": -0.184, "standard_y": 0.184 }
  ],
  "review_needed": []
}
```

Coordinates are **SVG units** (post-crop, post-translate, 2-decimal). The
`standard_x`/`standard_y` fields are MIL-STD-1560 inches when the matcher ran.

---

## Project conventions to honor

These are the same rules the `pdf-parser` skill documents — don't drift:

- Every JSON output carries `schema_version`, `generated_at`, `source_pdf`,
  `source_pdf_sha256`, `source_page`.
- Every contact / shape carries a `confidence` of `"high"`, `"medium"`, or
  `"needs_manual_verification"`.
- Unresolved cases append to `data/review_needed.json` with `id`, `reason`,
  `details`. Do not silently drop ambiguous drawings.
- Curated SVGs go in `app/assets/svg/`. Raw / temporary crops go under
  `output/` (already gitignored) or `/tmp/`.
- After committing new SVGs, run `python scripts/build_app.py` so they land
  in `app/app-data.js`.

---

## Common workflows

### A. "Make an SVG of the face view of arrangement 11-35"

1. Find the PDF page that contains the drawing — usually
   `docs/pdfs/specs/slash-sheets/dtl38999ss<n>.pdf` or
   `docs/pdfs/reference/d38999-contact-arrangements.pdf`.
2. Run the script with `--probe` to list candidate clusters.
3. Re-run with the cluster's clip rect + `--view face --pins` and the
   correct vendor / arrangement tokens.
4. Inspect the SVG and pin JSON; fix labels in `data/review_needed.json`
   if any are flagged.

### B. "Extract the side / profile view of an Amphenol jam-nut receptacle"

1. Open the catalog page (`docs/pdfs/catalogs/amphenol/...`).
2. Use `--probe` and pick the cluster matching the silhouette (wider than
   tall, aspect ≈ 2.0).
3. Run with `--view jam-nut-receptacle` (no `--pins` — profile views don't
   carry pin coordinates).
4. Output goes to `app/assets/svg/amphenol-d38999-jam-nut-receptacle.svg`.

### C. "Pull all 8 face views from an MS27xxx sheet"

1. Run `--probe` to get the per-page cluster count.
2. Loop: for each page with a face cluster, call the script with
   `--page N --view face --pins --arrangement <id>`.
3. Verify outputs by opening the generated SVGs in the browser.

---

## Editing the script

`extract_connector_svg.py` lives next to this SKILL.md. Keep its public CLI
flags stable — other agents rely on the contract documented above. When
adding cleaners, do so as ordered passes inside `clean_svg()` so each pass is
opt-out via a `--no-<pass>` flag.

If you find a recurring crop pattern (e.g., "Glenair Series III catalogs
always put the face view in the top-left quadrant"), add a named preset to
`PRESETS` rather than duplicating CLI calls.
