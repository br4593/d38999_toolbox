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

from dataset_io import data_path


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


def dms_to_decimal(degrees: int, minutes: int) -> float:
    return round(degrees + minutes / 60.0, 4)


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

    series_iv_minor_keys = {
        "N": (110, 250, None),
        "A": (100, 260, None),
        "B": (90, 270, None),
        "C": (80, 280, None),
        "D": (70, 290, None),
        "K": (120, 255, "K polarization: see note 16 for U2/UU2/Z2 key/keyway width increase on Y/YY positions."),
        "L": (120, 265, None),
        "M": (120, 275, None),
        "R": (120, 285, None),
    }
    series_iv_main_keys = {
        "11": ("B", (47, 21), (148, 13), (211, 47), (312, 39)),
        "13": ("C", (46, 34), (148, 22), (211, 38), (313, 26)),
        "15": ("D", (46, 23), (148, 35), (211, 25), (313, 37)),
        "17": ("E", (46, 11), (148, 47), (211, 13), (313, 49)),
        "19": ("F", (45, 33), (149, 27), (210, 33), (314, 27)),
        "21": ("G", (45, 28), (149, 29), (210, 31), (314, 32)),
        "23": ("H", (45, 25), (149, 29), (210, 31), (314, 35)),
        "25": ("J", (45, 30), (149, 34), (210, 26), (314, 30)),
    }
    minor_key_arrangements = {
        key: {
            "identification_letter": key,
            "X_or_XX_deg": x_deg,
            "Y_or_YY_deg": y_deg,
            "description": "Normal" if key == "N" else f"Alternate polarization {key}",
            **({"note": note} if note else {}),
            **source(111, "FIGURE 7 Main key/keyway polarization (series IV)"),
        }
        for key, (x_deg, y_deg, note) in series_iv_minor_keys.items()
    }
    main_key_by_shell_size = {
        shell_size: {
            "shell_size_code": code,
            "P_deg_dms": f"{p[0]}\u00b0{p[1]:02d}'",
            "Q_deg_dms": f"{q[0]}\u00b0{q[1]:02d}'",
            "R_deg_dms": f"{r[0]}\u00b0{r[1]:02d}'",
            "S_deg_dms": f"{s[0]}\u00b0{s[1]:02d}'",
            "P_deg": dms_to_decimal(*p),
            "Q_deg": dms_to_decimal(*q),
            "R_deg": dms_to_decimal(*r),
            "S_deg": dms_to_decimal(*s),
            **source(111, "FIGURE 7 Main key/keyway polarization (series IV)"),
        }
        for shell_size, (code, p, q, r, s) in series_iv_main_keys.items()
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
            "description": (
                "Main key/keyway polarization for series IV. The minor key/keyway polarity "
                "arrangements (N, A, B, C, D, K, L, M, R) apply to all shell sizes (note 5), "
                "while the main key/keyway angles P/Q/R/S vary by shell size. The insert "
                "arrangement does not rotate with the main key/keyway. Series IV is defined "
                "for shell sizes 11 through 25 (no shell size 9)."
            ),
            "angle_units": "degrees BSC",
            "minor_key_polarity_arrangements": {
                "columns": ["X_or_XX_deg", "Y_or_YY_deg"],
                "applies_to_all_shell_sizes": True,
                "arrangements": minor_key_arrangements,
            },
            "main_key_by_shell_size": {
                "columns": ["P_deg", "Q_deg", "R_deg", "S_deg"],
                "angle_format": "Values are printed in degrees-minutes (the *_dms fields); the *_deg fields are decimal-degree equivalents.",
                "shell_sizes": main_key_by_shell_size,
            },
            "confidence": "high",
            **source(111, "FIGURE 7 Main key/keyway polarization (series IV)"),
        },
    }


def key_geometry_definitions() -> dict[str, Any]:
    """Real main-key/keyway diameters and key/keyway widths (series IV, figure 7).

    Diameters come from the figure 7 main-key table (p.111); key/keyway width
    dimensions come from the figure 7 width tables (p.112). These are the
    machine-readable, dimensioned key widths from the standard. Series III width
    dimensions are published only as dimensioned drawings (figure 6, pp.99-107)
    and are not extractable as text, so only the series IV widths are tabulated
    here; the series III main key is geometrically equivalent in magnitude.
    """
    # shell: (code, L_dia_max_mm, L_dia_max_in, L_dia_min_mm, L_dia_min_in, M_dia_bsc_mm, M_dia_bsc_in)
    diameters = {
        "11": ("B", 13.26, 0.522, 13.16, 0.518, 16.28, 0.641),
        "13": ("C", 16.68, 0.657, 16.58, 0.653, 19.35, 0.762),
        "15": ("D", 19.86, 0.782, 19.76, 0.778, 22.50, 0.886),
        "17": ("E", 23.06, 0.908, 22.96, 0.904, 25.68, 1.011),
        "19": ("F", 25.96, 1.022, 25.86, 1.018, 27.71, 1.091),
        "21": ("G", 29.13, 1.147, 29.03, 1.143, 30.88, 1.216),
        "23": ("H", 32.31, 1.272, 32.21, 1.268, 34.16, 1.345),
        "25": ("J", 35.48, 1.397, 35.38, 1.393, 37.38, 1.472),
    }
    # shell: (U_mm,U_in, U2K_mm,U2K_in, UUmax_mm,UUmax_in, UU2K_mm,UU2K_in, W1_mm,W1_in, W2_mm,W2_in)
    # U2 (all polarizations except K) equals U; UU2 (except K) equals UU max.
    # W1/W2 are blank on the drawing for shells 17, 21 and 25 (recorded as null).
    widths = {
        "11": (1.26, 0.050, 2.06, 0.081, 2.42, 0.095, 3.20, 0.126, 1.82, 0.072, 2.84, 0.112),
        "13": (0.95, 0.037, 1.96, 0.077, 2.22, 0.087, 3.00, 0.118, 1.85, 0.073, 2.87, 0.113),
        "15": (1.77, 0.070, 2.82, 0.111, 2.76, 0.109, 3.81, 0.150, 2.36, 0.093, 3.37, 0.133),
        "17": (1.46, 0.057, 2.72, 0.107, 2.71, 0.107, 3.58, 0.141, None, None, None, None),
        "19": (2.28, 0.090, 3.58, 0.141, 2.94, 0.116, 4.24, 0.167, 2.87, 0.113, 3.89, 0.153),
        "21": (1.97, 0.078, 3.48, 0.137, 2.92, 0.115, 4.22, 0.166, None, None, None, None),
        "23": (2.78, 0.109, 4.34, 0.171, 3.47, 0.137, 5.05, 0.199, 3.37, 0.133, 4.39, 0.173),
        "25": (2.47, 0.097, 4.24, 0.167, 3.47, 0.137, 5.05, 0.199, None, None, None, None),
    }
    by_shell_size: dict[str, Any] = {}
    k_factors: list[float] = []
    main_factors: list[float] = []
    for shell_size, (code, ld_max, ld_max_in, ld_min, ld_min_in, m_bsc, m_bsc_in) in diameters.items():
        (u, u_in, u2k, u2k_in, uu, uu_in, uu2k, uu2k_in, w1, w1_in, w2, w2_in) = widths[shell_size]
        k_factors.append(round(uu2k / uu, 4))
        if w2 is not None:
            main_factors.append(round(w2 / uu, 4))
        by_shell_size[shell_size] = {
            "shell_size_code": code,
            "L_dia_mm": {"max": ld_max, "min": ld_min},
            "L_dia_in": {"max": ld_max_in, "min": ld_min_in},
            "M_dia_bsc_mm": m_bsc,
            "M_dia_bsc_in": m_bsc_in,
            "polarity_key_width_U_mm": u,
            "polarity_key_width_U_in": u_in,
            "polarity_key_width_U2_K_mm": u2k,
            "polarity_key_width_U2_K_in": u2k_in,
            "keyway_width_UU_max_mm": uu,
            "keyway_width_UU_max_in": uu_in,
            "keyway_width_UU2_K_max_mm": uu2k,
            "keyway_width_UU2_K_max_in": uu2k_in,
            "main_keyway_W1_pin_mm": w1,
            "main_keyway_W1_pin_in": w1_in,
            "main_keyway_W2_socket_mm": w2,
            "main_keyway_W2_socket_in": w2_in,
            **source(112, "FIGURE 7 Main key/keyway polarization (series IV) - width dimensions"),
        }
    k_factor_avg = round(sum(k_factors) / len(k_factors), 3)
    main_factor_avg = round(sum(main_factors) / len(main_factors), 3)
    return {
        "series_iv": {
            "description": (
                "Real main-key/keyway diameters and key/keyway widths for series IV "
                "(figure 7). Polarization is set by the angular position of the minor keys, "
                "not by their width, so all minor polarizing keys share one nominal width per "
                "shell size; the K polarization key/keyway is wider (note 16). The main "
                "key/keyway (W1/W2) is dimensioned separately from the polarizing keys. Key "
                "and keyway widths scale with shell size (≈ proportional to shell diameter)."
            ),
            "units": "millimeters (mm) with inch equivalents (in) for reference",
            "diameters_source_page": 111,
            "widths_source_page": 112,
            "column_legend": {
                "L_dia": "polarity-key reference diameter",
                "M_dia_bsc": "main key/keyway reference diameter (BSC)",
                "U": "polarity (minor) key width; U2 (all polarizations except K) equals U",
                "U2_K": "polarity key width for K polarization only (wider, note 16)",
                "UU_max": "maximum keyway width; UU2 (except K) equals UU max",
                "UU2_K_max": "maximum keyway width for K polarization only (note 16)",
                "W1_pin": "main keyway width, pin contact (BSC); blank on drawing for shells 17/21/25",
                "W2_socket": "main keyway width, socket contact (BSC); blank on drawing for shells 17/21/25",
            },
            "derived_render_ratios": {
                "k_polarization_keyway_width_factor": k_factor_avg,
                "k_polarization_keyway_width_factor_basis": "mean of UU2(K max) / UU(max) across shell sizes 11-25",
                "k_polarization_keyway_width_factor_range": [min(k_factors), max(k_factors)],
                "main_keyway_to_minor_keyway_width_factor": main_factor_avg,
                "main_keyway_to_minor_keyway_width_factor_basis": "mean of W2(socket BSC) / UU(max) across shells that list W2 (11,13,15,19,23)",
                "main_keyway_to_minor_keyway_width_factor_range": [min(main_factors), max(main_factors)],
                "minor_keys_share_one_width": True,
                "polarization_encoded_by": "angular position (not key width)",
            },
            "by_shell_size": by_shell_size,
            "confidence": "high",
            **source(112, "FIGURE 7 Main key/keyway polarization (series IV) - width dimensions"),
        },
        "series_iii": {
            "description": (
                "Series III key/keyway width dimensions are published only as dimensioned "
                "drawings (figure 6, pp.99-107) and are not extractable as machine-readable "
                "text. Angular key positions are tabulated under definitions.polarization."
            ),
            "confidence": "not_tabulated_text_only_drawings",
            **source(103, "FIGURE 6 Main key/keyway polarization (series III)"),
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
            "key_geometry": key_geometry_definitions(),
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
                        "description": "Key/keyway polarization. Series III values are tabulated in figure 6; series IV values are tabulated in figure 7.",
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
        if doc.page_count < 113:
            raise RuntimeError(
                "dtl38999.pdf is shorter than expected; cannot source figure 6 (page 103) "
                "and figure 7 (pages 111-113)."
            )

    # Canonical data lives under data/<category>/ (see dataset_io.DATASET_CATEGORIES).
    standard_definitions = build_standard_definitions(pdf_path)
    part_number_rules = build_part_number_rules(pdf_path)
    std_path = data_path("standard_definitions.json", project_root / "data")
    rules_path = data_path("part_number_rules.json", project_root / "data")
    std_path.parent.mkdir(parents=True, exist_ok=True)
    rules_path.parent.mkdir(parents=True, exist_ok=True)
    std_path.write_text(
        json.dumps(standard_definitions, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    rules_path.write_text(
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
