---
name: pdf-parser
description: >
  PDF extraction and analysis skill for the d38999_toolbox project.
  Use this skill when the user asks to read, parse, search, or extract data
  from any PDF file in the repository (e.g., docs/pdfs/*.pdf, DLA slash-sheet
  PDFs, manufacturer catalogs, MIL-STD-1560). Provides text extraction, block
  and word-level bounding-box data, page search, TOC, metadata, and SVG export
  via PyMuPDF (fitz). Also guides writing new extractor scripts that follow the
  project's established patterns.
allowed-tools: shell
---

# PDF Parser Skill

This skill extracts data from PDF files in the `d38999_toolbox` repository
using **PyMuPDF** (`fitz`). Use it to read source PDFs before writing new
extractor scripts, or to answer ad-hoc questions about PDF content.

---

## Quick-start: use the bundled helper script

The skill ships `extract_pdf.py` in its own directory. Run it directly — no
installation needed beyond `pymupdf` (already in `requirements.txt`):

```bash
# Dump plain text of the main standard
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --text

# Search across the whole document
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --search "shell size"

# Show metadata and table of contents
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --meta --toc

# Word-level bounding boxes for specific pages (JSON)
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --words --pages 3 --pages 4

# Text blocks with bounding boxes
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --blocks --pages 7

# Export page 6 as SVG
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --svg 6

# Save JSON output to file
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --text --out /tmp/dtl38999_text.json
```

### All flags

| Flag | Description |
|------|-------------|
| `--text` | Plain text per page (default if no other mode given). |
| `--blocks` | Text blocks with bounding boxes as JSON. |
| `--words` | Word tokens with bounding boxes as JSON. |
| `--links` | Hyperlinks per page. |
| `--toc` | Table of contents. |
| `--meta` | Document metadata (title, author, page count, dates). |
| `--search PATTERN` | Case-insensitive full-text search; returns pages, hit counts, bboxes, and context snippet. |
| `--svg PAGE` | Export one page as an SVG string. |
| `--pages N` | Restrict processing to page N (1-based, repeatable). |
| `--out FILE` | Write JSON output to FILE instead of stdout. |

---

## PyMuPDF API patterns used in this project

### Open and iterate pages

```python
import fitz

doc = fitz.open("docs/pdfs/dtl38999.pdf")
for page in doc:
    text = page.get_text("text")   # plain text
    # page.number is 0-based
doc.close()
```

### Text extraction modes

| Mode | Returns |
|------|---------|
| `"text"` | Plain string, reading order preserved. |
| `"dict"` | Nested dict: `blocks → lines → spans`. Each span has `text`, `bbox`, `font`, `size`, `color`. |
| `"words"` | List of `(x0, y0, x1, y1, word, block_no, line_no, word_no)`. |
| `"rawdict"` | Like `"dict"` but with individual character info. |
| `"html"` | HTML string. |
| `"xml"` | XML string. |

### Get word list (bounding boxes)

```python
words = page.get_text("words")
# Each entry: (x0, y0, x1, y1, "word_text", block_no, line_no, word_no)
for x0, y0, x1, y1, word, *_ in words:
    print(f"{word:20s}  bbox=({x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f})")
```

### Get structured blocks

```python
data = page.get_text("dict")
for block in data["blocks"]:
    if block["type"] != 0:   # 0 = text, 1 = image
        continue
    for line in block["lines"]:
        line_text = " ".join(span["text"] for span in line["spans"])
        print(line_text)
```

### Search for text

```python
hits = page.search_for("shell size", quads=False)
# Returns list of fitz.Rect; each has x0, y0, x1, y1
for rect in hits:
    print(f"Found on page {page.number + 1}: {rect}")
```

### Extract vector paths (for contact center detection)

```python
paths = page.get_drawings()
# Each path dict has: "rect", "type", "fill", "color", "width", "items"
# "items": list of ("l", pt1, pt2) lines, ("c", ...) curves, ("re", rect) rectangles
for path in paths:
    if path["type"] == "f" and path["fill"]:   # filled shape
        print(path["rect"])
```

### Export page as SVG

```python
svg_text = page.get_svg_image()
with open("page.svg", "w") as f:
    f.write(svg_text)
```

### Document metadata and TOC

```python
meta = doc.metadata   # dict: title, author, subject, keywords, creator, producer, dates
toc  = doc.get_toc()  # list of [level, title, page_number]
```

---

## Project extractor conventions

All extractor scripts in `scripts/` follow these conventions — match them when
writing new extractors:

### Output schema

Every JSON output file includes:
```json
{
  "schema_version": "1.0",
  "generated_at": "2026-05-14T19:35:01Z",
  "standard": "MIL-DTL-38999",
  "source_pdf": "dtl38999.pdf",
  "source_pdf_sha256": "..."
}
```

Compute the SHA-256 at extraction time:
```python
import hashlib
from pathlib import Path

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: h.update(fh.read(1 << 20)) or b"", b""):
            pass
    return h.hexdigest()
```

### Source citations

Every extracted field must carry its provenance:
```python
def source(page: int, section: str) -> dict:
    return {
        "source_pdf": "dtl38999.pdf",
        "source_page": page,
        "section": section,
    }
```

### Confidence tagging

Tag every value with `"confidence"`: `"high"`, `"medium"`, or `"needs_manual_verification"`.

### Output locations

| Script output | Destination |
|---------------|-------------|
| Insert arrangements + SVGs | `app/data/insert_arrangements.json`, `app/assets/svg/` |
| Standard definitions | `app/data/standard_definitions.json` |
| Part-number rules | `app/data/part_number_rules.json` |
| DLA documents | `app/data/dla_documents.json` |
| Unresolved items | `data/review_needed.json` |

After any extractor runs, regenerate the app bundle:
```bash
python scripts/build_app.py
```

### Review-needed pattern

Items that cannot be auto-resolved go to `data/review_needed.json`:
```python
review_items.append({
    "id": arrangement_id,
    "reason": "label_missing",
    "details": "Contact label could not be matched to MIL-STD-1560 reference.",
})
```

---

## Common extraction workflows

### 1. Read and inspect a new PDF

```bash
# Step 1 – metadata and page count
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/NEW.pdf --meta

# Step 2 – table of contents
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/NEW.pdf --toc

# Step 3 – search for key terms to find relevant pages
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/NEW.pdf --search "part number"
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/NEW.pdf --search "shell size"

# Step 4 – read specific pages
python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/NEW.pdf --text --pages 3 --pages 4
```

### 2. Extract a table from a known page

Use `--words` to get bounding boxes, then group by Y coordinate to reconstruct rows:

```python
import fitz, json
from collections import defaultdict

doc = fitz.open("docs/pdfs/dtl38999.pdf")
page = doc[2]  # page 3 (0-based)
words = page.get_text("words")

# Group words into rows by rounding y0 to nearest 5pt
rows = defaultdict(list)
for x0, y0, x1, y1, text, *_ in words:
    row_key = round(y0 / 5) * 5
    rows[row_key].append((x0, text))

for y_key in sorted(rows):
    row_words = sorted(rows[y_key], key=lambda t: t[0])
    print("  ".join(w for _, w in row_words))
doc.close()
```

### 3. Find contact center circles (vector graphics)

```python
import fitz

doc = fitz.open("docs/pdfs/d38999-contact-arrangements.pdf")
page = doc[0]
paths = page.get_drawings()

circles = []
for path in paths:
    rect = path["rect"]
    w = rect.width
    h = rect.height
    if abs(w - h) < 2 and 3 < w < 30:   # roughly circular and right size
        circles.append({"cx": (rect.x0 + rect.x1) / 2, "cy": (rect.y0 + rect.y1) / 2, "r": w / 2})

print(f"Found {len(circles)} candidate contact circles")
doc.close()
```

### 4. Export arrangement pages as SVG crops

```python
import fitz
from pathlib import Path

doc = fitz.open("docs/pdfs/d38999-contact-arrangements.pdf")
out_dir = Path("app/assets/svg")
out_dir.mkdir(parents=True, exist_ok=True)

for i, page in enumerate(doc):
    svg = page.get_svg_image()
    (out_dir / f"page_{i+1:03d}.svg").write_text(svg)

doc.close()
```

---

## Source PDFs in this repository

| File | Contents |
|------|----------|
| `docs/pdfs/dtl38999.pdf` | MIL-DTL-38999 main standard; part-number fields, series, shell sizes, classes, contact styles, polarization. |
| `docs/pdfs/d38999-contact-arrangements.pdf` | Insert arrangement drawings; contact locations and labels for all 63 arrangements. |
| `docs/pdfs/d38999-shell-keying.pdf` | Series III keying tooth angle table (Figure 6). |
| `docs/pdfs/dtl38999ss*.pdf` | DLA slash-sheet supplement PDFs (one per slash-sheet). |
| `docs/pdfs/dla/*.pdf` | DLA MIL-DTL-38999 shell-type source catalog PDFs. |
| `docs/pdfs/Amphenol_D38999_Series_III.pdf` | Amphenol Series III catalog. |
| `docs/pdfs/Amphenol-MIL-DTL-38999-series-I-II.pdf` | Amphenol Series I/II catalog. |
| `docs/pdfs/Conesys-MIL-DTL-38999-Series-III.pdf` | Conesys Series III catalog. |
| `docs/pdfs/Conesys-Hermetic.pdf` | Conesys hermetic catalog. |
| `docs/pdfs/Eaton_D38999_Series_IV.pdf` | Eaton Series IV catalog. |
| `docs/pdfs/Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf` | Glenair all-series catalog. |
| `docs/pdfs/ITT-Cannon-38999-Series-I-II-III.pdf` | ITT Cannon catalog. |
| `docs/pdfs/Souriau-Mil-DTL-38999-Series-III.pdf` | Souriau 8D Series III catalog. |
| `docs/pdfs/TE_Deutsch_D38999_Series_III.pdf` | TE Deutsch DTS/ACT Series III catalog. |
| `data/reference/std1560.pdf` | MIL-STD-1560 reference; used to cross-check insert arrangement labels. |

---

## Dependency check

```bash
python -c "import fitz; print('PyMuPDF', fitz.version)"
# If missing:
pip install pymupdf>=1.24.0
```
