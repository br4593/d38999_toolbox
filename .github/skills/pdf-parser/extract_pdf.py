#!/usr/bin/env python3
"""
extract_pdf.py - General-purpose PDF extraction helper for the d38999_toolbox.

Usage:
  python .github/skills/pdf-parser/extract_pdf.py <pdf_path> [options]

Options:
  --pages N         Extract only page N (1-based). Repeat for multiple pages.
  --text            Dump plain text for each page (default mode).
  --blocks          Dump text blocks with bounding boxes as JSON.
  --words           Dump word-level tokens with bounding boxes as JSON.
  --links           List all hyperlinks found in the document.
  --toc             Print the document table of contents.
  --meta            Print document metadata (title, author, subject, etc.).
  --search PATTERN  Find all pages containing PATTERN (case-insensitive).
  --svg PAGE        Export page PAGE as an SVG string (stdout).
  --out FILE        Write JSON output to FILE instead of stdout.

Examples:
  # Dump full plain text of a PDF
  python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --text

  # Search for a pattern across all pages
  python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --search "shell size"

  # Extract word-level blocks from pages 3-5 as JSON
  python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --words --pages 3 --pages 4 --pages 5

  # Get document metadata and TOC
  python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --meta --toc

  # Export page 6 as SVG
  python .github/skills/pdf-parser/extract_pdf.py docs/pdfs/dtl38999.pdf --svg 6
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF is not installed. Run: pip install pymupdf>=1.24.0", file=sys.stderr)
    sys.exit(1)


def open_pdf(path: Path) -> fitz.Document:
    if not path.exists():
        print(f"ERROR: File not found: {path}", file=sys.stderr)
        sys.exit(1)
    return fitz.open(str(path))


def page_range(doc: fitz.Document, pages: list[int] | None) -> list[int]:
    """Return 0-based page indices to process."""
    total = doc.page_count
    if not pages:
        return list(range(total))
    result = []
    for p in pages:
        idx = p - 1
        if 0 <= idx < total:
            result.append(idx)
        else:
            print(f"WARNING: Page {p} out of range (document has {total} pages).", file=sys.stderr)
    return sorted(set(result))


def extract_text(doc: fitz.Document, indices: list[int]) -> list[dict]:
    results = []
    for i in indices:
        page = doc[i]
        results.append({"page": i + 1, "text": page.get_text("text")})
    return results


def extract_blocks(doc: fitz.Document, indices: list[int]) -> list[dict]:
    results = []
    for i in indices:
        page = doc[i]
        raw = page.get_text("dict")
        blocks = []
        for block in raw.get("blocks", []):
            if block.get("type") != 0:  # type 0 = text
                continue
            lines_text = []
            for line in block.get("lines", []):
                spans_text = " ".join(span["text"] for span in line.get("spans", []))
                lines_text.append(spans_text)
            blocks.append({
                "bbox": [round(v, 2) for v in block["bbox"]],
                "text": "\n".join(lines_text).strip(),
            })
        results.append({"page": i + 1, "blocks": blocks})
    return results


def extract_words(doc: fitz.Document, indices: list[int]) -> list[dict]:
    results = []
    for i in indices:
        page = doc[i]
        words = [
            {
                "text": w[4],
                "bbox": [round(v, 2) for v in w[:4]],
                "block": w[5],
                "line": w[6],
                "word": w[7],
            }
            for w in page.get_text("words")
        ]
        results.append({"page": i + 1, "words": words})
    return results


def extract_links(doc: fitz.Document, indices: list[int]) -> list[dict]:
    results = []
    for i in indices:
        page = doc[i]
        links = []
        for link in page.get_links():
            entry = {"bbox": [round(v, 2) for v in link.get("from", [])]}
            if link.get("uri"):
                entry["uri"] = link["uri"]
            if link.get("page") is not None:
                entry["dest_page"] = link["page"] + 1
            links.append(entry)
        if links:
            results.append({"page": i + 1, "links": links})
    return results


def extract_toc(doc: fitz.Document) -> list[dict]:
    toc = doc.get_toc()
    return [{"level": entry[0], "title": entry[1], "page": entry[2]} for entry in toc]


def extract_meta(doc: fitz.Document) -> dict:
    meta = doc.metadata or {}
    return {
        "page_count": doc.page_count,
        "title": meta.get("title", ""),
        "author": meta.get("author", ""),
        "subject": meta.get("subject", ""),
        "keywords": meta.get("keywords", ""),
        "creator": meta.get("creator", ""),
        "producer": meta.get("producer", ""),
        "creation_date": meta.get("creationDate", ""),
        "mod_date": meta.get("modDate", ""),
    }


def search_text(doc: fitz.Document, pattern: str) -> list[dict]:
    results = []
    for i in range(doc.page_count):
        page = doc[i]
        hits = page.search_for(pattern, quads=False)
        if hits:
            text = page.get_text("text")
            # Return a short context snippet around first hit
            results.append({
                "page": i + 1,
                "hit_count": len(hits),
                "bboxes": [[round(v, 2) for v in h] for h in hits],
                "context": text[:500].strip(),
            })
    return results


def export_svg(doc: fitz.Document, page_number: int) -> str:
    idx = page_number - 1
    if idx < 0 or idx >= doc.page_count:
        print(f"ERROR: Page {page_number} out of range.", file=sys.stderr)
        sys.exit(1)
    page = doc[idx]
    return page.get_svg_image()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="General-purpose PDF extraction helper for d38999_toolbox.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("pdf", type=Path, help="Path to the PDF file.")
    parser.add_argument("--pages", type=int, action="append", metavar="N",
                        help="Page number(s) to process (1-based). Repeat for multiple.")
    parser.add_argument("--text", action="store_true", help="Dump plain text per page.")
    parser.add_argument("--blocks", action="store_true", help="Dump text blocks with bboxes as JSON.")
    parser.add_argument("--words", action="store_true", help="Dump word tokens with bboxes as JSON.")
    parser.add_argument("--links", action="store_true", help="List hyperlinks.")
    parser.add_argument("--toc", action="store_true", help="Print table of contents.")
    parser.add_argument("--meta", action="store_true", help="Print document metadata.")
    parser.add_argument("--search", metavar="PATTERN", help="Search for pattern across all pages.")
    parser.add_argument("--svg", type=int, metavar="PAGE", help="Export page as SVG.")
    parser.add_argument("--out", type=Path, metavar="FILE", help="Write JSON output to FILE.")

    args = parser.parse_args()

    doc = open_pdf(args.pdf)
    indices = page_range(doc, args.pages)
    output: dict = {}

    if args.meta:
        output["meta"] = extract_meta(doc)

    if args.toc:
        output["toc"] = extract_toc(doc)

    if args.search:
        output["search"] = {
            "pattern": args.search,
            "results": search_text(doc, args.search),
        }

    if args.text:
        output["text"] = extract_text(doc, indices)

    if args.blocks:
        output["blocks"] = extract_blocks(doc, indices)

    if args.words:
        output["words"] = extract_words(doc, indices)

    if args.links:
        output["links"] = extract_links(doc, indices)

    if args.svg is not None:
        print(export_svg(doc, args.svg))
        doc.close()
        return

    if not output:
        # Default: plain text
        output["text"] = extract_text(doc, indices)

    doc.close()

    json_str = json.dumps(output, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(json_str, encoding="utf-8")
        print(f"Written to {args.out}", file=sys.stderr)
    else:
        print(json_str)


if __name__ == "__main__":
    main()
