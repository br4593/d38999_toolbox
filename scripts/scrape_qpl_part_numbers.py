from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

try:
    import requests
except ImportError:  # pragma: no cover - fallback for minimal environments
    requests = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dataset_io import data_path  # noqa: E402

DEFAULT_OUTPUT = data_path("qpl_1122_part_numbers.json")
BASE_URL = "https://qpldocs.dla.mil/search/parts.aspx?qpl={qpl}"


class InputParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.inputs: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "input":
            return
        values = {key: value or "" for key, value in attrs}
        if "name" in values:
            self.inputs.append(values)


@dataclass
class PageResult:
    part_numbers: list[str]
    current_page: int
    total_pages: int
    form_fields: dict[str, str]


def parse_form_fields(html: str) -> dict[str, str]:
    parser = InputParser()
    parser.feed(html)
    fields: dict[str, str] = {}
    for attrs in parser.inputs:
        input_type = attrs.get("type", "text").lower()
        if input_type in {"submit", "image", "button", "reset", "file"}:
            continue
        fields[attrs["name"]] = attrs.get("value", "")
    return fields


def parse_page_info(html: str) -> tuple[int, int]:
    match = re.search(r"Page&nbsp;(\d+)&nbsp;of&nbsp;(\d+)", html)
    if not match:
        raise ValueError("Unable to locate page counter in QPL response")
    return int(match.group(1)), int(match.group(2))


def parse_part_numbers(html: str) -> list[str]:
    matches = re.findall(r">\s*(D38999/[^<]+?)\s*<", html)
    return [unescape(match).strip() for match in matches]


def fetch_html(client, qpl: str, fields: dict[str, str] | None = None) -> str:
    url = BASE_URL.format(qpl=qpl)
    if requests is not None and isinstance(client, requests.Session):
        if fields is None:
            response = client.get(url, timeout=60)
        else:
            response = client.post(url, data=fields, timeout=60)
        response.raise_for_status()
        return response.text

    if fields is None:
        request = Request(url)
    else:
        request = Request(url, data=urlencode(fields).encode("utf-8"), method="POST")
    with client.open(request, timeout=60) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_page(client, qpl: str, fields: dict[str, str] | None = None) -> PageResult:
    html = fetch_html(client, qpl, fields)
    current_page, total_pages = parse_page_info(html)
    return PageResult(
        part_numbers=parse_part_numbers(html),
        current_page=current_page,
        total_pages=total_pages,
        form_fields=parse_form_fields(html),
    )


def iter_part_numbers(qpl: str, limit_pages: int | None = None) -> tuple[list[str], int]:
    client = requests.Session() if requests is not None else build_opener(HTTPCookieProcessor())
    page = fetch_page(client, qpl)
    collected: list[str] = []
    seen: set[str] = set()

    def add_items(items: Iterable[str]) -> None:
        for item in items:
            if item in seen:
                continue
            seen.add(item)
            collected.append(item)

    add_items(page.part_numbers)
    total_pages = page.total_pages
    last_page = min(total_pages, limit_pages) if limit_pages else total_pages

    for page_number in range(2, last_page + 1):
        fields = dict(page.form_fields)
        fields["Lu_gov$Datagrid_navigation1$txtPgNum"] = str(page_number)
        fields["Lu_gov$Datagrid_navigation1$btnGoTo"] = "Go to Page"
        page = fetch_page(client, qpl, fields)
        if page.current_page != page_number:
            raise ValueError(
                f"Expected page {page_number}, received page {page.current_page}"
            )
        add_items(page.part_numbers)
        if page_number % 25 == 0 or page_number == last_page:
            print(
                f"Scraped page {page.current_page}/{page.total_pages}: {len(collected)} unique part numbers",
                file=sys.stderr,
            )

    return collected, total_pages


def build_payload(qpl: str, part_numbers: list[str], total_pages: int) -> dict[str, object]:
    return {
        "source": BASE_URL.format(qpl=qpl),
        "qpl": qpl,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "total_pages": total_pages,
        "part_count": len(part_numbers),
        "part_numbers": part_numbers,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape DLA QPL part numbers")
    parser.add_argument("--qpl", default="1122", help="QPL identifier to scrape")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="JSON file to write",
    )
    parser.add_argument(
        "--limit-pages",
        type=int,
        default=None,
        help="Optional page limit for quick validation runs",
    )
    args = parser.parse_args()

    part_numbers, total_pages = iter_part_numbers(args.qpl, args.limit_pages)
    payload = build_payload(args.qpl, part_numbers, total_pages)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(part_numbers)} part numbers from QPL {args.qpl} to {args.output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())