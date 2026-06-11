#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from build_valid_d38999_pns import build_outputs
from dataset_io import load_dataset, data_path
from d38999_environment import (
    CLASS_DEFINITIONS,
    CONTACT_STYLE_DEFINITIONS,
    ENVIRONMENT_FILTER_DEFINITIONS,
    SHELL_SIZE_CODES,
    SLASH_SHEETS,
    TAG_ORDER,
    make_context,
    report_record,
)


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DOCS_PDF_DIR = ROOT / "docs" / "pdfs"

VALID_DATA_PATH = data_path("d38999_valid_part_numbers.json")
ENVIRONMENT_REPORT_PATH = data_path("d38999_environment_classification.json")
MANIFEST_PATH = DOCS_PDF_DIR / "manifest.json"
DLA_DOCUMENTS_PATH = data_path("dla_documents.json")

PART_FIELDS_TO_COMPARE = (
    "environment_tags",
    "environment_score",
    "environment_notes",
)

REPORT_FIELDS_TO_COMPARE = (
    "series",
    "shell_style",
    "shell_size",
    "insert_arrangement",
    "contact_type",
    "shell_material",
    "finish",
    "coupling_type",
    "temperature_range",
    "environment_tags",
    "environment_score",
    "environment_profiles",
    "environment_notes",
)

ALLOWED_ENVIRONMENT_SCORES = {0, 1, 3, 4, 5}
ALLOWED_UNKNOWN_SHELL_MATERIAL_CLASSES = {"N", "R"}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def records_by_key(records: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for record in records:
        value = str(record.get(key, ""))
        ensure(value, f"Missing record key {key!r} in generated output.")
        ensure(value not in result, f"Duplicate {key!r} value {value!r} in generated output.")
        result[value] = record
    return result


def validate_source_inventory() -> set[str]:
    manifest = load_json(MANIFEST_PATH)
    manifest_files = {str(item.get("file", "")) for item in manifest if item.get("file")}
    disk_files = {path.name for path in DOCS_PDF_DIR.glob("*.pdf")}
    dla_documents = load_json(DLA_DOCUMENTS_PATH).get("documents", [])
    dla_files = {str(item.get("file", "")) for item in dla_documents if item.get("file")}

    ensure(manifest_files, "PDF manifest is empty.")
    ensure(not (manifest_files - disk_files), f"Manifest references missing PDFs: {sorted(manifest_files - disk_files)}")
    ensure(not (dla_files - disk_files), f"DLA document index references missing PDFs: {sorted(dla_files - disk_files)}")

    return manifest_files | disk_files


def compare_checked_in_outputs(generated_valid: dict[str, Any], generated_report: dict[str, Any]) -> None:
    checked_in_valid = load_dataset(VALID_DATA_PATH)
    checked_in_report = load_dataset(ENVIRONMENT_REPORT_PATH)

    ensure(generated_valid.get("schema_version") == checked_in_valid.get("schema_version"), "Schema version drift detected in valid PN dataset.")
    ensure(generated_valid.get("description") == checked_in_valid.get("description"), "Valid PN dataset description drift detected.")
    ensure(generated_valid.get("inputs") == checked_in_valid.get("inputs"), "Valid PN input source manifest drift detected.")
    ensure(generated_valid.get("summary") == checked_in_valid.get("summary"), "Valid PN summary drift detected.")
    ensure(
        generated_valid.get("environment_filter_definitions") == checked_in_valid.get("environment_filter_definitions"),
        "Environment filter definitions drift detected in valid PN dataset.",
    )

    ensure(generated_report.get("report_format") == checked_in_report.get("report_format"), "Environment report format drift detected.")
    ensure(generated_report.get("report_notes") == checked_in_report.get("report_notes"), "Environment report notes drift detected.")
    ensure(
        generated_report.get("environment_filter_definitions") == checked_in_report.get("environment_filter_definitions"),
        "Environment filter definitions drift detected in environment report.",
    )

    generated_parts = records_by_key(generated_valid.get("partNumbers", []), "partNumber")
    checked_in_parts = records_by_key(checked_in_valid.get("partNumbers", []), "partNumber")
    ensure(generated_parts.keys() == checked_in_parts.keys(), "Valid PN part number set drift detected.")

    for part_number, generated_record in generated_parts.items():
        checked_record = checked_in_parts[part_number]
        for field in PART_FIELDS_TO_COMPARE:
            ensure(
                generated_record.get(field) == checked_record.get(field),
                f"{part_number}: checked-in valid PN field {field!r} is stale.",
            )

    generated_connectors = records_by_key(generated_report.get("connector_records", []), "part_number")
    checked_in_connectors = records_by_key(checked_in_report.get("connector_records", []), "part_number")
    ensure(generated_connectors.keys() == checked_in_connectors.keys(), "Environment audit part number set drift detected.")

    for part_number, generated_record in generated_connectors.items():
        checked_record = checked_in_connectors[part_number]
        for field in REPORT_FIELDS_TO_COMPARE:
            ensure(
                generated_record.get(field) == checked_record.get(field),
                f"{part_number}: checked-in environment report field {field!r} is stale.",
            )


def validate_environment_records(generated_valid: dict[str, Any], known_source_files: set[str]) -> tuple[int, int]:
    part_numbers = generated_valid.get("partNumbers", [])
    filter_keys = [item["filter_key"] for item in ENVIRONMENT_FILTER_DEFINITIONS]
    filter_tags = {item["filter_key"]: set(item["matches_tags"]) for item in ENVIRONMENT_FILTER_DEFINITIONS}

    shell_material_exceptions = 0
    contact_type_exceptions = 0

    for record in part_numbers:
        connector = report_record(record)
        context = make_context(record)
        decoded = context["decoded"]
        part_number = str(record.get("partNumber", ""))
        slash_sheet = context["slash_sheet"]
        class_code = context["class_code"]
        shell_size_code = str(decoded.get("shellSizeCode", ""))
        contact_style = str(decoded.get("contactStyle", ""))

        ensure(slash_sheet in SLASH_SHEETS, f"{part_number}: slash sheet {slash_sheet!r} is missing from the DLA source map.")
        ensure(class_code in CLASS_DEFINITIONS, f"{part_number}: class code {class_code!r} is missing from standard definitions.")
        if shell_size_code:
            ensure(
                shell_size_code in SHELL_SIZE_CODES or shell_size_code[0] in SHELL_SIZE_CODES,
                f"{part_number}: shell size code {shell_size_code!r} is missing from standard definitions.",
            )
        if contact_style and not context["accessory"] and contact_style not in CONTACT_STYLE_DEFINITIONS:
            ensure(
                str(connector.get("contact_type", "")).lower() != "unknown",
                f"{part_number}: contact style {contact_style!r} is unmapped and did not resolve to a contact type.",
            )

        slash_doc = context["slash_doc"] or {}
        source_file = str(slash_doc.get("file", ""))
        ensure(source_file in known_source_files, f"{part_number}: slash-sheet source file {source_file!r} is missing from docs/pdfs.")

        ensure(str(connector.get("shell_style", "")).lower() != "unknown", f"{part_number}: shell style was not resolved.")
        ensure(str(connector.get("finish", "")).lower() != "unknown", f"{part_number}: finish was not resolved.")
        ensure(str(connector.get("coupling_type", "")).lower() != "unknown", f"{part_number}: coupling type was not resolved.")
        ensure(str(connector.get("temperature_range", "")).strip(), f"{part_number}: temperature range is empty.")

        if str(connector.get("shell_material", "")).lower() == "unknown":
            ensure(
                class_code in ALLOWED_UNKNOWN_SHELL_MATERIAL_CLASSES,
                f"{part_number}: shell material is unknown outside the documented class N/R exception.",
            )
            shell_material_exceptions += 1

        if str(connector.get("contact_type", "")).lower() == "unknown":
            ensure(context["accessory"], f"{part_number}: contact type is unknown outside the accessory exception.")
            contact_type_exceptions += 1

        scores = connector.get("environment_score", {}) or {}
        ensure(list(scores.keys()) == filter_keys, f"{part_number}: environment score keys drifted from the filter definitions.")
        for filter_key, value in scores.items():
            ensure(value in ALLOWED_ENVIRONMENT_SCORES, f"{part_number}: environment score {filter_key!r} has unsupported value {value!r}.")

        tags = connector.get("environment_tags", []) or []
        ensure(all(tag in TAG_ORDER for tag in tags), f"{part_number}: environment tags contain an unknown tag.")

        if context["accessory"]:
            ensure(not tags, f"{part_number}: accessory record should not emit environment tags.")
            ensure(
                "not classified" in str(connector.get("environment_notes", "")).lower(),
                f"{part_number}: accessory record should explain that environment suitability is not classified.",
            )
        else:
            ensure(tags, f"{part_number}: connector record resolved without any environment tags.")

        for definition in ENVIRONMENT_FILTER_DEFINITIONS:
            filter_key = definition["filter_key"]
            matching_tags = filter_tags[filter_key]
            has_tag = any(tag in matching_tags for tag in tags)
            is_positive = scores[filter_key] >= 3
            ensure(
                has_tag == is_positive,
                f"{part_number}: score/tag mismatch for environment filter {filter_key!r}.",
            )

        for profile in connector.get("environment_profiles", []) or []:
            for evidence_source in profile.get("evidence_sources", []) or []:
                ensure(
                    evidence_source in known_source_files,
                    f"{part_number}: evidence source {evidence_source!r} is missing from docs/pdfs.",
                )

    return shell_material_exceptions, contact_type_exceptions


def main() -> None:
    known_source_files = validate_source_inventory()
    generated_valid, generated_report = build_outputs()
    compare_checked_in_outputs(generated_valid, generated_report)
    shell_material_exceptions, contact_type_exceptions = validate_environment_records(generated_valid, known_source_files)

    print(
        "Environment smoke test passed: "
        f"validated {generated_valid['summary']['uniquePartNumbers']} part numbers, "
        f"{len(generated_report['connector_records'])} environment audit records, "
        f"{shell_material_exceptions} documented class N/R shell-material exceptions, and "
        f"{contact_type_exceptions} accessory contact-type exceptions."
    )


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"Environment smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)