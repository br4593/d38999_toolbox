from __future__ import annotations

import argparse
import json
import re
from collections import deque
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset_io import data_path  # noqa: E402

BASE_URL = "https://d38999.federalconnectors.com/"
INDEX_PATH = "D38999"
DEFAULT_SEEDS = ["20", "21", "23", "24", "25", "26", "27"]
DEFAULT_PAGE_LIMIT = 500
ANCHOR_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
COUNTED_LINK_RE = re.compile(r"^D38999/([A-Z0-9/]+)\s*\((\d+)\)$")
EXACT_LINK_RE = re.compile(r"^D38999/([A-Z0-9/]+)$")
MIL_PN_RE = re.compile(r"^D38999/(?P<style>\d{2})(?P<class>[A-Z])(?P<shell>[A-Z]{1,2})(?P<arr>\d{1,3})(?P<contact>[A-Z])(?P<key>[A-Z])$")
USER_AGENT = "Mozilla/5.0 (compatible; d38999-toolbox-scraper/1.0)"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def clean_text(html_text: str) -> str:
    return " ".join(unescape(TAG_RE.sub(" ", html_text)).split())


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="ignore")


def load_support_map(data_dir: Path) -> dict[str, list[dict[str, Any]]]:
    payload = read_json(data_path("d38999_catalog_supported_combinations.json", data_dir))
    support_map: dict[str, list[dict[str, Any]]] = {}
    for row in payload.get("catalogSupportedCombinations", []):
        code = row.get("shellStyleCode")
        if not code:
            continue
        support_map.setdefault(code, []).append(row)
    return support_map


def load_verified_map(data_dir: Path) -> dict[str, dict[str, Any]]:
    payload = read_json(data_path("d38999_verified_part_numbers.json", data_dir))
    return {
        normalize_part_number(entry.get("partNumber", "")): entry
        for entry in payload.get("verifiedPartNumbers", [])
        if entry.get("partNumber")
    }


def normalize_part_number(part_number: str) -> str:
    return re.sub(r"[^A-Z0-9/]", "", (part_number or "").upper())


def decode_military_part_number(part_number: str) -> dict[str, str] | None:
    match = MIL_PN_RE.match(part_number)
    if not match:
        return None
    decoded = match.groupdict()
    decoded["slashSheet"] = f"/{decoded['style']}"
    return decoded


def crawl_site(seeds: list[str], page_limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    visited: set[str] = set()
    queued = deque(reversed(seeds))
    exact_by_part_number: dict[str, dict[str, Any]] = {}
    pages_fetched = 0
    intermediate_pages = 0
    seed_set = set(seeds)

    while queued:
        if pages_fetched >= page_limit:
            break
        query = queued.pop()
        if query in visited:
            continue
        visited.add(query)
        url = urljoin(BASE_URL, f"{INDEX_PATH}?{query}")
        try:
            html_text = fetch_text(url)
        except (HTTPError, URLError, TimeoutError):
            continue
        pages_fetched += 1
        intermediate_pages += 1
        child_queries: list[str] = []
        for href, anchor_html in ANCHOR_RE.findall(html_text):
            text = clean_text(anchor_html)
            counted = COUNTED_LINK_RE.match(text)
            if counted:
                slug = counted.group(1).replace("/", "")
                if any(slug.startswith(seed) for seed in seed_set) and slug not in visited:
                    child_queries.append(slug)
                continue
            exact = EXACT_LINK_RE.match(text)
            if not exact:
                continue
            part_number = f"D38999/{exact.group(1)}"
            normalized = normalize_part_number(part_number)
            if not any(normalized.startswith(f"D38999/{seed}") for seed in seed_set):
                continue
            exact_by_part_number.setdefault(normalized, {
                "partNumber": part_number,
                "sourcePage": url,
                "productUrl": urljoin(url, href),
                "query": query,
            })

        for child in sorted(set(child_queries), key=lambda item: (len(item), item), reverse=True):
            queued.append(child)

    metadata = {
        "seedPrefixes": seeds,
        "pageLimit": page_limit,
        "pagesFetched": pages_fetched,
        "intermediatePagesVisited": intermediate_pages,
    }
    return sorted(exact_by_part_number.values(), key=lambda entry: entry["partNumber"]), metadata


def classify_entries(entries: list[dict[str, Any]], verified_map: dict[str, dict[str, Any]], support_map: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    exact_verified_overlaps: list[str] = []
    importable_overlaps: list[dict[str, Any]] = []
    classified_entries: list[dict[str, Any]] = []

    for entry in entries:
        normalized = normalize_part_number(entry["partNumber"])
        verified = verified_map.get(normalized)
        decoded = decode_military_part_number(entry["partNumber"])
        support_rows = support_map.get(decoded["slashSheet"], []) if decoded else []
        matched_rows = [
            row for row in support_rows
            if decoded
            and decoded["contact"] in row.get("supportedContactStyles", [])
            and decoded["key"] in row.get("supportedKeying", [])
        ]

        classified = {
            **entry,
            "normalizedPartNumber": normalized,
            "decoded": {
                "slashSheet": decoded["slashSheet"],
                "class": decoded["class"],
                "shellSizeCode": decoded["shell"],
                "insertArrangement": decoded["arr"],
                "contactStyle": decoded["contact"],
                "keying": decoded["key"],
            } if decoded else None,
            "crossCheck": {
                "matchesVerifiedDataset": bool(verified),
                "verifiedManufacturer": verified.get("manufacturer") if verified else "",
                "verifiedSource": verified.get("source") if verified else "",
                "matchesCatalogSupportedCombination": bool(matched_rows),
                "manufacturerSupportSources": [row.get("source", "") for row in matched_rows if row.get("source")],
                "eligibleImport": bool(matched_rows),
            },
        }
        classified_entries.append(classified)

        if verified:
            exact_verified_overlaps.append(entry["partNumber"])
        if matched_rows:
            importable_overlaps.append({
                "partNumber": entry["partNumber"],
                "productUrl": entry["productUrl"],
                "sourcePage": entry["sourcePage"],
                "decoded": classified["decoded"],
                "manufacturerSupportSources": classified["crossCheck"]["manufacturerSupportSources"],
                "alreadyVerified": bool(verified),
                "verifiedManufacturer": verified.get("manufacturer") if verified else "",
            })

    return {
        "entries": classified_entries,
        "exactVerifiedOverlaps": sorted(set(exact_verified_overlaps)),
        "importableOverlaps": sorted(importable_overlaps, key=lambda item: item["partNumber"]),
    }


def build_payload(data_dir: Path, seeds: list[str], page_limit: int) -> dict[str, Any]:
    verified_map = load_verified_map(data_dir)
    support_map = load_support_map(data_dir)
    entries, crawl = crawl_site(seeds, page_limit)
    classified = classify_entries(entries, verified_map, support_map)
    return {
        "schema_version": "2026-05-19",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "name": "Federal Connectors D38999 index",
            "baseUrl": urljoin(BASE_URL, INDEX_PATH),
            "type": "secondary_source",
            "caveat": "Secondary-source distributor/index site. Exact part numbers are retained separately from manufacturer-verified catalog examples.",
        },
        "crawl": {
            **crawl,
            "exactPartNumbersFound": len(classified["entries"]),
            "exactVerifiedOverlapCount": len(classified["exactVerifiedOverlaps"]),
            "importableOverlapCount": len(classified["importableOverlaps"]),
        },
        "exactVerifiedOverlaps": classified["exactVerifiedOverlaps"],
        "importableOverlaps": classified["importableOverlaps"],
        "entries": classified["entries"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape exact D38999 part numbers from the federalconnectors hierarchical index.")
    parser.add_argument(
        "--project-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Project root directory (defaults to repository root).",
    )
    parser.add_argument(
        "--output",
        default=str(data_path("d38999_federalconnectors_secondary_source.json")),
        help="Output path relative to the project root.",
    )
    parser.add_argument(
        "--seeds",
        nargs="+",
        default=DEFAULT_SEEDS,
        help="Query-prefix seeds to crawl from the site hierarchy.",
    )
    parser.add_argument(
        "--page-limit",
        type=int,
        default=DEFAULT_PAGE_LIMIT,
        help="Maximum number of hierarchy pages to fetch before stopping.",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    output_path = (project_root / args.output).resolve()
    data_dir = project_root / "data"
    payload = build_payload(data_dir, args.seeds, args.page_limit)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {payload['crawl']['exactPartNumbersFound']} exact part numbers to {output_path} "
        f"({payload['crawl']['exactVerifiedOverlapCount']} exact verified overlaps, "
        f"{payload['crawl']['importableOverlapCount']} importable overlaps)."
    )


if __name__ == "__main__":
    main()