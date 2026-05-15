"""
Extract MIL-DTL-38999 / D38999 insert arrangement drawings and contact centers
from d38999-contact-arrangements.pdf.

The extractor intentionally keeps a conservative data model:
- Arrangement SVGs are clipped vector exports from the source PDF.
- Contact centers come from PDF vector shapes.
- Labels come from nearby PDF text tokens.
- Any missing labels or ambiguous size assignments are written to review_needed.json.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import re
import urllib.request
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
from PIL import ImageDraw


ARRANGEMENT_ID_RE = re.compile(r"\b(?:9|11|13|15|17|19|21|23|25)-\d{1,3}\b")
CONTACT_COUNT_RE = re.compile(
    r"(\d+)\s*x\s*#?\s*(22D|20|16|12(?:\s+Coax)?|10|8\s+Coax|8\s+Twinax|8)",
    re.IGNORECASE,
)
LABEL_RE = re.compile(r"^[A-Za-z0-9]{1,3}$")
STANDARD_TABLE_NUMBER_RE = re.compile(r"^[+-]?(?:\d+\.\d+|\.\d+)")
STANDARD_INSERT_RE = re.compile(r"\(Insert arrangement ([0-9]{1,2}-[0-9]{1,3})\)")
STANDARD_REFERENCE_URL = (
    "https://landandmaritimeapps.dla.mil/Downloads/MilSpec/Docs/MIL-STD-1560/std1560.pdf"
)
SHELL_SIZE_CODE = {
    "9": "A",
    "11": "B",
    "13": "C",
    "15": "D",
    "17": "E",
    "19": "F",
    "21": "G",
    "23": "H",
    "25": "J",
}
SIZE_ORDER = {
    "22D": 0,
    "20": 1,
    "16": 2,
    "12": 3,
    "12 Coax": 4,
    "10": 5,
    "8": 6,
    "8 Coax": 6,
    "8 Twinax": 6,
}
def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def round2(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 2)


def rect_tuple(rect: fitz.Rect) -> list[float]:
    return [round2(rect.x0), round2(rect.y0), round2(rect.x1), round2(rect.y1)]


def text_of_block(block: dict[str, Any]) -> str:
    return " ".join(
        span["text"]
        for line in block.get("lines", [])
        for span in line.get("spans", [])
    ).strip()


def is_black(color: tuple[float, ...] | None) -> bool:
    return color is not None and all(channel < 0.2 for channel in color)


def normalize_size(size_text: str) -> str:
    cleaned = " ".join(size_text.replace("#", "").split())
    cleaned = cleaned.replace("coax", "Coax").replace("twinax", "Twinax")
    return cleaned


def contact_type_for_size(size: str | None) -> str:
    if not size:
        return "unknown"
    lowered = size.lower()
    if "twinax" in lowered:
        return "twinax"
    if "coax" in lowered:
        return "coax"
    return "signal"


def parse_contact_size_notes(title_text: str) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    for count, size in CONTACT_COUNT_RE.findall(title_text):
        normalized = normalize_size(size)
        notes.append(
            {
                "count": int(count),
                "size": normalized,
                "type": contact_type_for_size(normalized),
                "source_text": f"{count} x #{normalized}",
            }
        )
    return notes


def parse_standard_number(line: str) -> float | None:
    match = STANDARD_TABLE_NUMBER_RE.match(line.strip())
    return float(match.group(0)) if match else None


def standard_reference_candidates(project_root: Path) -> list[Path]:  # noqa: D401
    """Return the search order for the MIL-STD-1560 reference PDF."""
    return [
        project_root / "data" / "reference" / "std1560.pdf",
        project_root / "std1560.pdf",
        project_root / "docs" / "pdfs" / "std1560.pdf",
        project_root / "output" / "reference" / "std1560.pdf",
    ]


def _legacy_standard_reference_candidates(project_root: Path) -> list[Path]:
    return [
        project_root / "std1560.pdf",
        project_root / "MIL-STD-1560C.pdf",
        project_root / "output" / "reference" / "std1560.pdf",
    ]


def find_or_download_standard_reference(project_root: Path) -> Path | None:
    for candidate in standard_reference_candidates(project_root):
        if candidate.exists():
            return candidate

    target = project_root / "data" / "reference" / "std1560.pdf"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(STANDARD_REFERENCE_URL, timeout=30) as response:
            target.write_bytes(response.read())
        return target
    except Exception:
        return None


def load_standard_contact_reference(project_root: Path) -> dict[str, list[dict[str, Any]]]:
    reference_path = find_or_download_standard_reference(project_root)
    if reference_path is None:
        return {}

    references: dict[str, dict[str, dict[str, Any]]] = {}
    doc = fitz.open(reference_path)
    try:
        for page in doc:
            text = page.get_text("text")
            arrangement_ids = set(STANDARD_INSERT_RE.findall(text))
            if not arrangement_ids:
                continue

            lines = [line.strip() for line in text.splitlines() if line.strip()]
            entries: list[dict[str, Any]] = []
            for index in range(len(lines) - 2):
                label = lines[index]
                if not LABEL_RE.match(label) or label == "ID":
                    continue
                x_value = parse_standard_number(lines[index + 1])
                y_value = parse_standard_number(lines[index + 2])
                if x_value is None or y_value is None:
                    continue
                entries.append({"label": label, "std_x": x_value, "std_y": y_value})

            for arrangement_id in arrangement_ids:
                bucket = references.setdefault(arrangement_id, {})
                for entry in entries:
                    bucket[entry["label"]] = entry
    finally:
        doc.close()

    return {
        arrangement_id: list(entries_by_label.values())
        for arrangement_id, entries_by_label in references.items()
    }


def hungarian_assignment(cost: list[list[float]]) -> list[int]:
    """Return the selected column index for each row in a square/rectangular cost matrix."""
    row_count = len(cost)
    column_count = len(cost[0]) if cost else 0
    if row_count > column_count:
        raise ValueError("Hungarian assignment requires row_count <= column_count.")

    u = [0.0] * (row_count + 1)
    v = [0.0] * (column_count + 1)
    p = [0] * (column_count + 1)
    way = [0] * (column_count + 1)

    for row in range(1, row_count + 1):
        p[0] = row
        column = 0
        minv = [float("inf")] * (column_count + 1)
        used = [False] * (column_count + 1)

        while True:
            used[column] = True
            current_row = p[column]
            delta = float("inf")
            next_column = 0
            for candidate_column in range(1, column_count + 1):
                if used[candidate_column]:
                    continue
                current = cost[current_row - 1][candidate_column - 1] - u[current_row] - v[candidate_column]
                if current < minv[candidate_column]:
                    minv[candidate_column] = current
                    way[candidate_column] = column
                if minv[candidate_column] < delta:
                    delta = minv[candidate_column]
                    next_column = candidate_column

            for candidate_column in range(column_count + 1):
                if used[candidate_column]:
                    u[p[candidate_column]] += delta
                    v[candidate_column] -= delta
                else:
                    minv[candidate_column] -= delta

            column = next_column
            if p[column] == 0:
                break

        while True:
            previous_column = way[column]
            p[column] = p[previous_column]
            column = previous_column
            if column == 0:
                break

    assignment = [-1] * row_count
    for column in range(1, column_count + 1):
        if p[column] != 0:
            assignment[p[column] - 1] = column - 1
    return assignment


def apply_standard_reference_labels(
    arrangement_id: str,
    contacts: list[dict[str, Any]],
    standard_references: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    reference = standard_references.get(arrangement_id)
    if not reference or len(reference) != len(contacts):
        return None

    contact_x_values = [contact["x"] for contact in contacts]
    contact_y_values = [contact["y"] for contact in contacts]
    reference_x_values = [entry["std_x"] for entry in reference]
    reference_y_values = [entry["std_y"] for entry in reference]

    reference_width = max(reference_x_values) - min(reference_x_values)
    reference_height = max(reference_y_values) - min(reference_y_values)
    if reference_width == 0 or reference_height == 0:
        return None

    scale_x = (max(contact_x_values) - min(contact_x_values)) / reference_width
    scale_y = (max(contact_y_values) - min(contact_y_values)) / reference_height
    contact_mid_x = (max(contact_x_values) + min(contact_x_values)) / 2.0
    contact_mid_y = (max(contact_y_values) + min(contact_y_values)) / 2.0
    reference_mid_x = (max(reference_x_values) + min(reference_x_values)) / 2.0
    reference_mid_y = (max(reference_y_values) + min(reference_y_values)) / 2.0
    offset_x = contact_mid_x - scale_x * reference_mid_x
    offset_y = contact_mid_y + scale_y * reference_mid_y

    cost: list[list[float]] = []
    transformed_reference: list[tuple[float, float]] = []
    for entry in reference:
        target_x = offset_x + scale_x * entry["std_x"]
        target_y = offset_y - scale_y * entry["std_y"]
        transformed_reference.append((target_x, target_y))
        cost.append(
            [
                (target_x - contact["x"]) ** 2 + (target_y - contact["y"]) ** 2
                for contact in contacts
            ]
        )

    assignment = hungarian_assignment(cost)
    filled = 0
    corrected = 0
    distances: list[float] = []
    for reference_index, contact_index in enumerate(assignment):
        if contact_index < 0:
            continue
        entry = reference[reference_index]
        contact = contacts[contact_index]
        old_label = contact["label"]
        new_label = entry["label"]
        if old_label == "?":
            filled += 1
        elif old_label != new_label:
            corrected += 1
            contact["extracted_label"] = old_label
        contact["label"] = new_label
        contact["label_confidence"] = "standard_reference"
        contact["standard_x"] = round2(entry["std_x"])
        contact["standard_y"] = round2(entry["std_y"])
        target_x, target_y = transformed_reference[reference_index]
        distance = math.hypot(target_x - contact["x"], target_y - contact["y"])
        contact["standard_match_distance"] = round2(distance)
        distances.append(distance)
        if contact["size_confidence"] in {"high", "medium"}:
            contact["confidence"] = "high"

    return {
        "source": "MIL-STD-1560 contact-position table",
        "filled_missing_labels": filled,
        "corrected_extracted_labels": corrected,
        "max_match_distance": round2(max(distances) if distances else 0.0),
        "reference_url": STANDARD_REFERENCE_URL,
    }


def extract_titles(page: fitz.Page) -> list[dict[str, Any]]:
    titles: list[dict[str, Any]] = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        text = text_of_block(block)
        match = ARRANGEMENT_ID_RE.search(text)
        if not match:
            continue
        title_rect = fitz.Rect(block["bbox"])
        arrangement_id = match.group(0)
        shell_size, arrangement_number = arrangement_id.split("-", 1)
        contact_size_notes = parse_contact_size_notes(text)
        titles.append(
            {
                "id": arrangement_id,
                "shell_size": shell_size,
                "shell_size_code": SHELL_SIZE_CODE.get(shell_size),
                "arrangement_number": arrangement_number,
                "title_text": text,
                "title_rect": title_rect,
                "contact_size_notes": contact_size_notes,
                "expected_contact_count": sum(note["count"] for note in contact_size_notes),
            }
        )
    titles.sort(key=lambda item: (item["title_rect"].y0, item["title_rect"].x0))
    return titles


def outer_circle_candidates(page: fitz.Page) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for index, drawing in enumerate(page.get_drawings()):
        rect = drawing.get("rect")
        if rect is None:
            continue
        width = rect.width
        height = rect.height
        if (
            drawing.get("type") == "s"
            and abs(width - height) < 1.5
            and 12 <= width <= 100
        ):
            candidates.append({"index": index, "rect": rect, "drawing": drawing})
    return candidates


def map_titles_to_outer_circles(
    titles: list[dict[str, Any]], candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    used: set[int] = set()
    mapped: list[dict[str, Any]] = []
    for title in titles:
        title_rect: fitz.Rect = title["title_rect"]
        title_center_x = (title_rect.x0 + title_rect.x1) / 2.0
        choices: list[tuple[float, dict[str, Any]]] = []
        for candidate in candidates:
            if candidate["index"] in used:
                continue
            rect: fitz.Rect = candidate["rect"]
            if rect.y1 <= title_rect.y0 + 10 and rect.y1 >= title_rect.y0 - 115:
                circle_center_x = (rect.x0 + rect.x1) / 2.0
                score = abs(circle_center_x - title_center_x) + abs(rect.y1 - title_rect.y0) * 0.25
                choices.append((score, candidate))
        if not choices:
            for candidate in candidates:
                if candidate["index"] in used:
                    continue
                rect = candidate["rect"]
                circle_center_x = (rect.x0 + rect.x1) / 2.0
                score = abs(circle_center_x - title_center_x) + abs(rect.y1 - title_rect.y0) * 0.25
                choices.append((score, candidate))
        if not choices:
            title["outer_circle"] = None
            title["mapping_score"] = None
            mapped.append(title)
            continue
        score, selected = min(choices, key=lambda item: item[0])
        used.add(selected["index"])
        title["outer_circle"] = selected
        title["mapping_score"] = round2(score)
        mapped.append(title)
    return mapped


def detect_contacts(page: fitz.Page, outer_rect: fitz.Rect) -> list[dict[str, Any]]:
    center_x = (outer_rect.x0 + outer_rect.x1) / 2.0
    center_y = (outer_rect.y0 + outer_rect.y1) / 2.0
    radius = (outer_rect.width + outer_rect.height) / 4.0
    raw: list[dict[str, Any]] = []
    clip = outer_rect + (-1, -1, 1, 1)
    for index, drawing in enumerate(page.get_drawings()):
        rect = drawing.get("rect")
        if rect is None or not rect.intersects(clip):
            continue
        width = rect.width
        height = rect.height
        if not (0.8 <= width <= radius * 0.65 and 0.8 <= height <= radius * 0.65):
            continue
        if abs(width - height) > max(0.45, 0.22 * max(width, height)):
            continue
        shape_center_x = (rect.x0 + rect.x1) / 2.0
        shape_center_y = (rect.y0 + rect.y1) / 2.0
        if (
            math.hypot(shape_center_x - center_x, shape_center_y - center_y)
            > radius - min(width, height) * 0.15 + 1.0
        ):
            continue
        if not (
            drawing.get("type") == "s"
            or is_black(drawing.get("fill"))
            or is_black(drawing.get("color"))
        ):
            continue
        codes = [item[0] for item in drawing.get("items", [])]
        circular = codes.count("c") >= 2 or (
            len(drawing.get("items", [])) == 4 and drawing.get("type") in {"s", "f", "fs"}
        )
        if not circular:
            continue
        raw.append(
            {
                "x": shape_center_x,
                "y": shape_center_y,
                "diameter": max(width, height),
                "drawing_index": index,
                "drawing_type": drawing.get("type"),
            }
        )

    raw.sort(key=lambda item: -item["diameter"])
    clusters: list[dict[str, Any]] = []
    for item in raw:
        placed = False
        for cluster in clusters:
            distance = math.hypot(item["x"] - cluster["x"], item["y"] - cluster["y"])
            tolerance = max(0.9, min(3.0, max(item["diameter"], cluster["diameter"]) * 0.35))
            if distance <= tolerance:
                weight = 2 if item["drawing_type"] == "s" else 1
                total = cluster["weight"] + weight
                cluster["x"] = (cluster["x"] * cluster["weight"] + item["x"] * weight) / total
                cluster["y"] = (cluster["y"] * cluster["weight"] + item["y"] * weight) / total
                cluster["weight"] = total
                cluster["diameter"] = max(cluster["diameter"], item["diameter"])
                cluster["source_drawing_indices"].append(item["drawing_index"])
                placed = True
                break
        if not placed:
            clusters.append(
                {
                    "x": item["x"],
                    "y": item["y"],
                    "diameter": item["diameter"],
                    "weight": 1,
                    "source_drawing_indices": [item["drawing_index"]],
                }
            )
    clusters.sort(key=lambda item: (item["y"], item["x"]))
    return clusters


def drawing_color_hex(color: tuple[float, ...] | None) -> str | None:
    if color is None or len(color) < 3:
        return None
    channels = [max(0, min(255, round(channel * 255))) for channel in color[:3]]
    return "#" + "".join(f"{channel:02x}" for channel in channels)


def extract_label_tokens(
    page: fitz.Page, outer_rect: fitz.Rect, title_rect: fitz.Rect
) -> list[dict[str, Any]]:
    center_x = (outer_rect.x0 + outer_rect.x1) / 2.0
    center_y = (outer_rect.y0 + outer_rect.y1) / 2.0
    radius = (outer_rect.width + outer_rect.height) / 4.0
    raw_text = page.get_text("rawdict")
    tokens: list[dict[str, Any]] = []

    for block in raw_text["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            chars: list[dict[str, Any]] = []
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    char_text = char["c"]
                    if char_text.isspace():
                        continue
                    rect = fitz.Rect(char["bbox"])
                    char_center = ((rect.x0 + rect.x1) / 2.0, (rect.y0 + rect.y1) / 2.0)
                    if rect.y0 >= title_rect.y0 - 0.2:
                        continue
                    if not rect.intersects(outer_rect + (-7, -7, 7, 7)):
                        continue
                    if math.hypot(char_center[0] - center_x, char_center[1] - center_y) > radius + 8:
                        continue
                    chars.append({"char": char_text, "rect": rect})
            if not chars:
                continue
            chars.sort(key=lambda item: item["rect"].x0)
            group: list[dict[str, Any]] = []

            def flush(current_group: list[dict[str, Any]]) -> None:
                if not current_group:
                    return
                text = "".join(item["char"] for item in current_group)
                rect = fitz.Rect(current_group[0]["rect"])
                for grouped_item in current_group[1:]:
                    rect |= grouped_item["rect"]
                if LABEL_RE.match(text):
                    tokens.append(
                        {
                            "text": text,
                            "bbox": rect,
                            "x": (rect.x0 + rect.x1) / 2.0,
                            "y": (rect.y0 + rect.y1) / 2.0,
                        }
                    )

            for char_item in chars:
                if not group:
                    group = [char_item]
                    continue
                previous = group[-1]["rect"]
                current = char_item["rect"]
                gap = current.x0 - previous.x1
                vertical_overlap = max(
                    0.0, min(previous.y1, current.y1) - max(previous.y0, current.y0)
                ) / max(0.1, min(previous.height, current.height))
                if gap <= max(0.7, previous.width * 0.55) and vertical_overlap > 0.45:
                    group.append(char_item)
                else:
                    flush(group)
                    group = [char_item]
            flush(group)

    unique_tokens: list[dict[str, Any]] = []
    for token in tokens:
        duplicate = any(
            token["text"] == seen["text"]
            and math.hypot(token["x"] - seen["x"], token["y"] - seen["y"]) < 0.3
            for seen in unique_tokens
        )
        if not duplicate:
            unique_tokens.append(token)
    return unique_tokens


def map_labels_to_contacts(
    contacts: list[dict[str, Any]], tokens: list[dict[str, Any]], outer_diameter: float
) -> dict[int, dict[str, Any]]:
    pairs: list[tuple[float, int, int]] = []
    for token_index, token in enumerate(tokens):
        for contact_index, contact in enumerate(contacts):
            distance = math.hypot(token["x"] - contact["x"], token["y"] - contact["y"])
            threshold = max(6.0, min(18.0, outer_diameter * 0.24), contact["diameter"] * 3.5)
            if distance <= threshold:
                pairs.append((distance, token_index, contact_index))

    pairs.sort()
    used_tokens: set[int] = set()
    used_contacts: set[int] = set()
    mapped: dict[int, dict[str, Any]] = {}
    for distance, token_index, contact_index in pairs:
        if token_index in used_tokens or contact_index in used_contacts:
            continue
        used_tokens.add(token_index)
        used_contacts.add(contact_index)
        token = tokens[token_index]
        mapped[contact_index] = {
            "label": token["text"],
            "distance": round2(distance),
            "label_bbox": rect_tuple(token["bbox"]),
        }
    return mapped


def diameter_bins(contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_rounded_diameter: dict[float, dict[str, Any]] = {}
    for index, contact in enumerate(contacts):
        diameter_key = round(float(contact["diameter"]), 2)
        bin_item = by_rounded_diameter.setdefault(
            diameter_key,
            {
                "indices": [],
                "diameters": [],
                "diameter_mean": diameter_key,
            },
        )
        bin_item["indices"].append(index)
        bin_item["diameters"].append(contact["diameter"])
        bin_item["diameter_mean"] = sum(bin_item["diameters"]) / len(bin_item["diameters"])
    return sorted(by_rounded_diameter.values(), key=lambda item: item["diameter_mean"])


def merge_nearest_diameter_bins(
    bins: list[dict[str, Any]], target_count: int
) -> list[dict[str, Any]]:
    merged = [
        {
            "indices": list(bin_item["indices"]),
            "diameters": list(bin_item["diameters"]),
            "diameter_mean": bin_item["diameter_mean"],
        }
        for bin_item in bins
    ]
    while len(merged) > target_count:
        nearest_index = min(
            range(len(merged) - 1),
            key=lambda index: merged[index + 1]["diameter_mean"] - merged[index]["diameter_mean"],
        )
        left = merged[nearest_index]
        right = merged.pop(nearest_index + 1)
        left["indices"].extend(right["indices"])
        left["diameters"].extend(right["diameters"])
        left["diameter_mean"] = sum(left["diameters"]) / len(left["diameters"])
    return sorted(merged, key=lambda item: item["diameter_mean"])


def assign_contact_sizes(
    contacts: list[dict[str, Any]], contact_size_notes: list[dict[str, Any]]
) -> tuple[dict[int, dict[str, Any]], list[str]]:
    issues: list[str] = []
    assignments: dict[int, dict[str, Any]] = {}
    if not contact_size_notes:
        issues.append("No contact-size note was parsed from the arrangement title.")
        return assignments, issues
    if len(contact_size_notes) == 1:
        note = contact_size_notes[0]
        for index in range(len(contacts)):
            assignments[index] = {
                "size": note["size"],
                "type": note["type"],
                "confidence": "high",
                "source_text": note["source_text"],
            }
        return assignments, issues

    raw_bins = diameter_bins(contacts)
    bins = merge_nearest_diameter_bins(raw_bins, len(contact_size_notes))
    expected_counts = sorted(
        [(note["count"], SIZE_ORDER.get(note["size"], 99), note) for note in contact_size_notes],
        key=lambda item: item[1],
    )
    observed_counts = [len(bin_item["indices"]) for bin_item in bins]
    expected_count_values = [item[0] for item in expected_counts]

    if len(bins) == len(contact_size_notes) and observed_counts == expected_count_values:
        for bin_item, (_, _, note) in zip(bins, expected_counts):
            for contact_index in bin_item["indices"]:
                assignments[contact_index] = {
                    "size": note["size"],
                    "type": note["type"],
                    "confidence": "medium",
                    "source_text": note["source_text"],
                    "diameter_bin": round2(bin_item["diameter_mean"]),
                }
        return assignments, issues

    if len(bins) == len(contact_size_notes) and sorted(observed_counts) == sorted(expected_count_values):
        unmatched_notes = [item[2] for item in expected_counts]
        for bin_item in bins:
            matching_note_index = next(
                (
                    index
                    for index, note in enumerate(unmatched_notes)
                    if note["count"] == len(bin_item["indices"])
                ),
                None,
            )
            if matching_note_index is None:
                continue
            note = unmatched_notes.pop(matching_note_index)
            for contact_index in bin_item["indices"]:
                assignments[contact_index] = {
                    "size": note["size"],
                    "type": note["type"],
                    "confidence": "medium",
                    "source_text": note["source_text"],
                    "diameter_bin": round2(bin_item["diameter_mean"]),
                }
        if len(assignments) == len(contacts):
            return assignments, issues

    if sum(expected_count_values) == len(contacts):
        ordered_notes = sorted(
            contact_size_notes,
            key=lambda note: SIZE_ORDER.get(note["size"], 99),
            reverse=True,
        )
        ordered_contacts = sorted(
            enumerate(contacts),
            key=lambda item: item[1]["diameter"],
            reverse=True,
        )
        cursor = 0
        for note in ordered_notes:
            for contact_index, contact in ordered_contacts[cursor : cursor + note["count"]]:
                assignments[contact_index] = {
                    "size": note["size"],
                    "type": note["type"],
                    "confidence": "medium",
                    "source_text": note["source_text"],
                    "detected_diameter": round2(contact["diameter"]),
                }
            cursor += note["count"]
        issues.append(
            "Contact-size assignment used diameter ranking because vector diameter groups "
            f"{observed_counts} do not exactly match source title counts {expected_count_values}."
        )
        return assignments, issues

    issues.append(
        "Contact-size assignment is ambiguous: vector diameter groups "
        f"{observed_counts} do not match source title counts {expected_count_values}."
    )
    return assignments, issues


def drawing_items_to_path(items: list[tuple[Any, ...]], crop_rect: fitz.Rect) -> str | None:
    commands: list[str] = []
    current: fitz.Point | None = None
    for item in items:
        op = item[0]
        if op == "l":
            p1, p2 = item[1], item[2]
            if current is None or abs(current.x - p1.x) > 0.01 or abs(current.y - p1.y) > 0.01:
                commands.append(f"M {round2(p1.x - crop_rect.x0)} {round2(p1.y - crop_rect.y0)}")
            commands.append(f"L {round2(p2.x - crop_rect.x0)} {round2(p2.y - crop_rect.y0)}")
            current = p2
        elif op == "c":
            p1, p2, p3, p4 = item[1], item[2], item[3], item[4]
            if current is None or abs(current.x - p1.x) > 0.01 or abs(current.y - p1.y) > 0.01:
                commands.append(f"M {round2(p1.x - crop_rect.x0)} {round2(p1.y - crop_rect.y0)}")
            commands.append(
                "C "
                f"{round2(p2.x - crop_rect.x0)} {round2(p2.y - crop_rect.y0)} "
                f"{round2(p3.x - crop_rect.x0)} {round2(p3.y - crop_rect.y0)} "
                f"{round2(p4.x - crop_rect.x0)} {round2(p4.y - crop_rect.y0)}"
            )
            current = p4
        elif op == "re":
            rect = item[1]
            commands.append(
                "M "
                f"{round2(rect.x0 - crop_rect.x0)} {round2(rect.y0 - crop_rect.y0)} "
                f"L {round2(rect.x1 - crop_rect.x0)} {round2(rect.y0 - crop_rect.y0)} "
                f"L {round2(rect.x1 - crop_rect.x0)} {round2(rect.y1 - crop_rect.y0)} "
                f"L {round2(rect.x0 - crop_rect.x0)} {round2(rect.y1 - crop_rect.y0)} Z"
            )
            current = None
    return " ".join(commands) if commands else None


def extract_guide_paths(
    page: fitz.Page,
    crop_rect: fitz.Rect,
    outer_rect: fitz.Rect,
    contact_drawing_indices: set[int],
    outer_drawing_index: int | None,
) -> list[dict[str, Any]]:
    guide_paths: list[dict[str, Any]] = []
    clip = outer_rect + (-0.5, -0.5, 0.5, 0.5)
    for drawing_index, drawing in enumerate(page.get_drawings()):
        if drawing_index == outer_drawing_index or drawing_index in contact_drawing_indices:
            continue
        rect = drawing.get("rect")
        if rect is None:
            continue
        drawing_rect = fitz.Rect(rect)
        if not crop_rect.intersects(drawing_rect) or not clip.intersects(drawing_rect):
            continue
        if drawing.get("type") != "s" or drawing.get("fill") is not None or not is_black(drawing.get("color")):
            continue
        width = float(drawing.get("width") or 0)
        if width <= 0 or width > 0.75:
            continue
        local_rect = [
            round2(drawing_rect.x0 - crop_rect.x0),
            round2(drawing_rect.y0 - crop_rect.y0),
            round2(drawing_rect.x1 - crop_rect.x0),
            round2(drawing_rect.y1 - crop_rect.y0),
        ]
        if max(drawing_rect.width, drawing_rect.height) < 1.2:
            continue
        path = drawing_items_to_path(drawing.get("items", []), crop_rect)
        if not path:
            continue
        guide_paths.append(
            {
                "source_drawing_index": drawing_index,
                "d": path,
                "stroke": drawing_color_hex(drawing.get("color")) or "#000000",
                "stroke_width": round2(width),
                "bbox": local_rect,
            }
        )
    guide_paths.sort(key=lambda item: item["source_drawing_index"])
    return guide_paths


def visual_pin_radius(shell_radius: float, contact_count: int) -> float:
    """Return a compact rendering radius in the SVG/PDF coordinate system."""
    if contact_count <= 5:
        factor = 0.058
    elif contact_count <= 30:
        factor = 0.044
    elif contact_count <= 80:
        factor = 0.034
    else:
        factor = 0.027
    radius = shell_radius * factor
    minimum = max(0.55, shell_radius * 0.02)
    maximum = min(2.8, shell_radius * 0.085)
    return max(minimum, min(maximum, radius))


def normalize_duplicate_contact_labels(contacts: list[dict[str, Any]]) -> list[str]:
    """
    The source PDF sometimes emits double-letter labels as separated identical
    one-character text tokens (for example "F F" instead of "FF"). Convert the
    second and subsequent occurrence of a single uppercase label to repeated
    letters so the app does not expose duplicate pin labels.
    """
    issues: list[str] = []
    seen: dict[str, int] = {}
    existing = {contact["label"] for contact in contacts if contact["label"] != "?"}

    for contact in contacts:
        label = contact["label"]
        if label == "?":
            continue
        prior_count = seen.get(label, 0)
        seen[label] = prior_count + 1
        if prior_count == 0:
            continue
        if len(label) == 1 and label.isalpha() and label.isupper():
            repeat_count = prior_count + 1
            candidate = label * repeat_count
            while candidate in existing:
                repeat_count += 1
                candidate = label * repeat_count
            contact["original_source_label"] = label
            contact["label"] = candidate
            contact["label_confidence"] = "medium"
            if contact["confidence"] == "high":
                contact["confidence"] = "medium"
            existing.add(candidate)
            issues.append(
                f"Normalized duplicate source label '{label}' to '{candidate}' because the PDF text extraction split a double-letter label."
            )
        else:
            issues.append(
                f"Duplicate label '{label}' remains ambiguous and needs manual verification."
            )
    return issues


def compute_crop_rect(
    page: fitz.Page,
    outer_rect: fitz.Rect,
    title_rect: fitz.Rect,
    label_tokens: list[dict[str, Any]],
) -> fitz.Rect:
    crop = fitz.Rect(outer_rect)
    crop |= title_rect
    for token in label_tokens:
        crop |= token["bbox"]
    padding = max(5.0, outer_rect.width * 0.12)
    crop += (-padding, -padding, padding, padding)
    page_rect = page.rect
    crop.x0 = max(page_rect.x0, crop.x0)
    crop.y0 = max(page_rect.y0, crop.y0)
    crop.x1 = min(page_rect.x1, crop.x1)
    crop.y1 = min(page_rect.y1, crop.y1)
    return crop


def export_svg_clip(
    source_doc: fitz.Document,
    source_page_index: int,
    crop_rect: fitz.Rect,
    target_path: Path,
    arrangement_id: str,
) -> None:
    out_doc = fitz.open()
    page = out_doc.new_page(width=crop_rect.width, height=crop_rect.height)
    page.show_pdf_page(
        fitz.Rect(0, 0, crop_rect.width, crop_rect.height),
        source_doc,
        source_page_index,
        clip=crop_rect,
    )
    svg = page.get_svg_image(text_as_path=1)
    metadata = (
        f"<!-- Source: d38999-contact-arrangements.pdf page {source_page_index + 1}; "
        f"arrangement {arrangement_id}; crop {rect_tuple(crop_rect)} -->\n"
    )
    target_path.write_text(metadata + svg, encoding="utf-8")
    out_doc.close()


def render_crop_preview(page: fitz.Page, crop_rect: fitz.Rect, target_path: Path) -> None:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=crop_rect, alpha=False)
    pixmap.save(str(target_path))


def render_page_debug(
    page: fitz.Page,
    page_number: int,
    arrangements: list[dict[str, Any]],
    target_path: Path,
) -> None:
    scale = 2.0
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = pixmap.pil_image()
    draw = ImageDraw.Draw(image)
    for arrangement in arrangements:
        outer = arrangement["_outer_rect"]
        title = arrangement["_title_rect"]
        crop = arrangement["_crop_rect"]
        for rect, color, width in (
            (crop, "#f0b45b", 2),
            (outer, "#82b36d", 2),
            (title, "#8fb7c9", 1),
        ):
            draw.rectangle(
                [coord * scale for coord in (rect.x0, rect.y0, rect.x1, rect.y1)],
                outline=color,
                width=width,
            )
        draw.text((crop.x0 * scale, max(0, crop.y0 * scale - 14)), arrangement["id"], fill="#f0b45b")
    image.save(target_path)


def make_review_entry(
    arrangement: dict[str, Any], issues: list[str], severity: str = "needs_manual_verification"
) -> dict[str, Any]:
    return {
        "id": arrangement["id"],
        "source_pdf": "d38999-contact-arrangements.pdf",
        "source_page": arrangement["source_page"],
        "severity": severity,
        "issues": issues,
        "crop_bbox_pdf_points": arrangement.get("source_crop_bbox"),
    }


def extract(project_root: Path, pdf_name: str = "d38999-contact-arrangements.pdf") -> dict[str, Any]:
    pdf_path = project_root / "docs" / "pdfs" / pdf_name
    if not pdf_path.exists():
        # Fall back to repo root for backwards compatibility.
        pdf_path = project_root / pdf_name
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)

    data_dir = project_root / "data"
    svg_dir = data_dir / "svg"
    debug_dir = project_root / "output" / "debug"
    for directory in (svg_dir, data_dir, debug_dir):
        directory.mkdir(parents=True, exist_ok=True)

    source_doc = fitz.open(pdf_path)
    standard_references = load_standard_contact_reference(project_root)
    arrangements: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    page_debug_items: dict[int, list[dict[str, Any]]] = {}

    for page_index in range(source_doc.page_count):
        page = source_doc[page_index]
        titles = extract_titles(page)
        if not titles:
            continue
        candidates = outer_circle_candidates(page)
        if not candidates:
            # Pages 1-2 contain the arrangement selection table. They list the
            # arrangement IDs but do not contain the drawing geometry to crop.
            continue
        mapped_titles = map_titles_to_outer_circles(titles, candidates)
        page_items_for_debug: list[dict[str, Any]] = []

        for item in mapped_titles:
            issues: list[str] = []
            outer_circle = item.get("outer_circle")
            if not outer_circle:
                item_record = {
                    "id": item["id"],
                    "source_page": page_index + 1,
                    "source_crop_bbox": None,
                }
                review.append(
                    make_review_entry(
                        item_record,
                        ["Arrangement title could not be matched to a vector outer circle."],
                    )
                )
                continue

            outer_rect: fitz.Rect = outer_circle["rect"]
            contacts = detect_contacts(page, outer_rect)
            label_tokens = extract_label_tokens(page, outer_rect, item["title_rect"])
            label_map = map_labels_to_contacts(contacts, label_tokens, outer_rect.width)
            size_map, size_issues = assign_contact_sizes(contacts, item["contact_size_notes"])
            issues.extend(size_issues)

            expected_count = item["expected_contact_count"]
            if expected_count and len(contacts) != expected_count:
                issues.append(
                    f"Detected {len(contacts)} contact centers but source title lists {expected_count}."
                )
            direct_label_issue = None
            if len(label_map) != len(contacts):
                direct_label_issue = (
                    f"Matched {len(label_map)} PDF text labels to {len(contacts)} detected contacts."
                )
            if len(label_tokens) > len(label_map):
                issues.append(
                    f"{len(label_tokens) - len(label_map)} source label tokens were not matched to contacts."
                )

            crop_rect = compute_crop_rect(page, outer_rect, item["title_rect"], label_tokens)
            minimum_margin = min(
                outer_rect.x0 - crop_rect.x0,
                outer_rect.y0 - crop_rect.y0,
                crop_rect.x1 - outer_rect.x1,
                crop_rect.y1 - outer_rect.y1,
            )
            if minimum_margin < outer_rect.width * 0.08:
                issues.append(
                    "Crop padding around the outer connector outline is below the requested 8% margin."
                )

            svg_filename = f"d38999_{item['id']}.svg"
            svg_path = svg_dir / svg_filename
            export_svg_clip(source_doc, page_index, crop_rect, svg_path, item["id"])
            render_crop_preview(page, crop_rect, debug_dir / f"{item['id']}_crop_preview.png")

            contact_drawing_indices = {
                source_index
                for contact in contacts
                for source_index in contact["source_drawing_indices"]
            }
            guide_paths = extract_guide_paths(
                page,
                crop_rect,
                outer_rect,
                contact_drawing_indices,
                outer_circle["index"],
            )

            contacts_out: list[dict[str, Any]] = []
            for contact_index, contact in enumerate(contacts):
                label_info = label_map.get(contact_index)
                size_info = size_map.get(contact_index)
                label = label_info["label"] if label_info else "?"
                label_confidence = "high" if label_info else "needs_review"
                contact_confidence = (
                    "high"
                    if label_info and size_info and size_info.get("confidence") in {"high", "medium"}
                    else "needs_review"
                )
                contacts_out.append(
                    {
                        "label": label,
                        "x": round2(contact["x"] - crop_rect.x0),
                        "y": round2(contact["y"] - crop_rect.y0),
                        "source_x": round2(contact["x"]),
                        "source_y": round2(contact["y"]),
                        "r": round2(
                            visual_pin_radius(
                                (outer_rect.width + outer_rect.height) / 4.0,
                                len(contacts),
                            )
                        ),
                        "size": size_info["size"] if size_info else "unknown",
                        "type": size_info["type"] if size_info else "unknown",
                        "detected_diameter": round2(contact["diameter"]),
                        "confidence": contact_confidence,
                        "label_confidence": label_confidence,
                        "size_confidence": size_info["confidence"] if size_info else "needs_review",
                        "label_match_distance": label_info["distance"] if label_info else None,
                        "source_drawing_indices": contact["source_drawing_indices"],
                    }
                )

            standard_label_result = apply_standard_reference_labels(
                item["id"], contacts_out, standard_references
            )
            if standard_label_result is None:
                if direct_label_issue:
                    issues.append(f"{direct_label_issue} Unmatched contacts are labelled '?'.")
                issues.extend(normalize_duplicate_contact_labels(contacts_out))
            else:
                duplicate_labels = sorted(
                    {
                        contact["label"]
                        for contact in contacts_out
                        if sum(1 for item_contact in contacts_out if item_contact["label"] == contact["label"]) > 1
                    }
                )
                if duplicate_labels:
                    issues.append(
                        "Standard reference label mapping produced duplicate labels: "
                        + ", ".join(duplicate_labels)
                    )

            arrangement_confidence = "high"
            if issues:
                arrangement_confidence = "needs_review"
            elif any(contact["confidence"] != "high" for contact in contacts_out):
                arrangement_confidence = "medium"

            arrangement = {
                "id": item["id"],
                "shell_size": item["shell_size"],
                "shell_size_code": item["shell_size_code"],
                "arrangement_number": item["arrangement_number"],
                "contact_count": len(contacts_out),
                "expected_contact_count": expected_count,
                "contact_size_notes": item["contact_size_notes"],
                "service_rating": parse_service_rating(item["title_text"]),
                "svg": f"assets/svg/{svg_filename}",
                "source_pdf": pdf_name,
                "source_page": page_index + 1,
                "source_title_text": item["title_text"],
                "source_title_bbox": rect_tuple(item["title_rect"]),
                "source_outer_bbox": rect_tuple(outer_rect),
                "source_crop_bbox": rect_tuple(crop_rect),
                "viewBox": {
                    "min_x": 0,
                    "min_y": 0,
                    "width": round2(crop_rect.width),
                    "height": round2(crop_rect.height),
                },
                "confidence": arrangement_confidence,
                "contacts": contacts_out,
                "guide_paths": guide_paths,
                "outline": {
                    "center_x": round2((outer_rect.x0 + outer_rect.x1) / 2.0 - crop_rect.x0),
                    "center_y": round2((outer_rect.y0 + outer_rect.y1) / 2.0 - crop_rect.y0),
                    "radius": round2((outer_rect.width + outer_rect.height) / 4.0),
                },
                "orientation": {
                    "keyway_angle_deg": None,
                    "front_view": True,
                    "source_note": "Front face of pin insert shown",
                    "source_page": page_index + 1,
                },
                "notes": issues,
                "extraction": {
                    "outer_circle_mapping_score": item.get("mapping_score"),
                    "label_tokens_detected": len(label_tokens),
                    "labels_matched": len(label_map),
                    "guide_paths_detected": len(guide_paths),
                    "standard_reference_labels": standard_label_result,
                    "method": "PDF vector contact centers with PDF text label matching",
                },
            }
            arrangements.append(arrangement)

            debug_copy = dict(arrangement)
            debug_copy["_outer_rect"] = outer_rect
            debug_copy["_title_rect"] = item["title_rect"]
            debug_copy["_crop_rect"] = crop_rect
            page_items_for_debug.append(debug_copy)

            if issues:
                review.append(make_review_entry(arrangement, issues))

        if page_items_for_debug:
            page_debug_items[page_index] = page_items_for_debug

    for page_index, page_items in page_debug_items.items():
        render_page_debug(
            source_doc[page_index],
            page_index + 1,
            page_items,
            debug_dir / f"page_{page_index + 1}_detections.png",
        )

    arrangements.sort(key=lambda item: (int(item["shell_size"]), int(item["arrangement_number"])))
    data = {
        "schema_version": "1.0",
        "generated_at": now_iso(),
        "source_pdf": pdf_name,
        "source_pdf_sha256": sha256(pdf_path),
        "coordinate_system": {
            "units": "PDF points carried into SVG viewBox units",
            "origin": "top-left of each extracted SVG viewBox",
            "orientation": "front face of pin insert as printed in source PDF",
        },
        "arrangement_count": len(arrangements),
        "arrangements": arrangements,
    }

    review_data = {
        "schema_version": "1.0",
        "generated_at": data["generated_at"],
        "source_pdf": pdf_name,
        "review_count": len(review),
        "items": review,
    }

    (data_dir / "insert_arrangements.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "review_needed.json").write_text(
        json.dumps(review_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    write_contact_csv(data_dir / "insert_arrangements_contacts.csv", arrangements)
    source_doc.close()
    return data


def parse_service_rating(title_text: str) -> str:
    match = ARRANGEMENT_ID_RE.search(title_text)
    if not match:
        return "unknown"
    remainder = title_text[match.end() :].strip()
    first_count = CONTACT_COUNT_RE.search(remainder)
    if not first_count:
        return remainder.split()[0] if remainder.split() else "unknown"
    return remainder[: first_count.start()].strip() or "unknown"


def write_contact_csv(path: Path, arrangements: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "arrangement",
                "source_page",
                "label",
                "x",
                "y",
                "size",
                "type",
                "confidence",
            ],
        )
        writer.writeheader()
        for arrangement in arrangements:
            for contact in arrangement["contacts"]:
                writer.writerow(
                    {
                        "arrangement": arrangement["id"],
                        "source_page": arrangement["source_page"],
                        "label": contact["label"],
                        "x": contact["x"],
                        "y": contact["y"],
                        "size": contact["size"],
                        "type": contact["type"],
                        "confidence": contact["confidence"],
                    }
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".", help="Project root containing the source PDFs")
    parser.add_argument("--pdf", default="d38999-contact-arrangements.pdf")
    args = parser.parse_args()
    data = extract(Path(args.project_root).resolve(), args.pdf)
    print(
        f"Extracted {data['arrangement_count']} arrangements from {args.pdf} "
        "into output/assets/svg and output/data."
    )


if __name__ == "__main__":
    main()
