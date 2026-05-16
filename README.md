# D38999 Toolbox

A self-contained offline toolbox for MIL-DTL-38999 / D38999 circular connectors.

The app combines:

- A part-number decoder that accepts full PNs like `D38999/26WE35PN` and shorthand like `26WE35PN`.
- An insert-arrangement browser with 63 arrangements and 1,747 contacts.
- A connector drawing with gauge-specific pin symbols, Series III keying teeth, separator guide paths, and hover labels.
- A manufacturer cross-reference converter for Amphenol, Conesys, Glenair, ITT Cannon, Souriau, TE Deutsch, and Eaton equivalents.
- A beginner-friendly D38999 manual with an interactive PN guide, shell type, shell size, insert arrangement, contact style, finish, and DLA source summaries.

The app is single-page, offline, and dependency-free. Open `app/index.html` in any browser. No server, no build step, and no `fetch()` are required.

## Quick Start

```bash
git clone <this-repo>
cd d38999-toolbox

# Linux
xdg-open app/index.html

# macOS
open app/index.html

# Windows
start app/index.html
```

## Host on GitHub Pages

This repo ships a workflow (`.github/workflows/pages.yml`) that publishes the `app/` folder to GitHub Pages on every push to `main`. To turn it on:

1. Push the repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. (Optional) Push any change to `main`, or trigger **Actions → Deploy to GitHub Pages → Run workflow** manually.

The site will be served at `https://<your-user>.github.io/<repo-name>/` (or your project page URL). All asset paths in the app are relative, so it works correctly under any project sub-path.

If you'd rather not use Actions, you can instead point Pages directly at a branch + folder. Make a `gh-pages` branch whose contents are the files in `app/`, or change Pages **Source** to `main` / `/ (root)` after copying `app/` to the repo root. The Actions workflow is the recommended route because it rebuilds `app/` from sources on every push.

## Project Layout

The `app/` directory is the single source of truth for everything the browser
loads. Edit HTML, CSS, and JS directly in `app/`. Generated artifacts inside
`app/` are `app/app-data.js`, `app/data/*.json`, and `app/assets/svg/*`, which
`scripts/build_app.py` refreshes from `data/*` plus `scripts/d38999_rules.py`.

```text
d38999-toolbox/
|-- app/                          # the runnable web app (source of truth)
|   |-- index.html
|   |-- styles.css
|   |-- app.js                    # pinout + arrangement browser + manual
|   |-- converter.js              # manufacturer cross-reference converter
|   |-- app-data.js               # GENERATED: embedded JSON + converter rules
|   |-- data/*.json               # 5 JSON files (extraction outputs)
|   `-- assets/svg/               # 63 arrangement vector crops
|-- data/                         # converter-only source data (not in app/)
|   |-- conversion_rules.csv
|   |-- style_mappings.csv
|   |-- finish_mappings.csv
|   |-- rule_constraints.csv
|   |-- example_conversions.csv
|   |-- d38999_cross_reference.sqlite
|   `-- reference/std1560.pdf     # MIL-STD-1560 reference for extract scripts
|-- scripts/
|   |-- d38999_rules.py           # converter rule database
|   |-- convert_d38999.py         # CLI converter
|   |-- build_d38999_database.py  # rebuilds data/*.csv + sqlite from d38999_rules.py
|   |-- extract_arrangements.py   # PDF -> app/data/*.json + app/assets/svg/
|   |-- extract_standard_definitions.py
|   |-- extract_dla_documents.py
|   |-- build_app.py              # regenerates app/app-data.js
|   `-- validate_app.js           # headless-Chrome smoke test
|-- docs/
|   |-- D38999_manufacturer_guide.md
|   |-- pdfs/                     # source MIL-DTL-38999 / DLA / manufacturer PDFs
|   `-- text/                     # PyMuPDF text dumps (audit / search)
`-- .github/workflows/
    |-- ci.yml                    # JSON parse, build, CLI converter smoke test
    `-- pages.yml                 # deploy app/ to GitHub Pages
```

If you're working from an earlier checkout that still has `app_static/`,
`tests/`, `text/`, `data/svg/`, or `data/*.json` lying around, those are
legacy duplicates of files now living under `app/` and `docs/`. Run
`bash scripts/cleanup_workspace.sh` (or `.\scripts\cleanup_workspace.ps1`) once
to remove them locally — they are already in `.gitignore` so they will not be
committed regardless.

## Features

### Pinout

- Decode `D38999/26WE35PN` or shorthand `26WE35PN`.
- The P/N input defaults to `D38999/`.
- Valid typed PNs automatically switch the connector drawing to the matching insert arrangement.
- Missing polarization defaults to `N`; explicit `A`, `B`, `C`, `D`, and `E` are supported.
- Series III keying teeth are rendered on the connector drawing from the extracted Figure 6 angle table.
- Hover a contact to see only pin name and gauge.
- Search pins by label and inspect the selected pin detail in the decoder.
- Compare two insert arrangements side by side.

### Converter

- Convert D38999 PNs to manufacturer candidates.
- Convert manufacturer PNs back to D38999.
- Shows decoded shell type, shell size, class/finish, insert arrangement, contact style, and polarization.

### Manual

- Interactive PN guide where users click each PN element to see what it means.
- Beginner-facing wording uses "shell type" for `/20`, `/24`, `/26`, etc.
- Distinguishes shell type from shell-size code, for example `E` means shell size `17`.
- Summarizes approved DLA Series III/IV shell-type documents and drafts.

## Data Provenance

All decoded fields and arrangement geometry come from supplied source PDFs or generated data derived from those PDFs.

| Source | Used for |
|---|---|
| `docs/pdfs/dtl38999.pdf` | Part-number field order, shell-size codes, contact styles, classes/finishes, series definitions, and Series III polarization. |
| `docs/pdfs/d38999-contact-arrangements.pdf` | Insert arrangement drawings, contact locations, labels, counts, contact-size notes, and SVG crops. |
| `docs/pdfs/dla/*.pdf` and `data/dla_documents.json` | DLA MIL-DTL-38999 shell-type source catalog, approved Series III/IV sheets, and initial draft tracking. |
| `data/reference/std1560.pdf` | MIL-STD-1560 reference used to correct insert arrangement labels where needed. |
| Manufacturer PDFs in `docs/pdfs/` | Cross-reference rules in `scripts/d38999_rules.py`. |

If a source PDF does not contain a definition, generated JSON marks the value as unknown or needing manual verification.

## Regenerating

The repo ships with generated app artifacts so it works immediately. The
extract scripts write directly into `app/data/` and `app/assets/svg/`; the
build script bundles `app/data/*.json` + `scripts/d38999_rules.py` into
`app/app-data.js`. To regenerate from source PDFs:

```bash
python -m pip install -r requirements.txt

python scripts/extract_arrangements.py            # writes app/data/insert_arrangements.json + app/assets/svg/
python scripts/extract_standard_definitions.py    # writes app/data/standard_definitions.json + part_number_rules.json
python scripts/extract_dla_documents.py           # writes app/data/dla_documents.json
python scripts/build_d38999_database.py           # refreshes data/*.csv + sqlite from d38999_rules.py
python scripts/build_app.py                       # bakes app/app-data.js
```

To run the CLI converter:

```bash
python scripts/convert_d38999.py D38999/26WD35PN
```

## Validation

Run the smoke test with a local Chrome or Edge install:

```bash
npm run validate
```

The validator checks app loading, part-number decoding, arrangement filtering, SVG rendering, gauge symbols, label uniqueness, pin search, CSV export, and manual rendering.

## GitHub Upload Notes

- Do not upload `.venv/`, `output/`, `node_modules/`, browser profiles, or local temp files.
- Those artifacts are ignored by `.gitignore`.
- No committed file should exceed GitHub's 100 MB hard file limit.
- The committed `app/` folder is intentionally included so the app can run directly from GitHub Pages or a downloaded ZIP.

## Requirements

- Python 3.10+ only for regeneration scripts.
- `pymupdf` and `pillow` for extraction scripts.
- Node 18+ and Chrome/Edge for `npm run validate`.

## License

See [LICENSE](LICENSE). Source standards and manufacturer PDFs under `docs/pdfs/` are redistributed under their own terms; see `docs/pdfs/manifest.json` for upstream URLs where available.
