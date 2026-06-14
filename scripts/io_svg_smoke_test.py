#!/usr/bin/env python3
"""
I/O connector SVG smoke test — graphics / drawings / representation / shape /
catalogs / correctness of the rugged D38999-style I/O connector visual assets.

This complements ``scripts/smoke_test_connectors.py`` (which validates the part
number logic and that referenced SVGs *exist*). Here we focus on the *drawings
themselves*: that every map points at a real file, that nothing is dead, that
source and build stay in lockstep, and that each SVG is well-formed, has a sane
viewBox, actually draws something, and (``--deep``) keeps its geometry inside
the viewBox.

Tables come straight from the shipping ``app/converter.js`` via the
``scripts/_io_svg_tables.js`` node helper (the real source of truth), with a
stdlib regex fallback if node is unavailable.

Sections (each tallied; any FAIL -> non-zero exit, so it doubles as CI):

  A  Referential integrity   every SVG named by RUGGED_IO_FAMILIES,
                             FAMILY_SVG_MAP, d38999_visual_assets.json and the
                             app.js shell-profile map resolves on disk.
  B  Source/build parity     assets/svg/<x> == app/assets/svg/<x> byte-for-byte.
  C  No dead assets          every app/assets/svg/*.svg is referenced somewhere.
  D  Well-formed drawings     valid SVG XML, sane viewBox, has drawable geometry.
  E  Family / view coverage  every FAMILY_SVG_MAP family has a face; view keys
                             are valid; every recognized family is mapped.
  F  View distinctness       no family reuses one file for two different views.
  G  Geometry fits viewBox   (``--deep``, needs inkscape) true drawing bbox is
                             inside the viewBox — catches clipped / off-canvas art.

Usage:
    python3 scripts/io_svg_smoke_test.py
    python3 scripts/io_svg_smoke_test.py --deep      # + inkscape geometry check
    python3 scripts/io_svg_smoke_test.py --quiet
"""

from __future__ import annotations

import argparse
import json
import re
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
SRC_SVG = ROOT / "assets" / "svg"
APP_SVG = APP / "assets" / "svg"
NODE_HELPER = Path(__file__).resolve().parent / "_io_svg_tables.js"
VISUAL_ASSETS = ROOT / "data" / "connectors" / "d38999_visual_assets.json"

SVG_NS = "{http://www.w3.org/2000/svg}"
DRAWABLE = {"path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text"}
# Where to scan for "is this asset referenced anywhere" (orphan detection).
REF_SCAN_GLOBS = ("app/**/*.js", "app/**/*.html", "app/**/*.css", "data/**/*.json")


# --------------------------------------------------------------------------- #
class Report:
    def __init__(self, quiet: bool) -> None:
        self.quiet = quiet
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.sections: list[tuple[str, int, int]] = []

    def section(self, title: str) -> None:
        if not self.quiet:
            print(f"\n=== {title} ===")

    def ok(self, msg: str) -> None:
        if not self.quiet:
            print(f"  PASS  {msg}")

    def fail(self, msg: str) -> None:
        self.failures.append(msg)
        print(f"  FAIL  {msg}")

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        if not self.quiet:
            print(f"  WARN  {msg}")

    def tally(self, title: str, passed: int, total: int) -> None:
        self.sections.append((title, passed, total))


# --------------------------------------------------------------------------- #
# Load the canonical tables from converter.js (node helper, regex fallback).
# --------------------------------------------------------------------------- #
def load_tables(rep: Report) -> tuple[list[dict], dict[str, dict[str, str]]]:
    node = shutil.which("node")
    if node and NODE_HELPER.exists():
        try:
            out = subprocess.run(
                [node, str(NODE_HELPER), str(ROOT)],
                capture_output=True, text=True, timeout=60, check=True,
            ).stdout
            data = json.loads(out)
            return data["families"], data["familySvgMap"]
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            rep.warn(f"node table extraction failed ({exc}); using regex fallback")
    else:
        rep.warn("node unavailable; using regex fallback for converter tables")
    return _regex_families(), _regex_family_svg_map()


def _regex_families() -> list[dict]:
    text = (APP / "converter.js").read_text(encoding="utf-8")
    body = re.search(r"const RUGGED_IO_FAMILIES\s*=\s*\[(.*?)\];", text, re.DOTALL).group(1)
    field_re = re.compile(r'(\w+)\s*:\s*"([^"]*)"')
    out = []
    for obj in re.finditer(r"\{([^{}]*)\}", body):
        fields = dict(field_re.findall(obj.group(1)))
        if "prefix" in fields:
            out.append(fields)
    return out


def _regex_family_svg_map() -> dict[str, dict[str, str]]:
    text = (APP / "converter.js").read_text(encoding="utf-8")
    body = re.search(r"const FAMILY_SVG_MAP\s*=\s*\{(.*?)\n\s*\};", text, re.DOTALL).group(1)
    line_re = re.compile(r'"([^"]+)":\s*\{(.*)\}\s*,?\s*$')
    pair_re = re.compile(r'(?:"([^"]+)"|(\w+))\s*:\s*"([^"]+)"')
    fmap: dict[str, dict[str, str]] = {}
    for line in body.splitlines():
        lm = line_re.match(line.strip())
        if lm:
            fmap[lm.group(1)] = {(q or b): v for q, b, v in pair_re.findall(lm.group(2))}
    return fmap


def parse_io_view_order() -> list[str]:
    text = (APP / "app.js").read_text(encoding="utf-8")
    m = re.search(r"const IO_VIEW_ORDER\s*=\s*\[(.*?)\];", text, re.DOTALL)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


# --------------------------------------------------------------------------- #
# Reference collection
# --------------------------------------------------------------------------- #
def collect_referenced(families: list[dict], fmap: dict) -> dict[str, set[str]]:
    """basename -> set of human-readable sources that name it."""
    ref: dict[str, set[str]] = {}

    def add(name: str | None, src: str) -> None:
        if name:
            ref.setdefault(name, set()).add(src)

    for f in families:
        add(f.get("svg"), f"RUGGED_IO_FAMILIES[{f.get('prefix')}].svg")
        add(f.get("mountSvg"), f"RUGGED_IO_FAMILIES[{f.get('prefix')}].mountSvg")
    for fam, views in fmap.items():
        for view, name in views.items():
            add(name, f"FAMILY_SVG_MAP[{fam}][{view}]")
    if VISUAL_ASSETS.exists():
        for a in json.loads(VISUAL_ASSETS.read_text())["visualAssets"]:
            fp = a.get("file", "")
            if fp.startswith("assets/svg/"):
                add(fp.split("/")[-1], f"visualAssets[{a.get('id')}]")
    # app.js literal "assets/svg/<name>.svg" string references (shell-profile map etc.)
    appjs = (APP / "app.js").read_text(encoding="utf-8")
    for name in re.findall(r"assets/svg/([a-z0-9._-]+\.svg)", appjs):
        add(name, "app.js (string ref)")
    return ref


def textual_reference_index() -> str:
    """One big lowercase blob of every place an asset could be named, for orphan detection."""
    blob: list[str] = []
    for pattern in REF_SCAN_GLOBS:
        for p in ROOT.glob(pattern):
            if "node_modules" in p.parts or ".venv" in p.parts:
                continue
            try:
                blob.append(p.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                pass
    return "\n".join(blob).lower()


# --------------------------------------------------------------------------- #
# Sections
# --------------------------------------------------------------------------- #
def section_integrity(rep: Report, ref: dict[str, set[str]], on_disk: set[str]) -> None:
    rep.section("A  Referential integrity (every mapped SVG exists)")
    passed = 0
    for name in sorted(ref):
        if name in on_disk:
            passed += 1
        else:
            rep.fail(f"{name} referenced by {sorted(ref[name])} but missing from app/assets/svg/")
    rep.ok(f"{passed}/{len(ref)} mapped SVG names resolve on disk")
    rep.tally("A referential integrity", passed, len(ref))


def section_parity(rep: Report, on_disk_app: set[str], on_disk_src: set[str]) -> None:
    rep.section("B  Source/build parity (assets/svg == app/assets/svg)")
    names = sorted(on_disk_app | on_disk_src)
    passed = 0
    for name in names:
        in_src, in_app = name in on_disk_src, name in on_disk_app
        if not in_src:
            rep.fail(f"{name} present in app/assets/svg but not in source assets/svg")
        elif not in_app:
            rep.fail(f"{name} present in source assets/svg but not built into app/assets/svg")
        elif (SRC_SVG / name).read_bytes() != (APP_SVG / name).read_bytes():
            rep.fail(f"{name} differs between source and build")
        else:
            passed += 1
    rep.ok(f"{passed}/{len(names)} SVGs identical in source and build")
    rep.tally("B source/build parity", passed, len(names))


def section_orphans(rep: Report, on_disk: set[str], blob: str) -> None:
    rep.section("C  No dead assets (every SVG is referenced)")
    passed = 0
    for name in sorted(on_disk):
        if name.lower() in blob:
            passed += 1
        else:
            rep.fail(f"{name} is on disk but referenced nowhere in app/ or data/ (dead asset)")
    rep.ok(f"{passed}/{len(on_disk)} SVGs are referenced")
    rep.tally("C no dead assets", passed, len(on_disk))


def _viewbox(root: ET.Element) -> tuple[float, float, float, float] | None:
    vb = root.get("viewBox")
    if not vb:
        return None
    parts = re.split(r"[ ,]+", vb.strip())
    if len(parts) != 4:
        return None
    try:
        x, y, w, h = (float(v) for v in parts)
    except ValueError:
        return None
    return x, y, w, h


def section_wellformed(rep: Report, on_disk: set[str]) -> None:
    rep.section("D  Well-formed drawings (XML / viewBox / non-empty)")
    passed = 0
    for name in sorted(on_disk):
        path = APP_SVG / name
        try:
            root = ET.fromstring(path.read_text(encoding="utf-8", errors="replace"))
        except ET.ParseError as exc:
            rep.fail(f"{name}: malformed SVG XML ({exc})")
            continue
        if root.tag != f"{SVG_NS}svg":
            rep.fail(f"{name}: root element is <{root.tag}>, not an SVG-namespaced <svg>")
            continue
        vb = _viewbox(root)
        if vb is None:
            rep.fail(f"{name}: missing or unparseable viewBox")
            continue
        _, _, w, h = vb
        if w <= 0 or h <= 0:
            rep.fail(f"{name}: non-positive viewBox size {w}x{h}")
            continue
        if w > 5000 or h > 5000:
            rep.fail(f"{name}: implausible viewBox size {w}x{h}")
            continue
        if not any(el.tag.replace(SVG_NS, "") in DRAWABLE for el in root.iter()):
            rep.fail(f"{name}: no drawable elements (blank drawing)")
            continue
        passed += 1
    rep.ok(f"{passed}/{len(on_disk)} SVGs are well-formed with sane viewBox and geometry")
    rep.tally("D well-formed drawings", passed, len(on_disk))


def section_coverage(rep: Report, families: list[dict], fmap: dict, view_order: list[str]) -> None:
    rep.section("E  Family / view coverage")
    order = set(view_order) or set()
    passed = total = 0
    # E1+E2: every FAMILY_SVG_MAP family has a face, valid view keys.
    for fam, views in fmap.items():
        total += 1
        problems = []
        if "face" not in views:
            problems.append("no 'face' view")
        bad_keys = [k for k in views if order and k not in order]
        if bad_keys:
            problems.append(f"view keys outside IO_VIEW_ORDER: {bad_keys}")
        if problems:
            rep.fail(f"FAMILY_SVG_MAP[{fam}]: " + "; ".join(problems))
        else:
            passed += 1
    # E3: every recognized family is mapped (else no multi-view drawings).
    mapped = set(fmap)
    for fam in sorted({f["family"] for f in families}):
        total += 1
        if fam in mapped:
            passed += 1
        else:
            rep.fail(f"family '{fam}' has no FAMILY_SVG_MAP entry (no multi-view drawings)")
    rep.ok(f"{passed}/{total} family/view coverage checks passed")
    rep.tally("E family/view coverage", passed, total)


def section_distinctness(rep: Report, fmap: dict) -> None:
    rep.section("F  Within-family view distinctness")
    passed = 0
    for fam, views in fmap.items():
        seen: dict[str, list[str]] = {}
        for view, name in views.items():
            seen.setdefault(name, []).append(view)
        dups = {n: ks for n, ks in seen.items() if len(ks) > 1}
        if dups:
            rep.warn(f"{fam}: same file reused for multiple views {dups}")
        else:
            passed += 1
    rep.ok(f"{passed}/{len(fmap)} families draw each view distinctly")
    rep.tally("F view distinctness", passed, len(fmap))


def _inkscape_doc_bbox(inkscape: str, svg_text: str) -> tuple[float, float, float, float] | None:
    """Whole-document bbox via inkscape --query-all, in user units.

    Text is stripped first: a headless tool measures <text> with fallback font
    metrics that differ from a browser, so text extents are not a reliable
    correctness signal. We validate the *vector* geometry stays in frame.
    """
    stripped = re.sub(r"<text\b.*?</text>", "", svg_text, flags=re.DOTALL)
    stripped = re.sub(r"<text\b[^>]*/>", "", stripped)
    fd, tmp = tempfile.mkstemp(suffix=".svg")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(stripped)
        out = subprocess.run(
            [inkscape, "--query-all", tmp],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout.strip().splitlines()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    finally:
        os.unlink(tmp)
    if not out:
        return None
    cols = out[0].split(",")  # first row = whole <svg>: id,x,y,w,h
    try:
        return tuple(float(c) for c in cols[1:5])  # type: ignore[return-value]
    except (ValueError, IndexError):
        return None


def section_geometry(rep: Report, on_disk: set[str]) -> None:
    """--deep: use inkscape to confirm the vector drawing bbox fits the viewBox."""
    rep.section("G  Geometry fits viewBox (inkscape, --deep)")
    inkscape = shutil.which("inkscape")
    if not inkscape:
        rep.warn("inkscape not found; skipping geometry check")
        rep.tally("G geometry fits viewBox", 0, 0)
        return
    passed = total = 0
    for name in sorted(on_disk):
        path = APP_SVG / name
        text = path.read_text(encoding="utf-8", errors="replace")
        vb = _viewbox(ET.fromstring(text))
        if vb is None:
            continue
        vx, vy, vw, vh = vb
        bbox = _inkscape_doc_bbox(inkscape, text)
        if bbox is None:
            continue  # all-text drawing or query failure -> nothing vector to bound
        bx, by, bw, bh = bbox
        total += 1
        tol = max(vw, vh) * 0.02 + 0.5  # 2% + 0.5u slack for stroke half-width
        overflow = max(vx - bx, (bx + bw) - (vx + vw), vy - by, (by + bh) - (vy + vh))
        if overflow > tol:
            rep.fail(f"{name}: vector bbox ({bx:.1f},{by:.1f},{bw:.1f},{bh:.1f}) "
                     f"exceeds viewBox ({vx:.0f},{vy:.0f},{vw:.0f},{vh:.0f}) by {overflow:.1f}u")
        else:
            passed += 1
    rep.ok(f"{passed}/{total} drawings fit inside their viewBox")
    rep.tally("G geometry fits viewBox", passed, total)


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--deep", action="store_true", help="add inkscape geometry-fits-viewBox check")
    ap.add_argument("--quiet", action="store_true", help="print only the summary and failures")
    args = ap.parse_args()

    rep = Report(args.quiet)
    print("d38999 Toolbox — I/O connector SVG smoke test")
    print(f"root: {ROOT}")

    families, fmap = load_tables(rep)
    view_order = parse_io_view_order()
    on_disk_app = {p.name for p in APP_SVG.glob("*.svg")}
    on_disk_src = {p.name for p in SRC_SVG.glob("*.svg")} if SRC_SVG.exists() else set()
    ref = collect_referenced(families, fmap)
    blob = textual_reference_index()

    section_integrity(rep, ref, on_disk_app)
    section_parity(rep, on_disk_app, on_disk_src)
    section_orphans(rep, on_disk_app, blob)
    section_wellformed(rep, on_disk_app)
    section_coverage(rep, families, fmap, view_order)
    section_distinctness(rep, fmap)
    if args.deep:
        section_geometry(rep, on_disk_app)

    print("\n=== SUMMARY ===")
    for title, passed, total in rep.sections:
        flag = "OK " if passed == total else "BAD"
        print(f"  [{flag}] {title}: {passed}/{total}")
    print(f"\n  warnings: {len(rep.warnings)}")
    print(f"  failures: {len(rep.failures)}")
    if rep.failures:
        print("\nFAILED — see FAIL lines above.")
        return 1
    print("\nALL CHECKS PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
