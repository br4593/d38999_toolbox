from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from d38999_environment import build_environment_outputs, ENVIRONMENT_FILTER_DEFINITIONS
from dataset_io import write_sharded_dataset, data_path
from d38999_rules import parse_d38999_pin


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DEFAULT_OUTPUT = data_path("d38999_valid_part_numbers.json")
DEFAULT_ENVIRONMENT_OUTPUT = data_path("d38999_environment_classification.json")

SHELL25_LANYARD_RE = re.compile(
    r"^D38999/(?P<slashSheet>31|36)(?P<class>[A-Z])(?P<lanyardLengthCode>[A-Z])(?P<insertArrangement>\d{1,3})(?P<contactStyle>[A-Z])(?P<keying>[A-Z])(?P<typeNumber>\d)$"
)
DUMMY_STOWAGE_RE = re.compile(
    r"^D38999/(?P<slashSheet>22|50)(?P<shellSizeCode>[A-HJ](?:\d)?)(?P<class>[A-Z])$"
)
PROTECTIVE_COVER_RE = re.compile(
    r"^D38999/(?P<slashSheet>32|33|51|52)(?P<class>[A-Z])(?P<shellSizeNumber>\d{1,2})(?P<keying>[A-Z])$"
)
SHELL_SIZE_NUMBER_TO_CODE = {
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

# Documented MIL-DTL-38999 contact style letters (Table III, section 1.4.2).
# Any standard D38999 part number must end in (contactStyle)(keying) where
# contactStyle is one of these. PNs scraped from secondary sources whose
# trailing two characters do not match (e.g. digits, undocumented letters)
# are dropped from the validated dataset to avoid downstream classifiers
# claiming things the spec does not define.
KNOWN_CONTACT_STYLES = set("PSHJXZCDRMGUAB")
KNOWN_SHELL_SIZE_CODES = set(SHELL_SIZE_NUMBER_TO_CODE.values())

# Valid keying (polarization) letters per series, from MIL-DTL-38999 Figures 6 &
# 7. Series III (/20-/27) uses N,A,B,C,D,E; Series IV (/40-/49) uses
# N,A,B,C,D,K,L,M,R. Part numbers whose trailing keying letter is illegal for
# their series (e.g. a finish code W or Z scraped into the keying slot) are
# dropped so downstream tools never suggest a key the spec does not define.
SERIES_III_SLASH_SHEETS = {"/20", "/21", "/23", "/24", "/25", "/26", "/27"}
SERIES_IV_SLASH_SHEETS = {"/40", "/41", "/42", "/43", "/44", "/45", "/46", "/47", "/48", "/49"}
SERIES_III_KEYING = set("NABCDE")
SERIES_IV_KEYING = set("NABCDKLMR")
KNOWN_KEYING_LETTERS = SERIES_III_KEYING | SERIES_IV_KEYING  # N,A,B,C,D,E,K,L,M,R


def keying_letter_valid(slash_sheet: str | None, keying: str | None) -> bool:
    """True if ``keying`` is a legal polarization letter for the connector series.

    Accessory / cover / lanyard sheets (not in the Series III or IV environmental
    sets) are checked against the union of known letters, so obvious typos are
    still rejected without dropping a legitimate series-specific key.
    """
    if not keying:
        return True
    if slash_sheet in SERIES_III_SLASH_SHEETS:
        return keying in SERIES_III_KEYING
    if slash_sheet in SERIES_IV_SLASH_SHEETS:
        return keying in SERIES_IV_KEYING
    return keying in KNOWN_KEYING_LETTERS


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_part_number(part_number: str) -> str:
    return re.sub(r"[^A-Z0-9/]", "", (part_number or "").upper())


def canonical_part_number(part_number: str) -> str:
    return re.sub(r"\s+", "", (part_number or "").upper())


def decode_part_number(part_number: str) -> dict[str, str] | None:
    try:
        parsed = parse_d38999_pin(part_number)
    except ValueError:
        parsed = None
    if parsed is not None:
        return {
            "slashSheet": f"/{parsed.shell_type}",
            "class": parsed.service_class,
            "shellSizeCode": parsed.shell_size_code,
            "insertArrangement": parsed.insert,
            "contactStyle": parsed.contact,
            "keying": parsed.key,
        }

    match = SHELL25_LANYARD_RE.match(part_number)
    if match:
        decoded = match.groupdict()
        decoded["slashSheet"] = f"/{decoded['slashSheet']}"
        decoded["shellSizeCode"] = "J"
        decoded["shellSize"] = "25"
        return decoded

    match = DUMMY_STOWAGE_RE.match(part_number)
    if match:
        decoded = match.groupdict()
        decoded["slashSheet"] = f"/{decoded['slashSheet']}"
        return decoded

    match = PROTECTIVE_COVER_RE.match(part_number)
    if match:
        decoded = match.groupdict()
        decoded["slashSheet"] = f"/{decoded['slashSheet']}"
        decoded["shellSizeCode"] = SHELL_SIZE_NUMBER_TO_CODE.get(decoded["shellSizeNumber"], "")
        return decoded

    return None


def is_d38999_part_number(part_number: str) -> bool:
    decoded = decode_part_number(canonical_part_number(part_number))
    if decoded is None:
        return False
    contact_style = decoded.get("contactStyle")
    if contact_style is not None and contact_style not in KNOWN_CONTACT_STYLES:
        return False
    shell_size_code = decoded.get("shellSizeCode")
    if shell_size_code is not None and shell_size_code and shell_size_code not in KNOWN_SHELL_SIZE_CODES:
        return False
    if not keying_letter_valid(decoded.get("slashSheet"), decoded.get("keying")):
        return False
    return True


def base_record(part_number: str) -> dict[str, Any]:
    canonical = canonical_part_number(part_number)
    return {
        "partNumber": canonical,
        "normalizedPartNumber": normalize_part_number(canonical),
        "decoded": decode_part_number(canonical),
        "nsn": "",
        "sourcePresence": {
            "manufacturerVerified": False,
            "catalogExample": False,
            "federalConnectorsExact": False,
            "federalConnectorsImportable": False,
            "qpl": False,
            "qplQualified": False,
        },
        "qpls": [],
        "manufacturers": [],
        "qualifiedSources": [],
        "sources": [],
        "evidenceLevel": "",
    }


def append_unique(target: list[Any], value: Any) -> None:
    if value not in target:
        target.append(value)


def merge_manufacturer(record: dict[str, Any], manufacturer: str) -> None:
    if manufacturer:
        append_unique(record["manufacturers"], manufacturer)


def evidence_level(source_presence: dict[str, bool]) -> str:
    if source_presence["manufacturerVerified"]:
        return "manufacturer_verified_exact"
    if source_presence["qpl"] and source_presence["federalConnectorsExact"]:
        return "qpl_and_secondary_exact"
    if source_presence.get("qplQualified"):
        return "qpl_qualified_source"
    if source_presence["qpl"]:
        return "qpl_listed"
    if source_presence["federalConnectorsImportable"]:
        return "secondary_exact_supported"
    if source_presence["federalConnectorsExact"]:
        return "secondary_exact"
    if source_presence["catalogExample"]:
        return "catalog_example_exact"
    return "other"


def load_verified(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(data_path("d38999_verified_part_numbers.json"))
    for entry in payload.get("verifiedPartNumbers", []):
        part_number = entry.get("partNumber", "")
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["manufacturerVerified"] = True
        merge_manufacturer(record, entry.get("manufacturer", ""))
        append_unique(
            record["sources"],
            {
                "type": "manufacturer_verified",
                "manufacturer": entry.get("manufacturer", ""),
                "series": entry.get("series", ""),
                "citation": entry.get("source", ""),
            },
        )


def load_examples(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(data_path("d38999_part_number_examples.json"))
    for entry in payload.get("examples", []):
        part_number = entry.get("originalPartNumber", "")
        if not entry.get("exactPartNumberAppears"):
            continue
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["catalogExample"] = True
        merge_manufacturer(record, entry.get("manufacturer", ""))
        append_unique(
            record["sources"],
            {
                "type": "catalog_example",
                "manufacturer": entry.get("manufacturer", ""),
                "series": entry.get("series", ""),
                "sourcePdf": entry.get("sourcePdf", ""),
                "sourcePage": entry.get("sourcePage", ""),
                "validationStatus": entry.get("validationStatus", ""),
                "notes": entry.get("notes", ""),
            },
        )


def load_federal_connectors(records: dict[str, dict[str, Any]]) -> None:
    payload = read_json(data_path("d38999_federalconnectors_secondary_source.json"))
    importable_map = {
        normalize_part_number(item.get("partNumber", "")): item
        for item in payload.get("importableOverlaps", [])
        if item.get("partNumber")
    }
    for entry in payload.get("entries", []):
        part_number = entry.get("partNumber", "")
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["federalConnectorsExact"] = True
        importable = importable_map.get(normalized)
        if importable:
          record["sourcePresence"]["federalConnectorsImportable"] = True
        append_unique(
            record["sources"],
            {
                "type": "federalconnectors_exact",
                "sourcePage": entry.get("sourcePage", ""),
                "productUrl": entry.get("productUrl", ""),
                "eligibleImport": bool(entry.get("crossCheck", {}).get("eligibleImport")) or bool(importable),
                "manufacturerSupportSources": (entry.get("crossCheck", {}) or {}).get("manufacturerSupportSources", []),
            },
        )


def load_qpl_details(records: dict[str, dict[str, Any]]) -> str | None:
    """Ingest the rich QPL detail crawl (per-part NSN + qualified sources)."""
    path = data_path("qpl_1122_part_details.json")
    if not path.exists():
        return None
    payload = read_json(path)
    qpl_id = str(payload.get("qpl", "1122"))
    source_url = payload.get("source", "")
    scraped_at = payload.get("scraped_at", "")
    for entry in payload.get("parts", []):
        part_number = entry.get("partNumber", "")
        if not is_d38999_part_number(part_number):
            continue
        normalized = normalize_part_number(part_number)
        record = records.setdefault(normalized, base_record(part_number))
        record["sourcePresence"]["qpl"] = True
        append_unique(record["qpls"], qpl_id)
        nsn = (entry.get("nsn") or "").strip()
        if nsn:
            record["nsn"] = nsn
        qualified = []
        for src in entry.get("qualifiedSources") or []:
            qualified.append(
                {
                    "cage": src.get("cage", ""),
                    "company": src.get("company", ""),
                    "country": src.get("country", ""),
                    "mfgPart": src.get("mfgPart", ""),
                    "status": src.get("status", ""),
                }
            )
        if qualified:
            record["qualifiedSources"] = qualified
            record["sourcePresence"]["qplQualified"] = True
        append_unique(
            record["sources"],
            {
                "type": "qpl_detail",
                "qpl": qpl_id,
                "source": source_url,
                "scrapedAt": scraped_at,
                "file": path.name,
                "qualifiedSourceCount": len(qualified),
                "nsn": nsn,
            },
        )
    return path.name


def load_qpl_files(records: dict[str, dict[str, Any]]) -> list[str]:
    qpl_files = sorted((DATA_DIR / "qpl").glob("qpl_*_part_numbers.json"))
    used: list[str] = []
    for path in qpl_files:
        details_path = path.with_name(
            path.name.replace("_part_numbers.json", "_part_details.json")
        )
        if details_path.exists():
            # Richer detail crawl supersedes the bare list; handled separately.
            continue
        payload = read_json(path)
        qpl_id = str(payload.get("qpl", ""))
        qpl_source = payload.get("source", "")
        scraped_at = payload.get("scraped_at", "")
        for part_number in payload.get("part_numbers", []):
            if not is_d38999_part_number(part_number):
                continue
            normalized = normalize_part_number(part_number)
            record = records.setdefault(normalized, base_record(part_number))
            record["sourcePresence"]["qpl"] = True
            append_unique(record["qpls"], qpl_id)
            append_unique(
                record["sources"],
                {
                    "type": "qpl",
                    "qpl": qpl_id,
                    "source": qpl_source,
                    "scrapedAt": scraped_at,
                    "file": path.name,
                },
            )
        used.append(path.name)
    return used


def finalize(records: dict[str, dict[str, Any]], qpl_files: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    part_numbers = sorted(records.values(), key=lambda item: item["partNumber"])
    counts = Counter()
    for record in part_numbers:
        record["manufacturers"].sort()
        record["qpls"].sort()
        record["evidenceLevel"] = evidence_level(record["sourcePresence"])
        counts[record["evidenceLevel"]] += 1

    environment_fields, environment_report, environment_tag_counts = build_environment_outputs(part_numbers)
    for record, enrichment in zip(part_numbers, environment_fields):
        record.update(enrichment)

    summary = {
        "uniquePartNumbers": len(part_numbers),
        "sourceCounts": {
            "manufacturerVerified": sum(1 for record in part_numbers if record["sourcePresence"]["manufacturerVerified"]),
            "catalogExample": sum(1 for record in part_numbers if record["sourcePresence"]["catalogExample"]),
            "federalConnectorsExact": sum(1 for record in part_numbers if record["sourcePresence"]["federalConnectorsExact"]),
            "federalConnectorsImportable": sum(1 for record in part_numbers if record["sourcePresence"]["federalConnectorsImportable"]),
            "qpl": sum(1 for record in part_numbers if record["sourcePresence"]["qpl"]),
            "qplQualified": sum(1 for record in part_numbers if record["sourcePresence"].get("qplQualified")),
        },
        "partsWithNsn": sum(1 for record in part_numbers if record.get("nsn")),
        "partsWithQualifiedSource": sum(1 for record in part_numbers if record.get("qualifiedSources")),
        "evidenceLevelCounts": dict(sorted(counts.items())),
        "qplFiles": qpl_files,
        "environmentTagCounts": environment_tag_counts,
    }

    payload = {
        "schema_version": "2026-05-20",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "description": "Unified database of valid MIL D38999 part numbers built from all PN-bearing JSON datasets in the repository.",
        "inputs": {
            "manufacturerVerified": "data/part_numbers/d38999_verified_part_numbers.json",
            "catalogExamples": "data/part_numbers/d38999_part_number_examples.json",
            "federalConnectors": "data/part_numbers/d38999_federalconnectors_secondary_source.json",
            "qplFiles": qpl_files,
        },
        "summary": summary,
        "environment_filter_definitions": ENVIRONMENT_FILTER_DEFINITIONS,
        "partNumbers": part_numbers,
    }
    return payload, environment_report


def build_outputs() -> tuple[dict[str, Any], dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    load_verified(records)
    load_examples(records)
    load_federal_connectors(records)
    qpl_files = load_qpl_files(records)
    qpl_details_file = load_qpl_details(records)
    if qpl_details_file:
        qpl_files = qpl_files + [qpl_details_file]
    return finalize(records, qpl_files)


def build_payload() -> dict[str, Any]:
    payload, _ = build_outputs()
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a unified database of valid D38999 part numbers from repository PN datasets.")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Output JSON path (defaults to data/d38999_valid_part_numbers.json).",
    )
    parser.add_argument(
        "--environment-output",
        default=str(DEFAULT_ENVIRONMENT_OUTPUT),
        help="Output JSON path for environment classification report (defaults to data/d38999_environment_classification.json).",
    )
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    environment_output_path = Path(args.environment_output).resolve()
    payload, environment_report = build_outputs()
    # These datasets exceed GitHub's 50 MiB warning / 100 MiB hard limit, so they
    # are written as size-bounded shard directories (see scripts/dataset_io.py).
    output_dir = write_sharded_dataset(
        output_path, payload, "partNumbers", indent=2
    )
    environment_output_dir = write_sharded_dataset(
        environment_output_path, environment_report, "connector_records"
    )
    print(f"Wrote {payload['summary']['uniquePartNumbers']} unified valid D38999 part numbers to {output_dir}/")
    print(f"Wrote {len(environment_report['connector_records'])} environment-classified connector records to {environment_output_dir}/")


if __name__ == "__main__":
    main()