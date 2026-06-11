"""Extract DLA MIL-DTL-38999 document metadata for the in-app manual.

Input:
  docs/pdfs/dla_mil_dtl_38999_list.html
  docs/pdfs/dla/*.pdf

Output:
  data/dla_documents.json

The download step is intentionally separate because the DLA site can be
sensitive to client/TLS behavior. This script only parses local files.
"""

from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import fitz

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LIST_HTML = PROJECT_ROOT / "docs" / "pdfs" / "dla_mil_dtl_38999_list.html"
PDF_DIR = PROJECT_ROOT / "docs" / "pdfs" / "dla"

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset_io import data_path  # noqa: E402

OUT_PATH = data_path("dla_documents.json")


def clean_text(value: str) -> str:
    value = re.sub(r"<.*?>", "", value, flags=re.S)
    value = html.unescape(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def parse_list_page() -> list[dict[str, str]]:
    text = LIST_HTML.read_text(encoding="utf-8")
    docs: list[dict[str, str]] = []
    pattern = re.compile(
        r'<a[^>]+href="(?P<href>[^"]+\.pdf)"[^>]*>(?P<title>.*?)</a>',
        re.I | re.S,
    )
    for match in pattern.finditer(text):
        href = html.unescape(match.group("href"))
        title = clean_text(match.group("title"))
        chunk = text[match.end() : match.end() + 1400]
        spans = [
            clean_text(span)
            for span in re.findall(r"<span[^>]*>(.*?)</span>", chunk, re.I | re.S)
        ]
        description = spans[0] if spans else ""
        dated = ""
        line2 = ""
        for span in spans:
            if span.startswith("Dated:"):
                dated = span.replace("Dated:", "", 1).strip()
            if "File name:" in span:
                line2 = span
        file_match = re.search(r"File name:\s*([^,]+)", line2)
        size_match = re.search(r"File Size:\s*([^,]+)$", line2, re.I)
        docs.append(
            {
                "title": title,
                "file": file_match.group(1).strip() if file_match else Path(href).name,
                "url": urljoin(
                    "https://landandmaritimeapps.dla.mil/Programs/MilSpec/ListDocs.aspx",
                    href,
                ),
                "description": description,
                "date": dated,
                "listed_size": size_match.group(1).strip() if size_match else "",
            }
        )

    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for doc in docs:
        key = doc["file"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(doc)
    return unique


def roman_series(text: str) -> str | None:
    normalized = text.upper()
    # Match IV before I so Series IV is not classified as Series I.
    for series in ("IV", "III", "II", "I"):
        if re.search(rf"\bSERIES\s+{series}\b", normalized):
            return series
    return None


def infer_component(description: str) -> str:
    d = description.lower()
    if "plug" in d and "cover" not in d:
        return "plug"
    if "receptacle" in d:
        return "receptacle"
    if "cover" in d:
        return "protective cover"
    if "nut" in d:
        return "mounting nut"
    if "memorandum" in d:
        return "memorandum"
    return "reference"


def infer_mount(description: str) -> str:
    d = description.lower()
    checks = [
        ("dummy stowage", "dummy stowage receptacle"),
        ("breakaway jamnut", "breakaway jam-nut receptacle"),
        ("breakaway wall", "breakaway wall-mount receptacle"),
        ("wall mounting", "wall-mount flange"),
        ("box mounting", "box-mount flange"),
        ("jam nut", "jam-nut mount"),
        ("jam-nut", "jam-nut mount"),
        ("jamnut", "jam-nut mount"),
        ("solder mounting", "solder-mount"),
        ("weld mounting", "weld-mount"),
        ("thru-bulkhead", "thru-bulkhead"),
        ("in line cable", "in-line cable receptacle"),
        ("lanyard release", "lanyard-release plug"),
        ("breakaway", "breakaway"),
    ]
    for needle, label in checks:
        if needle in d:
            return label
    if "straight" in d and "plug" in d:
        return "straight plug"
    if "cover" in d:
        return "cover"
    if "nut" in d:
        return "mounting hardware"
    return ""


def infer_coupling(description: str) -> str:
    d = description.lower()
    if "bayonet" in d:
        return "bayonet"
    if "threaded" in d:
        return "threaded"
    if "breech" in d:
        return "breech"
    return ""


def infer_contacts(description: str) -> str:
    d = description.lower()
    if "removable crimp" in d:
        if "pins" in d:
            return "removable crimp contacts, pins"
        if "sockets" in d:
            return "removable crimp contacts, sockets"
        return "removable crimp contacts"
    if "hermetic solder" in d or "hermetic soler" in d:
        return "hermetic solder contacts"
    if "crimp type" in d:
        return "crimp contacts"
    return ""


def classify(doc: dict[str, str]) -> dict[str, object]:
    title = doc["title"]
    description = doc["description"]
    combined = f"{title} {description}"
    slash = None
    match = re.search(r"MIL-DTL-38999/(\d+)", title)
    if match:
        slash = f"/{match.group(1)}"

    is_initial_draft = "initial draft" in title.lower() or doc["file"].lower().startswith("id")
    family = "base" if doc["file"].lower() == "dtl38999.pdf" else "associated"
    if slash:
        family = "slash_sheet"
    elif doc["file"].lower().startswith("ms"):
        family = "ms_sheet"
    elif "sup" in doc["file"].lower():
        family = "supplement"

    return {
        "family": family,
        "slash_sheet": slash,
        "is_initial_draft": is_initial_draft,
        "series": "III/IV" if "series iii and iv" in combined.lower() else roman_series(combined),
        "component": infer_component(description),
        "mount": infer_mount(description),
        "coupling": infer_coupling(description),
        "contacts": infer_contacts(description),
    }


def pdf_probe(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"downloaded": False}
    try:
        with fitz.open(path) as pdf:
            text = "\n".join(pdf[i].get_text() for i in range(min(2, len(pdf))))
            text = re.sub(r"\s+", " ", text).strip()
            return {
                "downloaded": True,
                "bytes": path.stat().st_size,
                "pages": len(pdf),
                "text_probe": text[:900],
            }
    except Exception as exc:  # pragma: no cover - defensive for corrupt PDFs
        return {"downloaded": False, "error": str(exc)}


def build() -> dict[str, object]:
    docs = []
    for item in parse_list_page():
        pdf_path = PDF_DIR / item["file"]
        docs.append({**item, **classify(item), "pdf": pdf_probe(pdf_path)})

    slash_sheets = [
        doc
        for doc in docs
        if doc["family"] == "slash_sheet"
        and doc["series"] in {"III", "IV", "III/IV"}
        and doc["slash_sheet"]
    ]
    approved = [doc for doc in slash_sheets if not doc["is_initial_draft"]]
    drafts = [doc for doc in slash_sheets if doc["is_initial_draft"]]
    ms_sheets = [doc for doc in docs if doc["family"] == "ms_sheet"]

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_page": "https://landandmaritimeapps.dla.mil/Programs/MilSpec/ListDocs.aspx?BasicDoc=MIL-DTL-38999",
        "download_dir": "docs/pdfs/dla",
        "document_count": len(docs),
        "downloaded_count": sum(1 for doc in docs if doc["pdf"].get("downloaded")),
        "summary": {
            "series_iii_iv_approved_slash_sheets": len(approved),
            "series_iii_iv_initial_drafts": len(drafts),
            "series_i_ii_ms_sheets": len(ms_sheets),
        },
        "documents": docs,
    }


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
