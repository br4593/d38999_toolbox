"""D38999 AI Agent — runs locally via Ollama, no API key required.

Setup (one-time):
    # 1. Install Ollama: https://ollama.com/download
    # 2. Pull a model:
    #        ollama pull llama3.1          # 8B, good balance
    #        ollama pull qwen2.5           # alternative
    # 3. Install the Python package:
    #        pip install ollama
    # 4. Run this agent:
    #        python scripts/d38999_agent.py
    #        python scripts/d38999_agent.py --model qwen2.5
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Data paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_json(name: str) -> Any:
    with open(DATA_DIR / name) as f:
        return json.load(f)


# Lazy-loaded once at first use
_insert_arrangements: list[dict] | None = None
_dla_documents: list[dict] | None = None
_standard_definitions: dict | None = None


def _get_arrangements() -> list[dict]:
    global _insert_arrangements
    if _insert_arrangements is None:
        _insert_arrangements = _load_json("insert_arrangements.json")["arrangements"]
    return _insert_arrangements


def _get_documents() -> list[dict]:
    global _dla_documents
    if _dla_documents is None:
        _dla_documents = _load_json("dla_documents.json")["documents"]
    return _dla_documents


def _get_definitions() -> dict:
    global _standard_definitions
    if _standard_definitions is None:
        _standard_definitions = _load_json("standard_definitions.json")["definitions"]
    return _standard_definitions


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).parent))
from d38999_rules import convert_pin, MIL_SHELL_TYPES, CONTACT_DESCRIPTIONS, RULES


def tool_decode_part_number(part_number: str) -> dict:
    """Decode and convert a MIL-DTL-38999 part number."""
    try:
        result = convert_pin(part_number, include_unsupported=False)
        # Strip SVG/heavy fields from any nested data
        return result
    except ValueError as exc:
        return {"error": str(exc), "part_number": part_number}


def tool_lookup_insert_arrangement(arrangement_id: str) -> dict:
    """Look up an insert arrangement by id (e.g. '22-55' or '20-9').
    Returns contact count, service rating, shell size, and notes.
    """
    arrangements = _get_arrangements()
    # Normalize: strip leading zeros from arrangement number
    parts = arrangement_id.split("-")
    if len(parts) == 2:
        normalized = f"{parts[0]}-{parts[1].lstrip('0') or '0'}"
    else:
        normalized = arrangement_id

    for arr in arrangements:
        if arr["id"] == normalized or arr["id"] == arrangement_id:
            return {
                "id": arr["id"],
                "shell_size": arr.get("shell_size"),
                "shell_size_code": arr.get("shell_size_code"),
                "arrangement_number": arr.get("arrangement_number"),
                "contact_count": arr.get("contact_count"),
                "service_rating": arr.get("service_rating"),
                "contact_size_notes": arr.get("contact_size_notes"),
                "notes": arr.get("notes"),
                "confidence": arr.get("confidence"),
                "source_page": arr.get("source_page"),
            }
    return {"error": f"Arrangement '{arrangement_id}' not found.", "hint": "IDs are in format shell_size-arrangement_number, e.g. '22-55'"}


def tool_search_dla_documents(query: str) -> list[dict]:
    """Search DLA documents by slash_sheet number, series, family, or keyword.
    Returns matching document metadata (title, description, date, url).
    """
    docs = _get_documents()
    q = query.lower().strip()
    results = []
    for doc in docs:
        searchable = " ".join(str(v) for v in doc.values() if v).lower()
        if q in searchable:
            results.append({
                "title": doc.get("title"),
                "slash_sheet": doc.get("slash_sheet"),
                "series": doc.get("series"),
                "family": doc.get("family"),
                "description": doc.get("description"),
                "date": doc.get("date"),
                "contacts": doc.get("contacts"),
                "url": doc.get("url"),
            })
    return results[:10]  # cap at 10


def tool_list_manufacturers(series: str | None = None) -> list[dict]:
    """List available manufacturer conversion rules, optionally filtered by series ('III' or 'IV')."""
    results = []
    for rule in RULES:
        if series and rule.get("series", "").upper() != series.upper():
            continue
        results.append({
            "manufacturer": rule["manufacturer"],
            "product_line": rule["product_line"],
            "series": rule.get("series"),
            "confidence": rule["confidence"],
            "supported_contacts": rule.get("supported_contacts"),
        })
    return results


def tool_lookup_definition(category: str, code: str | None = None) -> dict:
    """Look up a MIL-DTL-38999 standard definition.
    Category can be: 'series', 'classes', 'contact_styles', 'shell_size_codes_series_iii_iv',
    'polarization', 'slash_sheets'.
    If code is provided, returns just that entry; otherwise returns the full category.
    """
    defs = _get_definitions()
    if category not in defs:
        return {
            "error": f"Unknown category '{category}'.",
            "available": list(defs.keys()),
        }
    category_data = defs[category]
    if code:
        if isinstance(category_data, dict) and code in category_data:
            return {category: {code: category_data[code]}}
        return {"error": f"Code '{code}' not found in '{category}'."}
    return {category: category_data}


def tool_search_arrangements(min_contacts: int | None = None, max_contacts: int | None = None,
                              contact_size: str | None = None, shell_size: str | None = None,
                              min_current_amps: float | None = None) -> list[dict]:
    """Search insert arrangements by criteria (contact count, contact size, shell size, current rating).
    When min_current_amps is specified, returns arrangements whose total current capacity meets or exceeds it.
    """
    arrangements = _get_arrangements()
    results = []
    for arr in arrangements:
        count = arr.get("contact_count", 0)
        if min_contacts is not None and count < min_contacts:
            continue
        if max_contacts is not None and count > max_contacts:
            continue
        if shell_size is not None and str(arr.get("shell_size", "")) != str(shell_size):
            continue
        if contact_size is not None:
            sizes = [n.get("size", "") for n in (arr.get("contact_size_notes") or [])]
            if contact_size not in sizes:
                continue

        # Calculate current capacity
        capacity = _calculate_current_capacity(arr)

        if min_current_amps is not None and capacity["total_amps"] < min_current_amps:
            continue

        results.append({
            "id": arr["id"],
            "shell_size": arr.get("shell_size"),
            "contact_count": arr.get("contact_count"),
            "service_rating": arr.get("service_rating"),
            "contact_size_notes": arr.get("contact_size_notes"),
            "current_capacity": capacity,
        })
    # Sort by total amps descending if filtering by current
    if min_current_amps is not None:
        results.sort(key=lambda r: r["current_capacity"]["total_amps"], reverse=True)
    # Cap results
    return results[:20]


# MIL-DTL-38999 contact current ratings (amps per contact, single contact derated)
# Source: MIL-DTL-38999 Table IV (signal contacts at sea level, 25°C ambient)
CONTACT_CURRENT_RATINGS = {
    "22D": 5.0,
    "22": 5.0,
    "20": 7.5,
    "16": 13.0,
    "12": 23.0,
    "8": 46.0,
    "4": 78.0,
    "0": 150.0,
}

# Derating factor when multiple contacts carry current simultaneously
# Per MIL-DTL-38999, Table V — worst-case multiplier for full-load
DERATING_FACTORS = {
    1: 1.0,
    2: 0.90,
    3: 0.85,
    5: 0.78,
    10: 0.70,
    20: 0.63,
    37: 0.56,
    50: 0.52,
    100: 0.45,
}


def _get_derating(n_contacts: int) -> float:
    """Interpolate derating factor for n contacts carrying current."""
    if n_contacts <= 1:
        return 1.0
    prev_n, prev_f = 1, 1.0
    for threshold, factor in sorted(DERATING_FACTORS.items()):
        if n_contacts <= threshold:
            # Linear interpolation
            if threshold == prev_n:
                return factor
            ratio = (n_contacts - prev_n) / (threshold - prev_n)
            return prev_f - ratio * (prev_f - factor)
        prev_n, prev_f = threshold, factor
    return 0.45  # beyond 100 contacts


def _calculate_current_capacity(arr: dict) -> dict:
    """Calculate total and per-contact current capacity for an arrangement."""
    notes = arr.get("contact_size_notes") or []
    total_signal_contacts = 0
    breakdown = []

    for note in notes:
        size = note.get("size", "")
        count = note.get("count", 0)
        ntype = note.get("type", "signal")

        # Only calculate for standard signal contacts
        # Strip non-numeric suffixes for matching (e.g., "22D" → "22D", "8 Twinax" → skip)
        if ntype not in ("signal",):
            breakdown.append({
                "size": size, "count": count, "type": ntype,
                "per_contact_amps": 0, "subtotal_amps": 0, "note": "non-signal, excluded from current calc"
            })
            continue

        # Match contact size to rating table
        rating = CONTACT_CURRENT_RATINGS.get(size, CONTACT_CURRENT_RATINGS.get(size.rstrip("D"), 0))
        total_signal_contacts += count
        breakdown.append({
            "size": size, "count": count, "type": ntype,
            "per_contact_amps": rating,
            "subtotal_amps": round(rating * count, 1),
        })

    # Apply derating
    derating = _get_derating(total_signal_contacts)
    total_raw = sum(b["subtotal_amps"] for b in breakdown if b.get("type") == "signal")
    total_derated = round(total_raw * derating, 1)

    return {
        "total_amps": total_derated,
        "total_amps_no_derating": total_raw,
        "derating_factor": round(derating, 3),
        "signal_contacts_used": total_signal_contacts,
        "breakdown": breakdown,
    }


# ---------------------------------------------------------------------------
# Shell size code lookup (size number → letter code for Series III/IV P/N)
# ---------------------------------------------------------------------------

SHELL_SIZE_TO_CODE = {
    "9": "A", "11": "B", "13": "C", "15": "D", "17": "E",
    "19": "F", "21": "G", "23": "H", "25": "J",
}

# Slash sheet mapping: connector type → slash sheet number
# Series III
SLASH_SHEETS = {
    "plug": {"III": "26", "IV": "46"},
    "jam_nut_receptacle": {"III": "24", "IV": "44"},
    "wall_mount_receptacle": {"III": "20", "IV": "40"},
}

# Functional requirement → minimum contact size needed
# Based on MIL-DTL-38999 signal integrity and current guidelines
FUNCTION_CONTACT_REQUIREMENTS = {
    "power": {
        "description": "Power delivery contact (V+ supply)",
        "min_size_by_amps": [
            (5, "22D"),   # up to 5A → #22D is fine
            (7.5, "20"),  # up to 7.5A → #20
            (13, "16"),   # up to 13A → #16
            (23, "12"),   # up to 23A → #12
            (46, "8"),    # up to 46A → #8
            (78, "4"),    # up to 78A → #4
            (150, "0"),   # up to 150A → #0
        ],
        "return_rule": "Equal number of return contacts at same size",
        "parallel_rule": "For >1 contact per rail: same size, same wire length, 25% margin, N-1 survival",
    },
    "power_return": {
        "description": "Power return contact (V- / GND return)",
        "min_size_by_amps": [
            (5, "22D"), (7.5, "20"), (13, "16"), (23, "12"), (46, "8"), (78, "4"), (150, "0"),
        ],
    },
    "discrete": {
        "description": "Discrete signal (on/off, low-current logic)",
        "contact_size": "22D",
        "per_contact_amps": 5.0,
    },
    "ethernet_1g": {
        "description": "1000BASE-T Gigabit Ethernet (4 bidirectional diff pairs = 8 signal + 1 drain/shield)",
        "contacts_needed": 9,
        "contact_size": "22D",
        "signals": ["BI_DA+", "BI_DA-", "BI_DB+", "BI_DB-", "BI_DC+", "BI_DC-", "BI_DD+", "BI_DD-", "SHIELD/DRAIN"],
        "note": "4 twisted pairs all bidirectional (IEEE 802.3ab). Recommend Quadrax/Twinax contacts for controlled impedance. Keep pairs adjacent. Maximum skew <50ns between pairs.",
        "warning": "Standard D38999 contacts require validated cable assembly for 1GbE signal integrity.",
    },
    "ethernet_100m": {
        "description": "100BASE-TX Fast Ethernet (2 diff pairs = 4 signal + 1 drain/shield)",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["TX+", "TX-", "RX+", "RX-", "SHIELD/DRAIN"],
        "note": "2 twisted pairs (TX pair pins 1-2, RX pair pins 3-6 per T568B). Less demanding than 1GbE.",
    },
    "uart": {
        "description": "UART (TX, RX, GND; add RTS/CTS for flow control)",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["TX", "RX", "GND"],
        "note": "TTL levels. For cable >3m, convert to RS-422/RS-485 differential.",
    },
    "i2c": {
        "description": "I2C bus (SDA, SCL, GND, optional VCC)",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["SDA", "SCL", "GND"],
        "note": "Max bus capacitance 400pF. NOT suitable for cable runs >1m. Consider RS-485/CAN for inter-box comm.",
        "warning": "I2C through connectors is generally discouraged for production harnesses >1m.",
    },
    "spi": {
        "description": "SPI bus (SCLK, MOSI, MISO, CS, GND per slave)",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["SCLK", "MOSI", "MISO", "CS", "GND"],
        "note": "Board-level interface only. Limit speed to <1MHz if cable >0.5m. Prefer RS-485/CAN for inter-box.",
        "warning": "SPI is generally inappropriate for connector/cable applications.",
    },
    "rs485": {
        "description": "RS-485 half-duplex (A/D-, B/D+, GND, optional SHIELD)",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["A(D-)", "B(D+)", "GND"],
        "note": "120Ω termination at each bus end. Keep A/B as twisted pair, adjacent in connector. Bus topology only.",
    },
    "rs485_full": {
        "description": "RS-485 full-duplex (TX+, TX-, RX+, RX-, GND)",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["TX+", "TX-", "RX+", "RX-", "GND"],
        "note": "Full duplex with separate TX and RX pairs. Keep each pair adjacent.",
    },
    "rs422": {
        "description": "RS-422 (TX+, TX-, RX+, RX-, GND)",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["TX+(Y)", "TX-(Z)", "RX+(A)", "RX-(B)", "GND"],
        "note": "Point-to-point, full duplex. 120Ω termination at receiver end. Up to 1200m at 100kbps.",
    },
    "rs232": {
        "description": "RS-232 minimum (TXD, RXD, GND)",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["TXD", "RXD", "GND"],
        "note": "Single-ended, ground-referenced. Max 15m at 19200 baud. For noise/distance, prefer RS-422.",
    },
    "rs232_full": {
        "description": "RS-232 full (TXD, RXD, RTS, CTS, DTR, DSR, DCD, GND)",
        "contacts_needed": 8,
        "contact_size": "22D",
        "signals": ["TXD", "RXD", "RTS", "CTS", "DTR", "DSR", "DCD", "GND"],
    },
    "can_bus": {
        "description": "CAN bus (CAN_H, CAN_L, GND, optional SHIELD)",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["CAN_H", "CAN_L", "GND"],
        "note": "120Ω termination at each physical bus end. CAN_H/CAN_L MUST be adjacent twisted pair. Bus topology only.",
    },
    "coax": {
        "description": "Coaxial contact (RF signal)",
        "contacts_needed": 1,
        "contact_size": "12 Coax",
        "type": "coax",
    },
    "twinax": {
        "description": "Twinaxial contact (differential RF / controlled impedance)",
        "contacts_needed": 1,
        "contact_size": "8 Twinax",
        "type": "twinax",
    },
    # --- High-speed digital interfaces ---
    "usb2": {
        "description": "USB 2.0 (D+, D-, VBUS, GND, SHIELD). 480 Mbps max. 90Ω diff impedance.",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["USB2_D+", "USB2_D-", "USB2_VBUS", "USB2_GND", "USB2_SHIELD"],
        "note": "D+/D- MUST be adjacent (twisted pair). For High Speed (480Mbps), Twinax contact recommended. Max cable 5m. ESD protection at board level.",
        "warning": "Standard contacts may work for Full Speed (12Mbps) only. High Speed needs validated assembly.",
    },
    "usb3": {
        "description": "USB 3.x SuperSpeed (USB2 + SSTX+/-, SSRX+/-, extra GND). 5-10 Gbps. 90Ω diff.",
        "contacts_needed": 10,
        "contact_size": "22D",
        "signals": ["USB2_D+", "USB2_D-", "SSTX+", "SSTX-", "SSRX+", "SSRX-", "VBUS", "GND", "GND_DRAIN", "SHIELD"],
        "note": "SuperSpeed TX and RX pairs REQUIRE Twinax/Quadrax contacts. Generic signal contacts are NOT suitable for 5+ Gbps. Max cable ~3m.",
        "warning": "Do NOT use standard D38999 signal contacts for USB 3.x SuperSpeed pairs. Signal integrity validation mandatory.",
    },
    "usb_c_usb2": {
        "description": "USB Type-C carrying USB 2.0 only (VBUS, GND, D+, D-, CC1, CC2, SHIELD)",
        "contacts_needed": 7,
        "contact_size": "22D",
        "signals": ["VBUS", "GND", "D+", "D-", "CC1", "CC2", "SHIELD"],
        "note": "CC pins need 5.1kΩ pull-down (sink) or Rp (source). Standard contacts OK for USB 2.0 data. Fixed orientation (not reversible).",
        "warning": "USB-C requires CC resistors or controller at each end. Cannot just pass through without electronics.",
    },
    "hdmi": {
        "description": "HDMI (4x TMDS diff pairs + DDC + CEC + HPD + 5V). 100Ω diff impedance.",
        "contacts_needed": 14,
        "contact_size": "22D",
        "signals": ["TMDS_D2+", "TMDS_D2-", "TMDS_D1+", "TMDS_D1-", "TMDS_D0+", "TMDS_D0-", "TMDS_CLK+", "TMDS_CLK-", "DDC_SDA", "DDC_SCL", "CEC", "HPD", "+5V", "GND"],
        "note": "4 TMDS pairs need Twinax/Quadrax contacts (100Ω). DDC/CEC/HPD use normal contacts. Max ~13m certified.",
        "warning": "Generic D38999 signal contacts NOT suitable for TMDS. HDMI 2.1 FRL is extremely demanding — avoid. SI validation mandatory.",
    },
    "displayport": {
        "description": "DisplayPort (4x main link lanes + AUX pair + HPD + DP_PWR). 100Ω diff.",
        "contacts_needed": 14,
        "contact_size": "22D",
        "signals": ["LANE0+", "LANE0-", "LANE1+", "LANE1-", "LANE2+", "LANE2-", "LANE3+", "LANE3-", "AUX+", "AUX-", "HPD", "DP_PWR", "GND", "SHIELD"],
        "note": "4 main link pairs need Twinax contacts (100Ω). AUX is lower speed diff pair. For 2-lane DP, reduce to 2 Twinax.",
        "warning": "Generic signal contacts NOT suitable for DP main link lanes. DP 2.0 UHBR should not use D38999.",
    },
    "dvi_d_single": {
        "description": "DVI-D Single-Link (4x TMDS pairs + DDC + HPD + 5V). Same as HDMI digital.",
        "contacts_needed": 13,
        "contact_size": "22D",
        "signals": ["TMDS_D2+", "TMDS_D2-", "TMDS_D1+", "TMDS_D1-", "TMDS_D0+", "TMDS_D0-", "TMDS_CLK+", "TMDS_CLK-", "DDC_SDA", "DDC_SCL", "HPD", "+5V", "GND"],
        "note": "Electrically same as HDMI 1.x TMDS. 4 pairs need Twinax contacts (100Ω). DDC/HPD use normal contacts.",
        "warning": "Generic signal contacts NOT suitable for TMDS pairs. SI validation required.",
    },
    "vga": {
        "description": "VGA analog RGB (R, G, B coax + H/V sync + DDC + 5V). 75Ω coaxial per color.",
        "contacts_needed": 10,
        "contact_size": "22D",
        "signals": ["VGA_R", "VGA_R_RTN", "VGA_G", "VGA_G_RTN", "VGA_B", "VGA_B_RTN", "HSYNC", "VSYNC", "DDC_SDA", "DDC_SCL"],
        "note": "RGB lines need coax contacts (75Ω, 0.7Vpp) with individual returns. Sync/DDC use normal contacts. Each color MUST have own return.",
        "warning": "Without coax contacts, expect ghosting/blur at resolutions above 800x600.",
    },
    "dpi_rgb888": {
        "description": "DPI/Parallel RGB 24-bit (24 data + PCLK + HSYNC + VSYNC + DE + grounds). Board-level only.",
        "contacts_needed": 37,
        "contact_size": "22D",
        "signals": ["R0-R7", "G0-G7", "B0-B7", "PCLK", "HSYNC", "VSYNC", "DE", "GND(x8)", "VCC"],
        "note": "DPI is NOT designed for cable runs. Serialize to LVDS/eDP/HDMI before connector. If forced: <30cm, <25MHz PCLK, shielded cable, aggressive ground interleaving.",
        "warning": "STRONGLY recommend converting to HDMI or LVDS before crossing D38999. DPI through a cable causes timing violations and EMC failures.",
    },
    # --- Avionics & Military Protocols ---
    "mil_std_1553": {
        "description": "MIL-STD-1553 single bus (BUS_A+, BUS_A-, SHIELD). 1 Mbps, 78Ω twinax, Manchester encoded.",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["BUS_A+", "BUS_A-", "SHIELD"],
        "note": "BUS_A+ and BUS_A- MUST be adjacent twisted pair. 78Ω termination only at physical bus cable ends — NOT at stub connectors. Use transformer-coupled stubs (max 20ft/6.1m). 360° shielded backshell required.",
        "warning": "Do NOT place termination resistors at stub connectors. Star topology is NOT allowed. Dual-redundant systems need a second bus (use mil_std_1553_dual function).",
    },
    "mil_std_1553_dual": {
        "description": "MIL-STD-1553 dual-redundant (Bus A + Bus B, SHIELD each). Standard dual-redundant avionics bus.",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["BUS_A+", "BUS_A-", "BUS_B+", "BUS_B-", "SHIELD"],
        "note": "Two completely independent twinax pairs. BUS_A+ adjacent to BUS_A-; BUS_B+ adjacent to BUS_B-. Each pair in adjacent cavities. Dual shield or separate drain per bus recommended.",
        "warning": "Bus A and Bus B must be electrically isolated — no shared grounds, shields, or routing. Shield drain bonded to chassis separately.",
    },
    "arinc_429_rx": {
        "description": "ARINC 429 receive bus only (DATA_A, DATA_B, SHIELD). 12.5 or 100 kbps, 78Ω, unidirectional.",
        "contacts_needed": 3,
        "contact_size": "22D",
        "signals": ["DATA_A", "DATA_B", "SHIELD"],
        "note": "DATA_A and DATA_B MUST be adjacent (twisted pair). 78Ω shielded pair. Shield grounded at transmitter end only. Up to 20 receivers per transmitter. BPRZ differential ±10V.",
        "warning": "Each ARINC 429 bus is unidirectional (1 TX, up to 20 RX). For bidirectional communication, use separate TX and RX buses (use arinc_429_bidir function).",
    },
    "arinc_429_bidir": {
        "description": "ARINC 429 bidirectional (separate TX and RX bus pairs + shields). Full LRU-to-LRU communication.",
        "contacts_needed": 6,
        "contact_size": "22D",
        "signals": ["TX_DATA_A", "TX_DATA_B", "TX_SHIELD", "RX_DATA_A", "RX_DATA_B", "RX_SHIELD"],
        "note": "TX pair and RX pair both in adjacent cavities. TX and RX are independent buses — separate shielding, separate cable. Shield grounded at transmitter end of each bus.",
    },
    "afdx": {
        "description": "AFDX / ARINC 664 Part 7 single network (TX+, TX-, RX+, RX-, SHIELD). 100 Mbps, 100Ω.",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["TX+", "TX-", "RX+", "RX-", "SHIELD"],
        "note": "Same physical layer as 100BASE-TX. TX pair and RX pair each in adjacent cavities. Cat 5e STP cable. 360° shielded backshell. AFDX determinism enforced at switch level, not connector.",
        "warning": "AFDX uses dual-redundant networks. For both Network A and Network B, use afdx_dual function or use two separate connectors.",
    },
    "afdx_dual": {
        "description": "AFDX dual-redundant (Network A + Network B, each with TX+/-, RX+/-, shield). 100 Mbps.",
        "contacts_needed": 10,
        "contact_size": "22D",
        "signals": ["NET_A_TX+", "NET_A_TX-", "NET_A_RX+", "NET_A_RX-", "NET_A_SHIELD",
                    "NET_B_TX+", "NET_B_TX-", "NET_B_RX+", "NET_B_RX-", "NET_B_SHIELD"],
        "note": "Network A and Network B must be fully independent. Keep cavity groups separated — use ground contacts as buffer. Consider two separate connectors if insert space is tight.",
    },
    "spacewire": {
        "description": "SpaceWire (ECSS-E-ST-50-12C): 4 diff pairs + GND. DIN+/-, DOUT+/-, SIN+/-, SOUT+/-. LVDS-based.",
        "contacts_needed": 9,
        "contact_size": "22D",
        "signals": ["DIN+", "DIN-", "DOUT+", "DOUT-", "SIN+", "SIN-", "SOUT+", "SOUT-", "GND"],
        "note": "Four LVDS pairs (DIN, DOUT, SIN, SOUT), each pair in adjacent cavities. GND connected at PCB only (not in harness). 100Ω diff impedance. Individually shielded twisted pairs per ECSS-E-ST-50-12C. Data-strobe encoding.",
        "warning": "GND (Micro-D pin 3) is a PCB-local ground — do NOT connect it through the harness. All 4 pairs must have adjacent cavity assignments.",
    },
    "lvds_pair": {
        "description": "Single LVDS differential pair (LVDS+, LVDS-). 100–120Ω, 3.5mA, 350mV swing, 655Mbps+.",
        "contacts_needed": 2,
        "contact_size": "22D",
        "signals": ["LVDS+", "LVDS-"],
        "note": "LVDS+ and LVDS- MUST be adjacent (twisted pair). 100Ω termination at receiver inside equipment. Standard signal contacts may work for lower speeds; twinax recommended for >400 Mbps.",
    },
    "lvds_fpd_link": {
        "description": "FPD-Link LVDS 18-bit (3 data pairs + 1 clock pair, all 100Ω LVDS). Video interface.",
        "contacts_needed": 8,
        "contact_size": "22D",
        "signals": ["D0+", "D0-", "D1+", "D1-", "D2+", "D2-", "CLK+", "CLK-"],
        "note": "Each of the 4 pairs MUST be adjacent in connector. Twinax contacts strongly recommended. 100Ω termination at display side. Keep all 4 pairs as tightly grouped as insert allows.",
        "warning": "Generic signal contacts not recommended for >200 Mbps LVDS. SI validation required.",
    },
    "eth_10gbase_t": {
        "description": "10GBASE-T Ethernet over copper (4 bidirectional pairs, all 100Ω). 10 Gbps, Cat 6A cable.",
        "contacts_needed": 9,
        "contact_size": "22D",
        "signals": ["BI_DA+", "BI_DA-", "BI_DB+", "BI_DB-", "BI_DC+", "BI_DC-", "BI_DD+", "BI_DD-", "SHIELD"],
        "note": "All 4 pairs bidirectional at 400 MHz bandwidth. Quadrax or Twinax contacts REQUIRED — standard signal contacts will not pass signal integrity at 10 Gbps. All pairs must be adjacent. Cat 6A cable required.",
        "warning": "This is an EXTREMELY demanding interface. Standard D38999 contacts are NOT adequate. Requires validated high-speed contact inserts, qualified connectors, and full SI verification. Consider fiber optic alternative.",
    },
    "poe_type1": {
        "description": "PoE Type 1 (802.3af): data + 350mA power on 2 Ethernet pairs. Up to 15.4W PSE.",
        "contacts_needed": 5,
        "contact_size": "22D",
        "signals": ["TX+", "TX-", "RX+", "RX-", "SHIELD"],
        "note": "Same as 100BASE-TX contacts, 350mA per pair for power (common mode). #22D (5A rated) adequate for 350mA data+power. Pair adjacency required. Shielded cable.",
    },
    "poe_type3_4": {
        "description": "PoE Type 3/4 (802.3bt): 4-pair power, 960mA per pair. Up to 60–90W PSE. 10 contacts.",
        "contacts_needed": 9,
        "contact_size": "22D",
        "signals": ["BI_DA+", "BI_DA-", "BI_DB+", "BI_DB-", "BI_DC+", "BI_DC-", "BI_DD+", "BI_DD-", "SHIELD"],
        "note": "All 4 pairs carry both Ethernet data AND power simultaneously. 960mA per pair at 48–57V. Verify thermal performance in harness — 4-pair PoE raises cable temperature significantly. #22D contacts adequate thermally but verify derating for bundled harness.",
        "warning": "Voltages up to 57V DC — hazardous voltage per IEC 62368-1. All 4 pairs must be adjacent. Temperature derating for bundled cables per IEEE 802.3bt Table 145-1.",
    },
}


def _size_for_power_amps(amps: float) -> str:
    """Return the smallest contact size that can carry the given amps (underated baseline)."""
    for threshold, size in FUNCTION_CONTACT_REQUIREMENTS["power"]["min_size_by_amps"]:
        if amps <= threshold:
            return size
    return "0"


# Contact sizes available in standard insert arrangements (largest to smallest current capacity).
# Derived from data/insert_arrangements.json — only these sizes exist as standard contacts.
_DB_POWER_SIZES = ["12", "16", "20", "22D"]


def _best_power_contacts(rail_amps: float, n_other_approx: int = 10) -> dict:
    """Determine the optimal contact size and parallel count for a given rail current.

    Applies MIL-DTL-38999 Table V derating and enforces:
      - 25% safety margin above required current
      - N-1 survival for rails > 13A (high-power rails only)

    Starts from the minimum adequate contact size (matching MIL-DTL-38999 Table IV
    underated ratings) and steps up to larger contacts only if more than 6 contacts
    would be needed. Only considers sizes available in the standard insert database:
    #12 (23A), #16 (13A), #20 (7.5A), #22D (5A).

    Args:
        rail_amps: Total current the rail must carry (A).
        n_other_approx: Approximate number of other energized contacts (for derating).

    Returns dict with keys: size, contacts_per_rail, rated_per_contact,
        derated_per_contact, total_capacity, n1_capacity, margin_pct.
        On failure adds an 'error' key.
    """
    if rail_amps <= 0:
        return {
            "size": "22D",
            "contacts_per_rail": 1,
            "rated_per_contact": CONTACT_CURRENT_RATINGS["22D"],
            "derated_per_contact": CONTACT_CURRENT_RATINGS["22D"],
            "total_capacity": CONTACT_CURRENT_RATINGS["22D"],
            "n1_capacity": 0.0,
            "margin_pct": 100.0,
        }

    # Minimum contact size based on MIL-DTL-38999 Table IV (underated)
    min_size = _size_for_power_amps(rail_amps)
    # _DB_POWER_SIZES = ["12", "16", "20", "22D"] (index 0 = largest current capacity)
    if min_size not in _DB_POWER_SIZES:
        min_size = _DB_POWER_SIZES[0]  # fallback to largest available
    min_idx = _DB_POWER_SIZES.index(min_size)

    # Try sizes from minimum adequate → progressively larger (fewer contacts)
    # e.g., for 5A: try ["22D", "20", "16", "12"]
    sizes_to_try = _DB_POWER_SIZES[min_idx::-1]

    best = None
    for size in sizes_to_try:
        rated_a = CONTACT_CURRENT_RATINGS.get(size, 0)
        if rated_a == 0:
            continue
        apply_n1 = rail_amps > 13.0  # N-1 survival only for high-current rails
        for n in range(1, 50):
            total_energized = n_other_approx + n
            derate = _get_derating(total_energized)
            derated_per = rated_a * derate
            total_cap = derated_per * n
            n1_cap = derated_per * (n - 1) if n > 1 else 0.0
            # Accept if: margin ≥ 25% AND N-1 passes (for high-power rails, must
            # have ≥ 2 contacts so that N-1 contacts still carry the full load)
            if total_cap >= rail_amps * 1.25:
                if apply_n1:
                    n1_ok = (n >= 2) and (n1_cap >= rail_amps)
                else:
                    n1_ok = True  # single contact acceptable for low-power rails
                if n1_ok:
                    candidate = {
                        "size": size,
                        "contacts_per_rail": n,
                        "rated_per_contact": rated_a,
                        "derated_per_contact": round(derated_per, 2),
                        "total_capacity": round(total_cap, 2),
                        "n1_capacity": round(n1_cap, 2),
                        "margin_pct": round((total_cap / rail_amps - 1) * 100, 1),
                    }
                    # Accept minimum-size solution; step to larger contact only if
                    # more than 6 contacts would be needed (prefer fewer contacts)
                    if best is None or n < best["contacts_per_rail"] - 1:
                        best = candidate
                    break  # found minimum contacts for this size; try next size

    if best:
        return best

    # Fallback: extremely high current — report error
    size = _DB_POWER_SIZES[0]  # "#12"
    rated_a = CONTACT_CURRENT_RATINGS.get(size, 23.0)
    derated = rated_a * _get_derating(n_other_approx + 20)
    needed = int(rail_amps / derated) + 1
    return {
        "size": size,
        "contacts_per_rail": needed,
        "rated_per_contact": rated_a,
        "derated_per_contact": round(derated, 2),
        "total_capacity": round(derated * needed, 2),
        "n1_capacity": round(derated * (needed - 1), 2),
        "margin_pct": 0.0,
        "error": (
            f"Cannot carry {rail_amps:.1f}A within standard D38999 insert contacts. "
            f"Minimum ~{needed}x #{size} contacts required; consider multiple connectors."
        ),
    }


def _calc_power_for_size(rail_amps: float, size: str, n_other_approx: int = 10) -> dict | None:
    """Calculate contacts needed to carry rail_amps using a SPECIFIC forced contact size.

    Used by the insert-matching loop to try alternative (smaller) gauges when the
    preferred gauge is not present in the candidate insert.

    Applies Table V derating and N-1 survival (for rails >13A).
    Returns None if even 20 parallel contacts of `size` cannot carry `rail_amps`.

    Returns dict with keys: size, contacts_per_rail, derated_per_contact,
        total_capacity, n1_capacity.
    """
    rated_a = CONTACT_CURRENT_RATINGS.get(size, 0)
    if rated_a == 0:
        return None
    apply_n1 = rail_amps > 13.0
    for n in range(1, 21):  # practical limit: 20 parallel contacts per rail
        total_energized = n_other_approx + n
        derate = _get_derating(total_energized)
        derated_per = rated_a * derate
        total_cap = derated_per * n
        n1_cap = derated_per * (n - 1) if n > 1 else 0.0
        if total_cap >= rail_amps * 1.25:
            if apply_n1:
                n1_ok = (n >= 2) and (n1_cap >= rail_amps)
            else:
                n1_ok = True
            if n1_ok:
                return {
                    "size": size,
                    "contacts_per_rail": n,
                    "rated_per_contact": rated_a,
                    "derated_per_contact": round(derated_per, 2),
                    "total_capacity": round(total_cap, 2),
                    "n1_capacity": round(n1_cap, 2),
                }
    return None  # cannot carry rail_amps even with 20 contacts of this size


def tool_suggest_connector(requirements: list[dict], connector_type: str = "plug",
                            series: str = "III", shell_finish: str = "W",
                            keying: str = "N", spare_pct: int = 15) -> dict:
    """Given functional requirements, find matching insert arrangements and generate valid D38999 part numbers.

    Each requirement is: {"function": "power|power_return|discrete|ethernet_1g|ethernet_100m|uart|i2c|spi|rs485|rs485_full|rs422|rs232|rs232_full|can_bus|coax|twinax",
                          "count": N, "amps": A (for power/power_return only)}

    Automatically:
    - Adds matching power_return contacts for every power requirement (balanced V+/RTN)
    - Applies derating to power contacts
    - Adds spare contacts (default 15%)
    - Generates pin assignment table
    - Warns about signal integrity issues
    """
    # Calculate minimum contacts needed per size
    needed_by_size: dict[str, int] = {}  # size → count (preferred design, for display)
    explanations = []
    pin_assignments = []  # detailed pin assignment plan
    warnings = []

    # Track power contacts to auto-add returns
    power_contacts_added = []  # [(size, count, amps)]
    has_explicit_return = any(r.get("function") == "power_return" for r in requirements)

    # power_batches: tracks each power batch so the matching loop can re-split to
    # smaller gauges when the preferred gauge is absent in the candidate insert.
    # Each entry: {preferred_size, rail_amps, n_dir_rails}
    #   n_dir_rails = n_rails × 2 (supply direction + return direction)
    power_batches: list[dict] = []

    for req in requirements:
        func = req.get("function", "discrete")
        count = req.get("count", 1)
        amps = req.get("amps", 0)

        if func == "power":
            # count = number of independent power rails; amps = total current per rail.
            # Calculate contacts needed with derating + N-1 survival using available DB sizes.
            n_other_approx = sum(needed_by_size.values())
            power_info = _best_power_contacts(amps, n_other_approx)
            size = power_info["size"]
            n_per_rail = power_info["contacts_per_rail"]
            total_power_contacts = n_per_rail * count
            needed_by_size[size] = needed_by_size.get(size, 0) + total_power_contacts
            power_contacts_added.append((size, total_power_contacts, amps, count, n_per_rail))
            if n_per_rail == 1:
                explanations.append(
                    f"{count}x power V+ rail @ {amps}A → {total_power_contacts}x #{size} contact"
                    f" ({power_info['derated_per_contact']:.1f}A derated, "
                    f"{power_info['margin_pct']:.0f}% margin)"
                )
            else:
                explanations.append(
                    f"{count}x power V+ rail @ {amps}A → {n_per_rail}x #{size} parallel per rail"
                    f" = {total_power_contacts}x #{size} total"
                    f" ({power_info['derated_per_contact']:.1f}A each derated,"
                    f" N-1 capacity: {power_info['n1_capacity']:.1f}A)"
                )
            for rail in range(count):
                rail_label = f" rail #{rail+1}" if count > 1 else ""
                for i in range(n_per_rail):
                    pin_label = f" p{i+1}" if n_per_rail > 1 else ""
                    pin_assignments.append({
                        "signal": f"V+{rail_label}{pin_label}",
                        "function": "power",
                        "contact_size": size,
                        "wire_color": "RED",
                        "notes": (
                            f"#{size} contact rated {power_info['rated_per_contact']}A, "
                            f"{power_info['derated_per_contact']:.1f}A derated. "
                            + (f"{n_per_rail}x parallel per rail for {amps}A; N-1: {power_info['n1_capacity']:.1f}A."
                               if n_per_rail > 1 else f"Carries {amps}A rail with margin.")
                        ),
                    })
            if power_info.get("error"):
                warnings.append(f"Power: {power_info['error']}")
            if n_per_rail > 1:
                warnings.append(
                    f"Power {amps}A: {n_per_rail}x #{size} contacts wired in parallel per rail. "
                    f"N-1 survival capacity: {power_info['n1_capacity']:.1f}A. "
                    f"All parallel contacts must be bonded to the same node."
                )
            # Record batch so matching can re-split to smaller gauges if needed.
            # n_dir_rails starts at count (supply only); return doubles it below.
            power_batches.append({
                "preferred_size": size,
                "rail_amps": amps,
                "n_dir_rails": count,  # supply direction only for now
                "preferred_n_per_rail": n_per_rail,
            })
        elif func == "power_return":
            # Explicit return specified by user.
            n_other_approx = sum(needed_by_size.values())
            power_info = _best_power_contacts(amps, n_other_approx)
            size = power_info["size"]
            n_per_rail = power_info["contacts_per_rail"]
            total_rtn_contacts = n_per_rail * count
            needed_by_size[size] = needed_by_size.get(size, 0) + total_rtn_contacts
            explanations.append(
                f"{count}x power RTN @ {amps}A → {n_per_rail}x #{size} per rail"
                f" = {total_rtn_contacts}x #{size} total"
            )
            for rail in range(count):
                rail_label = f" rail #{rail+1}" if count > 1 else ""
                for i in range(n_per_rail):
                    pin_label = f" p{i+1}" if n_per_rail > 1 else ""
                    pin_assignments.append({
                        "signal": f"V-/RTN{rail_label}{pin_label}",
                        "function": "power_return",
                        "contact_size": size,
                        "wire_color": "BLACK",
                        "notes": f"Return for V+ supply; #{size} contact, {power_info['derated_per_contact']:.1f}A derated.",
                    })
        elif func in FUNCTION_CONTACT_REQUIREMENTS:
            spec = FUNCTION_CONTACT_REQUIREMENTS[func]
            size = spec.get("contact_size", "22D")
            contacts_per = spec.get("contacts_needed", 1)
            total_contacts = contacts_per * count
            needed_by_size[size] = needed_by_size.get(size, 0) + total_contacts
            explanations.append(f"{count}x {func} → {total_contacts}x #{size} contacts")
            # Add pin assignments for each instance
            signals = spec.get("signals", [func.upper()])
            for instance in range(count):
                suffix = f" #{instance+1}" if count > 1 else ""
                for sig in signals:
                    pin_assignments.append({
                        "signal": f"{sig}{suffix}",
                        "function": func,
                        "contact_size": size,
                        "wire_color": "",
                        "notes": spec.get("note", ""),
                    })
            # Add warnings
            if spec.get("warning"):
                warnings.append(f"{func}: {spec['warning']}")
        else:
            needed_by_size["22D"] = needed_by_size.get("22D", 0) + count
            explanations.append(f"{count}x {func} → {count}x #22D contacts (assumed discrete)")
            for i in range(count):
                pin_assignments.append({
                    "signal": f"{func} #{i+1}",
                    "function": "discrete",
                    "contact_size": "22D",
                    "wire_color": "",
                    "notes": "Assumed discrete signal",
                })

    # Auto-add balanced power returns if not explicitly provided
    # power_contacts_added tuples: (size, total_contacts, amps, n_rails, n_per_rail)
    if power_contacts_added and not has_explicit_return:
        for size, total_contacts, amps, n_rails, n_per_rail in power_contacts_added:
            needed_by_size[size] = needed_by_size.get(size, 0) + total_contacts
            explanations.append(
                f"{n_rails}x power RTN (auto-balanced) → {n_per_rail}x #{size} per rail"
                f" = {total_contacts}x #{size} total"
            )
            for rail in range(n_rails):
                rail_label = f" rail #{rail+1}" if n_rails > 1 else ""
                for i in range(n_per_rail):
                    pin_label = f" p{i+1}" if n_per_rail > 1 else ""
                    pin_assignments.append({
                        "signal": f"V-/RTN{rail_label}{pin_label}",
                        "function": "power_return",
                        "contact_size": size,
                        "wire_color": "BLACK",
                        "notes": "Auto-added for balanced supply/return. Same gauge as V+.",
                    })
        warnings.append(
            "Power return contacts auto-added to balance supply. "
            "Equal V+ and RTN parallel contacts per rail."
        )
        # Double n_dir_rails in each power batch to account for return direction
        for batch in power_batches:
            batch["n_dir_rails"] *= 2

    total_contacts_needed = sum(needed_by_size.values())

    # Compute desired spare count as guidance; do NOT add to needed_by_size
    # (spares = unused cavities in the selected insert, not a hard matching constraint)
    spare_target = max(2, int(total_contacts_needed * spare_pct / 100))
    explanations.append(
        f"Target ≥{spare_target} spare contacts ({spare_pct}%) — filled by unused insert cavities"
    )

    total_with_spares = total_contacts_needed  # matching constraint ignores spare target

    # Search for arrangements that have at least the required contacts of each size
    arrangements = _get_arrangements()

    # Build a lookup: preferred_size → consolidated batch info for power re-splitting.
    # Merge batches with the same preferred_size (conservative: use max rail_amps).
    _power_batch_by_size: dict[str, dict] = {}
    for batch in power_batches:
        ps = batch["preferred_size"]
        if ps not in _power_batch_by_size:
            _power_batch_by_size[ps] = {
                "rail_amps": batch["rail_amps"],
                "n_dir_rails": batch["n_dir_rails"],
            }
        else:
            # Multiple batches at same preferred size: use max amps (conservative)
            _power_batch_by_size[ps]["rail_amps"] = max(
                _power_batch_by_size[ps]["rail_amps"], batch["rail_amps"]
            )
            _power_batch_by_size[ps]["n_dir_rails"] += batch["n_dir_rails"]

    candidates = []

    for arr in arrangements:
        notes = arr.get("contact_size_notes") or []
        # Build size → available count map
        available: dict[str, int] = {}
        for note in notes:
            size = note.get("size", "")
            ncount = note.get("count", 0)
            available[size] = available.get(size, 0) + ncount

        # Check if arrangement satisfies all requirements.
        # A larger contact CAN substitute for a smaller one (larger cavity can accept
        # the bigger contact wired to a low-current signal — physically valid in D38999).
        # For POWER contacts: also try splitting to smaller gauge with more contacts.
        size_order = ["22D", "22", "20", "16", "12", "8", "4", "0"]
        satisfied = True
        usage_notes = []
        used_by_size: dict[str, int] = {}  # track actual contact allocation per size
        power_splits_applied: list[dict] = []  # record any gauge re-splits

        for req_size, req_count in needed_by_size.items():
            # --- Exact size match ---
            already_used = used_by_size.get(req_size, 0)
            avail = available.get(req_size, 0) - already_used
            if avail >= req_count:
                used_by_size[req_size] = already_used + req_count
                usage_notes.append(f"Use {req_count}/{available.get(req_size,0)} #{req_size} contacts")
                continue

            # --- Upsize: use a physically larger contact (same cavity count) ---
            req_idx = size_order.index(req_size) if req_size in size_order else -1
            found_substitute = False
            if req_idx >= 0:
                for bigger_size in size_order[req_idx + 1:]:
                    bigger_already = used_by_size.get(bigger_size, 0)
                    bigger_avail = available.get(bigger_size, 0) - bigger_already
                    if bigger_avail >= req_count:
                        used_by_size[bigger_size] = bigger_already + req_count
                        usage_notes.append(
                            f"Use {req_count}/{available.get(bigger_size,0)} #{bigger_size} contacts"
                            f" (upsized from #{req_size})"
                        )
                        found_substitute = True
                        break

            if found_substitute:
                continue

            # --- Power split: try smaller gauges with more parallel contacts ---
            # Only applies to contacts that are part of a power requirement.
            if req_size in _power_batch_by_size:
                pinfo = _power_batch_by_size[req_size]
                rail_amps = pinfo["rail_amps"]
                n_dir_rails = pinfo["n_dir_rails"]
                n_other_est = sum(used_by_size.values())  # contacts allocated so far

                # Try each smaller gauge (less current per contact → more contacts)
                for alt_size in _DB_POWER_SIZES:
                    if alt_size == req_size:
                        continue  # already tried preferred size
                    alt_calc = _calc_power_for_size(rail_amps, alt_size, n_other_est)
                    if alt_calc is None:
                        continue  # this gauge can't carry the current even with 20 contacts
                    alt_total = alt_calc["contacts_per_rail"] * n_dir_rails
                    alt_already = used_by_size.get(alt_size, 0)
                    alt_avail = available.get(alt_size, 0) - alt_already
                    if alt_avail >= alt_total:
                        # Power split accepted: record and allocate
                        used_by_size[alt_size] = alt_already + alt_total
                        split_note = (
                            f"POWER SPLIT: {alt_total}x #{alt_size} contacts"
                            f" (preferred {req_count}x #{req_size} — not available in insert);"
                            f" {alt_calc['contacts_per_rail']}x #{alt_size}/rail,"
                            f" {alt_calc['derated_per_contact']:.1f}A derated each,"
                            f" N-1: {alt_calc['n1_capacity']:.1f}A"
                        )
                        usage_notes.append(split_note)
                        power_splits_applied.append({
                            "original_size": req_size,
                            "original_count": req_count,
                            "split_size": alt_size,
                            "split_count": alt_total,
                            "contacts_per_rail": alt_calc["contacts_per_rail"],
                            "n_dir_rails": n_dir_rails,
                            "derated_per_contact": alt_calc["derated_per_contact"],
                            "n1_capacity": alt_calc["n1_capacity"],
                            "rail_amps": rail_amps,
                        })
                        found_substitute = True
                        break

            if not found_substitute:
                satisfied = False
                break

        if not satisfied:
            continue

        # Calculate actual spare capacity per size
        spare_by_size = {
            sz: available[sz] - used_by_size.get(sz, 0)
            for sz in available
            if available[sz] - used_by_size.get(sz, 0) > 0
        }
        total_spare = sum(spare_by_size.values())

        # Generate part numbers
        shell_size = str(arr.get("shell_size", ""))
        shell_code = SHELL_SIZE_TO_CODE.get(shell_size, "?")
        arrangement_num = str(arr.get("arrangement_number", ""))
        slash = SLASH_SHEETS.get(connector_type, {}).get(series, "26")

        pn_pin = f"D38999/{slash}{shell_finish}{shell_code}{arrangement_num}PN"
        pn_socket = f"D38999/{slash}{shell_finish}{shell_code}{arrangement_num}SN"

        capacity = _calculate_current_capacity(arr)

        candidates.append({
            "arrangement_id": arr["id"],
            "shell_size": shell_size,
            "contact_count": arr.get("contact_count"),
            "part_number_pin": pn_pin,
            "part_number_socket": pn_socket,
            "keying": keying,
            "usage": usage_notes,
            "power_splits_applied": power_splits_applied,
            "spare_contacts": total_spare,
            "spare_by_size": {f"#{k}": v for k, v in spare_by_size.items()},
            "spare_target": spare_target,
            "meets_spare_target": total_spare >= spare_target,
            "current_capacity": {
                "total_amps_derated": capacity["total_amps"],
                "derating_factor": capacity["derating_factor"],
                "energized_contacts": capacity["signal_contacts_used"],
            },
            "contact_breakdown": arr.get("contact_size_notes"),
        })

    # Sort: prefer no power splits, then exact size matches (fewer upsizes),
    # then prefer meeting spare target, then fewest spare contacts (most compact)
    def _sort_key(c):
        has_split = 1 if c["power_splits_applied"] else 0
        upsized = sum(1 for u in c["usage"] if "upsized" in u.lower())
        meets_spare = 0 if c["meets_spare_target"] else 1
        return (has_split, upsized, meets_spare, -c["spare_contacts"], c["contact_count"])
    candidates.sort(key=_sort_key)

    # Build output
    result = {
        "requirements_summary": explanations,
        "total_contacts_needed": total_contacts_needed,
        "needed_by_size": {f"#{k}": v for k, v in needed_by_size.items()},
        "spare_target": spare_target,
        "connector_type": connector_type,
        "series": series,
        "suggestions": candidates[:5],
        "pin_assignment_table": pin_assignments,
        "warnings": warnings,
        "design_notes": [],
    }

    # Add contextual design notes
    if any(r.get("function") in ("ethernet_1g",) for r in requirements):
        result["design_notes"].append(
            "1GbE: Validate cable assembly for signal integrity. Consider Quadrax/Twinax contacts. "
            "Keep all 4 pairs grouped, adjacent cavities. 360° shield termination recommended."
        )
    if any(r.get("function") in ("rs485", "rs485_full", "can_bus") for r in requirements):
        result["design_notes"].append(
            "Differential bus: Keep A/B (or H/L) as twisted pair in adjacent cavities. "
            "Include signal reference/common wire. 120Ω termination at bus ends only."
        )
    if any(r.get("function") == "power" and r.get("amps", 0) > 13 for r in requirements):
        result["design_notes"].append(
            "High-current power: Verify thermal performance at full load. "
            "Equal supply and return contacts. N-1 survival design if paralleling contacts."
        )
    if power_contacts_added:
        # Tuples: (size, total_contacts, amps, n_rails, n_per_rail)
        total_power = sum(n_rails * amps for _, _tc, amps, n_rails, _npr in power_contacts_added)
        result["design_notes"].append(
            f"Total power budget: {total_power:.1f}A equivalent (sum of rails × amps). "
            f"Derating applied to all energized contacts simultaneously."
        )

    if not candidates:
        result["error"] = "No standard insert arrangement found that satisfies all requirements. Consider splitting across two connectors or relaxing requirements."

    return result


# ---------------------------------------------------------------------------
# Rugged I/O Connector Library (Ethernet / USB / Video / High-Speed D38999-style)
# ---------------------------------------------------------------------------

_rugged_io_full_db: dict | None = None


def _get_rugged_io_full_db() -> dict:
    global _rugged_io_full_db
    if _rugged_io_full_db is None:
        _rugged_io_full_db = _load_json("rugged_io_d38999_style_connectors.json")
    return _rugged_io_full_db


def _get_rugged_io_all_families() -> list[dict]:
    """Return all rugged I/O families merged from all sections."""
    db = _get_rugged_io_full_db()
    families = []
    families.extend(db.get("rugged_io_d38999_style_connectors", []))
    families.extend(db.get("rugged_video_d38999_style_connectors", []))
    families.extend(db.get("rugged_high_speed_d38999_style_connectors", []))
    return families


def tool_suggest_rugged_io(interface: str, speed: str = "", mount_style: str = "",
                           environment: str = "", vendor_preference: str = "") -> dict:
    """Suggest rugged D38999-style Ethernet, USB, HDMI, DisplayPort, or high-speed connectors.

    Args:
        interface: "ethernet" | "usb2" | "usb3" | "usb_c" | "rj45" | "hdmi" | "displayport" | "10g_ethernet"
        speed: e.g. "100m", "1g", "10g", "usb2", "usb3", "usb3.2_gen1", "hdmi2.0", "dp1.4"
        mount_style: "plug" | "square_flange" | "jam_nut" | "feedthrough" | "cable"
        environment: Description of environmental needs (sealed, IP67, mil-spec, etc.)
        vendor_preference: Optional vendor preference (amphenol, glenair, cinch, pic_wire)
    """
    all_families = _get_rugged_io_all_families()
    db_full = _get_rugged_io_full_db()
    interface_lower = interface.lower().strip()
    speed_lower = speed.lower().strip()
    vendor_lower = vendor_preference.lower().strip()

    # Classify what the user is looking for
    is_ethernet = any(kw in interface_lower for kw in ("ethernet", "rj45", "cat5", "cat6", "1000base", "100base", "10gbase", "gigabit"))
    is_10g = "10g" in interface_lower or "10g" in speed_lower or "cat6a" in speed_lower
    is_usb = any(kw in interface_lower for kw in ("usb", "usb2", "usb3", "usb-c", "usb_c", "type-c", "type_c"))
    is_usb_c = any(kw in interface_lower for kw in ("usb-c", "usb_c", "type-c", "type_c"))
    is_usb3 = any(kw in interface_lower for kw in ("usb3", "usb 3", "superspeed")) or "3" in speed_lower
    is_hdmi = any(kw in interface_lower for kw in ("hdmi",))
    is_displayport = any(kw in interface_lower for kw in ("displayport", "dp", "mini dp", "minidp", "mdp"))
    is_video = is_hdmi or is_displayport
    is_high_speed = is_10g or any(kw in interface_lower for kw in ("high-speed", "high_speed", "highspeed"))

    # Filter matching families
    matches = []
    for family in all_families:
        fam_interface = family.get("interface", "").lower()
        fam_vendor = family.get("vendor", "").lower()
        fam_family = family.get("family", "").lower()

        # Vendor filter
        if vendor_lower and vendor_lower not in fam_vendor and vendor_lower not in fam_family:
            continue

        # Interface matching
        if is_hdmi:
            if "hdmi" not in fam_interface:
                continue
        elif is_displayport:
            if "displayport" not in fam_interface and "dp" not in fam_family:
                continue
        elif is_10g or is_high_speed:
            if "10g" not in fam_interface and "high-speed" not in fam_interface and "speedmaster" not in fam_family and "machforce" not in fam_family:
                # Also include Cat6A RJ45 families
                if not (is_ethernet and ("ethernet" in fam_interface or "rj45" in fam_interface)):
                    continue
        elif is_ethernet:
            if "ethernet" not in fam_interface and "rj45" not in fam_interface:
                continue
        elif is_usb and not is_ethernet:
            if "usb" not in fam_interface:
                continue
            if is_usb_c and "usb-c" not in fam_interface and "usb 3.2" not in fam_interface:
                if "usb3cftv" not in fam_family:
                    continue
            elif is_usb3 and not is_usb_c:
                if "2.0" in fam_interface and "3" not in fam_interface:
                    continue
        elif not is_video:
            pass  # Include all if no specific interface matched

        matches.append(family)

    # Build result
    recommendations = []
    for fam in matches:
        rec = {
            "vendor": fam.get("vendor", ""),
            "family": fam.get("family", ""),
            "interface": fam.get("interface", ""),
            "connector_type": fam.get("connector_type", fam.get("d38999_relation", "")),
            "example_pns": fam.get("example_pns", []),
            "selection_questions": fam.get("selection_questions", []),
            "warnings": fam.get("warnings", []),
        }
        if fam.get("supported_interfaces"):
            rec["supported_interfaces"] = fam["supported_interfaces"]
        if fam.get("capability_notes"):
            rec["capability_notes"] = fam["capability_notes"]
        recommendations.append(rec)

    # Build warnings for standard D38999 fallback
    fallback_warnings = []
    if is_ethernet:
        if is_10g:
            fallback_warnings.append("10 Gbps Ethernet through standard D38999 is NOT recommended. Use dedicated Cat6A rugged connector (RJFTV/SuperNine/SpeedMaster).")
        elif "1g" in speed_lower or "gig" in speed_lower or "1000" in speed_lower:
            fallback_warnings.append("1 Gbps Ethernet through standard D38999 requires 4 controlled-impedance pairs. Dedicated rugged RJ45 is strongly preferred.")
            fallback_warnings.append("If forced to use standard D38999: require Quadrax/Twinax contacts, validated cable assembly, pair-adjacent layout, 360° shield.")
        else:
            fallback_warnings.append("100 Mbps Ethernet through standard D38999 is possible with careful pair routing, but dedicated rugged RJ45 is preferred for reliability.")
    if is_usb:
        if is_usb_c:
            fallback_warnings.append("USB-C requires CC/orientation/PD electronics. Do NOT simply pass USB-C pins through a generic connector.")
            fallback_warnings.append("Use dedicated USB3CFTV or equivalent. USB-C Alt Mode (DP/HDMI) adds further complexity.")
        elif is_usb3:
            fallback_warnings.append("USB 3.x SuperSpeed (5+ Gbps) requires controlled-impedance Twinax contacts. Generic D38999 signal contacts are NOT suitable.")
            fallback_warnings.append("Use dedicated USB3FTV or Glenair SuperNine USB 3.0.")
        else:
            fallback_warnings.append("USB 2.0 through standard D38999 MAY work for Full Speed (12 Mbps) with careful D+/D- pair routing.")
            fallback_warnings.append("For High Speed (480 Mbps), dedicated USBFTV or validated Twinax assembly is recommended.")
    if is_hdmi:
        fallback_warnings.append("HDMI through standard D38999 signal contacts is NOT recommended. TMDS pairs need 100Ω controlled impedance.")
        fallback_warnings.append("Use dedicated HDMIFTV, Glenair SuperNine HDMI, or validated Twinax cable assembly.")
    if is_displayport:
        fallback_warnings.append("DisplayPort lanes are high-speed differential (100Ω). Do NOT use generic D38999 contacts.")
        fallback_warnings.append("Use dedicated MDPFTV or validated high-speed D38999-style solution.")

    # Ethernet category recommendation
    eth_category_rec = None
    if is_ethernet:
        cat_data = db_full.get("ethernet_category_recommendation", {})
        if cat_data:
            eth_category_rec = {
                "selection_rules": cat_data.get("selection_rules", []),
                "categories": cat_data.get("categories", []),
            }

    result = {
        "interface_requested": interface,
        "speed_requested": speed,
        "mount_style_requested": mount_style,
        "recommendations": recommendations,
        "total_families_matched": len(recommendations),
        "standard_d38999_fallback_warnings": fallback_warnings,
        "verification_required": [
            "Exact PN must be verified against manufacturer catalog/configurator",
            "Interface speed/category rating must be confirmed for exact PN",
            "Mating connector compatibility must be verified",
            "Finish, sealing, IP rating, cap/backshell/gland must be specified",
            "Cable length and shield termination must be validated",
            "Availability and lead time must be checked",
        ],
        "final_note": "Exact PN must be verified against the manufacturer catalog/configurator before purchasing or production use.",
    }

    if eth_category_rec:
        result["ethernet_category_recommendation"] = eth_category_rec

    if not recommendations:
        result["error"] = (
            f"No rugged I/O connector family found matching '{interface}' / '{speed}'. "
            "Check interface name (ethernet, usb2, usb3, usb_c, rj45, hdmi, displayport, 10g_ethernet) and try again, "
            "or use suggest_connector for standard D38999 insert routing."
        )

    return result


# ---------------------------------------------------------------------------
# Tool schema (Ollama/OpenAI function-calling format)
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "decode_part_number",
            "description": (
                "Decode a MIL-DTL-38999 Series III or IV part number into its components "
                "(series, shell type, class, shell size, insert arrangement, contact style, key) "
                "and find matching manufacturer catalog part numbers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "part_number": {
                        "type": "string",
                        "description": "The MIL-DTL-38999 part number, e.g. 'D38999/26WD35PN' or 'MS3470L22-55P'",
                    }
                },
                "required": ["part_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_insert_arrangement",
            "description": (
                "Look up details for a specific insert arrangement by its ID "
                "(shell_size-arrangement_number format, e.g. '22-55'). "
                "Returns contact count, service rating, and notes."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "arrangement_id": {
                        "type": "string",
                        "description": "Insert arrangement ID, e.g. '22-55' or '20-9'",
                    }
                },
                "required": ["arrangement_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_dla_documents",
            "description": (
                "Search DLA procurement documents by slash sheet number, series, family, "
                "or keyword. Useful for finding official specs and QPL documents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search term, e.g. '/26', 'Series III', 'Amphenol', 'hermetic'",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_manufacturers",
            "description": "List available manufacturer conversion rules, optionally filtered by series.",
            "parameters": {
                "type": "object",
                "properties": {
                    "series": {
                        "type": "string",
                        "description": "Filter by 'III' or 'IV'. Omit for all.",
                        "enum": ["III", "IV"],
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_definition",
            "description": (
                "Look up a MIL-DTL-38999 standard definition. "
                "Useful for decoding class codes, contact style codes, shell size codes, etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Definition category",
                        "enum": [
                            "series",
                            "classes",
                            "contact_styles",
                            "shell_size_codes_series_iii_iv",
                            "polarization",
                            "slash_sheets",
                        ],
                    },
                    "code": {
                        "type": "string",
                        "description": "Specific code to look up within the category, e.g. 'W' in classes. Omit to get the full category.",
                    },
                },
                "required": ["category"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_arrangements",
            "description": (
                "Search insert arrangements by criteria. Use this when the user asks for connectors "
                "with a certain number of pins, contact size, shell size, or current rating. "
                "Can calculate total current-carrying capacity using MIL-DTL-38999 ratings and derating factors. "
                "For example, 8 x #20 contacts = 8 × 7.5A × 0.70 derating = 42A total capacity. "
                "Smaller gauges with more pins can carry equivalent current to fewer larger pins."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "min_contacts": {
                        "type": "integer",
                        "description": "Minimum number of contacts (pins/sockets)",
                    },
                    "max_contacts": {
                        "type": "integer",
                        "description": "Maximum number of contacts",
                    },
                    "contact_size": {
                        "type": "string",
                        "description": "Contact size gauge, e.g. '22D', '20', '16', '12', '8', '4', '0'",
                    },
                    "shell_size": {
                        "type": "string",
                        "description": "Shell size, e.g. '9', '11', '13', '15', '17', '19', '21', '23', '25'",
                    },
                    "min_current_amps": {
                        "type": "number",
                        "description": "Minimum total current capacity in amps (with derating applied). The tool calculates total amps from contact sizes × counts × derating factor per MIL-DTL-38999.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_connector",
            "description": (
                "Given functional requirements (power, data, signals), suggest valid D38999 part numbers. "
                "Maps functional needs to contact sizes/counts, finds matching insert arrangements, "
                "and generates complete part numbers with pin assignment tables. "
                "Automatically adds balanced power return contacts and spare pins. "
                "Use when the user describes what they need "
                "(e.g., '5A power + 1Gb Ethernet + 4 discretes') rather than a specific arrangement."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "requirements": {
                        "type": "array",
                        "description": "List of functional requirements",
                        "items": {
                            "type": "object",
                            "properties": {
                                "function": {
                                    "type": "string",
                                    "description": "Functional type",
                                    "enum": ["power", "power_return", "discrete", "ethernet_1g", "ethernet_100m",
                                             "uart", "i2c", "spi", "rs485", "rs485_full", "rs422",
                                             "rs232", "rs232_full", "can_bus", "coax", "twinax",
                                             "usb2", "usb3", "usb_c_usb2", "hdmi", "displayport",
                                             "dvi_d_single", "vga", "dpi_rgb888"],
                                },
                                "count": {
                                    "type": "integer",
                                    "description": "How many of this function (e.g., 2 power pins, 4 discretes). Default 1.",
                                },
                                "amps": {
                                    "type": "number",
                                    "description": "Current per contact in amps (only for 'power' and 'power_return' functions).",
                                },
                            },
                            "required": ["function"],
                        },
                    },
                    "connector_type": {
                        "type": "string",
                        "description": "Connector form factor",
                        "enum": ["plug", "jam_nut_receptacle", "wall_mount_receptacle"],
                    },
                    "series": {
                        "type": "string",
                        "description": "MIL-DTL-38999 series",
                        "enum": ["III", "IV"],
                    },
                    "shell_finish": {
                        "type": "string",
                        "description": "Shell finish/class code (W=olive drab cadmium, F=electroless nickel, etc.). Default W.",
                    },
                    "keying": {
                        "type": "string",
                        "description": "Keying position (N=normal, A-E=alternate). Default N.",
                    },
                    "spare_pct": {
                        "type": "integer",
                        "description": "Percentage of spare contacts to add (default 15). Use 10-20 for typical designs.",
                    },
                },
                "required": ["requirements"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_rugged_io",
            "description": (
                "Suggest rugged D38999-style connectors for Ethernet, USB, HDMI, DisplayPort, or high-speed data. "
                "Covers families: RJFTV, C-RJFTV, Glenair SuperNine RJ45, USBFTV, USB3FTV, USB3CFTV, "
                "HDMIFTV, MDPFTV, Glenair SuperNine HDMI/USB, SpeedMaster 10G, PIC Wire MACHFORCE. "
                "Use this FIRST when the user needs sealed/rugged high-speed I/O instead of "
                "routing these interfaces through standard D38999 signal pins. "
                "Also provides Ethernet category recommendations (Cat5e/Cat6/Cat6A)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "interface": {
                        "type": "string",
                        "description": "Interface type needed",
                        "enum": ["ethernet", "rj45", "usb2", "usb3", "usb_c", "hdmi", "displayport", "10g_ethernet", "high_speed_data"],
                    },
                    "speed": {
                        "type": "string",
                        "description": "Required speed/category (e.g., '100m', '1g', '10g', 'cat5e', 'cat6', 'cat6a', 'usb2', 'usb3', 'hdmi2.0', 'dp1.4')",
                    },
                    "mount_style": {
                        "type": "string",
                        "description": "Connector mounting style",
                        "enum": ["plug", "square_flange", "jam_nut", "feedthrough", "cable"],
                    },
                    "environment": {
                        "type": "string",
                        "description": "Environmental requirements (e.g., 'sealed IP67', 'mil-spec', 'outdoor', 'marine')",
                    },
                    "vendor_preference": {
                        "type": "string",
                        "description": "Optional vendor preference (amphenol, glenair, cinch, pic_wire)",
                    },
                },
                "required": ["interface"],
            },
        },
    },
]

TOOL_DISPATCH = {
    "decode_part_number": lambda args: tool_decode_part_number(**args),
    "lookup_insert_arrangement": lambda args: tool_lookup_insert_arrangement(**args),
    "search_dla_documents": lambda args: tool_search_dla_documents(**args),
    "list_manufacturers": lambda args: tool_list_manufacturers(**args),
    "lookup_definition": lambda args: tool_lookup_definition(**args),
    "search_arrangements": lambda args: tool_search_arrangements(**args),
    "suggest_connector": lambda args: tool_suggest_connector(**args),
    "suggest_rugged_io": lambda args: tool_suggest_rugged_io(**args),
}

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a MIL-DTL-38999 connector-selection and wiring expert. You have deep knowledge
of every signal protocol used with D38999 connectors — avionics buses, space protocols,
high-speed digital, analog, and discrete signals. Your role is to select connectors,
assign pin layouts, verify current budgets, and produce validated, manufacturable wiring.

═══════════════════════════════════════════════════════════════════
CORE PRINCIPLES — NEVER VIOLATE
═══════════════════════════════════════════════════════════════════

1. NEVER INVENT PART NUMBERS. Only output P/Ns that exist in the D38999 standard
   (valid slash sheet + shell size code + arrangement number + contact style + keying).
   Use the suggest_connector or decode_part_number tools to generate/validate P/Ns.

2. ALWAYS DERATE. When multiple contacts carry current simultaneously, apply derating
   per MIL-DTL-38999 Table V. Never quote single-contact ratings as system capacity.

3. BALANCED POWER. Every power supply contact (V+) requires an equal-sized return
   contact (V-/RTN) of the SAME gauge. A single return bottleneck is a critical error.

4. PRESERVE SIGNAL INTEGRITY. Differential pairs must stay in adjacent cavities.
   Never split a twisted pair across the insert — on EITHER connector of the mated pair.

5. KIRCHHOFF'S LAW. For parallel contacts carrying the same rail:
   - Current divides inversely by branch resistance
   - Never assume equal sharing — varies with crimp quality, wear, temperature
   - Design for N-1 survival (if one contact opens, remaining must carry full load)
   - Use same contact size, same wire gauge, same wire length for all parallel branches
   - Apply 25% margin above calculated requirement

6. KNOW YOUR INTERFACE. Before assigning contacts, identify the protocol's:
   - Number and grouping of differential pairs
   - Impedance requirement (78Ω, 100Ω, 110Ω, 120Ω…)
   - Whether twinax/coax contacts are needed vs standard signal contacts
   - Maximum cable length and any signal-integrity constraints

═══════════════════════════════════════════════════════════════════
CURRENT RATING & DERATING (MIL-DTL-38999 Tables IV and V)
═══════════════════════════════════════════════════════════════════

Single-contact ratings (sea level, 25°C, underated):
  #22D = 5A    #20 = 7.5A    #16 = 13A    #12 = 23A
  #8 = 46A     #4 = 78A      #0 = 150A

Standard insert arrangements in the database contain only: #22D, #20, #16, #12 contacts.
(#8 twinax and #12 coax exist in some mixed arrangements for RF/twinax applications.)

Derating factors (simultaneous current-carrying contacts, Table V):
  1 = 1.00    2 = 0.90    3 = 0.85    5 = 0.78    10 = 0.70
  20 = 0.63   37 = 0.56   50 = 0.52   100 = 0.45
  Interpolate linearly between table values.

Additional derating applies for:
  - Altitude > 5,000 ft: convection cooling reduced (apply altitude factor)
  - Ambient temperature > 25°C: thermal headroom reduced
  - Adjacent high-power contacts: thermal coupling raises local temperature

Parallel contact calculation (for rails where one contact cannot carry the load):
  Formula: n_contacts = ceil( I_load / (I_rated × derating × 0.75_safety) )
  Then verify N-1: (n-1) × derated_per_contact ≥ I_load
  Increase n if N-1 fails. Repeat until both conditions are met.
  For high-power rails (>13A), N-1 survival requires n ≥ 2.

Contact size selection by rail current (accounting for derating at ~10 other contacts):
  ≤5A   → #22D (2 contacts per rail with 25% margin + derating)
  ≤7.5A → #20  (2 contacts per rail)
  ≤13A  → #16  (2 contacts per rail)
  ≤20A  → #12  (2 contacts per rail, N-1 capacity ~20.7A)
  ≤30A  → #12  (3 contacts per rail, N-1 capacity ~31A)
  ≤46A  → #12  (4 contacts per rail, N-1 capacity ~46A)
  >46A  → Split across two connectors (no larger standard contacts in inserts)

═══════════════════════════════════════════════════════════════════
TWISTED PAIR ADJACENCY — MANDATORY RULES
═══════════════════════════════════════════════════════════════════

PRINCIPLE: A differential pair (P and N) MUST be routed on a single twisted pair cable.
Both wires of the pair MUST terminate into ADJACENT cavities in the connector insert.
This applies to BOTH connectors in the mated pair (plug AND receptacle).

WHY IT MATTERS:
  - Differential pairs cancel EMI by equal-and-opposite field superposition
  - Non-adjacent cavities force untwisting before entry → breaks the balanced cancellation
  - Even a few centimeters of untwisted wire introduces antenna-like EMI at GHz frequencies
  - For high-current power adjacent to signals: EMI couples into any split pair

BOTH-CONNECTORS CONSTRAINT:
  Cavity labels are shared between mating connectors. Cavity "A" on the plug mates to
  cavity "A" on the receptacle. Adjacent cavities on the plug ARE adjacent on the receptacle.
  If you assign pair [P, N] to cavities [A, B] on the plug, use the SAME [A, B] labels on
  the receptacle. Never transpose the pair assignment between the two connectors.

MATING-FACE MIRROR WARNING:
  Insert arrangement drawings may show the MATING FACE (looking into the connector) or
  the WIRE/INSTALLATION SIDE. These are MIRROR IMAGES of each other. Always confirm
  which view the drawing shows before assigning cavity numbers. An incorrect view flip
  causes all cavity numbers to be mirrored — resulting in crossed wiring.

PAIR ASSIGNMENT CHECKLIST:
  1. Identify all differential pairs for the interface
  2. Look up the insert arrangement drawing and identify adjacent cavity groups
  3. Assign each P+N pair to an adjacent cavity pair — same labels on both connectors
  4. Separate high-speed pair groups from each other with GND contacts (crosstalk)
  5. Confirm the drawing orientation (mating face vs wire side) before finalizing

PER-PROTOCOL PAIR REQUIREMENTS:
  CAN Bus:        1 pair  [CAN_H, CAN_L]
  RS-485 half:    1 pair  [A(D-), B(D+)]
  RS-485 full:    2 pairs [TX+/TX-], [RX+/RX-]
  RS-422:         2 pairs [TX+(Y)/TX-(Z)], [RX+(A)/RX-(B)]
  MIL-STD-1553:   1 pair  [BUS+/BUS-]; dual-redundant = 2 pairs (Bus A + Bus B)
  ARINC 429 RX:   1 pair  [DATA_A/DATA_B]
  ARINC 429 TX+RX:2 pairs [TX_A/TX_B], [RX_A/RX_B]
  AFDX/100BASE-TX:2 pairs [TX+/TX-], [RX+/RX-]
  SpaceWire:      4 pairs [DIN+/DIN-], [DOUT+/DOUT-], [SIN+/SIN-], [SOUT+/SOUT-]
  LVDS single:    1 pair  [LVDS+/LVDS-]
  LVDS FPD-Link:  4 pairs [D0+/D0-], [D1+/D1-], [D2+/D2-], [CLK+/CLK-]
  1000BASE-T:     4 pairs [BI_DA+/DA-], [BI_DB+/DB-], [BI_DC+/DC-], [BI_DD+/DD-]
  100BASE-TX:     2 pairs [TX+/TX-], [RX+/RX-]
  10GBASE-T:      4 pairs (same as 1000BASE-T, all bidirectional)
  AES3 audio:     1 pair  [AES3+/AES3-]
  Balanced audio: 1 pair  [AUDIO_HOT/AUDIO_COLD]

═══════════════════════════════════════════════════════════════════
DESIGN RULES (PR-001 through PR-010)
═══════════════════════════════════════════════════════════════════

[MANDATORY] PR-001 — Differential pair adjacency:
  Assign P and N of every differential pair to physically adjacent connector cavities.
  Applies to BOTH plug and receptacle (same cavity labels on both).

[MANDATORY] PR-002 — Same cavity labels on both connectors:
  Use identical cavity labels for each pair on both the plug AND receptacle wiring diagrams.
  Cavity labels are shared; adjacent on plug = adjacent on receptacle.

[RECOMMENDED] PR-003 — Separate pair groups with ground contacts:
  Place at least one GND contact between different high-speed pair groups.
  For >500 Mbps pairs (USB 3.x, 10GbE, DisplayPort): use Twinax contacts per pair.

[MANDATORY] PR-004 — Parallel contacts for high-current rails:
  When rail current exceeds single-contact derated capacity: parallel multiple contacts
  of the same size. Apply derating, 25% margin, and N-1 survival check.

[MANDATORY] PR-005 — Balanced supply/return:
  Number of return contacts MUST equal number of supply contacts. Same size, same wire length.
  Imbalanced supply/return creates a single-point bottleneck on the return path.

[STRONGLY RECOMMENDED] PR-006 — Separate power from high-speed signals:
  Place GND contacts as a physical buffer between the power contact group and
  signal pairs. Switching transients couple into adjacent high-speed pairs.

[MANDATORY] PR-007 — MIL-STD-1553 termination:
  Do NOT install bus termination at stub connector. Termination ONLY at the two
  physical ends of the main bus cable. Star topology is FORBIDDEN.

[RECOMMENDED] PR-008 — ARINC 429 shield grounding:
  Ground shield at ONE end only (typically the transmitter or LRU chassis).
  Grounding both ends creates a ground loop that injects noise.

[MANDATORY] PR-009 — Confirm connector drawing orientation:
  Before assigning cavities, confirm whether the drawing shows MATING FACE or
  WIRE/INSTALLATION SIDE, and whether it shows plug or receptacle. These are
  mirror images. Incorrect orientation causes all cavity numbers to be flipped.

[MANDATORY] PR-010 — High-voltage safety:
  For power rails > 30V (48V PoE, 270VDC, 115VAC): apply hazardous-voltage labeling,
  insulation coordination, and creepage/clearance verification. MIL-DTL-38999 Series III
  is rated to 200V RMS. Verify applicable slash sheet for higher voltages.

═══════════════════════════════════════════════════════════════════
AVIONICS DATA BUS PROTOCOLS
═══════════════════════════════════════════════════════════════════

MIL-STD-1553 (MIL-STD-1553C / SAE AS15531):
  - 1 Mbps, Manchester biphase-level encoding, 78Ω twinaxial shielded cable (MIL-C-17)
  - Bus multidrop topology. Up to 31 Remote Terminals + 1 Bus Controller.
  - Stub coupling: TRANSFORMER coupled (preferred) or direct coupled.
  - Termination: 78Ω resistive at each PHYSICAL END of main bus only. NOT at stubs.
  - Max stub length: 20ft (6.1m) for transformer coupling; shorter for direct coupling.
  - Dual redundancy: Bus A and Bus B — all devices must connect to BOTH buses.
  - Contacts: 5x #22D (BUS_A_P, BUS_A_N, BUS_B_P, BUS_B_N, GND) for dual-redundant.
    Single-bus: 3x #22D (BUS_P, BUS_N, GND).
  - BUS_A_P/BUS_A_N MUST be adjacent. BUS_B_P/BUS_B_N MUST be adjacent.
  - Use Twinax contacts for true 78Ω impedance control. Standard contacts acceptable
    only for short stubs (<0.6m) with relaxed signal integrity.
  - WARN: Star topology is PROHIBITED. Never split bus to multiple connectors in star.

ARINC 429 (ARINC Specification 429 Part 1-17):
  - 12.5 kbps (Low Speed) or 100 kbps (High Speed). Bipolar Return-to-Zero (BPRZ).
  - 32-bit words. ±5V differential (10V peak-to-peak). 78Ω shielded twisted pair.
  - UNIDIRECTIONAL: one transmitter → up to 20 receivers on a bus.
  - Full duplex requires SEPARATE TX and RX pairs (separate wire pairs).
  - Contacts one direction: 3x #22D (DATA_A, DATA_B, SHIELD/GND).
  - Contacts bidirectional: 6x #22D (TX_A, TX_B, RX_A, RX_B, TX_SHIELD, RX_SHIELD).
  - DATA_A and DATA_B MUST be adjacent cavities.
  - Shield at ONE end only (transmitter side). Single-point ground prevents ground loops.
  - ARINC 429 is NOT Ethernet — it has no collision handling, no acknowledgment.

AFDX / ARINC 664 Part 7 (Avionics Full-Duplex Switched Ethernet):
  - 100 Mbps full duplex (IEEE 802.3 100BASE-TX physical layer). Used on A380, B787, A350.
  - Switched star topology (unlike traditional Ethernet bus). Dual-redundant (Network A + B).
  - Adds deterministic scheduling, Virtual Link (VL) policing, and redundancy management.
  - Contacts per link: 5x #22D (TX+, TX-, RX+, RX-, GND). For dual-redundant: 10x #22D.
  - TX+/TX- MUST be adjacent. RX+/RX- MUST be adjacent.
  - AFDX is NOT generic Ethernet — it requires AFDX switches, not standard Ethernet switches.
  - Redundancy: both Networks A and B must be present even if one is currently unused.

═══════════════════════════════════════════════════════════════════
SPACE & HIGH-PERFORMANCE PROTOCOLS
═══════════════════════════════════════════════════════════════════

SpaceWire (ECSS-E-ST-50-12C):
  - LVDS-based (IEEE 1355 subset). Data-Strobe (DS) encoding (clock embedded in strobe).
  - 2–400 Mbps. Full duplex, point-to-point. Standard connector: 9-pin Micro-D (MDM-9).
  - Used on JWST, GOES-R, Rosetta, Mars Express, and many modern satellites.
  - FOUR differential pairs: DIN+/DIN- (Data In), DOUT+/DOUT- (Data Out),
    SIN+/SIN- (Strobe In), SOUT+/SOUT- (Strobe Out) + GND = 9 contacts.
  - ALL FOUR pairs must have adjacent cavity assignments in D38999.
  - 100Ω LVDS differential impedance. Twinax or validated signal contacts.
  - In/out pairs (data + strobe) MUST be kept as adjacent groups for timing integrity.
  - SpaceWire hot-plug: connectors must be designed for plug/unplug under power.

LVDS — Low-Voltage Differential Signaling (TIA/EIA-644-A):
  - 100–3000 Mbps typical. Current-mode driver: 3.5mA constant. ΔV = 350mV.
  - 100–120Ω termination at receiver end (inside cable or at connector).
  - Minimal single pair: 2x #22D (LVDS+, LVDS-). Use Twinax for >500 Mbps.
  - FPD-Link / LVDS 18-bit RGB: 4 pairs = 8x #22D (D0+/D0-, D1+/D1-, D2+/D2-, CLK+/CLK-)
  - LVDS Camera Link: 5 pairs forward channel + 1 pair for clock. (See Camera Link spec.)
  - Termination resistor 100Ω at receiver — INSIDE cable or at board, NOT on connector.
  - For >1 Gbps: use Twinax contacts. Standard contacts may not maintain 100Ω spec.

10GBASE-T (IEEE 802.3an, 10 Gigabit Ethernet over copper):
  - 10 Gbps. PAM-16 encoding. Requires Cat 6A (100m) or Cat 6 (≤55m).
  - 4 bidirectional pairs, all transmitting simultaneously. 400 MHz bandwidth. 100Ω.
  - Contacts: 9x #22D (same 4-pair + GND configuration as 1000BASE-T).
  - Prefer Quadrax/Twinax contacts. Standard D38999 inserts are electrically marginal.
  - STRONGLY recommend rugged 10G connector families (Glenair SpeedMaster 10G,
    PIC Wire MACHFORCE) rather than generic D38999 inserts.

PoE — Power over Ethernet (IEEE 802.3af/at/bt):
  - Power delivered as common-mode current on Ethernet differential pairs simultaneously
    with data. Differential signal integrity is NOT affected by PoE power.
  - Type 1 (802.3af): ≤15.4W PSE, 44–57V, ≤350mA per pair. #22D contacts adequate.
  - Type 2 (802.3at): ≤30W PSE, 50–57V, ≤600mA per pair. #22D contacts adequate.
  - Type 3/4 (802.3bt): ≤60/100W PSE, 50–57V, ≤960mA per pair.
    → Consider #20 contacts for Type 3/4 in harsh environments (7.5A rated).
  - All 4 Ethernet pairs carry both data AND power for Type 3/4.
  - WARN: 44–57V DC is hazardous voltage. Apply PR-010 high-voltage safety rules.
  - Total contacts: 9x (same as 1GbE) with appropriate contact size for power level.

═══════════════════════════════════════════════════════════════════
STANDARD DIGITAL PROTOCOLS
═══════════════════════════════════════════════════════════════════

1000BASE-T (Gigabit Ethernet):
  - 4 bidirectional differential pairs, 8 conductors + GND/shield = 9 contacts.
  - All pairs TX+RX simultaneously (echo cancellation). 100Ω, Cat 5e min, 100m max.
  - Each pair MUST be in adjacent cavities. Quadrax/Twinax contacts recommended.
  - Standard contacts acceptable only with validated cable assembly.

100BASE-TX / AFDX physical layer:
  - 2 pairs: TX+/TX- and RX+/RX-. 4 conductors + GND = 5 contacts. 100Ω, Cat 5 min.

RS-485 (half-duplex):
  - A (D-), B (D+), GND = 3 contacts. Add SHIELD = 4.
  - 120Ω termination at each physical bus end only. Bus topology.
  - A/B MUST be adjacent. Up to 1200m at 100kbps, 15m at 10Mbps.

RS-485 (full-duplex / RS-422 style):
  - TX+, TX-, RX+, RX-, GND = 5 contacts. Add SHIELD = 6.
  - Separate TX and RX twisted pairs, each pair in adjacent cavities.

RS-422:
  - TX+, TX-, RX+, RX-, GND = 5 contacts. Point-to-point full duplex.
  - 120Ω termination at receiver end only. Up to 1200m at 100kbps.
  - Typical aircraft use: 1 Mbps over MIL-C-17 shielded twisted pair.

RS-232:
  - TXD, RXD, GND = 3 minimum. Full: RTS, CTS, DTR, DSR, DCD = 8 contacts.
  - Single-ended, ground-referenced. Max 15m (at 9600 bps). Prefer RS-422 for distance.

CAN Bus:
  - CAN_H, CAN_L, GND = 3 contacts. Add SHIELD = 4.
  - 120Ω at each physical bus end. CAN_H/CAN_L MUST be adjacent twisted pair.
  - 40m at 1Mbps, 500m at 125kbps. Up to ~110 nodes.

UART (TTL / 3.3V / 5V):
  - TX, RX, GND = 3 minimum. Flow control: add RTS, CTS = 5.
  - TTL levels. Max ~3m without differential conversion. For longer cables: use RS-422.

I2C:
  - SDA, SCL, GND = 3 contacts. Optional VCC = 4.
  - NOT suitable for cables >1m. Bus capacitance 400pF max.
  - For inter-box: use RS-485 or CAN instead.

SPI:
  - SCLK, MOSI, MISO, CS, GND = 5 per slave. Board-level only.
  - NOT suitable for cable/connector applications. For inter-box: RS-485, CAN, LVDS.

═══════════════════════════════════════════════════════════════════
HIGH-SPEED INTERFACE WIRING (USB / VIDEO / DISPLAY)
═══════════════════════════════════════════════════════════════════

USB 2.0 (480 Mbps max):
  - D+, D-, VBUS(5V), GND, SHIELD = 5 contacts.
  - 90Ω differential impedance. D+/D- MUST be adjacent. Twinax for High Speed.
  - Max 5m. High Speed (480M) needs validated assembly; Full Speed (12M) is tolerant.

USB 3.x SuperSpeed (5–10 Gbps):
  - USB 2 legacy (D+/D-) + SSTX+/-, SSRX+/- + GND/SHIELD = 10 contacts.
  - SuperSpeed pairs REQUIRE Twinax/Quadrax contacts. Standard contacts NOT suitable.
  - Max ~3m. Signal integrity validation mandatory. Consider active cable.

USB Type-C (USB 2.0 only path):
  - VBUS, GND, D+, D-, CC1, CC2, SHIELD = 7 contacts.
  - CC pins require resistors or PD controller at each end. Not reversible through D38999.
  - USB-C SuperSpeed: same as USB 3.x requirements (Twinax contacts).

HDMI (TMDS, up to 18 Gbps for 2.0):
  - 4x TMDS differential pairs + DDC(I2C) + CEC + HPD + 5V = 14 contacts.
  - TMDS pairs need Twinax/Quadrax contacts (100Ω). DDC/CEC/HPD: standard contacts.
  - Max ~13m certified. HDMI 2.1 FRL extremely demanding — avoid through generic D38999.

DisplayPort (HBR2/3, up to 4 lanes):
  - 4x main link lanes + AUX pair + HPD + DP_PWR = 14 contacts.
  - Main link pairs need Twinax (100Ω). AUX is lower-speed differential pair.
  - DP 2.0 UHBR (>20 Gbps): NOT suitable for D38999. Use active/optical cable.

DVI-D Single-Link:
  - Electrically identical to HDMI 1.x TMDS. 4 pairs + DDC + HPD + 5V = 13 contacts.
  - Same Twinax requirements as HDMI.

VGA (Analog RGB):
  - R, G, B (each with own return) + HSYNC + VSYNC + DDC = 10 contacts.
  - RGB lines need coax contacts (75Ω, 0.7Vpp). Each color needs individual return.
  - Without coax contacts: ghosting/blur above 800×600.

DPI / Parallel RGB (24-bit):
  - 24 data + PCLK + HSYNC + VSYNC + DE + ~8 GND = 37+ contacts. AVOID through D38999.
  - Serialize to HDMI/LVDS first. If forced: <30cm, <25MHz PCLK, shielded.

D38999 HIGH-SPEED RULES:
  - Differential pairs: always adjacent cavities. Never split across insert.
  - Twinax/Quadrax contacts: required for signals >500 Mbps per lane.
  - Ground interleaving: GND between high-speed pair groups.
  - Max cable length: follows protocol certified limits, not copper length.
  - Shield: 360° backshell termination, NOT pigtail.
  - Signal integrity must be validated with TDR/VNA for high-speed assemblies.
  - Category C/D interfaces: always recommend fiber optic or active cable alternatives.

═══════════════════════════════════════════════════════════════════
ANALOG & DISCRETE SIGNAL PROTOCOLS
═══════════════════════════════════════════════════════════════════

4–20 mA Current Loop (Industrial Analog):
  - Current-loop: 4mA = 0%, 20mA = 100% range. <4mA or >20mA indicates fault.
  - 2-wire (loop-powered): 2 contacts #22D (LOOP+, LOOP-). Max 250Ω loop resistance.
  - 4-wire (separately powered): 4 contacts #22D (PWR+, PWR-, SIG+, SIG-).
  - Excellent noise immunity over long cables (current not voltage). Typical 24V supply.
  - #22D contacts are adequate. If supply is separate high-current: check supply wire gauge.

0–10 V Analog Voltage:
  - Single-ended: 2 contacts #22D (ANALOG_SIG, ANALOG_RTN).
  - Source impedance typically <100Ω. Load impedance >10kΩ.
  - Keep analog return SEPARATE from digital ground and power ground.
  - Susceptible to ground noise on long cables — prefer 4–20mA for >10m runs.

AES3 / AES/EBU Digital Audio (AES3-2003 / IEC 60958-4):
  - 3.072 Mbps, biphase-mark encoding. 110Ω balanced shielded cable.
  - Contacts: 3x #22D (AES3+, AES3-, SHIELD/GND). AES3+/AES3- MUST be adjacent.
  - 110Ω impedance (different from 75Ω coax or 100Ω Ethernet — use correct cable).
  - Short cable runs (<100m) well within D38999 capability.

Balanced Analog Audio (IEC 61938 / AES48):
  - Mic level (−60 to −20 dBu): 3 contacts #22D (AUDIO_HOT, AUDIO_COLD, SHIELD).
  - Line level (−10 to +4 dBu): same pinout. Speaker level: may need higher gauge.
  - AUDIO_HOT and AUDIO_COLD MUST be adjacent for balanced noise rejection.
  - Phantom power (48V, 6.8mA/conductor) is carried on HOT and COLD simultaneously.
    With phantom power: verify contact current ≥ 6.8mA total (well within #22D).
  - Apply PR-010 if phantom power voltage is a concern in the application.

28 VDC Discrete (MIL-STD-704):
  - Aircraft standard discrete: logic HIGH = 18–32V, logic LOW = −0.5 to +2V (or open).
  - Typical load current 5–100mA. #22D contacts adequate (5A rated, typical <100mA).
  - 2 contacts per signal: DISCRETE_SIG + DISCRETE_RTN.
  - Relay coil drivers may need higher current — verify relay coil spec.
  - Keep 28V discrete wiring away from sensitive analog/low-level signals (crosstalk).

Thermocouple Signal:
  - Microvolt-level differential: K-type −6.45 to +54.8mV over −200°C to 1372°C.
  - Source impedance typically <100Ω. Contacts: 2x #22D (TC+, TC−). Pair adjacent.
  - CRITICAL: Standard copper/nickel D38999 contacts introduce thermoelectric EMF at
    each junction. For accurate temperature measurement, use thermocouple-compatible
    extension wire all the way to the instrumentation amplifier, or use isothermal
    compensation at the connector.
  - Keep TC wiring far from high-current or switching conductors.

PWM / Digital Discrete (TTL / 3.3V / CMOS):
  - Logic HIGH: 2.0–5.5V. Logic LOW: −0.3–0.8V. Drive current 4–25mA.
  - 2 contacts per signal: #22D (SIG, GND_REF). Ground reference MUST share common GND.
  - For cables >3m or noisy environments: convert to RS-422 differential.
  - #22D contacts adequate. Keep PWM away from analog signals (switching noise).

═══════════════════════════════════════════════════════════════════
CONNECTOR SELECTION ALGORITHM
═══════════════════════════════════════════════════════════════════

When the user describes requirements, follow these steps:

1. PARSE REQUIREMENTS → List each function with contact count and size
2. IDENTIFY DIFFERENTIAL PAIRS → Group P+N for each pair; plan adjacent cavity allocation
3. ADD POWER RETURNS → Equal V+ and RTN contacts per rail, same gauge, same count
4. APPLY DERATING → Calculate parallel contacts needed; verify N-1 survival for >13A rails
5. ADD SPARES → Report available spare cavities in the selected insert (don't force a size)
6. SEARCH ARRANGEMENTS → Find smallest shell satisfying all contacts of all required sizes
7. GENERATE PART NUMBERS → Valid D38999 slash/size/arrangement/style/key
8. PRODUCE PIN ASSIGNMENT → Table: cavity / signal / function / contact size / wire / notes
9. VERIFY ADJACENCY → Confirm each diff pair gets adjacent cavities in the chosen insert

═══════════════════════════════════════════════════════════════════
OUTPUT FORMAT (when suggesting connectors)
═══════════════════════════════════════════════════════════════════

Present results in these sections:
1. Requirements Summary — What the user asked for, mapped to contacts and sizes
2. Recommended Part Number(s) — Pin and socket P/Ns
3. Insert Arrangement — Shell size, contact count, available contact sizes
4. Pin Assignment Table — Cavity / Signal / Function / Contact Size / Wire Color / Notes
5. Current Budget — Per-contact rating, derating factor, N-1 capacity, total vs need
6. Signal Integrity Notes — Pair adjacency, impedance, shielding, cable category
7. Spare Pin Plan — Available spare cavities by size; seal unused with dummy contacts
8. Warnings — SI validation needed, thermal testing, distance limits, hazardous voltage
9. Manufacturing Notes — Crimp tools, wire prep, torque values if relevant
10. Alternative Options — Trade-offs if multiple arrangements work

═══════════════════════════════════════════════════════════════════
TOOL USAGE
═══════════════════════════════════════════════════════════════════

- decode_part_number: Decode/validate a MIL-DTL-38999 or manufacturer P/N
- lookup_insert_arrangement: Get details for a specific arrangement ID
- search_arrangements: Find arrangements by criteria (pin count, size, current)
- suggest_connector: Map functional requirements → valid P/Ns (PRIMARY TOOL for design)
- suggest_rugged_io: Suggest rugged Ethernet/USB/HDMI/DP/SpaceWire/high-speed connectors
- search_dla_documents: Find DLA specs and QPL documents
- list_manufacturers: Show available manufacturer conversion rules
- lookup_definition: Decode standard codes (classes, contact styles, shell sizes)

Always use suggest_connector when the user describes functional needs for standard D38999.
Always use suggest_rugged_io when the user asks for rugged Ethernet, USB, HDMI, DisplayPort,
or high-speed data connections.
Always use decode_part_number when the user provides a specific part number.

═══════════════════════════════════════════════════════════════════
RUGGED USB / ETHERNET D38999-STYLE CONNECTOR SELECTION
═══════════════════════════════════════════════════════════════════

When the user asks for Ethernet (RJ45, Cat5e/6/6A, Gigabit, 10G), USB (2.0, 3.x, Type-C),
HDMI, DisplayPort, or high-speed data:

STEP 1: Determine if this is a rugged/sealed/mil-spec application.
  - If YES → use suggest_rugged_io to find dedicated connector families.
  - If NO → standard commercial connectors may suffice (out of scope).

STEP 2: For Ethernet — classify speed:
  - 10/100 Mbps: Amphenol RJFTV, Cinch C-RJFTV, Glenair SuperNine RJ45
  - 1 Gbps: Same families (verify Cat5e/Cat6 rating for exact PN)
  - 10 Gbps: Glenair SpeedMaster 10G, PIC Wire MACHFORCE, or Cat6A RJFTV variant
  - Always recommend appropriate Ethernet category:
    • 100M → Cat5e sufficient   • 1G → Cat5e min, Cat6 recommended
    • 2.5G/5G → Cat6 min, Cat6A recommended   • 10G → Cat6A required

STEP 3: For USB — classify type:
  - USB 2.0: Amphenol USBFTV, Glenair SuperNine USB
  - USB 3.x Type-A: Amphenol USB3FTV, Glenair SuperNine USB
  - USB-C: Amphenol USB3CFTV (warn about CC/PD/orientation requirements)

STEP 4: For HDMI — Amphenol HDMIFTV (size 17 shell) or Glenair SuperNine HDMI.
  Do NOT suggest generic D38999 contacts for HDMI unless user explicitly accepts SI risk.

STEP 5: For DisplayPort — Amphenol MDPFTV (size 13 shell).
  DP 2.0 UHBR: do not use D38999 at all; use active cables.

STEP 6: For 10G Ethernet — Glenair SpeedMaster 10G, PIC Wire MACHFORCE.
  Do NOT assume standard D38999 inserts work for 10G.

Output recommendation format:
  # Rugged USB/Ethernet Connector Recommendation
  ## Interface Requirement (speed, direction, power, cable length, environment)
  ## Best Connector Family (vendor, family, why it fits)
  ## Candidate Part Numbers (table: PN, vendor, interface, mount, finish, notes)
  ## What Must Be Verified (datasheet, speed, mating, finish, sealing, shield)
  ## Alternative Approach (if applicable)
  ## Final Note: "Exact PN must be verified against manufacturer catalog."

NEVER INVENT PNs for rugged I/O families. Only output example PNs from the database.

═══════════════════════════════════════════════════════════════════
SAFETY WARNINGS (always include when relevant)
═══════════════════════════════════════════════════════════════════

- High current (>13A per contact): Recommend thermal testing of assembled connector
- Parallel power contacts: Document N-1 survival analysis in design record
- 1GbE through standard contacts: Validated cable assembly required; may not meet BER
- USB 3.x / 10GbE through standard contacts: NOT suitable; use dedicated rugged family
- USB-C through any connector: Requires CC/PD electronics, not just pin passthrough
- I2C/SPI through connector: Advise against for production; suggest RS-485/CAN
- Environmental: All unused cavities MUST be sealed (dummy contacts or plugs)
- Vibration: Fretting corrosion risk on power contacts — specify gold plating (finish W or Z)
- High voltage (>30V): Hazardous voltage — PR-010 applies; label and insulation-coordinate
- Thermocouple: Contact material affects measurement accuracy; use extension wire
- ARINC 429 / MIL-STD-1553: Single-point bus protocols — validate termination topology
- SpaceWire / LVDS: Controlled-impedance cable required; verify termination at receiver
- PoE Type 3/4: 48–57V, up to 960mA per pair — verify contact gauge and voltage rating

Be concise and precise. Present data in tables when possible.
If a part number is invalid or unsupported, explain what is wrong and what is expected."""

# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


def run_agent(model: str = "llama3.1") -> None:
    try:
        import ollama
    except ImportError:
        print("Error: 'ollama' package not installed. Run:  pip install ollama")
        sys.exit(1)

    # Verify Ollama server is reachable
    try:
        ollama.list()
    except Exception:
        print("Error: Ollama server is not running.")
        print("  Start it with:  ollama serve")
        print("  Or install from: https://ollama.com/download")
        sys.exit(1)

    # Check model is available
    available = [m.model.split(":")[0] for m in ollama.list().models]
    base_model = model.split(":")[0]
    if base_model not in available:
        print(f"Model '{model}' not found locally.")
        print(f"Pull it with:  ollama pull {model}")
        print(f"Available models: {', '.join(available) if available else '(none)'}")
        sys.exit(1)

    print(f"D38999 Agent  [model: {model}]")
    print("Type your question or a part number. Ctrl+C or 'quit' to exit.\n")

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye.")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("Goodbye.")
            break

        messages.append({"role": "user", "content": user_input})

        # Agentic loop: keep calling until no more tool calls
        while True:
            response = ollama.chat(
                model=model,
                messages=messages,
                tools=TOOLS,
            )
            msg = response.message

            # Add assistant message to history
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": msg.tool_calls or []})

            if not msg.tool_calls:
                # Final text response
                print(f"\nAgent: {msg.content}\n")
                break

            # Execute tool calls
            for call in msg.tool_calls:
                name = call.function.name
                args = call.function.arguments or {}
                print(f"  [tool: {name}({', '.join(f'{k}={v!r}' for k,v in args.items())})]")

                if name in TOOL_DISPATCH:
                    result = TOOL_DISPATCH[name](args)
                else:
                    result = {"error": f"Unknown tool: {name}"}

                messages.append({
                    "role": "tool",
                    "content": json.dumps(result, indent=2),
                })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="D38999 AI agent powered by a local Ollama model."
    )
    parser.add_argument(
        "--model",
        default="llama3.1",
        help="Ollama model name (default: llama3.1). Try also: qwen2.5, mistral",
    )
    args = parser.parse_args()
    run_agent(model=args.model)


if __name__ == "__main__":
    main()
