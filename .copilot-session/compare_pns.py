#!/usr/bin/env python3
"""Compare scraped D38999 part numbers vs the app database, produce gap report."""
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRAPED = ROOT / ".copilot-session" / "scraped_pns.json"
APP_DB = ROOT / "data" / "d38999_valid_part_numbers.json"
SECONDARY = ROOT / "data" / "d38999_federalconnectors_secondary_source.json"
OUT_JSON = ROOT / ".copilot-session" / "gap_report.json"
OUT_TXT = ROOT / ".copilot-session" / "gap_report.txt"

# D38999/<sheet><class><shell><contact><arr><contact-style>...
# Examples: D38999/26WE35PN, D38999/20FA23SN
PN_RE = re.compile(r"^D38999/(\d{2})([A-Z])", re.IGNORECASE)


def parse(pn: str):
    m = PN_RE.match(pn.strip())
    if not m:
        return None, None
    return m.group(1), m.group(2).upper()


def load_scraped():
    data = json.loads(SCRAPED.read_text())
    return {p.strip().upper() for p in data["part_numbers"] if p.strip()}


def load_app():
    data = json.loads(APP_DB.read_text())
    return {e["partNumber"].strip().upper() for e in data["partNumbers"] if e.get("partNumber")}


def load_secondary_count():
    data = json.loads(SECONDARY.read_text())
    # try common shapes
    for key in ("partNumbers", "part_numbers", "parts"):
        if key in data and isinstance(data[key], list):
            return len(data[key]), key
    return None, None


def main():
    scraped = load_scraped()
    app = load_app()
    sec_count, sec_key = load_secondary_count()

    only_web = scraped - app
    only_app = app - scraped
    both = scraped & app

    coverage = (len(both) / len(scraped) * 100) if scraped else 0.0

    # by slash sheet
    sheets = defaultdict(lambda: {"web": set(), "app": set()})
    sheet_class = defaultdict(lambda: defaultdict(lambda: {"web": 0, "app": 0, "missing": 0}))

    for pn in scraped:
        s, c = parse(pn)
        if s:
            sheets[s]["web"].add(pn)
    for pn in app:
        s, c = parse(pn)
        if s:
            sheets[s]["app"].add(pn)

    by_sheet = {}
    for s in sorted(sheets):
        w = sheets[s]["web"]
        a = sheets[s]["app"]
        missing = w - a
        by_sheet[s] = {
            "website_count": len(w),
            "app_count": len(a),
            "missing_from_app": len(missing),
            "in_both": len(w & a),
            "only_in_app": len(a - w),
            "coverage_pct": round(len(w & a) / len(w) * 100, 2) if w else 0.0,
        }

    # by sheet + class
    by_sheet_class = {}
    for s in sorted(sheets):
        cls_web = defaultdict(set)
        cls_app = defaultdict(set)
        for pn in sheets[s]["web"]:
            _, c = parse(pn)
            if c:
                cls_web[c].add(pn)
        for pn in sheets[s]["app"]:
            _, c = parse(pn)
            if c:
                cls_app[c].add(pn)
        classes = sorted(set(cls_web) | set(cls_app))
        by_sheet_class[s] = {}
        for c in classes:
            w = cls_web[c]
            a = cls_app[c]
            by_sheet_class[s][c] = {
                "website_count": len(w),
                "app_count": len(a),
                "missing_from_app": len(w - a),
                "coverage_pct": round(len(w & a) / len(w) * 100, 2) if w else 0.0,
            }

    missing_sample = sorted(only_web)[:50]
    only_app_sample = sorted(only_app)[:20]

    report = {
        "summary": {
            "scraped_total": len(scraped),
            "app_total": len(app),
            "in_both": len(both),
            "only_on_website": len(only_web),
            "only_in_app": len(only_app),
            "coverage_pct": round(coverage, 2),
            "secondary_source_count": sec_count,
            "secondary_source_key": sec_key,
        },
        "by_slash_sheet": by_sheet,
        "by_slash_sheet_class": by_sheet_class,
        "missing_pns_sample": missing_sample,
        "only_in_app_sample": only_app_sample,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2))

    # text report
    lines = []
    lines.append("D38999 PN Coverage Report")
    lines.append("=========================")
    lines.append(f"Scraped from federalconnectors.com: {len(scraped):>8,}")
    lines.append(f"In app database:                    {len(app):>8,}")
    lines.append(f"In both:                            {len(both):>8,} ({coverage:.1f}% of website)")
    lines.append(f"Missing from app (website only):    {len(only_web):>8,}")
    lines.append(f"In app but not on website:          {len(only_app):>8,}")
    if sec_count is not None:
        lines.append(f"Secondary-source file PNs ({sec_key}): {sec_count:,}")
    lines.append("")
    lines.append("Coverage by Slash Sheet:")
    lines.append(f"{'Sheet':<6} {'Website':>8} {'App':>8} {'Missing':>8} {'OnlyApp':>8} {'Coverage':>9}")
    for s in sorted(by_sheet):
        d = by_sheet[s]
        lines.append(
            f"/{s:<5} {d['website_count']:>8} {d['app_count']:>8} {d['missing_from_app']:>8} "
            f"{d['only_in_app']:>8} {d['coverage_pct']:>8.1f}%"
        )
    lines.append("")
    lines.append("Coverage by Slash Sheet + Class (classes with >0 on website):")
    for s in sorted(by_sheet_class):
        lines.append(f"  /{s}:")
        lines.append(f"    {'Class':<6} {'Website':>8} {'App':>8} {'Missing':>8} {'Coverage':>9}")
        for c, d in by_sheet_class[s].items():
            if d["website_count"] == 0:
                continue
            lines.append(
                f"    {c:<6} {d['website_count']:>8} {d['app_count']:>8} {d['missing_from_app']:>8} {d['coverage_pct']:>8.1f}%"
            )
    lines.append("")
    lines.append("Sample missing PNs (first 25):")
    for pn in missing_sample[:25]:
        lines.append(f"  {pn}")
    lines.append("")
    lines.append("Sample 'in app but not on website' PNs (first 20):")
    for pn in only_app_sample:
        lines.append(f"  {pn}")

    text = "\n".join(lines) + "\n"
    OUT_TXT.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
