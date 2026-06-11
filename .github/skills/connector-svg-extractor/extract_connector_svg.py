"""Extract connector drawings (face / profile / iso views) from PDFs and emit
clean SVGs (plus optional pin-coordinate JSON for face views).

Companion to the `connector-svg-extractor` skill — see SKILL.md for the
naming convention, cleaning passes, and pin-coordinate schema.

Examples
--------
  # 1. Probe a PDF for candidate vector clusters per page
  python .github/skills/connector-svg-extractor/extract_connector_svg.py \
      docs/pdfs/catalogs/amphenol/Amphenol_D38999_Series_III.pdf --probe

  # 2. Crop one page with an explicit clip rectangle and write a curated SVG
  python .github/skills/connector-svg-extractor/extract_connector_svg.py \
      docs/pdfs/catalogs/amphenol/Amphenol_D38999_Series_III.pdf \
      --page 7 --clip 72 110 320 320 \
      --view face --vendor amphenol --series 3 --shell 17 --arrangement 17-26 \
      --pins --out app/assets/svg/

  # 3. Auto-pick the largest vector cluster on a page
  python .github/skills/connector-svg-extractor/extract_connector_svg.py \
      docs/pdfs/specs/slash-sheets/dtl38999ss20.pdf \
      --page 3 --auto --view face --pins \
      --vendor mil --shell 11 --arrangement 11-35 \
      --out app/assets/svg/
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import fitz  # PyMuPDF


# --------------------------------------------------------------------------- #
# Naming
# --------------------------------------------------------------------------- #

ALLOWED_VENDORS = {
    "mil", "amphenol", "conesys", "eaton", "glenair", "itt", "souriau", "te",
}
ALLOWED_VIEWS = {
    "face", "profile", "iso",
    "plug", "receptacle",
    "jam-nut-receptacle", "wall-mount-receptacle", "straight-plug",
    "box-mount-receptacle", "in-line-receptacle", "cover", "stowage-receptacle",
    "backshell", "keying",
}
SHELL_SIZE_CODE = {
    "9": "a", "11": "b", "13": "c", "15": "d", "17": "e",
    "19": "f", "21": "g", "23": "h", "25": "j",
}


def slug_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def build_filename(
    vendor: str,
    family: str,
    view: str,
    arrangement: str | None,
    shell: str | None,
    product: str | None,
) -> str:
    parts: list[str] = [slug_token(vendor), slug_token(family)]
    # If arrangement already encodes the shell prefix (e.g. "11-35"), don't
    # repeat the shell token.
    arrangement_shell = None
    if arrangement and "-" in arrangement:
        arrangement_shell = arrangement.split("-", 1)[0]
    if shell and slug_token(shell) != slug_token(arrangement_shell or ""):
        parts.append(slug_token(shell))
    if arrangement:
        parts.append(slug_token(arrangement))
    elif product:
        parts.append(slug_token(product))
    parts.append(slug_token(view))
    parts = [token for token in parts if token]
    return "-".join(parts) + ".svg"


# --------------------------------------------------------------------------- #
# Provenance helpers
# --------------------------------------------------------------------------- #

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def now_iso() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def round2(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 2)


# --------------------------------------------------------------------------- #
# Vector cluster discovery
# --------------------------------------------------------------------------- #

@dataclass
class Cluster:
    rect: fitz.Rect
    drawings: list[int] = field(default_factory=list)
    text_count: int = 0

    @property
    def area(self) -> float:
        return self.rect.width * self.rect.height

    @property
    def aspect(self) -> float:
        if self.rect.height == 0:
            return float("inf")
        return self.rect.width / self.rect.height

    def to_dict(self) -> dict[str, Any]:
        return {
            "x0": round2(self.rect.x0),
            "y0": round2(self.rect.y0),
            "x1": round2(self.rect.x1),
            "y1": round2(self.rect.y1),
            "width": round2(self.rect.width),
            "height": round2(self.rect.height),
            "aspect": round2(self.aspect),
            "drawings": len(self.drawings),
            "text_tokens": self.text_count,
        }


def page_clusters(page: fitz.Page, gap: float = 8.0) -> list[Cluster]:
    """Return spatially clustered vector groups on a page.

    Two drawings join the same cluster if their bounding boxes are within `gap`
    points of each other. Tiny / page-spanning rects are dropped.
    """
    drawings = page.get_drawings()
    page_rect = page.rect
    candidates: list[tuple[int, fitz.Rect]] = []
    for index, drawing in enumerate(drawings):
        rect = drawing.get("rect")
        if rect is None or rect.is_empty:
            continue
        if rect.width < 2 or rect.height < 2:
            continue
        if rect.width > page_rect.width * 0.95 and rect.height > page_rect.height * 0.95:
            continue
        candidates.append((index, fitz.Rect(rect)))

    clusters: list[Cluster] = []
    for index, rect in candidates:
        expanded = rect + (-gap, -gap, gap, gap)
        joined: Cluster | None = None
        for cluster in clusters:
            if cluster.rect.intersects(expanded):
                if joined is None:
                    cluster.rect |= rect
                    cluster.drawings.append(index)
                    joined = cluster
                else:
                    joined.rect |= cluster.rect
                    joined.drawings.extend(cluster.drawings)
        if joined is None:
            clusters.append(Cluster(rect=fitz.Rect(rect), drawings=[index]))
        else:
            clusters = [c for c in clusters if c is joined or not c.rect.intersects(joined.rect) or c is joined]

    # Count text tokens that fall inside each cluster.
    words = page.get_text("words")
    for cluster in clusters:
        cluster.text_count = sum(
            1 for w in words if cluster.rect.contains(fitz.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
        )

    clusters.sort(key=lambda c: c.area, reverse=True)
    return clusters


def auto_pick_cluster(clusters: list[Cluster], view: str | None) -> Cluster | None:
    if not clusters:
        return None
    face_aspect = (0.6, 1.6)
    profile_aspect = (1.4, 4.0)
    target = face_aspect if view == "face" else profile_aspect if view in {"profile", "plug", "receptacle", "jam-nut-receptacle", "wall-mount-receptacle", "straight-plug", "backshell"} else None
    if target is None:
        return clusters[0]
    for cluster in clusters:
        if target[0] <= cluster.aspect <= target[1] and cluster.area > 400:
            return cluster
    return clusters[0]


# --------------------------------------------------------------------------- #
# SVG cleaning
# --------------------------------------------------------------------------- #

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def _qn(name: str) -> str:
    return f"{{{SVG_NS}}}{name}"


def _bbox_from_attrs(elem: ET.Element) -> fitz.Rect | None:
    """Best-effort bbox derivation for cleaning text outside the clip."""
    for attr in ("x", "y"):
        if attr not in elem.attrib:
            return None
    try:
        x = float(elem.attrib["x"])
        y = float(elem.attrib["y"])
    except ValueError:
        return None
    width = float(elem.attrib.get("width", "0") or 0)
    height = float(elem.attrib.get("height", "0") or 0)
    return fitz.Rect(x, y, x + max(width, 1), y + max(height, 1))


def clean_svg(
    raw_svg: str,
    clip_rect: fitz.Rect,
    drop_text_outside_body: bool = True,
    normalize_strokes: bool = True,
) -> tuple[str, tuple[float, float, float, float]]:
    """Clean a raw PyMuPDF SVG: re-origin viewBox, strip stray text, normalize strokes."""
    root = ET.fromstring(raw_svg)
    if root.tag != _qn("svg"):
        raise ValueError("Unexpected root element in SVG output")

    # PyMuPDF emits a transform that puts the page's CTM in place; collapse it
    # by taking the clip_rect as the new viewBox origin.
    width = clip_rect.width
    height = clip_rect.height
    new_view = (0.0, 0.0, round(width, 2), round(height, 2))
    root.set("viewBox", f"{new_view[0]} {new_view[1]} {new_view[2]} {new_view[3]}")
    root.set("width", f"{round(width, 2)}")
    root.set("height", f"{round(height, 2)}")
    for attr in ("x", "y"):
        root.attrib.pop(attr, None)

    # Wrap content in a translation so original page coords map into viewBox.
    translate = f"translate({-clip_rect.x0}, {-clip_rect.y0})"
    inner = list(root)
    for child in inner:
        root.remove(child)
    g = ET.SubElement(root, _qn("g"), {"transform": translate})
    for child in inner:
        # Strip PyMuPDF-injected metadata wrappers
        if child.tag in (_qn("title"), _qn("desc")):
            continue
        g.append(child)

    if drop_text_outside_body:
        for parent in root.iter():
            removable: list[ET.Element] = []
            for child in list(parent):
                if child.tag != _qn("text"):
                    continue
                bbox = _bbox_from_attrs(child)
                if bbox is None:
                    continue
                if not clip_rect.intersects(bbox):
                    removable.append(child)
            for elem in removable:
                parent.remove(elem)

    if normalize_strokes:
        for elem in root.iter():
            fill = elem.attrib.get("fill")
            if fill and fill.lower() in {"#000", "#000000", "black"}:
                elem.attrib["fill"] = "currentColor"
            stroke = elem.attrib.get("stroke")
            if stroke and stroke.lower() in {"#000", "#000000", "black"}:
                elem.attrib["stroke"] = "currentColor"

    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode"), new_view


# --------------------------------------------------------------------------- #
# Pin extraction (face views only)
# --------------------------------------------------------------------------- #

LABEL_RE = re.compile(r"^[A-Za-z0-9]{1,3}$")


def _is_dark(color: tuple[float, ...] | None) -> bool:
    return color is not None and len(color) >= 3 and all(c < 0.25 for c in color[:3])


def find_outer_circle(page: fitz.Page, clip: fitz.Rect) -> fitz.Rect | None:
    best: fitz.Rect | None = None
    best_score = -1.0
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None or not clip.intersects(rect):
            continue
        if drawing.get("type") != "s":
            continue
        if abs(rect.width - rect.height) > 1.5:
            continue
        if not (12 <= rect.width <= 220):
            continue
        score = rect.width * rect.height
        if score > best_score:
            best_score = score
            best = fitz.Rect(rect)
    return best


def detect_contacts_in_clip(page: fitz.Page, outer: fitz.Rect) -> list[dict[str, Any]]:
    cx = (outer.x0 + outer.x1) / 2
    cy = (outer.y0 + outer.y1) / 2
    radius = (outer.width + outer.height) / 4

    raw: list[dict[str, Any]] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None or not outer.intersects(rect):
            continue
        w, h = rect.width, rect.height
        if not (0.8 <= w <= radius * 0.65 and 0.8 <= h <= radius * 0.65):
            continue
        if abs(w - h) > max(0.45, 0.22 * max(w, h)):
            continue
        sx = (rect.x0 + rect.x1) / 2
        sy = (rect.y0 + rect.y1) / 2
        if math.hypot(sx - cx, sy - cy) > radius - min(w, h) * 0.15 + 1.0:
            continue
        if not (drawing.get("type") == "s" or _is_dark(drawing.get("fill")) or _is_dark(drawing.get("color"))):
            continue
        codes = [item[0] for item in drawing.get("items", [])]
        if codes.count("c") < 2 and not (
            len(codes) == 4 and drawing.get("type") in {"s", "f", "fs"}
        ):
            continue
        raw.append({"x": sx, "y": sy, "diameter": max(w, h), "type": drawing.get("type")})

    raw.sort(key=lambda i: -i["diameter"])
    clusters: list[dict[str, Any]] = []
    for item in raw:
        placed = False
        for cluster in clusters:
            tol = max(0.9, min(3.0, max(item["diameter"], cluster["diameter"]) * 0.35))
            if math.hypot(item["x"] - cluster["x"], item["y"] - cluster["y"]) <= tol:
                weight = 2 if item["type"] == "s" else 1
                total = cluster["weight"] + weight
                cluster["x"] = (cluster["x"] * cluster["weight"] + item["x"] * weight) / total
                cluster["y"] = (cluster["y"] * cluster["weight"] + item["y"] * weight) / total
                cluster["weight"] = total
                cluster["diameter"] = max(cluster["diameter"], item["diameter"])
                placed = True
                break
        if not placed:
            clusters.append({**item, "weight": 1})

    clusters.sort(key=lambda i: (i["y"], i["x"]))
    return clusters


def collect_labels(page: fitz.Page, outer: fitz.Rect) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for x0, y0, x1, y1, word, *_ in page.get_text("words"):
        rect = fitz.Rect(x0, y0, x1, y1)
        center = ((x0 + x1) / 2, (y0 + y1) / 2)
        if not outer.contains(fitz.Point(*center)):
            continue
        if not LABEL_RE.match(word):
            continue
        tokens.append({"label": word, "x": center[0], "y": center[1], "bbox": rect})
    return tokens


def assign_labels(contacts: list[dict[str, Any]], labels: list[dict[str, Any]]) -> None:
    """Greedy nearest-neighbour label assignment (good enough for ad-hoc extracts;
    use scripts/extract_arrangements.py for the Hungarian + MIL-STD-1560 path)."""
    used: set[int] = set()
    for contact in contacts:
        best_index = -1
        best_distance = float("inf")
        for index, label in enumerate(labels):
            if index in used:
                continue
            d = math.hypot(label["x"] - contact["x"], label["y"] - contact["y"])
            if d < best_distance:
                best_distance = d
                best_index = index
        if best_index >= 0 and best_distance <= contact["diameter"] * 4:
            contact["label"] = labels[best_index]["label"]
            contact["label_distance"] = round2(best_distance)
            contact["confidence"] = "medium"
            used.add(best_index)
        else:
            contact["label"] = "?"
            contact["confidence"] = "needs_manual_verification"


# --------------------------------------------------------------------------- #
# Pipeline
# --------------------------------------------------------------------------- #

def _pt(p: Any, ox: float, oy: float) -> str:
    return f"{round(p.x - ox, 2)},{round(p.y - oy, 2)}"


def _item_points(item: tuple) -> list[Any]:
    op = item[0]
    if op == "l":
        return [item[1], item[2]]
    if op == "c":
        return [item[1], item[2], item[3], item[4]]
    if op == "qu":
        q = item[1]
        return [q.ul, q.ur, q.lr, q.ll]
    if op == "re":
        r = item[1]
        return [fitz.Point(r.x0, r.y0), fitz.Point(r.x1, r.y1)]
    return []


def _item_to_d(item: tuple, ox: float, oy: float) -> str:
    op = item[0]
    if op == "l":
        return f"M{_pt(item[1], ox, oy)} L{_pt(item[2], ox, oy)}"
    if op == "c":
        return (
            f"M{_pt(item[1], ox, oy)} "
            f"C{_pt(item[2], ox, oy)} {_pt(item[3], ox, oy)} {_pt(item[4], ox, oy)}"
        )
    if op == "qu":
        q = item[1]
        return "M" + " L".join(_pt(p, ox, oy) for p in (q.ul, q.ur, q.lr, q.ll)) + " Z"
    if op == "re":
        r = item[1]
        x0, y0 = round(r.x0 - ox, 2), round(r.y0 - oy, 2)
        x1, y1 = round(r.x1 - ox, 2), round(r.y1 - oy, 2)
        return f"M{x0},{y0} H{x1} V{y1} H{x0} Z"
    return ""


def _is_light(color: tuple[float, ...] | None) -> bool:
    return color is not None and len(color) >= 3 and all(c > 0.6 for c in color[:3])


def _filter_small_components(
    items: list[tuple[tuple, list[Any]]],
    min_size: float,
    gap: float = 2.5,
) -> list[tuple]:
    """Drop spatially-isolated clumps of path items smaller than ``min_size``.

    Items are clustered by *stroke proximity*: two items join the same cluster
    when any of their points lie within ``gap`` PDF points of each other. Dense
    line work — outlines, knurling, section hatching, thread teeth — merges into
    large clusters and survives, while a stray dot, tick, or short stub sitting
    in empty space stays its own small cluster and is cut when its longer bbox
    side is under ``min_size``. Proximity is measured on the actual stroke points
    (not bounding boxes), so a long diagonal whose box happens to span a dot does
    not rescue that dot.
    """
    n = len(items)
    if n == 0:
        return []
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    cell = gap if gap > 0 else 0.5
    grid: dict[tuple[int, int], list[tuple[int, float, float]]] = {}
    for i, (_item, pts) in enumerate(items):
        for p in pts:
            key = (int(math.floor(p.x / cell)), int(math.floor(p.y / cell)))
            grid.setdefault(key, []).append((i, p.x, p.y))

    gap_sq = gap * gap
    for i, (_item, pts) in enumerate(items):
        for p in pts:
            cx = int(math.floor(p.x / cell))
            cy = int(math.floor(p.y / cell))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j, qx, qy in grid.get((cx + dx, cy + dy), ()):
                        if j != i and (p.x - qx) ** 2 + (p.y - qy) ** 2 <= gap_sq:
                            union(i, j)

    cluster_box: dict[int, list[float]] = {}
    for i, (_item, pts) in enumerate(items):
        root = find(i)
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        cb = cluster_box.get(root)
        if cb is None:
            cluster_box[root] = [min(xs), min(ys), max(xs), max(ys)]
        else:
            cb[0] = min(cb[0], *xs)
            cb[1] = min(cb[1], *ys)
            cb[2] = max(cb[2], *xs)
            cb[3] = max(cb[3], *ys)

    kept: list[tuple] = []
    for i, (item, _pts) in enumerate(items):
        cb = cluster_box[find(i)]
        if max(cb[2] - cb[0], cb[3] - cb[1]) >= min_size:
            kept.append(item)
    return kept


def build_geometry_svg(
    page: fitz.Page,
    clip: fitz.Rect,
    *,
    min_line_width: float | None = None,
    min_feature_size: float | None = None,
    proximity_gap: float = 2.5,
    exclude: list[fitz.Rect] | None = None,
    keep_fills: bool = False,
    pad: float = 2.0,
) -> str:
    """Build a compact SVG straight from the page's vector paths.

    Unlike ``page.get_svg_image()`` (which always serializes the *whole* page),
    this keeps only the path items that fall inside ``clip`` and re-origins them
    to a tight viewBox. Stroked paths thinner than ``min_line_width`` are dropped
    so dimension / leader lines vanish and only the connector body survives.
    Standalone drawings whose bounding box is smaller than ``min_feature_size``
    (PDF points, measured on the longer side) are dropped too, which clears the
    stray dots, tick marks, and arrowhead remnants left behind by dimension
    callouts. Any item whose points all fall inside one of the ``exclude``
    rectangles is dropped as well — a precise way to mask a detail/section
    callout that overlaps the connector body, without disturbing longer strokes
    that merely pass through the box.
    """
    body = clip + (-pad, -pad, pad, pad)
    exclude = exclude or []
    ox, oy = clip.x0, clip.y0
    stroke_items: list[tuple[tuple, list[Any]]] = []
    fill_ds: list[str] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None or rect.is_empty or not clip.intersects(rect):
            continue
        if (
            min_feature_size is not None
            and max(rect.width, rect.height) < min_feature_size
        ):
            continue
        dtype = drawing.get("type")
        stroked = dtype in ("s", "sf")
        filled = dtype in ("f", "sf")
        width = drawing.get("width") or 0.0
        if stroked and min_line_width is not None and width < min_line_width:
            stroked = False
        if filled and (not keep_fills or _is_light(drawing.get("fill"))):
            filled = False
        if not stroked and not filled:
            continue
        for item in drawing.get("items", []):
            pts = _item_points(item)
            if not pts:
                continue
            if not all(body.contains(fitz.Point(p.x, p.y)) for p in pts):
                continue
            if exclude and any(
                all(ex.contains(fitz.Point(p.x, p.y)) for p in pts)
                for ex in exclude
            ):
                continue
            if filled and not stroked:
                d = _item_to_d(item, ox, oy)
                if d:
                    fill_ds.append(d)
            else:
                stroke_items.append((item, pts))

    if min_feature_size is not None and stroke_items:
        kept_items = _filter_small_components(
            stroke_items, min_feature_size, gap=proximity_gap
        )
    else:
        kept_items = [item for item, _pts in stroke_items]
    stroke_ds = [d for d in (_item_to_d(item, ox, oy) for item in kept_items) if d]

    width_v = round(clip.width, 2)
    height_v = round(clip.height, 2)
    lines = [
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 {width_v} {height_v}" '
        f'width="{width_v}" height="{height_v}" fill="none" stroke="currentColor" '
        f'stroke-width="1" stroke-linejoin="round" stroke-linecap="round">',
    ]
    if fill_ds:
        lines.append(f'  <path fill="currentColor" stroke="none" d="{" ".join(fill_ds)}"/>')
    if stroke_ds:
        lines.append(f'  <path d="{" ".join(stroke_ds)}"/>')
    lines.append("</svg>")
    return "\n".join(lines)


def render_clip_svg(page: fitz.Page, clip: fitz.Rect) -> str:
    # PyMuPDF's get_svg_image does not accept a clip kwarg directly. We narrow
    # the page's cropbox to the clip rect so the emitted SVG only contains the
    # relevant region, then restore the original cropbox.
    original = fitz.Rect(page.cropbox)
    try:
        # set_cropbox uses page-relative coordinates (origin at mediabox origin).
        page.set_cropbox(clip & page.mediabox)
        return page.get_svg_image(matrix=fitz.Identity, text_as_path=False)
    except (ValueError, RuntimeError):
        # Fall back to full-page render if the cropbox cannot be tightened
        # (e.g. clip outside mediabox). clean_svg() still re-origins viewBox.
        return page.get_svg_image(matrix=fitz.Identity, text_as_path=False)
    finally:
        try:
            page.set_cropbox(original)
        except Exception:
            pass


def transform_contact_to_viewbox(contact: dict[str, Any], clip: fitz.Rect) -> dict[str, Any]:
    return {
        **contact,
        "x": round2(contact["x"] - clip.x0),
        "y": round2(contact["y"] - clip.y0),
        "diameter": round2(contact["diameter"]),
    }


def extract_one(
    pdf_path: Path,
    page_index: int,
    clip: fitz.Rect,
    *,
    view: str,
    output_svg: Path,
    output_json: Path | None,
    extract_pins: bool,
    geometry: bool = False,
    min_line_width: float | None = None,
    min_feature_size: float | None = None,
    proximity_gap: float = 2.5,
    exclude: list[fitz.Rect] | None = None,
    keep_fills: bool = False,
) -> dict[str, Any]:
    doc = fitz.open(pdf_path)
    try:
        page = doc.load_page(page_index)
        if geometry:
            cleaned = build_geometry_svg(
                page,
                clip,
                min_line_width=min_line_width,
                min_feature_size=min_feature_size,
                proximity_gap=proximity_gap,
                exclude=exclude,
                keep_fills=keep_fills,
            )
            viewbox = (0.0, 0.0, round(clip.width, 2), round(clip.height, 2))
        else:
            raw = render_clip_svg(page, clip)
            cleaned, viewbox = clean_svg(raw, clip)

        pin_data: dict[str, Any] | None = None
        if extract_pins and view == "face":
            outer = find_outer_circle(page, clip)
            if outer is not None:
                contacts = detect_contacts_in_clip(page, outer)
                labels = collect_labels(page, outer)
                assign_labels(contacts, labels)
                pin_data = {
                    "outer_circle": {
                        "cx": round2((outer.x0 + outer.x1) / 2 - clip.x0),
                        "cy": round2((outer.y0 + outer.y1) / 2 - clip.y0),
                        "r": round2((outer.width + outer.height) / 4),
                    },
                    "contacts": [transform_contact_to_viewbox(c, clip) for c in contacts],
                }

        output_svg.parent.mkdir(parents=True, exist_ok=True)
        output_svg.write_text(cleaned, encoding="utf-8")

        meta: dict[str, Any] = {
            "schema_version": "1.0",
            "generated_at": now_iso(),
            "source_pdf": str(pdf_path),
            "source_pdf_sha256": sha256_file(pdf_path),
            "source_page": page_index + 1,
            "view": view,
            "clip_pdf_points": [round2(clip.x0), round2(clip.y0), round2(clip.x1), round2(clip.y1)],
            "viewBox": list(viewbox),
            "svg_path": str(output_svg),
        }
        if pin_data:
            meta.update(pin_data)
        if output_json:
            output_json.parent.mkdir(parents=True, exist_ok=True)
            output_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return meta
    finally:
        doc.close()


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def parse_clip(values: list[float] | None) -> fitz.Rect | None:
    if values is None:
        return None
    if len(values) != 4:
        raise SystemExit("--clip requires exactly 4 numbers: x0 y0 x1 y1")
    return fitz.Rect(*values)


def cmd_probe(pdf_path: Path, page_filter: Iterable[int] | None) -> int:
    doc = fitz.open(pdf_path)
    try:
        report = []
        for page_index in range(doc.page_count):
            if page_filter is not None and page_index not in page_filter:
                continue
            page = doc.load_page(page_index)
            clusters = page_clusters(page)
            report.append(
                {
                    "page": page_index + 1,
                    "drawings": len(page.get_drawings()),
                    "clusters": [c.to_dict() for c in clusters[:8]],
                }
            )
        json.dump(report, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    finally:
        doc.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Extract clean connector SVGs and pin coordinates from PDFs.",
    )
    parser.add_argument("pdf", type=Path, help="Source PDF (under docs/pdfs/...).")
    parser.add_argument("--probe", action="store_true",
                        help="Print candidate vector clusters per page and exit.")
    parser.add_argument("--page", type=int, action="append",
                        help="1-based page number. Repeatable. Required unless --probe.")
    parser.add_argument("--clip", nargs=4, type=float, metavar=("X0", "Y0", "X1", "Y1"),
                        help="Clip rectangle in PDF points.")
    parser.add_argument("--exclude", nargs=4, type=float, action="append",
                        metavar=("X0", "Y0", "X1", "Y1"),
                        help="In --geometry mode, mask out a rectangle (PDF "
                             "points): any path item lying entirely inside it is "
                             "dropped. Repeatable. Use to delete a detail/section "
                             "callout that overlaps the connector body while "
                             "leaving longer strokes that only pass through.")
    parser.add_argument("--auto", action="store_true",
                        help="Auto-pick the best vector cluster on the page.")
    parser.add_argument("--view", choices=sorted(ALLOWED_VIEWS),
                        help="View kind for the output filename.")
    parser.add_argument("--vendor", choices=sorted(ALLOWED_VENDORS), default="mil")
    parser.add_argument("--family", default="d38999",
                        help="Family slug, e.g. d38999, supernine, superseal, 8d, dts.")
    parser.add_argument("--shell", help="Shell size (e.g. 11, 17) or letter code.")
    parser.add_argument("--arrangement", help="Arrangement id, e.g. 11-35.")
    parser.add_argument("--product", help="Product slug, e.g. 233-350, rj45, hdmi.")
    parser.add_argument("--pins", action="store_true",
                        help="Also emit pin-coordinate JSON (face views only).")
    parser.add_argument("--geometry", action="store_true",
                        help="Build a compact SVG directly from vector paths "
                             "(tiny output; ideal for profile/silhouette assets).")
    parser.add_argument("--min-line-width", type=float, default=None,
                        help="In --geometry mode, drop stroked paths thinner than "
                             "this (PDF points) to remove dimension/leader lines.")
    parser.add_argument("--min-feature-size", type=float, default=None,
                        help="In --geometry mode, drop connected runs of path "
                             "items whose bounding box (longer side, PDF points) "
                             "is smaller than this, clearing stray dots / ticks / "
                             "arrowhead remnants without breaking the outline.")
    parser.add_argument("--proximity-gap", type=float, default=2.5,
                        help="In --geometry mode, the stroke-proximity distance "
                             "(PDF points) used to cluster path items for the "
                             "--min-feature-size filter. Lower values isolate "
                             "near-body specks (use ~1.0 for sparse outlines); "
                             "raise it (default 2.5) to keep dense hatching / "
                             "knurling on busy drawings intact.")
    parser.add_argument("--keep-fills", action="store_true",
                        help="In --geometry mode, keep dark filled shapes too.")
    parser.add_argument("--out", type=Path, default=Path("output/connector_svgs"),
                        help="Output directory (or full path ending in .svg).")
    parser.add_argument("--out-dir", dest="out", type=Path,
                        help=argparse.SUPPRESS)  # alias kept for the SKILL examples
    parser.add_argument("--force", action="store_true",
                        help="Overwrite existing files.")
    args = parser.parse_args(argv)

    if not args.pdf.exists():
        parser.error(f"PDF not found: {args.pdf}")

    if args.probe:
        page_filter = {p - 1 for p in args.page} if args.page else None
        return cmd_probe(args.pdf, page_filter)

    if not args.page:
        parser.error("--page is required (unless --probe).")
    if not args.view:
        parser.error("--view is required for extraction.")
    if not args.clip and not args.auto:
        parser.error("Provide either --clip x0 y0 x1 y1 or --auto.")

    doc = fitz.open(args.pdf)
    try:
        results: list[dict[str, Any]] = []
        for one_based in args.page:
            page_index = one_based - 1
            if not (0 <= page_index < doc.page_count):
                parser.error(f"--page {one_based} out of range (1..{doc.page_count}).")
            page = doc.load_page(page_index)
            clip = parse_clip(args.clip)
            if clip is None:
                cluster = auto_pick_cluster(page_clusters(page), args.view)
                if cluster is None:
                    parser.error(f"No vector clusters detected on page {one_based}.")
                clip = cluster.rect

            filename = build_filename(
                vendor=args.vendor,
                family=args.family,
                view=args.view,
                arrangement=args.arrangement,
                shell=args.shell,
                product=args.product,
            )
            if args.out.suffix.lower() == ".svg":
                svg_path = args.out
            else:
                svg_path = args.out / filename
            json_path = svg_path.with_suffix(".json") if args.pins else None

            if svg_path.exists() and not args.force:
                parser.error(f"Refusing to overwrite {svg_path}; pass --force.")

            meta = extract_one(
                args.pdf,
                page_index,
                clip,
                view=args.view,
                output_svg=svg_path,
                output_json=json_path,
                extract_pins=args.pins,
                geometry=args.geometry,
                min_line_width=args.min_line_width,
                min_feature_size=args.min_feature_size,
                proximity_gap=args.proximity_gap,
                exclude=[fitz.Rect(*e) for e in (args.exclude or [])],
                keep_fills=args.keep_fills,
            )
            results.append(meta)
            print(f"wrote {svg_path}", file=sys.stderr)
            if json_path:
                print(f"wrote {json_path}", file=sys.stderr)

        json.dump(results, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    finally:
        doc.close()


if __name__ == "__main__":
    raise SystemExit(main())
