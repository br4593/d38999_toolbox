"""
Extract part-number and lookup definitions from dtl38999.pdf.

This script uses explicit, source-page-backed data from the specification text.
Where dtl38999.pdf points to another document (for example supplement 1 or
MIL-STD-1560), the generated JSON records the reference and marks the value as
unknown or needing manual verification rather than filling it from memory.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from typing import Any

import fitz


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def source(page: int, section: str, note: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"source_pdf": "dtl38999.pdf", "source_page": page, "section": section}
    if note:
        payload["note"] = note
    return payload


def shell_size_codes() -> dict[str, Any]:
    page = 3
    mapping = {
        "A": "9",
        "B": "11",
        "C": "13",
        "D": "15",
        "E": "17",
        "F": "19",
        "G": "21",
        "H": "23",
        "J": "25",
    }
    return {
        code: {
            "shell_size": shell,
            "confidence": "high",
            **source(page, "TABLE I. Shell size code for series III and IV part numbering"),
        }
        for code, shell in mapping.items()
    }


def contact_styles() -> dict[str, Any]:
    page = 7
    values = {
        "P": "Pin - including hermetics with solder cups.",
        "S": "Socket - including hermetics with solder cups.",
        "H": "Pin - 1500-cycle contact.",
        "J": "Socket - 1500-cycle contact.",
        "X": "Pin - with eyelet termination (hermetic only).",
        "Z": "Socket - with eyelet termination (hermetic only).",
        "C": "Pin - feed-thru (hermetic only).",
        "D": "Socket - feed-thru (hermetic only).",
        "R": "Pin - rhodium plating, including hermetics with solder cups.",
        "M": "Socket - rhodium plating, including hermetics with solder cups.",
        "G": "Pin - heavy gold plating, including hermetics with solder cups.",
        "U": "Socket - heavy gold plating, including hermetics with solder cups.",
        "A": "Connector with pin contact insert less standard pin contacts.",
        "B": "Connector with socket contact insert less standard socket contacts.",
    }
    pin_codes = {"P", "H", "X", "C", "R", "G", "A"}
    socket_codes = {"S", "J", "Z", "D", "M", "U", "B"}
    return {
        code: {
            "description": description,
            "contact_gender": "pin" if code in pin_codes else "socket" if code in socket_codes else "unknown",
            "confidence": "high",
            **source(page, "1.4.2 Contact styles"),
        }
        for code, description in values.items()
    }


def class_finish_definitions() -> dict[str, Any]:
    values = {
        "A": (14, "Nickel plate followed by cadmium plate, final finish electrically conductive and silver to light iridescent yellow."),
        "B": (14, "Olive drab cadmium plate over a suitable underplate; final finish electrically conductive."),
        "C": (14, "Hard anodic, nonconductive coating."),
        "D": (14, "Fused tin plate, reflowed to promote solderability; process shall inhibit tin whisker growth."),
        "E": (14, "Electrically conductive, stainless steel, passivated."),
        "F": (14, "Electrically conductive electroless nickel plating."),
        "G": (14, "Same finish family as F; see F, G entry in shell finish section."),
        "H": (15, "Electrically conductive, corrosion resistant steel, passivated."),
        "K": (15, "Electrically conductive, corrosion resistant steel, passivated."),
        "Y": (15, "Electrically conductive, corrosion resistant steel, passivated."),
        "J": (15, "Olive drab cadmium plate over a suitable underplate; dynamic salt spray requirements apply."),
        "L": (15, "Electrodeposited nickel."),
        "N": (15, "Electrodeposited nickel."),
        "S": (15, "Electrodeposited nickel."),
        "M": (15, "Electrically conductive electroless nickel or electrodeposited nickel; dynamic salt spray requirements apply."),
        "T": (15, "Nickel fluorocarbon polymer; color shall be nonreflective."),
        "R": (15, "Electrically conductive electroless nickel or electrodeposited nickel; higher corrosion requirement."),
        "U": (15, "Nickel plate followed by cadmium plate; final finish electrically conductive and silver to light iridescent yellow."),
        "V": (15, "Tin-zinc alloy; final finish electrically conductive; not approved for NAVAIR use per table note."),
        "W": (15, "Olive drab cadmium plate over a suitable underplate; final finish electrically conductive."),
        "Z": (15, "Zinc nickel, type D black, over a suitable underplate; color shall be nonreflective."),
        "AA": (15, "Tri-nickel alloy plate; electrically conductive electroless nickel plating."),
        "AB": (16, "Same class V above."),
    }
    return {
        code: {
            "description": description,
            "confidence": "medium",
            **source(page, "3.3.6.2 Shells and accessory hardware"),
            "classification_context": {
                "source_page": 3,
                "section": "1.4.1 Classes and finishes",
                "text": "For series III and IV, class designators identify environmental/hermetic status and shell finish/material/temperature range; see table II.",
            },
        }
        for code, (page, description) in values.items()
    }


def series_definitions() -> dict[str, Any]:
    return {
        "I": {
            "description": "Scoop-proof, bayonet coupling, inch-pound dimensions and measurements.",
            **source(2, "1.2.1 Connector series and types"),
        },
        "II": {
            "description": "Non-scoop-proof, bayonet coupling, low silhouette, inch-pound dimensions and measurements.",
            **source(2, "1.2.1 Connector series and types"),
        },
        "III": {
            "description": "Scoop-proof, triple start, self-locking, threaded coupling, metric dimensions and measurements.",
            **source(2, "1.2.1 Connector series and types"),
        },
        "IV": {
            "description": "Scoop-proof, breech coupling, metric dimensions and measurements.",
            **source(2, "1.2.1 Connector series and types"),
        },
    }


def slash_sheets() -> dict[str, Any]:
    return {
        "/20": {
            "description": "Specification sheet number shown in the series III/IV PIN example. Exact shell style is referred to supplement 1 and is not decoded from this PDF.",
            "confidence": "needs_manual_verification",
            **source(3, "1.3 Part or Identifying Number, series III and IV example"),
        },
        "/26": {
            "description": "Referenced in guidance example as a series III plug. Full specification-sheet style details require supplement 1 or the slash sheet and are not fully present in this PDF.",
            "series_inferred_from_source_text": "III",
            "shell_style": "plug",
            "confidence": "low",
            **source(71, "6.8.4 Guidance on performance determination of connectors"),
        },
    }


def polarization_definitions() -> dict[str, Any]:
    group_9 = {
        "N": [105, 140, 215, 265],
        "A": [102, 132, 248, 320],
        "B": [80, 118, 230, 312],
        "C": [35, 140, 205, 275],
        "D": [64, 155, 234, 304],
        "E": [91, 131, 197, 240],
    }
    group_11_15 = {
        "N": [95, 141, 208, 236],
        "A": [113, 156, 182, 292],
        "B": [90, 145, 195, 252],
        "C": [53, 156, 220, 255],
        "D": [119, 146, 176, 298],
        "E": [51, 141, 184, 242],
    }
    group_17_25 = {
        "N": [80, 142, 196, 293],
        "A": [135, 170, 200, 310],
        "B": [49, 169, 200, 244],
        "C": [66, 140, 200, 257],
        "D": [62, 145, 180, 280],
        "E": [79, 153, 197, 272],
    }
    shell_to_group = {
        "9": group_9,
        "11": group_11_15,
        "13": group_11_15,
        "15": group_11_15,
        "17": group_17_25,
        "19": group_17_25,
        "21": group_17_25,
        "23": group_17_25,
        "25": group_17_25,
    }
    rotations: dict[str, Any] = {}
    for shell_size, values in shell_to_group.items():
        rotations[shell_size] = {
            key: {
                "identification_letter": key,
                "AR_or_AP_deg": angles[0],
                "BR_or_BP_deg": angles[1],
                "CR_or_CP_deg": angles[2],
                "DR_or_DP_deg": angles[3],
                "description": "Normal" if key == "N" else f"Alternate rotation {key}",
                **source(103, "FIGURE 6 Main key/keyway polarization (series III)"),
            }
            for key, angles in values.items()
        }
    return {
        "series_iii": {
            "description": "Main key/keyway polarization for series III. The insert arrangement does not rotate with the main key/keyway.",
            "angle_units": "degrees BSC",
            "columns": ["AR_or_AP_deg", "BR_or_BP_deg", "CR_or_CP_deg", "DR_or_DP_deg"],
            "rotations_by_shell_size": rotations,
            "confidence": "high",
            **source(103, "FIGURE 6 Main key/keyway polarization (series III)"),
        },
        "series_iv": {
            "description": "Series IV polarization is referenced by the PIN section, but this extractor did not tabulate figure 7.",
            "confidence": "needs_manual_verification",
            **source(3, "1.3 Part or Identifying Number, series III and IV example"),
        },
    }


def build_standard_definitions(pdf_path: Path) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "generated_at": now_iso(),
        "standard": "MIL-DTL-38999",
        "source_pdf": pdf_path.name,
        "source_pdf_sha256": sha256(pdf_path),
        "definitions": {
            "series": series_definitions(),
            "slash_sheets": slash_sheets(),
            "classes": class_finish_definitions(),
            "contact_styles": contact_styles(),
            "shell_size_codes_series_iii_iv": shell_size_codes(),
            "polarization": polarization_definitions(),
            "insert_arrangements": {
                "description": "Insert arrangement values are referenced to MIL-STD-1560 by dtl38999.pdf. Actual insert drawings and coordinates in this project come from d38999-contact-arrangements.pdf.",
                "confidence": "high_for_reference_only",
                **source(3, "1.3 Part or Identifying Number"),
                "additional_reference": {
                    "source_page": 17,
                    "section": "3.4.1.4 Insert arrangements",
                    "text": "Insert arrangements shall be in accordance with MIL-STD-1560.",
                },
            },
            "part_number_examples": {
                "series_i_ii": {
                    "example": "MS27467T13F8PA",
                    **source(2, "1.3 Part or Identifying Number, series I and II example"),
                },
                "series_iii_iv": {
                    "example": "D38999/20WJ30PN",
                    **source(3, "1.3 Part or Identifying Number, series III and IV example"),
                },
            },
        },
        "warnings": [
            "dtl38999.pdf references supplement 1 for specification sheet numbers; the supplement/slash sheets are not included in this PDF.",
            "dtl38999.pdf references MIL-STD-1560 for insert arrangements; the arrangement drawings in this project are from d38999-contact-arrangements.pdf.",
        ],
    }


def build_part_number_rules(pdf_path: Path) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "generated_at": now_iso(),
        "standard": "MIL-DTL-38999",
        "source_pdf": pdf_path.name,
        "source_pdf_sha256": sha256(pdf_path),
        "part_number_patterns": [
            {
                "pattern_name": "D38999 slash-sheet connector, series III/IV form",
                "example": "D38999/26WE35PN",
                "regex": r"^D38999/([0-9]{2})([A-Z]{1,2}-?)([A-HJ])([0-9]{1,3})([A-Z])([A-Z])$",
                "confidence": "medium",
                "source_page": 3,
                "parse_note": "The PDF defines the series III/IV field order. The app parser uses known class codes and shell-size codes to avoid ambiguity in double-character classes.",
                "fields": [
                    {
                        "name": "family",
                        "description": "D38999 / MIL-DTL-38999 connector family",
                        **source(3, "1.3 Part or Identifying Number"),
                    },
                    {
                        "name": "slash_sheet",
                        "description": "Specification sheet number; exact shell style is in supplement 1.",
                        **source(3, "1.3 Part or Identifying Number"),
                    },
                    {
                        "name": "class",
                        "description": "Class; for double character classes, add trailing hyphen.",
                        **source(3, "1.3 Part or Identifying Number"),
                    },
                    {
                        "name": "shell_size_code",
                        "description": "Series III/IV shell size code.",
                        **source(3, "TABLE I. Shell size code for series III and IV part numbering"),
                    },
                    {
                        "name": "insert_arrangement",
                        "description": "Insert arrangement per MIL-STD-1560.",
                        **source(3, "1.3 Part or Identifying Number"),
                    },
                    {
                        "name": "contact_style",
                        "description": "Pin/socket/contact option.",
                        **source(7, "1.4.2 Contact styles"),
                    },
                    {
                        "name": "polarization",
                        "description": "Key/keyway polarization. Series III values are tabulated in figure 6.",
                        **source(3, "1.3 Part or Identifying Number"),
                    },
                ],
            }
        ],
        "decode_algorithm": [
            "Normalize to uppercase and remove spaces.",
            "Require prefix D38999/ followed by a two-digit slash-sheet number.",
            "Parse the final character as polarization and the preceding character as contact style.",
            "Parse the remaining body by matching a known class designator followed by a known series III/IV shell-size code and numeric insert arrangement.",
            "Resolve shell size from table I and combine it with the insert arrangement number as shell-size-insert, for example shell code E plus insert 35 becomes 17-35.",
        ],
        "definitions": {
            "shell_size_codes_series_iii_iv": shell_size_codes(),
            "contact_styles": contact_styles(),
            "slash_sheets": slash_sheets(),
            "classes": class_finish_definitions(),
        },
        "known_limitations": [
            "Full slash-sheet style decoding requires supplement 1 or the individual slash-sheet PDFs, which are not included in dtl38999.pdf.",
            "Insert arrangement geometry is not in dtl38999.pdf; this project extracts it from d38999-contact-arrangements.pdf.",
        ],
    }


def extract(project_root: Path, pdf_name: str = "dtl38999.pdf") -> tuple[dict[str, Any], dict[str, Any]]:
    candidates = [
        project_root / "docs" / "pdfs" / pdf_name,
        project_root / "docs" / "pdfs" / "MIL-DTL-38999-dtl38999.pdf",
        project_root / pdf_name,
    ]
    pdf_path = next((p for p in candidates if p.exists()), None)
    if pdf_path is None:
        raise FileNotFoundError(pdf_name)
    # Open once so PyMuPDF validates the PDF; definitions below are page-backed.
    with fitz.open(pdf_path) as doc:
        if doc.page_count < 103:
            raise RuntimeError("dtl38999.pdf is shorter than expected; cannot source figure 6 page 103.")

    # Web app is source of truth for runtime data; extraction writes into app/.
    data_dir = project_root / "app" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    standard_definitions = build_standard_definitions(pdf_path)
    part_number_rules = build_part_number_rules(pdf_path)
    (data_dir / "standard_definitions.json").write_text(
        json.dumps(standard_definitions, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (data_dir / "part_number_rules.json").write_text(
        json.dumps(part_number_rules, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return standard_definitions, part_number_rules


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".", help="Project root containing dtl38999.pdf")
    parser.add_argument("--pdf", default="dtl38999.pdf")
    args = parser.parse_args()
    standard_definitions, part_number_rules = extract(Path(args.project_root).resolve(), args.pdf)
    print(
        "Extracted standard definitions and part-number rules "
        f"from {args.pdf}: {len(standard_definitions['definitions'])} definition groups, "
        f"{len(part_number_rules['part_number_patterns'])} pattern."
    )


if __name__ == "__main__":
    main()
