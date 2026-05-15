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

## Project Layout

```text
d38999-toolbox/
|-- app/                      # ready-to-open offline web app
|   |-- index.html
|   |-- styles.css
|   |-- app.js                # pinout + arrangement browser + manual
|   |-- converter.js          # manufacturer cross-reference converter
|   |-- app-data.js           # embedded JSON bundle
|   |-- data/                 # generated JSON for inspection
|   `-- assets/svg/           # 63 arrangement vector crops
|-- app_static/               # source HTML/CSS/JS templates
|-- data/                     # canonical source data
|   |-- insert_arrangements.json
|   |-- part_number_rules.json
|   |-- standard_definitions.json
|   |-- dla_documents.json
|   |-- review_needed.json
|   |-- svg/*.svg
|   |-- reference/std1560.pdf
|   |-- conversion_rules.csv
|   |-- style_mappings.csv
|   |-- finish_mappings.csv
|   |-- rule_constraints.csv
|   |-- example_conversions.csv
|   `-- d38999_cross_reference.sqlite
|-- scripts/
|   |-- d38999_rules.py
|   |-- convert_d38999.py
|   |-- build_d38999_database.py
|   |-- extract_arrangements.py
|   |-- extract_standard_definitions.py
|   |-- extract_dla_documents.py
|   `-- build_app.py
|-- tests/
|   `-- validate_app.js
|-- docs/
|   |-- D38999_manufacturer_guide.md
|   `-- pdfs/                 # source MIL-DTL-38999 / DLA / manufacturer PDFs
|-- text/                     # extracted source-PDF text dumps
`-- .github/workflows/ci.yml
```

## Features

### Pinout

- Decode `D38999/26WE35PN` or shorthand `26WE35PN`.
- The P/N input defaults to `D38999/`.
- Valid typed PNs automatically switch the connector drawing to the matching insert arrangement.
- Missing polarization defaults to `N`; explicit `A`, `B`, `C`, `D`, and `E` are supported.
- Series III keying teeth are rendered on the connector drawing from the extracted Figure 6 angle table.
- Hover a contact to see only pin name and gauge.
- Search pins by label and export the pin catalog to CSV.
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

The repo ships with generated app artifacts so it works immediately. To regenerate data and the app:

```bash
python -m pip install -r requirements.txt

python scripts/extract_arrangements.py
python scripts/extract_standard_definitions.py
python scripts/extract_dla_documents.py
python scripts/build_d38999_database.py
python scripts/build_app.py
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
