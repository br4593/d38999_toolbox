# NotebookLM source pack — D38999 Toolbox

This folder is a curated set of source material designed to be uploaded into **Google NotebookLM** (or any similar tool) so it can generate slides, audio overviews / podcasts, study guides, and explainer videos about the D38999 Toolbox.

## What to upload

Upload all of the following to a single NotebookLM notebook:

1. `01_app_description.md` — what the app is, who it is for, architecture, data provenance.
2. `02_user_manual.md` — step-by-step walk-through of every tab and feature.
3. Every file under `diagrams/` — six custom SVG illustrations.
4. *(Optional)* the project `README.md` at the repo root, for extra technical context.
5. *(Optional)* `docs/D38999_manufacturer_guide.md` and `docs/reciprocal_connector_logic.md`, for deeper detail on the converter and mating engine.

## Diagrams included

| File | What it shows |
|---|---|
| `diagrams/01_part_number_anatomy.svg` | Each character of `D38999/26WE35PN` explained on one chart. |
| `diagrams/02_architecture.svg` | PDFs → Python extractors → JSON → bundled JS → browser. |
| `diagrams/03_user_journey.svg` | The five-step typical user flow: type → decode → inspect → mate → convert. |
| `diagrams/04_mating_logic.svg` | Plug ↔ receptacle pairing rules at a glance. |
| `diagrams/05_data_flow.svg` | How input, engine, and output relate inside the browser. |
| `diagrams/06_tabs_map.svg` | The eight tabs of the app at a glance. |

## Suggested prompts for NotebookLM

- *"Create a 12-slide deck that introduces the D38999 Toolbox to a new hardware engineer. One slide per tab, plus an intro and a closing slide on data provenance."*
- *"Generate a 6-minute audio overview / podcast in two-host conversational style explaining what D38999 is and how the Toolbox helps."*
- *"Write a YouTube explainer-video script (3 minutes) that decodes the part number `D38999/26WE35PN` using the part-number anatomy diagram."*
- *"Produce a beginner-friendly FAQ that answers: what is D38999, what does each field mean, how do I find a mate, how do I convert to Amphenol?"*
- *"Draft a one-page study guide for a new harness designer learning to use this app."*

## Where the rest of the app lives

- Live app: `app/index.html` (open offline or via GitHub Pages).
- Source PDFs and reference text: `docs/pdfs/`, `docs/text/`.
- Extraction and build scripts: `scripts/`.
- Generated app data: `app/data/*.json`, `app/assets/svg/`, `app/app-data.js`.
