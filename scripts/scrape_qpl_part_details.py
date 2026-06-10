"""Crawl the DLA QPL-1122 (MIL-DTL-38999) parts list and, for every government
part number, fetch the per-part "qualified source" detail that the site reveals
when a part link is pressed.

The public listing at https://qpldocs.dla.mil/search/parts.aspx?qpl=1122 renders
25 government part rows per page (an ASP.NET DataGrid).  Each part number is a
postback link; pressing it posts back ``__EVENTTARGET=Lu_gov$DG$ctlNN$btnGovPartNo``
and the response embeds a manufacturer grid (``Lu_man_DG``) listing the qualified
sources (CAGE code, company, country, manufacturer part number, certification
status).

Outputs:
* ``data/qpl_1122_part_details.json`` - rich per-part detail (NSN + qualified
  sources) plus crawl metadata.
* ``data/qpl_1122_part_numbers.json`` - refreshed, backward-compatible part list
  consumed by ``build_valid_d38999_pns.py``.

The crawl is polite (configurable delay), resumable (an on-disk JSONL cache keyed
by part number), and idempotent.  A plain ``urllib`` opener with a cookie jar is
used deliberately: the site's F5 WAF rejects requests that arrive without the
session cookies it sets on the first response.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

try:  # keep-alive connection reuse + concurrency when available
    import requests
except ImportError:  # pragma: no cover - urllib fallback for minimal envs
    requests = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_DETAILS_OUTPUT = DATA_DIR / "qpl_1122_part_details.json"
DEFAULT_LIST_OUTPUT = DATA_DIR / "qpl_1122_part_numbers.json"
CACHE_DIR = DATA_DIR / ".cache"

BASE_URL = "https://qpldocs.dla.mil/search/parts.aspx?qpl={qpl}"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

GOV_LINK_RE = re.compile(
    r'id="Lu_gov_DG_(ctl\d+)_btnGovPartNo"[^>]*>\s*([^<]+?)\s*</a>'
)
GOV_PLAIN_RE = re.compile(
    r'id="Lu_gov_DG_(ctl\d+)_lblGovPartNo"[^>]*>\s*([^<]*?)\s*</span>'
)
GOV_NSN_RE = re.compile(
    r'id="Lu_gov_DG_(ctl\d+)_lblNSN"[^>]*>\s*([^<]*?)\s*</span>'
)
PAGE_INFO_RE = re.compile(r"Page&nbsp;(\d+)&nbsp;of&nbsp;(\d+)")
TOTAL_COUNT_RE = re.compile(r"Total part count\s*=\s*([\d,]+)")
INPUT_RE = re.compile(r"<input\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(r'(\w[\w:-]*)\s*=\s*"([^"]*)"')
MAN_ROW_FIELD_RE = re.compile(
    r'id="Lu_man_DG_(ctl\d+)_(lblMfgPart|lblCompany|lblCountry|lblCAGECode)"'
    r'[^>]*>(.*?)</span>',
    re.S,
)
MAN_STATUS_RE = re.compile(
    r'id="Lu_man_DG_(ctl\d+)_imgCompanyStatus"[^>]*?alt="([^"]*)"', re.S
)
LABEL_RE_CACHE: dict[str, re.Pattern[str]] = {}


def left_nav_label(html: str, label_id: str) -> str:
    pattern = LABEL_RE_CACHE.get(label_id)
    if pattern is None:
        pattern = re.compile(
            r'id="' + re.escape(label_id) + r'"[^>]*>\s*([^<]*?)\s*</span>'
        )
        LABEL_RE_CACHE[label_id] = pattern
    match = pattern.search(html)
    return unescape(match.group(1)).strip() if match else ""


def strip_tags(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def normalize_part_number(part_number: str) -> str:
    return re.sub(r"\s+", "", (part_number or "").upper())


def make_client(workers: int = 1):
    """Return a keep-alive requests.Session, or a urllib opener as a fallback."""
    if requests is not None:
        session = requests.Session()
        session.headers.update(REQUEST_HEADERS)
        pool = max(workers + 2, 4)
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=pool, pool_maxsize=pool
        )
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session
    return build_opener(HTTPCookieProcessor(CookieJar()))


def fetch(client, qpl: str, fields: dict[str, str] | None = None, retries: int = 4) -> str:
    url = BASE_URL.format(qpl=qpl)
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            if requests is not None and isinstance(client, requests.Session):
                if fields is None:
                    response = client.get(url, timeout=90)
                else:
                    response = client.post(url, data=fields, timeout=90)
                response.raise_for_status()
                body = response.text
            else:
                data = urlencode(fields).encode("utf-8") if fields is not None else None
                request = Request(url, data=data, headers=REQUEST_HEADERS)
                with client.open(request, timeout=90) as response:
                    body = response.read().decode("utf-8", "ignore")
            if "Request Rejected" in body:
                raise RuntimeError("WAF rejected the request")
            return body
        except Exception as error:  # noqa: BLE001 - retry on any transport error
            last_error = error
            wait = min(30, 2 ** attempt) + random.uniform(0, 1)
            print(
                f"  ! request failed (attempt {attempt}/{retries}): {error}; "
                f"retrying in {wait:.1f}s",
                file=sys.stderr,
            )
            time.sleep(wait)
    raise RuntimeError(f"Failed to fetch after {retries} attempts: {last_error}")


def parse_hidden_fields(html: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for match in INPUT_RE.finditer(html):
        attrs = {key.lower(): value for key, value in ATTR_RE.findall(match.group(0))}
        input_type = attrs.get("type", "text").lower()
        if input_type in {"submit", "image", "button", "reset", "file"}:
            continue
        name = attrs.get("name")
        if not name:
            continue
        fields[name] = unescape(attrs.get("value", ""))
    return fields


def parse_page_info(html: str) -> tuple[int, int]:
    match = PAGE_INFO_RE.search(html)
    if not match:
        raise ValueError("Unable to locate page counter in QPL response")
    return int(match.group(1)), int(match.group(2))


def parse_total_count(html: str) -> int | None:
    match = TOTAL_COUNT_RE.search(html)
    return int(match.group(1).replace(",", "")) if match else None


def parse_gov_rows(html: str) -> list[dict[str, str]]:
    """Return ordered government rows: {ctl, partNumber, nsn, hasSource}."""
    nsn_by_ctl = {ctl: strip_tags(value) for ctl, value in GOV_NSN_RE.findall(html)}
    rows: list[dict[str, str]] = []
    seen_ctl: set[str] = set()
    for ctl, part in GOV_LINK_RE.findall(html):
        seen_ctl.add(ctl)
        rows.append(
            {
                "ctl": ctl,
                "partNumber": unescape(part).strip(),
                "nsn": nsn_by_ctl.get(ctl, ""),
                "hasSource": True,
            }
        )
    for ctl, part in GOV_PLAIN_RE.findall(html):
        text = unescape(part).strip()
        if ctl in seen_ctl or not text:
            continue
        rows.append(
            {
                "ctl": ctl,
                "partNumber": text,
                "nsn": nsn_by_ctl.get(ctl, ""),
                "hasSource": False,
            }
        )
    rows.sort(key=lambda row: row["ctl"])
    return rows


def split_mfg_part(raw: str) -> tuple[str, str]:
    """Split a manufacturer-part cell into the part number and an optional note.

    The site renders these as ``<part> ( <suffix> )`` where the suffix is often
    empty (``( )``) or stray punctuation.  The part number is the first token; a
    note is kept only when it carries alphanumeric content.
    """
    text = strip_tags(raw)
    if not text:
        return "", ""
    pieces = text.split(None, 1)
    base = pieces[0]
    remainder = pieces[1].strip() if len(pieces) > 1 else ""
    note = remainder.strip("()- ").strip()
    if not re.search(r"[A-Za-z0-9]", note):
        note = ""
    return base, note


def status_from_alt(alt: str) -> str:
    alt_l = alt.lower()
    if "certified" in alt_l and "not" not in alt_l:
        return "certified"
    if "inactive" in alt_l or "no longer" in alt_l or "not " in alt_l:
        return "inactive"
    return alt.strip()


def parse_manufacturer_rows(html: str) -> list[dict[str, str]]:
    by_ctl: dict[str, dict[str, str]] = {}
    for ctl, field, value in MAN_ROW_FIELD_RE.findall(html):
        record = by_ctl.setdefault(ctl, {})
        if field == "lblMfgPart":
            part, note = split_mfg_part(value)
            record["mfgPart"] = part
            record["mfgPartNote"] = note
        elif field == "lblCompany":
            record["company"] = strip_tags(value)
        elif field == "lblCountry":
            record["country"] = strip_tags(value)
        elif field == "lblCAGECode":
            record["cage"] = strip_tags(value)
    for ctl, alt in MAN_STATUS_RE.findall(html):
        by_ctl.setdefault(ctl, {})["status"] = status_from_alt(unescape(alt))

    sources: list[dict[str, str]] = []
    for ctl in sorted(by_ctl):
        record = by_ctl[ctl]
        if not any(record.get(key) for key in ("cage", "company", "mfgPart")):
            continue
        sources.append(
            {
                "cage": record.get("cage", ""),
                "company": record.get("company", ""),
                "country": record.get("country", ""),
                "mfgPart": record.get("mfgPart", ""),
                "mfgPartNote": record.get("mfgPartNote", ""),
                "status": record.get("status", ""),
            }
        )
    return sources


def gov_target(ctl: str) -> str:
    return f"Lu_gov$DG${ctl}$btnGovPartNo"


def navigate_to_page(client, qpl: str, base_fields: dict[str, str], page_number: int) -> str:
    fields = dict(base_fields)
    fields["__EVENTTARGET"] = ""
    fields["__EVENTARGUMENT"] = ""
    fields["Lu_gov$Datagrid_navigation1$txtPgNum"] = str(page_number)
    fields["Lu_gov$Datagrid_navigation1$btnGoTo"] = "Go to Page"
    return fetch(client, qpl, fields)


def fetch_detail(client, qpl: str, base_fields: dict[str, str], ctl: str) -> list[dict[str, str]]:
    fields = dict(base_fields)
    fields["__EVENTTARGET"] = gov_target(ctl)
    fields["__EVENTARGUMENT"] = ""
    html = fetch(client, qpl, fields)
    return parse_manufacturer_rows(html)


def load_cache(cache_path: Path) -> dict[str, dict[str, object]]:
    records: dict[str, dict[str, object]] = {}
    if not cache_path.exists():
        return records
    with cache_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = entry.get("partNumber")
            if key:
                records[normalize_part_number(key)] = entry
    return records


def append_cache(cache_path: Path, entry: dict[str, object]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def write_outputs(
    qpl: str,
    meta: dict[str, object],
    records: dict[str, dict[str, object]],
    details_path: Path,
    list_path: Path,
) -> None:
    parts = sorted(records.values(), key=lambda item: normalize_part_number(str(item["partNumber"])))
    part_numbers = [str(item["partNumber"]) for item in parts]
    sourced = sum(1 for item in parts if item.get("qualifiedSources"))

    details_payload = {
        "source": BASE_URL.format(qpl=qpl),
        "qpl": qpl,
        "governingSpec": meta.get("governingSpec", ""),
        "qplNumber": meta.get("qplNumber", ""),
        "qplDate": meta.get("qplDate", ""),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "total_pages": meta.get("totalPages"),
        "row_count": meta.get("rowCount"),
        "part_count": len(parts),
        "parts_with_qualified_source": sourced,
        "parts": parts,
    }
    details_path.parent.mkdir(parents=True, exist_ok=True)
    details_path.write_text(
        json.dumps(details_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    list_payload = {
        "source": BASE_URL.format(qpl=qpl),
        "qpl": qpl,
        "scraped_at": details_payload["scraped_at"],
        "total_pages": meta.get("totalPages"),
        "part_count": len(part_numbers),
        "part_numbers": part_numbers,
    }
    list_path.write_text(
        json.dumps(list_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def crawl(args: argparse.Namespace) -> int:
    qpl = args.qpl
    cache_path = args.cache or (CACHE_DIR / f"qpl_{qpl}_details.jsonl")
    records = {} if args.no_resume else load_cache(cache_path)
    if records:
        print(f"Resuming: {len(records)} part details already cached.", file=sys.stderr)

    client = make_client(args.workers)
    html = fetch(client, qpl)
    current_page, total_pages = parse_page_info(html)
    meta: dict[str, object] = {
        "governingSpec": "MIL-DTL-38999",
        "qplNumber": left_nav_label(html, "search_Left_nav1_lblQPLNum"),
        "qplDate": left_nav_label(html, "search_Left_nav1_lblQplDate"),
        "totalPages": total_pages,
        "rowCount": parse_total_count(html),
    }
    last_page = min(total_pages, args.limit_pages) if args.limit_pages else total_pages
    start_page = max(1, args.start_page)

    if start_page > 1:
        html = navigate_to_page(client, qpl, parse_hidden_fields(html), start_page)
        current_page, _ = parse_page_info(html)
        if current_page != start_page:
            raise ValueError(f"Expected page {start_page}, received {current_page}")

    processed = 0
    for page_number in range(start_page, last_page + 1):
        base_fields = parse_hidden_fields(html)
        rows = parse_gov_rows(html)

        pending: list[dict[str, str]] = []
        for row in rows:
            key = normalize_part_number(row["partNumber"])
            if key in records:
                continue
            if not row["hasSource"]:
                entry = {
                    "partNumber": row["partNumber"],
                    "nsn": row["nsn"],
                    "qualifiedSources": [],
                }
                records[key] = entry
                append_cache(cache_path, entry)
                processed += 1
            else:
                pending.append(row)

        def _work(row: dict[str, str]):
            if args.delay:
                time.sleep(random.uniform(0, args.delay))
            return row, fetch_detail(client, qpl, base_fields, row["ctl"])

        stop = False
        if pending:
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
                for row, sources in executor.map(_work, pending):
                    key = normalize_part_number(row["partNumber"])
                    entry = {
                        "partNumber": row["partNumber"],
                        "nsn": row["nsn"],
                        "qualifiedSources": sources,
                    }
                    records[key] = entry
                    append_cache(cache_path, entry)
                    processed += 1
                    if args.max_parts and processed >= args.max_parts:
                        stop = True
                        break

        if page_number % args.checkpoint_pages == 0 or page_number == last_page or stop:
            write_outputs(qpl, meta, records, args.details_output, args.list_output)
            print(
                f"Page {page_number}/{last_page}: {len(records)} parts cached "
                f"(+{processed} this run)",
                file=sys.stderr,
            )

        if stop:
            print(f"Reached --max-parts={args.max_parts}; stopping.", file=sys.stderr)
            return 0

        if page_number < last_page:
            html = navigate_to_page(client, qpl, base_fields, page_number + 1)
            current_page, _ = parse_page_info(html)
            if current_page != page_number + 1:
                raise ValueError(
                    f"Expected page {page_number + 1}, received {current_page}"
                )

    write_outputs(qpl, meta, records, args.details_output, args.list_output)
    print(
        f"Done: {len(records)} part details written to {args.details_output}",
        file=sys.stderr,
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Crawl QPL part numbers and their qualified-source detail."
    )
    parser.add_argument("--qpl", default="1122", help="QPL identifier (default 1122).")
    parser.add_argument("--details-output", type=Path, default=DEFAULT_DETAILS_OUTPUT)
    parser.add_argument("--list-output", type=Path, default=DEFAULT_LIST_OUTPUT)
    parser.add_argument("--cache", type=Path, default=None, help="JSONL resume cache path.")
    parser.add_argument("--delay", type=float, default=0.2, help="Max random jitter (s) before each detail request.")
    parser.add_argument("--workers", type=int, default=6, help="Concurrent detail fetches per page.")
    parser.add_argument("--limit-pages", type=int, default=None, help="Stop after N pages.")
    parser.add_argument("--start-page", type=int, default=1, help="First page to crawl.")
    parser.add_argument("--max-parts", type=int, default=None, help="Stop after N new parts.")
    parser.add_argument(
        "--checkpoint-pages", type=int, default=5, help="Flush outputs every N pages."
    )
    parser.add_argument(
        "--no-resume", action="store_true", help="Ignore any existing cache."
    )
    args = parser.parse_args()
    try:
        return crawl(args)
    except KeyboardInterrupt:
        print("Interrupted; progress is preserved in the cache.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
