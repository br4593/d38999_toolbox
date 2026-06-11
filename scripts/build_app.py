"""
Bake embedded data into the self-contained offline d38999 Toolbox web app.

The checked-in web app lives directly in ``app/``. Canonical JSON data comes
from ``data/*.json``. This script refreshes ``app/assets/svg/*``
and regenerates ``app/app-data.js`` so the page works from ``file://`` or a
static host without runtime fetches.

The app reads ALL data from the embedded ``app-data.js`` bundle and never
fetches a JSON file at runtime, so no ``app/data/*.json`` mirror is produced;
any previously generated mirror is removed during the build.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path

from dataset_io import dataset_exists, load_dataset

# DATA_FILES lists the canonical data/ sources the embedded bundle is built from;
# it is used only as a presence check (every source must exist before embedding).
# The full environment audit (d38999_environment_classification.json) stays in data/
# only — the app consumes the lightweight environment fields already embedded in
# d38999_valid_part_numbers.json, so the large audit blob is never shipped.
# connector_engineering_reference.json and high_speed_interface_wiring_reference.json
# are intentionally absent here: they are never embedded or fetched (they remain in
# data/ as source references cited by pinout_rules.json metadata).
DATA_FILES = [
    "insert_arrangements.json",
    "part_number_rules.json",
    "standard_definitions.json",
    "dla_documents.json",
    "review_needed.json",
    "d38999_extracted_rules.json",
    "d38999_part_number_examples.json",
    "d38999_catalog_supported_combinations.json",
    "d38999_verified_part_numbers.json",
    "d38999_federalconnectors_secondary_source.json",
    "d38999_valid_part_numbers.json",
    "d38999_visual_assets.json",
    "rugged_io_d38999_style_connectors.json",
    "pinout_rules.json",
    "contact_current_ratings.json",
]

def load_module(module_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def build(project_root: Path) -> Path:
    data_dir = project_root / "data"
    svg_dir = project_root / "assets" / "svg"
    app_dir = project_root / "app"
    app_data_dir = app_dir / "data"
    app_assets_dir = app_dir / "assets"
    app_svg_dir = app_assets_dir / "svg"
    rules_path = project_root / "scripts" / "d38999_rules.py"
    cname_path = project_root / "CNAME"

    if not rules_path.exists():
        raise FileNotFoundError(f"Missing converter rules at {rules_path}")
    if not svg_dir.exists():
        raise FileNotFoundError(f"Missing assets/svg/ directory at {svg_dir}")

    missing = [name for name in DATA_FILES if not dataset_exists(data_dir / name)]
    if missing:
        raise FileNotFoundError(
            "Missing data files in data/: "
            + ", ".join(missing)
            + ". Run scripts/extract_arrangements.py and "
              "scripts/extract_standard_definitions.py first."
        )

    docs_rules = load_module(rules_path, "d38999_rules")

    # The runtime app reads all data from the embedded app-data.js bundle (no JSON
    # is fetched at runtime), so the old app/data/ mirror was pure duplicate weight.
    # Rebuild the app asset tree from scratch so stale files never linger and the
    # shipped app keeps a single app/assets/svg/ graphics folder.
    if app_data_dir.exists():
        shutil.rmtree(app_data_dir)
    if app_assets_dir.exists():
        shutil.rmtree(app_assets_dir)
    app_svg_dir.mkdir(parents=True, exist_ok=True)

    for svg_path in sorted(svg_dir.glob("*.svg")):
        target = app_svg_dir / svg_path.name
        target.write_text(svg_path.read_text(encoding="utf-8"), encoding="utf-8")

    if cname_path.exists():
        (app_dir / "CNAME").write_text(cname_path.read_text(encoding="utf-8"), encoding="utf-8")

    embedded = {
        "pinout": {
            "insertArrangements": read_json(data_dir / "insert_arrangements.json"),
            "partNumberRules": read_json(data_dir / "part_number_rules.json"),
            "pinoutRules": read_json(data_dir / "pinout_rules.json"),
            "standardDefinitions": read_json(data_dir / "standard_definitions.json"),
            "dlaDocuments": read_json(data_dir / "dla_documents.json"),
            "reviewNeeded": read_json(data_dir / "review_needed.json"),
            "contactCurrentRatings": read_json(data_dir / "contact_current_ratings.json"),
        },
        "converter": {
            "shell_size_numbers": docs_rules.SHELL_SIZE_NUMBERS,
            "series_by_shell_type": docs_rules.SERIES_BY_SHELL_TYPE,
            "mil_shell_types": docs_rules.MIL_SHELL_TYPES,
            "known_classes": docs_rules.KNOWN_CLASSES,
            "contact_descriptions": docs_rules.CONTACT_DESCRIPTIONS,
            "rules": docs_rules.RULES,
        },
        "research": {
            "extractedRules": read_json(data_dir / "d38999_extracted_rules.json"),
            "partNumberExamples": read_json(data_dir / "d38999_part_number_examples.json"),
            "catalogSupportedCombinations": read_json(data_dir / "d38999_catalog_supported_combinations.json"),
            "validPartNumbers": load_dataset(data_dir / "d38999_valid_part_numbers.json"),
            "verifiedPartNumbers": read_json(data_dir / "d38999_verified_part_numbers.json"),
            "federalConnectorsSecondarySource": read_json(data_dir / "d38999_federalconnectors_secondary_source.json"),
            "visualAssets": read_json(data_dir / "d38999_visual_assets.json"),
        },
        "ruggedIo": read_json(data_dir / "rugged_io_d38999_style_connectors.json"),
    }

    app_data_js = (
        "window.D38999_TOOLBOX_DATA = "
        + json.dumps(embedded, ensure_ascii=False, separators=(",", ":"))
        + ";\nwindow.D38999_DATA = window.D38999_TOOLBOX_DATA.pinout;\n"
    )
    (app_dir / "app-data.js").write_text(app_data_js, encoding="utf-8")
    return app_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Project root directory (defaults to repository root).",
    )
    args = parser.parse_args()
    app_dir = build(Path(args.project_root).resolve())
    print(f"Built offline app at {app_dir / 'index.html'}")


if __name__ == "__main__":
    main()
