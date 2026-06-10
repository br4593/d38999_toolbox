from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

POSITIVE_SUITABILITIES = {"recommended", "acceptable", "conditional"}
SCORE_BY_SUITABILITY = {
    "unknown": 0,
    "not_recommended": 1,
    "conditional": 3,
    "acceptable": 4,
    "recommended": 5,
}
TAG_ORDER = [
    "land_general",
    "land_vehicle",
    "land_military",
    "desert_dust",
    "high_vibration",
    "high_shock",
    "marine_above_deck",
    "marine_below_deck",
    "salt_fog",
    "coastal",
    "aerospace_general",
    "aircraft_fixed_wing",
    "aircraft_rotary_wing",
    "uav",
    "space",
    "vacuum",
    "industrial",
    "outdoor_exposed",
    "high_temperature",
    "low_temperature",
    "high_emi_rfi",
    "fuel_oil_hydraulic_exposure",
    "sealed_weatherproof",
    "nuclear_radiation_sensitive",
    "not_recommended_for_environment",
    "unknown_environment",
]
PROFILE_ORDER = TAG_ORDER + ["unknown_environment"]
DEFAULT_TEMPERATURE_RANGE = "-65C to +200C family maximum; exact upper limit is finish-dependent."


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def evidence(source_file: str, page: str, section: str, text: str) -> dict[str, str]:
    return {
        "source_file": source_file,
        "page": page,
        "section": section,
        "quoted_or_paraphrased_evidence": text,
    }


def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def unique_profiles(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for profile in profiles:
        key = profile["environment"]
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = profile
            continue
        if SCORE_BY_SUITABILITY[profile["suitability"]] > SCORE_BY_SUITABILITY[existing["suitability"]]:
            deduped[key] = profile
            continue
        if (
            SCORE_BY_SUITABILITY[profile["suitability"]] == SCORE_BY_SUITABILITY[existing["suitability"]]
            and len(profile.get("evidence", [])) > len(existing.get("evidence", []))
        ):
            deduped[key] = profile
    order = {name: index for index, name in enumerate(PROFILE_ORDER)}
    return sorted(deduped.values(), key=lambda item: (order.get(item["environment"], len(order)), item["environment"]))


def ordered_tags(tags: list[str]) -> list[str]:
    order = {name: index for index, name in enumerate(TAG_ORDER)}
    return sorted(unique_strings(tags), key=lambda tag: (order.get(tag, len(order)), tag))


def profile(
    environment: str,
    suitability: str,
    confidence: str,
    reason: str,
    evidence_items: list[dict[str, str]],
    required_conditions: list[str] | None = None,
    limitations: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "environment": environment,
        "suitability": suitability,
        "confidence": confidence,
        "reason": reason,
        "evidence": evidence_items,
        "required_conditions": required_conditions or [],
        "limitations": limitations or [],
    }


def compact_profile(profile_record: dict[str, Any]) -> dict[str, Any]:
    compact = {
        "environment": profile_record["environment"],
        "suitability": profile_record["suitability"],
        "confidence": profile_record["confidence"],
        "reason": profile_record["reason"],
    }
    evidence_sources = unique_strings(
        [item.get("source_file", "") for item in profile_record.get("evidence", []) if item.get("source_file")]
    )
    if evidence_sources:
        compact["evidence_sources"] = evidence_sources
    if profile_record.get("required_conditions"):
        compact["required_conditions"] = profile_record["required_conditions"]
    if profile_record.get("limitations"):
        compact["limitations"] = profile_record["limitations"]
    return compact


STANDARD_DEFINITIONS = read_json(DATA_DIR / "standard_definitions.json")["definitions"]
CLASS_DEFINITIONS = STANDARD_DEFINITIONS["classes"]
CONTACT_STYLE_DEFINITIONS = STANDARD_DEFINITIONS["contact_styles"]
SHELL_SIZE_CODES = STANDARD_DEFINITIONS["shell_size_codes_series_iii_iv"]


def load_slash_sheet_map() -> dict[str, dict[str, Any]]:
    documents = read_json(DATA_DIR / "dla_documents.json").get("documents", [])
    slash_map: dict[str, dict[str, Any]] = {}
    for document in documents:
        slash_sheet = document.get("slash_sheet")
        if not slash_sheet or document.get("family") != "slash_sheet":
            continue
        existing = slash_map.get(slash_sheet)
        if existing is None:
            slash_map[slash_sheet] = document
            continue
        if existing.get("is_initial_draft") and not document.get("is_initial_draft"):
            slash_map[slash_sheet] = document
    return slash_map


SLASH_SHEETS = load_slash_sheet_map()


ENVIRONMENT_FILTER_DEFINITIONS = [
    {
        "filter_name": "Land",
        "filter_key": "land",
        "matches_tags": [
            "land_general",
            "land_vehicle",
            "land_military",
            "desert_dust",
            "high_vibration",
        ],
    },
    {
        "filter_name": "Sea / Marine",
        "filter_key": "sea",
        "matches_tags": [
            "marine_above_deck",
            "marine_below_deck",
            "salt_fog",
            "coastal",
            "sealed_weatherproof",
        ],
    },
    {
        "filter_name": "Air / Aerospace",
        "filter_key": "air",
        "matches_tags": [
            "aerospace_general",
            "aircraft_fixed_wing",
            "aircraft_rotary_wing",
            "uav",
            "high_vibration",
            "high_emi_rfi",
        ],
    },
    {
        "filter_name": "Space / Vacuum",
        "filter_key": "space",
        "matches_tags": [
            "space",
            "vacuum",
        ],
    },
    {
        "filter_name": "Industrial",
        "filter_key": "industrial",
        "matches_tags": [
            "industrial",
            "outdoor_exposed",
            "high_temperature",
            "low_temperature",
            "fuel_oil_hydraulic_exposure",
        ],
    },
]
SCORE_GROUPS = {item["filter_key"]: item["matches_tags"] for item in ENVIRONMENT_FILTER_DEFINITIONS}


CLASS_METADATA: dict[str, dict[str, Any]] = {
    "C": {
        "shell_material": "aluminum",
        "finish": "black anodized / hard anodic, nonconductive",
        "temperature_range": "-65C to +200C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": False,
        "finish_evidence": [
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "14",
                "3.3.6.2 Shells and accessory hardware",
                "Class C uses a hard anodic, nonconductive coating.",
            ),
            evidence(
                "Eaton_D38999_Series_IV.pdf",
                "30",
                "Environmental, Shock, Vibration, and EMI/RFI",
                "Class C is listed at -65C to +200C, 500 hours salt spray, and no EMI shielding.",
            ),
        ],
    },
    "F": {
        "shell_material": "aluminum",
        "finish": "electroless nickel",
        "temperature_range": "-65C to +200C",
        "temperature_specific": True,
        "salt_spray_hours": 48,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Operating Temperature Range / Material and Finish Data",
                "Class F is aluminum with electroless nickel finish, -65C to +200C, and 48-hour salt spray.",
            ),
        ],
    },
    "G": {
        "shell_material": "aluminum",
        "finish": "space-grade electroless nickel",
        "temperature_range": "-65C to +200C",
        "temperature_specific": True,
        "salt_spray_hours": 48,
        "conductive": True,
        "space_grade": True,
        "finish_evidence": [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "4",
                "Finish",
                "Finish G is listed as Space-Grade Electroless Nickel with 48-hour salt spray.",
            ),
            evidence(
                "Eaton_D38999_Series_IV.pdf",
                "30",
                "Environmental, Shock, Vibration, and EMI/RFI",
                "Class G thermal vacuum outgassing is limited to 1.0% TML and 0.1% CVCM maximum.",
            ),
        ],
    },
    "J": {
        "shell_material": "composite",
        "finish": "olive drab cadmium",
        "temperature_range": DEFAULT_TEMPERATURE_RANGE,
        "temperature_specific": False,
        "salt_spray_hours": 2000,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "4",
                "Finish",
                "Composite shell class J is listed with olive drab cadmium and 2000-hour salt spray.",
            ),
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "28",
                "3.47 Hydrolytic stability",
                "Classes J and M have a dedicated hydrolytic stability qualification.",
            ),
        ],
    },
    "K": {
        "shell_material": "stainless steel",
        "finish": "passivated, firewall",
        "temperature_range": "-65C to +200C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": True,
        "firewall": True,
        "finish_evidence": [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Material and Finish Data",
                "Class K is a stainless steel shell, passivated, firewall, with 500-hour salt spray.",
            ),
            evidence(
                "Eaton_D38999_Series_IV.pdf",
                "30",
                "Environmental, Shock, Vibration, and EMI/RFI",
                "Finish class K provides 2000F firewall protection for 20 minutes minimum.",
            ),
        ],
    },
    "M": {
        "shell_material": "composite",
        "finish": "electroless nickel",
        "temperature_range": DEFAULT_TEMPERATURE_RANGE,
        "temperature_specific": False,
        "salt_spray_hours": 2000,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "4",
                "Finish",
                "Composite shell class M is listed with electroless nickel plating and 2000-hour salt spray.",
            ),
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "28",
                "3.47 Hydrolytic stability",
                "Classes J and M have a dedicated hydrolytic stability qualification.",
            ),
        ],
    },
    "N": {
        "shell_material": "unknown",
        "finish": "electrodeposited nickel",
        "temperature_range": DEFAULT_TEMPERATURE_RANGE,
        "temperature_specific": False,
        "salt_spray_hours": None,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "15",
                "3.3.6.2 Shells and accessory hardware",
                "Class N is listed with electrodeposited nickel finish in table II.",
            ),
        ],
    },
    "S": {
        "shell_material": "stainless steel",
        "finish": "electrodeposited nickel, firewall",
        "temperature_range": "-65C to +200C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": True,
        "firewall": True,
        "finish_evidence": [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Material and Finish Data",
                "Class S is a stainless steel shell with electrodeposited nickel, firewall, and 500-hour salt spray.",
            ),
        ],
    },
    "T": {
        "shell_material": "aluminum",
        "finish": "nickel PTFE / nickel fluorocarbon polymer",
        "temperature_range": "-65C to +175C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "4",
                "Finish",
                "Finish T is Nickel PTFE with 500-hour salt spray.",
            ),
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Operating Temperature Range / Material and Finish Data",
                "Class T is nickel fluorocarbon polymer and is listed at -65C to +175C.",
            ),
        ],
    },
    "W": {
        "shell_material": "aluminum",
        "finish": "olive drab cadmium over nickel base",
        "temperature_range": "-65C to +175C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Operating Temperature Range / Material and Finish Data",
                "Class W is olive drab cadmium over nickel base, -65C to +175C, with 500-hour salt spray.",
            ),
        ],
    },
    "Y": {
        "shell_material": "corrosion resistant steel",
        "finish": "passivated",
        "temperature_range": DEFAULT_TEMPERATURE_RANGE,
        "temperature_specific": False,
        "salt_spray_hours": None,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "15",
                "3.3.6.2 Shells and accessory hardware",
                "Class Y is listed as corrosion resistant steel, passivated.",
            ),
        ],
    },
    "Z": {
        "shell_material": "aluminum",
        "finish": "black zinc nickel / zinc nickel",
        "temperature_range": "-65C to +175C",
        "temperature_specific": True,
        "salt_spray_hours": 500,
        "conductive": True,
        "finish_evidence": [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "4",
                "Finish",
                "Finish Z is Black Zinc Nickel with 500-hour salt spray.",
            ),
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Operating Temperature Range / Material and Finish Data",
                "Class Z is zinc nickel and is listed at -65C to +175C.",
            ),
        ],
    },
}


def infer_series(slash_doc: dict[str, Any] | None, slash_sheet: str) -> str:
    if slash_doc and slash_doc.get("series"):
        return str(slash_doc["series"])
    if slash_sheet.startswith("/4"):
        return "IV"
    return "III"


def infer_coupling_type(slash_doc: dict[str, Any] | None, series: str) -> str:
    if slash_doc and slash_doc.get("coupling"):
        return str(slash_doc["coupling"])
    description = " ".join(
        str(part)
        for part in (
            slash_doc or {}
        ).values()
        if isinstance(part, str)
    ).lower()
    if "threaded" in description:
        return "threaded"
    if "breech" in description:
        return "breech"
    if "bayonet" in description:
        return "bayonet"
    if series == "III":
        return "threaded"
    if series == "IV":
        return "breech"
    return "unknown"


# Per MIL-DTL-38999 Table II (and the manufacturer catalogs), several class
# codes describe only the surface treatment ("Electrodeposited nickel") without
# naming the base shell material in the same paragraph that the standard
# definitions extractor captures. Without this override, those classes fall to
# "unknown" even though the spec is unambiguous: L/N/S are stainless steel
# firewall/non-firewall variants, R is corrosion resistant steel, B is marine
# bronze (Amphenol Series III). Keep this map narrow — only add a class once
# its base material is verified against dtl38999.pdf Table II or a published
# manufacturer catalog page.
CLASS_SHELL_MATERIAL_OVERRIDES: dict[str, str] = {
    "L": "stainless steel",
    "N": "stainless steel",
    "S": "stainless steel",
    "R": "corrosion resistant steel",
    "B": "marine bronze",
}


def infer_shell_material(description: str, class_code: str | None = None) -> str:
    if class_code and class_code in CLASS_SHELL_MATERIAL_OVERRIDES:
        return CLASS_SHELL_MATERIAL_OVERRIDES[class_code]
    lowered = description.lower()
    if "aluminum nickel bronze" in lowered:
        return "aluminum nickel bronze"
    if "composite" in lowered:
        return "composite"
    if "stainless steel" in lowered:
        return "stainless steel"
    if "corrosion resistant steel" in lowered:
        return "corrosion resistant steel"
    if "aluminum" in lowered:
        return "aluminum"
    return "unknown"


def fallback_class_metadata(class_code: str) -> dict[str, Any]:
    class_definition = CLASS_DEFINITIONS.get(class_code, {})
    description = str(class_definition.get("description", ""))
    return {
        "shell_material": infer_shell_material(description, class_code),
        "finish": description or "unknown",
        "temperature_range": DEFAULT_TEMPERATURE_RANGE,
        "temperature_specific": False,
        "salt_spray_hours": None,
        "conductive": "nonconductive" not in description.lower(),
        "finish_evidence": [
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                str(class_definition.get("source_page", "")) or "unknown",
                str(class_definition.get("section", "Table II")),
                description or f"Class {class_code} definition was not expanded beyond the MIL table reference.",
            )
        ],
    }


def class_metadata(class_code: str) -> dict[str, Any]:
    return CLASS_METADATA.get(class_code, fallback_class_metadata(class_code))


def shell_size(shell_size_code: str) -> str:
    code = str(shell_size_code or "")
    if code.isdigit():
        return code
    direct = SHELL_SIZE_CODES.get(code)
    if direct:
        return str(direct.get("shell_size", "unknown"))
    if code and SHELL_SIZE_CODES.get(code[0]):
        return str((SHELL_SIZE_CODES.get(code[0]) or {}).get("shell_size", "unknown"))
    return "unknown"


def contact_type(decoded: dict[str, Any], slash_doc: dict[str, Any] | None) -> str:
    contacts_text = " ".join(
        str(item)
        for item in (
            (slash_doc or {}).get("contacts", ""),
            (slash_doc or {}).get("description", ""),
        )
    ).lower()
    if " pins" in contacts_text or contacts_text.endswith("pins"):
        return "pin"
    if " sockets" in contacts_text or contacts_text.endswith("sockets"):
        return "socket"
    contact_style = str(decoded.get("contactStyle", ""))
    contact_definition = CONTACT_STYLE_DEFINITIONS.get(contact_style)
    if contact_definition:
        return str(contact_definition.get("contact_gender", "unknown"))
    return "unknown"


def shell_style(slash_doc: dict[str, Any] | None) -> str:
    if slash_doc is None:
        return "unknown"
    mount = str(slash_doc.get("mount", "")).strip()
    component = str(slash_doc.get("component", "")).strip()
    if mount and component and component not in mount:
        return f"{mount} {component}"
    return mount or component or "unknown"


def manufacturer_name(record: dict[str, Any]) -> str:
    manufacturers = record.get("manufacturers", []) or []
    if len(manufacturers) == 1:
        return str(manufacturers[0])
    if len(manufacturers) > 1:
        return "multiple"
    return "unknown"


def part_number_verified(record: dict[str, Any]) -> bool:
    source_presence = record.get("sourcePresence", {}) or {}
    return any(bool(value) for value in source_presence.values())


def slash_sheet_evidence(slash_doc: dict[str, Any] | None, page: str = "1") -> list[dict[str, str]]:
    if not slash_doc:
        return []
    description = str(slash_doc.get("description", "")).strip()
    if not description:
        return []
    return [
        evidence(
            str(slash_doc.get("file", "unknown")),
            page,
            "Detail specification sheet description",
            description,
        )
    ]


def series_aerospace_evidence(series: str) -> list[dict[str, str]]:
    if series == "III":
        return [
            evidence(
                "TE_Deutsch_D38999_Series_III.pdf",
                "1",
                "Cover",
                "The guide labels MIL-DTL-38999 Series III as aerospace, defense, and marine rugged harsh-environment connectors.",
            ),
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "2",
                "1.2.1 Connector series and types",
                "Series III is scoop-proof with triple-start, self-locking threaded coupling.",
            ),
        ]
    return [
        evidence(
            "Eaton_D38999_Series_IV.pdf",
            "4",
            "Series IV overview",
            "MIL-DTL-38999 Series III and IV solutions are offered as QPL, general purpose, hermetic, filtered, lanyard released, and Wing-Lok plugs for harsh environments.",
        ),
        evidence(
            "MIL-DTL-38999-dtl38999.pdf",
            "2",
            "1.2.1 Connector series and types",
            "Series IV is scoop-proof with breech coupling.",
        ),
    ]


def series_vibration_evidence(series: str) -> list[dict[str, str]]:
    if series == "III":
        return [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Shock and Vibration Requirements",
                "Wired, mated connectors are qualified to 300 G half-sine shock and severe sine/random vibration, including MIL-STD-1344 method 2005.",
            )
        ]
    return [
        evidence(
            "Eaton_D38999_Series_IV.pdf",
            "30",
            "Environmental, Shock, Vibration, and EMI/RFI",
            "All finish classes are listed at 30 g sine vibration, 50 g random vibration, and 300 g +/-15% shock.",
        )
    ]


def series_fluid_evidence(series: str, hermetic: bool) -> list[dict[str, str]]:
    if hermetic:
        return [
            evidence(
                "Conesys-Hermetic.pdf",
                "4",
                "Fluid Hydraulics",
                "Glass is described as inert and adapted to aggressive fluids such as fuel, oil, skydrol, cooling fluid, and de-icing fluid.",
            )
        ]
    if series == "III":
        return [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Fluid Resistance",
                "Connectors resist immersions in MIL-PRF-7808, MIL-PRF-23699, MIL-PRF-5606, JP-8, JP-4/JP-5, de-icing fluid, and cleaning agents.",
            )
        ]
    return [
        evidence(
            "Eaton_D38999_Series_IV.pdf",
            "30",
            "Environmental, Shock, Vibration, and EMI/RFI",
            "All finish classes are listed for immersion in various fuels, solvents, coolants, and oils.",
        )
    ]


def sealing_evidence(series: str, hermetic: bool) -> list[dict[str, str]]:
    if hermetic:
        return [
            evidence(
                "Conesys-Hermetic.pdf",
                "4",
                "Vacuum",
                "Glass-to-metal sealing technology is described as providing a barrier fully adapted to vacuum applications.",
            )
        ]
    if series == "III":
        return [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Environmental Seal",
                "Wired, mated connectors with specified accessories attached meet the altitude-immersion test in MIL-DTL-38999.",
            )
        ]
    return [
        evidence(
            "TE_Deutsch_D38999_Series_III.pdf",
            "2",
            "Features",
            "Series III connectors are listed as environmentally sealed; the family is used here as the environmental benchmark for the MIL-DTL-38999 builder.",
        ),
        evidence(
            "Eaton_D38999_Series_IV.pdf",
            "30",
            "Environmental, Shock, Vibration, and EMI/RFI",
            "All finish classes are listed with sand and dust and ice resistance in the environmental table.",
        ),
    ]


def dust_evidence() -> list[dict[str, str]]:
    return [
        evidence(
            "MIL-DTL-38999-dtl38999.pdf",
            "28",
            "3.45 Dust or fine sand",
            "Dust or fine sand qualification is applicable to series I, III, and IV connectors.",
        ),
        evidence(
            "MIL-DTL-38999-dtl38999.pdf",
            "56",
            "4.5.41 Dust (fine sand)",
            "Mated connectors are tested in accordance with MIL-STD-202 method 110.",
        ),
    ]


def base_spec_evidence() -> list[dict[str, str]]:
    return [
        evidence(
            "MIL-DTL-38999-dtl38999.pdf",
            "1",
            "Scope",
            "MIL-DTL-38999 covers environment-resistant circular connectors capable of operation from -65C to +200C.",
        )
    ]


def military_spec_evidence() -> list[dict[str, str]]:
    return [
        evidence(
            "MIL-DTL-38999-dtl38999.pdf",
            "1",
            "Scope",
            "The specification is approved for use by all Departments and Agencies of the Department of Defense.",
        )
    ]


def emi_evidence(series: str, emi_specific: bool, conductive: bool) -> list[dict[str, str]]:
    if emi_specific:
        return [
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "2",
                "1.2.1 Connector series and types",
                "Series III uses self-locking threaded coupling and Series IV uses breech coupling for harsh environments.",
            )
        ]
    if not conductive:
        return [
            evidence(
                "Eaton_D38999_Series_IV.pdf",
                "30",
                "Environmental, Shock, Vibration, and EMI/RFI",
                "Class C is listed with no EMI shielding.",
            )
        ]
    if series == "III":
        return [
            evidence(
                "Conesys-MIL-DTL-38999-Series-III.pdf",
                "unknown",
                "Shielding Effectiveness",
                "RFI and EMI attenuation meet MIL-DTL-38999 requirements; shielding effectiveness is measured on mated connectors with RFI backshells.",
            )
        ]
    return [
        evidence(
            "Eaton_D38999_Series_IV.pdf",
            "30",
            "Environmental, Shock, Vibration, and EMI/RFI",
            "Conductive finish classes are listed with EMI attenuation greater than 80 to 90 dB at 100 MHz and greater than 45 to 65 dB at 10 GHz.",
        )
    ]


def vacuum_evidence(hermetic: bool, space_grade: bool) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    if hermetic:
        items.append(
            evidence(
                "Conesys-Hermetic.pdf",
                "4",
                "Vacuum",
                "Glass-to-metal sealing technology provides a barrier fully adapted to vacuum applications.",
            )
        )
    if space_grade:
        items.append(
            evidence(
                "Eaton_D38999_Series_IV.pdf",
                "30",
                "Environmental, Shock, Vibration, and EMI/RFI",
                "Class G thermal vacuum outgassing is limited to 1.0% TML and 0.1% CVCM maximum.",
            )
        )
        items.append(
            evidence(
                "MIL-DTL-38999-dtl38999.pdf",
                "28",
                "3.46 Thermal vacuum outgassing",
                "Applicable connectors must keep total mass loss at or below 1.0% and collected volatile condensable material at or below 0.1%.",
            )
        )
    return items


def space_limitations() -> list[str]:
    return [
        "Full assembly outgassing still depends on backshells, wire insulation, potting, labels, and other added materials.",
        "No cryogenic qualification is asserted by this dataset.",
    ]


def make_context(record: dict[str, Any]) -> dict[str, Any]:
    decoded = record.get("decoded", {}) or {}
    slash_sheet = str(decoded.get("slashSheet", ""))
    slash_doc = SLASH_SHEETS.get(slash_sheet)
    series = infer_series(slash_doc, slash_sheet)
    class_code = str(decoded.get("class", ""))
    class_info = class_metadata(class_code)
    hermetic = bool(slash_doc and "hermetic" in str(slash_doc.get("description", "")).lower())
    emi_specific = slash_sheet in {"/29", "/30", "/46"}
    conductive = bool(class_info.get("conductive", True))
    description = str((slash_doc or {}).get("description", "")).lower()
    component = str((slash_doc or {}).get("component", "")).lower()
    mount = str((slash_doc or {}).get("mount", "")).lower()
    accessory = any(token in description or token in component or token in mount for token in ("cover", "dummy stowage", "mounting nut"))
    return {
        "record": record,
        "decoded": decoded,
        "slash_sheet": slash_sheet,
        "slash_doc": slash_doc,
        "series": series,
        "class_code": class_code,
        "class_info": class_info,
        "hermetic": hermetic,
        "emi_specific": emi_specific,
        "conductive": conductive,
        "salt_spray_hours": class_info.get("salt_spray_hours"),
        "space_grade": bool(class_info.get("space_grade")),
        "firewall": bool(class_info.get("firewall")),
        "accessory": accessory,
    }


def build_profiles(context: dict[str, Any]) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    if context["accessory"]:
        return [
            profile(
                "unknown_environment",
                "unknown",
                "low",
                "This valid D38999 record is a protective cover, dummy-stowage, or other accessory-style part, so connector environment suitability was not classified in this pass.",
                slash_sheet_evidence(context["slash_doc"]),
                limitations=["Retained in the valid part number database for auditability, but excluded from connector-environment filtering."],
            )
        ]

    series = context["series"]
    class_info = context["class_info"]
    class_code = context["class_code"]
    hermetic = context["hermetic"]
    emi_specific = context["emi_specific"]
    conductive = context["conductive"]
    salt_spray_hours = context["salt_spray_hours"]
    space_grade = context["space_grade"]

    profiles.append(
        profile(
            "aerospace_general",
            "recommended",
            "high",
            "Series-level MIL-DTL-38999 evidence supports aerospace harsh-environment use.",
            series_aerospace_evidence(series),
        )
    )
    profiles.append(
        profile(
            "aircraft_fixed_wing",
            "recommended",
            "medium",
            "Shock, vibration, and aerospace-focused coupling systems support fixed-wing applications.",
            series_aerospace_evidence(series) + series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "land_general",
            "recommended",
            "high",
            "Rugged environmental qualification supports general land use.",
            base_spec_evidence() + series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "land_military",
            "recommended",
            "high",
            "The connector family is a DoD specification with military environmental qualification.",
            military_spec_evidence() + series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "land_vehicle",
            "acceptable",
            "medium",
            "Shock, vibration, dust, and fluid qualification support harsh ground-vehicle use.",
            series_vibration_evidence(series) + dust_evidence() + series_fluid_evidence(series, hermetic),
        )
    )
    profiles.append(
        profile(
            "desert_dust",
            "conditional",
            "high",
            "Dust/fine-sand qualification exists for mated connectors, but the evidence is for qualified, mated hardware rather than open interfaces.",
            dust_evidence(),
            required_conditions=["Connector pair should be used in the qualified mated condition."],
            limitations=["Unmated connector interfaces are not represented by the dust/fine-sand qualification."],
        )
    )
    profiles.append(
        profile(
            "high_vibration",
            "recommended",
            "high",
            "Series qualification includes severe sine and random vibration testing.",
            series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "high_shock",
            "recommended",
            "high",
            "Series qualification includes 300 G shock performance.",
            series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "industrial",
            "recommended",
            "high",
            "Harsh-environment sealing, shock/vibration, and fluid resistance support industrial service.",
            series_fluid_evidence(series, hermetic) + series_vibration_evidence(series),
        )
    )
    profiles.append(
        profile(
            "fuel_oil_hydraulic_exposure",
            "recommended",
            "high",
            "The cited catalogs list qualified resistance to fuels, oils, coolants, and hydraulic media.",
            series_fluid_evidence(series, hermetic),
        )
    )
    profiles.append(
        profile(
            "low_temperature",
            "recommended",
            "high",
            "The MIL-DTL-38999 family is cited down to -65C.",
            base_spec_evidence(),
        )
    )

    temperature_range = str(class_info.get("temperature_range") or DEFAULT_TEMPERATURE_RANGE)
    if class_info.get("temperature_specific") and ("+200" in temperature_range or "200C" in temperature_range):
        profiles.append(
            profile(
                "high_temperature",
                "recommended",
                "medium",
                "This finish/class is cited to +200C.",
                class_info["finish_evidence"],
            )
        )
    elif class_info.get("temperature_specific") and ("+175" in temperature_range or "175C" in temperature_range):
        profiles.append(
            profile(
                "high_temperature",
                "acceptable",
                "medium",
                "This finish/class is cited to +175C rather than the full +200C family maximum.",
                class_info["finish_evidence"],
            )
        )

    if hermetic:
        profiles.append(
            profile(
                "sealed_weatherproof",
                "conditional",
                "medium",
                "The hermetic shell body is sealed, but full weatherproof performance still depends on the mating half and cable-side sealing.",
                sealing_evidence(series, hermetic) + slash_sheet_evidence(context["slash_doc"]),
                required_conditions=["Seal the mating interface and rear cable interface in the installed assembly."],
                limitations=["Hermetic body sealing does not by itself qualify the full cable assembly for immersion."],
            )
        )
    else:
        profiles.append(
            profile(
                "sealed_weatherproof",
                "conditional",
                "high",
                "Environmental sealing is documented only for wired, mated connectors with specified accessories attached.",
                sealing_evidence(series, hermetic),
                required_conditions=[
                    "Use the connector in the cited wired, mated condition.",
                    "Install the specified backshells, sealing plugs, and related accessories.",
                ],
                limitations=["No immersion rating is asserted in the cited sources."],
            )
        )

    if salt_spray_hours == 2000:
        profiles.extend(
            [
                profile(
                    "salt_fog",
                    "recommended",
                    "high",
                    "This finish/material combination is explicitly listed for 2000-hour salt spray.",
                    class_info["finish_evidence"],
                ),
                profile(
                    "coastal",
                    "recommended",
                    "high",
                    "The finish/material combination has strong corrosion evidence for coastal use.",
                    class_info["finish_evidence"],
                ),
                profile(
                    "marine_above_deck",
                    "acceptable",
                    "medium",
                    "Corrosion performance is strong, but marine deployment still depends on a sealed mated assembly.",
                    class_info["finish_evidence"] + sealing_evidence(series, hermetic),
                    required_conditions=["Use the connector mated and fully sealed in service."],
                    limitations=["No long-term immersion claim is asserted in the cited sources."],
                ),
                profile(
                    "outdoor_exposed",
                    "recommended",
                    "high",
                    "The combination of 2000-hour salt spray and environmental sealing supports exposed outdoor use.",
                    class_info["finish_evidence"] + sealing_evidence(series, hermetic),
                ),
            ]
        )
    elif salt_spray_hours == 500:
        profiles.extend(
            [
                profile(
                    "salt_fog",
                    "acceptable",
                    "high",
                    "This finish/material combination is explicitly listed for 500-hour salt spray.",
                    class_info["finish_evidence"],
                ),
                profile(
                    "coastal",
                    "acceptable",
                    "medium",
                    "500-hour salt-spray performance supports coastal exposure better than standard nickel classes.",
                    class_info["finish_evidence"],
                ),
                profile(
                    "marine_above_deck",
                    "conditional",
                    "medium",
                    "Marine use is finish-capable, but only when the connector is mated and sealed with the correct accessories.",
                    class_info["finish_evidence"] + sealing_evidence(series, hermetic),
                    required_conditions=["Use corrosion-resistant finish exactly as specified.", "Use a mated, sealed assembly with appropriate backshells and sealing plugs."],
                    limitations=["The cited evidence does not support long-term immersion or underwater service."],
                ),
                profile(
                    "outdoor_exposed",
                    "acceptable",
                    "medium",
                    "Outdoor exposure is supported when the corrosion-resistant finish is paired with proper sealing.",
                    class_info["finish_evidence"] + sealing_evidence(series, hermetic),
                    required_conditions=["Seal the installed assembly."],
                ),
            ]
        )
    elif salt_spray_hours == 48:
        profiles.extend(
            [
                profile(
                    "salt_fog",
                    "not_recommended",
                    "high",
                    "This finish is only cited for 48-hour salt spray and is weaker than the 500-hour and 2000-hour options for marine corrosion exposure.",
                    class_info["finish_evidence"],
                    limitations=["Prefer higher-corrosion classes for sustained salt-fog or marine exposure."],
                ),
                profile(
                    "outdoor_exposed",
                    "conditional",
                    "medium",
                    "Outdoor use is possible, but corrosion margin is limited compared with higher salt-spray finishes.",
                    class_info["finish_evidence"] + sealing_evidence(series, hermetic),
                    required_conditions=["Use full sealing accessories and manage corrosion exposure."],
                    limitations=["Not a strong fit for sustained salt-fog or marine-above-deck service."],
                ),
            ]
        )

    if emi_specific:
        profiles.append(
            profile(
                "high_emi_rfi",
                "recommended",
                "high",
                "This slash sheet explicitly requires or identifies EMI grounding features.",
                slash_sheet_evidence(context["slash_doc"], page="2") + emi_evidence(series, emi_specific, conductive),
            )
        )
    elif conductive:
        profiles.append(
            profile(
                "high_emi_rfi",
                "conditional",
                "high",
                "EMI/RFI performance is documented for conductive finishes, but shielding effectiveness is measured on mated connectors with RFI backshells or equivalent shield terminations.",
                emi_evidence(series, emi_specific, conductive),
                required_conditions=["Use conductive shell finishes.", "Terminate the cable shield with an appropriate RFI backshell or shield termination accessory."],
            )
        )
    else:
        profiles.append(
            profile(
                "high_emi_rfi",
                "not_recommended",
                "high",
                "The cited finish/class is explicitly nonconductive and is listed with no EMI shielding.",
                emi_evidence(series, emi_specific, conductive),
            )
        )

    if space_grade:
        profiles.append(
            profile(
                "space",
                "acceptable",
                "high",
                "Space-grade plating and thermal vacuum outgassing evidence exist for this class, but full assembly screening is still required.",
                vacuum_evidence(hermetic, space_grade) + class_info["finish_evidence"],
                required_conditions=["Verify the complete assembly, including backshells, wire insulation, potting, and labels, against mission outgassing limits."],
                limitations=space_limitations(),
            )
        )
    if hermetic or space_grade:
        profiles.append(
            profile(
                "vacuum",
                "acceptable",
                "medium",
                "Vacuum use is supported either by hermetic glass-to-metal sealing or by explicit thermal vacuum outgassing limits.",
                vacuum_evidence(hermetic, space_grade),
                required_conditions=["Match the vacuum-side connector design to the intended installation and verify all added materials."],
                limitations=["Vacuum evidence does not automatically qualify the connector for full space-flight use."] if hermetic and not space_grade else space_limitations(),
            )
        )

    if hermetic:
        profiles.append(
            profile(
                "industrial",
                "recommended",
                "high",
                "The hermetic catalog explicitly cites severe industrial environments, fuel systems, and pressure/vacuum service.",
                series_fluid_evidence(series, hermetic) + vacuum_evidence(hermetic, space_grade),
            )
        )

    if class_code in {"K", "S"}:
        profiles.append(
            profile(
                "high_temperature",
                "recommended",
                "medium",
                "Firewall stainless classes are the strongest high-temperature option in the cited material set.",
                class_info["finish_evidence"],
                limitations=["Do not assume firewall suitability for unsupported special contact systems or cable accessories."],
            )
        )

    return unique_profiles(profiles)


def environment_tags_from_profiles(profiles: list[dict[str, Any]]) -> list[str]:
    return ordered_tags(
        [profile_item["environment"] for profile_item in profiles if profile_item["suitability"] in POSITIVE_SUITABILITIES]
    )


def environment_score(profiles: list[dict[str, Any]]) -> dict[str, int]:
    score = {"land": 0, "sea": 0, "air": 0, "space": 0, "industrial": 0}
    for filter_key, tags in SCORE_GROUPS.items():
        max_value = 0
        for profile_item in profiles:
            if profile_item["environment"] not in tags:
                continue
            max_value = max(max_value, SCORE_BY_SUITABILITY[profile_item["suitability"]])
        score[filter_key] = max_value
    return score


def feature_lists(context: dict[str, Any]) -> dict[str, list[str]]:
    series = context["series"]
    hermetic = context["hermetic"]
    slash_doc = context["slash_doc"] or {}
    class_info = context["class_info"]
    class_code = context["class_code"]
    coupling = infer_coupling_type(context["slash_doc"], series)
    sealing_features: list[str] = []
    emi_rfi_features: list[str] = []
    corrosion_features: list[str] = []
    vibration_shock_features: list[str] = []
    fluid_resistance: list[str] = []
    space_vacuum_features: list[str] = []

    if context["accessory"]:
        corrosion_features.append(f"class {class_code} finish: {class_info['finish']}")
        return {
            "sealing_features": [],
            "emi_rfi_features": [],
            "corrosion_features": unique_strings(corrosion_features),
            "vibration_shock_features": [],
            "fluid_resistance": [],
            "space_vacuum_features": [],
        }

    if hermetic:
        sealing_features.extend(["hermetic solder contacts", "glass-to-metal seal barrier"])
    else:
        sealing_features.extend([
            "environmentally sealed when wired, mated, and fitted with specified accessories",
            "altitude-immersion qualified in the mated condition",
        ])
    if context["emi_specific"]:
        emi_rfi_features.append("EMI grounding feature required by slash sheet")
    elif context["conductive"]:
        emi_rfi_features.extend([
            "conductive shell finish",
            "shielding effectiveness measured on mated connectors with RFI backshells or equivalent shield terminations",
        ])
    else:
        emi_rfi_features.append("nonconductive finish; no EMI shielding cited")

    salt_spray_hours = class_info.get("salt_spray_hours")
    if salt_spray_hours:
        corrosion_features.append(f"{salt_spray_hours}-hour salt spray")
    corrosion_features.append(f"class {class_code} finish: {class_info['finish']}")
    vibration_shock_features.extend([
        "300 G half-sine shock, 3 +/- 1 ms",
        "qualified sine/random vibration performance",
        f"{coupling} coupling",
    ])
    if context["firewall"]:
        vibration_shock_features.append("firewall stainless construction")

    if hermetic:
        fluid_resistance.extend([
            "fuel",
            "oil",
            "skydrol / hydraulic fluid",
            "cooling fluid",
            "de-icing fluid",
        ])
    else:
        fluid_resistance.extend([
            "MIL-PRF-7808 oil",
            "MIL-PRF-23699 oil",
            "MIL-PRF-5606 hydraulic fluid",
            "JP-8 / JP-4 / JP-5 fuels",
            "de-icing fluid",
            "cleaning agents",
        ])

    if context["space_grade"]:
        space_vacuum_features.extend([
            "space-grade electroless nickel finish",
            "thermal vacuum outgassing 1.0% TML / 0.1% CVCM max",
        ])
    if hermetic:
        space_vacuum_features.append("glass-to-metal seal barrier adapted to vacuum")

    return {
        "sealing_features": unique_strings(sealing_features),
        "emi_rfi_features": unique_strings(emi_rfi_features),
        "corrosion_features": unique_strings(corrosion_features),
        "vibration_shock_features": unique_strings(vibration_shock_features),
        "fluid_resistance": unique_strings(fluid_resistance),
        "space_vacuum_features": unique_strings(space_vacuum_features),
    }


def environment_notes(profiles: list[dict[str, Any]], score: dict[str, int]) -> str:
    if profiles and all(item["environment"] == "unknown_environment" for item in profiles):
        return "Valid D38999 accessory or dummy-stowage part number retained in the database; connector environment suitability was not classified in this pass."

    notes: list[str] = []
    if score["air"] >= 4:
        notes.append("Suitable for aerospace and high-vibration service.")
    if score["land"] >= 4:
        notes.append("Well matched to military and rugged land/vehicle environments.")
    if score["sea"] >= 4:
        notes.append("Selected finish supports coastal or salt-fog exposure.")
    elif score["sea"] == 3:
        notes.append("Marine use is conditional on corrosion-resistant finish and full sealing.")
    elif any(item["environment"] == "salt_fog" and item["suitability"] == "not_recommended" for item in profiles):
        notes.append("This finish is weak for sustained salt-fog exposure.")
    if score["industrial"] >= 4:
        notes.append("Industrial fluid exposure and outdoor use are supported within the stated conditions.")
    if score["space"] >= 4:
        notes.append("Space or vacuum evidence is explicit for this class or shell style.")
    elif any(item["environment"] == "vacuum" and item["suitability"] in POSITIVE_SUITABILITIES for item in profiles):
        notes.append("Vacuum suitability is documented, but full space-flight screening still depends on the complete assembly.")
    else:
        notes.append("No explicit space-grade evidence was attached to this record.")
    return " ".join(notes)


def report_record(record: dict[str, Any]) -> dict[str, Any]:
    context = make_context(record)
    decoded = context["decoded"]
    slash_doc = context["slash_doc"]
    class_info = context["class_info"]
    profiles = build_profiles(context)
    compact_profiles = [compact_profile(item) for item in profiles]
    tags = environment_tags_from_profiles(profiles)
    score = environment_score(profiles)
    notes = environment_notes(profiles, score)
    features = feature_lists(context)
    return {
        "manufacturer": manufacturer_name(record),
        "series": f"Series {context['series']}",
        "standard": f"MIL-DTL-38999 Series {context['series']}",
        "part_number": record.get("partNumber", ""),
        "part_number_verified": part_number_verified(record),
        "shell_style": shell_style(slash_doc),
        "shell_size": shell_size(str(decoded.get("shellSizeCode", ""))),
        "insert_arrangement": str(decoded.get("insertArrangement", "unknown")),
        "contact_type": contact_type(decoded, slash_doc),
        "shell_material": str(class_info.get("shell_material", "unknown")),
        "finish": str(class_info.get("finish", "unknown")),
        "coupling_type": infer_coupling_type(slash_doc, context["series"]),
        "temperature_range": str(class_info.get("temperature_range") or DEFAULT_TEMPERATURE_RANGE),
        "sealing_features": features["sealing_features"],
        "emi_rfi_features": features["emi_rfi_features"],
        "corrosion_features": features["corrosion_features"],
        "vibration_shock_features": features["vibration_shock_features"],
        "fluid_resistance": features["fluid_resistance"],
        "space_vacuum_features": features["space_vacuum_features"],
        "environment_tags": tags,
        "environment_score": score,
        "environment_profiles": compact_profiles,
        "environment_notes": notes,
    }


def lightweight_environment_fields(record: dict[str, Any]) -> dict[str, Any]:
    connector = report_record(record)
    return {
        "environment_tags": connector["environment_tags"],
        "environment_score": connector["environment_score"],
        "environment_notes": connector["environment_notes"],
    }


def build_environment_outputs(part_numbers: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, int]]:
    connector_records: list[dict[str, Any]] = []
    lightweight_records: list[dict[str, Any]] = []
    tag_counts: dict[str, int] = {}

    for record in part_numbers:
        connector = report_record(record)
        connector_records.append(connector)
        lightweight_records.append(
            {
                "environment_tags": connector["environment_tags"],
                "environment_score": connector["environment_score"],
                "environment_notes": connector["environment_notes"],
            }
        )
        for tag in connector["environment_tags"]:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    return (
        lightweight_records,
        {
            "report_format": "compact_audit_v1",
            "report_notes": "Per-profile evidence quotes are omitted from this checked-in audit report to keep repository artifacts under GitHub's file-size limit. Supporting evidence remains encoded in scripts/d38999_environment.py and the cited source documents.",
            "connector_records": connector_records,
            "environment_filter_definitions": ENVIRONMENT_FILTER_DEFINITIONS,
        },
        dict(sorted(tag_counts.items())),
    )