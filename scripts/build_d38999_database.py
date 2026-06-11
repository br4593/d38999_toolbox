from __future__ import annotations

import csv
import json
from pathlib import Path
import sqlite3

from d38999_rules import (
    DOCUMENTS,
    MIL_SHELL_TYPES,
    RULES,
    SERIES_BY_SHELL_TYPE,
    SHELL_SIZE_NUMBERS,
    convert_pin,
)
from dataset_io import data_path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = data_path("d38999_cross_reference.sqlite")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=OFF")
    cur.execute("PRAGMA synchronous=OFF")

    cur.executescript(
        """
        DROP TABLE IF EXISTS example_conversions;
        DROP TABLE IF EXISTS rule_constraints;
        DROP TABLE IF EXISTS finish_mappings;
        DROP TABLE IF EXISTS style_mappings;
        DROP TABLE IF EXISTS conversion_rules;
        DROP TABLE IF EXISTS mil_shell_types;
        DROP TABLE IF EXISTS shell_size_codes;
        DROP TABLE IF EXISTS source_documents;
        DROP TABLE IF EXISTS manufacturers;

        CREATE TABLE manufacturers (
            manufacturer TEXT PRIMARY KEY
        );

        CREATE TABLE source_documents (
            manufacturer TEXT,
            file TEXT,
            scope TEXT,
            PRIMARY KEY (manufacturer, file)
        );

        CREATE TABLE shell_size_codes (
            mil_code TEXT PRIMARY KEY,
            numeric_size TEXT NOT NULL
        );

        CREATE TABLE mil_shell_types (
            shell_type TEXT PRIMARY KEY,
            series TEXT NOT NULL,
            description TEXT NOT NULL
        );

        CREATE TABLE conversion_rules (
            rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
            manufacturer TEXT NOT NULL,
            product_line TEXT NOT NULL,
            series TEXT NOT NULL,
            format TEXT NOT NULL,
            confidence TEXT,
            notes TEXT
        );

        CREATE TABLE style_mappings (
            rule_id INTEGER NOT NULL,
            mil_shell_type TEXT NOT NULL,
            mfg_style_code TEXT,
            mfg_prefix_by_finish_json TEXT,
            description TEXT,
            PRIMARY KEY (rule_id, mil_shell_type)
        );

        CREATE TABLE finish_mappings (
            rule_id INTEGER NOT NULL,
            mil_class TEXT NOT NULL,
            mfg_finish_code TEXT NOT NULL,
            PRIMARY KEY (rule_id, mil_class)
        );

        CREATE TABLE rule_constraints (
            rule_id INTEGER PRIMARY KEY,
            supported_contacts TEXT,
            supported_keys TEXT,
            allowed_shell_size_codes TEXT
        );

        CREATE TABLE example_conversions (
            mil_pin TEXT,
            normalized_pin TEXT,
            manufacturer TEXT,
            product_line TEXT,
            manufacturer_part_number TEXT,
            confidence TEXT,
            notes TEXT
        );
        """
    )

    manufacturers = sorted({doc["manufacturer"] for doc in DOCUMENTS} | {rule["manufacturer"] for rule in RULES})
    cur.executemany("INSERT INTO manufacturers(manufacturer) VALUES (?)", [(m,) for m in manufacturers])

    cur.executemany(
        "INSERT INTO source_documents(manufacturer, file, scope) VALUES (:manufacturer, :file, :scope)",
        DOCUMENTS,
    )

    cur.executemany(
        "INSERT INTO shell_size_codes(mil_code, numeric_size) VALUES (?, ?)",
        sorted(SHELL_SIZE_NUMBERS.items()),
    )

    cur.executemany(
        "INSERT INTO mil_shell_types(shell_type, series, description) VALUES (?, ?, ?)",
        [
            (shell_type, SERIES_BY_SHELL_TYPE[shell_type], description)
            for shell_type, description in sorted(MIL_SHELL_TYPES.items())
        ],
    )

    rule_export: list[dict[str, object]] = []
    style_export: list[dict[str, object]] = []
    finish_export: list[dict[str, object]] = []
    constraints_export: list[dict[str, object]] = []

    for rule in RULES:
        cur.execute(
            """
            INSERT INTO conversion_rules(manufacturer, product_line, series, format, confidence, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                rule["manufacturer"],
                rule["product_line"],
                rule["series"],
                rule["format"],
                rule["confidence"],
                rule["notes"],
            ),
        )
        rule_id = cur.lastrowid
        rule_export.append(
            {
                "rule_id": rule_id,
                "manufacturer": rule["manufacturer"],
                "product_line": rule["product_line"],
                "series": rule["series"],
                "format": rule["format"],
                "confidence": rule["confidence"],
                "notes": rule["notes"],
            }
        )

        for mil_shell_type, style_data in rule["styles"].items():
            if isinstance(style_data, dict):
                mfg_style_code = ""
                prefix_json = json.dumps(style_data.get("prefix_by_finish", {}), sort_keys=True)
                description = style_data.get("description", "")
            else:
                mfg_style_code = style_data
                prefix_json = ""
                description = MIL_SHELL_TYPES.get(mil_shell_type, "")
            cur.execute(
                """
                INSERT INTO style_mappings(rule_id, mil_shell_type, mfg_style_code, mfg_prefix_by_finish_json, description)
                VALUES (?, ?, ?, ?, ?)
                """,
                (rule_id, mil_shell_type, mfg_style_code, prefix_json, description),
            )
            style_export.append(
                {
                    "rule_id": rule_id,
                    "manufacturer": rule["manufacturer"],
                    "product_line": rule["product_line"],
                    "mil_shell_type": mil_shell_type,
                    "mfg_style_code": mfg_style_code,
                    "mfg_prefix_by_finish_json": prefix_json,
                    "description": description,
                }
            )

        finishes = rule.get("finishes")
        if not finishes and "supported_finishes" in rule:
            finishes = {code: code for code in rule["supported_finishes"]}
        if not finishes and rule["format"] == "amphenol_prefix":
            finishes = {}
            for style_data in rule["styles"].values():
                finishes.update({code: code for code in style_data["prefix_by_finish"]})

        for mil_class, mfg_finish in sorted((finishes or {}).items()):
            cur.execute(
                "INSERT INTO finish_mappings(rule_id, mil_class, mfg_finish_code) VALUES (?, ?, ?)",
                (rule_id, mil_class, mfg_finish),
            )
            finish_export.append(
                {
                    "rule_id": rule_id,
                    "manufacturer": rule["manufacturer"],
                    "product_line": rule["product_line"],
                    "mil_class": mil_class,
                    "mfg_finish_code": mfg_finish,
                }
            )

        constraint_row = {
            "rule_id": rule_id,
            "manufacturer": rule["manufacturer"],
            "product_line": rule["product_line"],
            "supported_contacts": "".join(rule.get("supported_contacts", [])),
            "supported_keys": "".join(rule.get("supported_keys", [])),
            "allowed_shell_size_codes": "".join(rule.get("allowed_shell_size_codes", [])),
        }
        cur.execute(
            """
            INSERT INTO rule_constraints(rule_id, supported_contacts, supported_keys, allowed_shell_size_codes)
            VALUES (?, ?, ?, ?)
            """,
            (
                rule_id,
                constraint_row["supported_contacts"],
                constraint_row["supported_keys"],
                constraint_row["allowed_shell_size_codes"],
            ),
        )
        constraints_export.append(constraint_row)

    examples = [
        "D38999/26WD35PN",
        "D38999/20MD35PN",
        "D38999/21YB35PN",
        "D38999/43NB35PN",
        "D38999/46WB35PN",
    ]
    example_rows: list[dict[str, object]] = []
    for mil_pin in examples:
        result = convert_pin(mil_pin)
        for candidate in result["candidates"]:
            row = {
                "mil_pin": mil_pin,
                "normalized_pin": result["normalized"],
                "manufacturer": candidate["manufacturer"],
                "product_line": candidate["product_line"],
                "manufacturer_part_number": candidate["manufacturer_part_number"],
                "confidence": candidate["confidence"],
                "notes": candidate["notes"],
            }
            example_rows.append(row)
            cur.execute(
                """
                INSERT INTO example_conversions(
                    mil_pin, normalized_pin, manufacturer, product_line,
                    manufacturer_part_number, confidence, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                tuple(row.values()),
            )

    conn.commit()
    conn.close()

    write_csv(data_path("conversion_rules.csv"), rule_export)
    write_csv(data_path("style_mappings.csv"), style_export)
    write_csv(data_path("finish_mappings.csv"), finish_export)
    write_csv(data_path("rule_constraints.csv"), constraints_export)
    write_csv(data_path("example_conversions.csv"), example_rows)

    print(f"Wrote {DB_PATH}")
    print(f"Wrote {len(rule_export)} conversion rules and {len(example_rows)} example rows")


if __name__ == "__main__":
    main()
