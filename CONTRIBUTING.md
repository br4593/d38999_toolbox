# Contributing

Thanks for your interest in improving the D38999 Toolbox.

## Source-of-truth rules

The whole project follows one principle: **no fact is filled from memory**.
Every decoded field, every contact label, every manufacturer mapping must be
traceable to a file in `docs/pdfs/` (or a transparent transformation of one).

If you cannot point to a source page, the corresponding JSON should be marked
`unknown` or `needs_review` and the UI should surface that uncertainty.

## Layout cheat sheet

| Where | What lives there |
|---|---|
| `app/` | The shipped web app and source-of-truth UI files (`index.html`, `styles.css`, `app.js`, `converter.js`, `app-data.js`). Edit HTML/CSS/JS here. |
| `data/` | Canonical JSON / SVG / CSV / SQLite data. Regenerable via the extract / build scripts. |
| `scripts/` | All Python entry points + the converter rule database (`d38999_rules.py`). |
| `tests/` | Smoke test for the built app. |
| `docs/` | Manufacturer guide markdown and source PDFs. |

## Adding a manufacturer rule

1. Add the rule block to `scripts/d38999_rules.py` with `source_url` / `source_page`
   referring to a file in `docs/pdfs/`.
2. Run `python scripts/build_d38999_database.py` to refresh the CSVs and SQLite.
3. Run `python scripts/build_app.py` to re-embed rules into `app/app-data.js`.
4. Run `node tests/validate_app.js` (requires local Chrome / Edge) and
   `python scripts/convert_d38999.py <sample PN>` for the new manufacturer to
   confirm the round-trip works.

## Adding an insert arrangement

Edit the extraction logic in `scripts/extract_arrangements.py` rather than
hand-editing `data/insert_arrangements.json`. Then re-run:

```
python scripts/extract_arrangements.py
python scripts/build_app.py
```

If the arrangement requires manual review, add it to the `review_needed.json`
output produced by the extraction script and document the ambiguity in the
script's review-emission code path.

## Pull request checklist

- [ ] `python scripts/build_app.py` succeeds.
- [ ] `python scripts/convert_d38999.py D38999/26WD35PN` still produces an
      Amphenol / Conesys / Glenair / ITT Cannon / Souriau row.
- [ ] No new `?` labels appear in `app/data/insert_arrangements.json`.
- [ ] No new entries in `data/review_needed.json` go undocumented.
- [ ] CI is green.
