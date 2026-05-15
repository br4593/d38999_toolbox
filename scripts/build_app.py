"""
Build the self-contained offline d38999 Toolbox web app into ``app/``.

HTML / CSS / JS templates come from ``app_static/``. Canonical JSON data comes
from ``data/*.json``. The generated app is written into ``app/`` and embeds the
same JSON into ``app/app-data.js`` so the page works from ``file://``.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
from pathlib import Path

DATA_FILES = [
    "insert_arrangements.json",
    "part_number_rules.json",
    "standard_definitions.json",
    "dla_documents.json",
    "review_needed.json",
]

STATIC_FILES = ["index.html", "styles.css", "app.js", "converter.js"]


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
    svg_dir = data_dir / "svg"
    static_dir = project_root / "app_static"
    app_dir = project_root / "app"
    app_data_dir = app_dir / "data"
    app_svg_dir = app_dir / "assets" / "svg"
    rules_path = project_root / "scripts" / "d38999_rules.py"

    if not rules_path.exists():
        raise FileNotFoundError(f"Missing converter rules at {rules_path}")
    if not static_dir.exists():
        raise FileNotFoundError(f"Missing app_static/ directory at {static_dir}")
    if not svg_dir.exists():
        raise FileNotFoundError(f"Missing data/svg/ directory at {svg_dir}")

    missing = [name for name in DATA_FILES if not (data_dir / name).exists()]
    if missing:
        raise FileNotFoundError(
            "Missing data files in data/: "
            + ", ".join(missing)
            + ". Run scripts/extract_arrangements.py and "
              "scripts/extract_standard_definitions.py first."
        )

    docs_rules = load_module(rules_path, "d38999_rules")

    app_data_dir.mkdir(parents=True, exist_ok=True)
    app_svg_dir.mkdir(parents=True, exist_ok=True)

    for name in STATIC_FILES:
        shutil.copy2(static_dir / name, app_dir / name)

    for name in DATA_FILES:
        shutil.copy2(data_dir / name, app_data_dir / name)

    for svg_path in sorted(svg_dir.glob("*.svg")):
        shutil.copy2(svg_path, app_svg_dir / svg_path.name)

    embedded = {
        "pinout": {
            "insertArrangements": read_json(data_dir / "insert_arrangements.json"),
            "partNumberRules": read_json(data_dir / "part_number_rules.json"),
            "standardDefinitions": read_json(data_dir / "standard_definitions.json"),
            "dlaDocuments": read_json(data_dir / "dla_documents.json"),
            "reviewNeeded": read_json(data_dir / "review_needed.json"),
        },
        "converter": {
            "shell_size_numbers": docs_rules.SHELL_SIZE_NUMBERS,
            "series_by_shell_type": docs_rules.SERIES_BY_SHELL_TYPE,
            "mil_shell_types": docs_rules.MIL_SHELL_TYPES,
            "known_classes": docs_rules.KNOWN_CLASSES,
            "contact_descriptions": docs_rules.CONTACT_DESCRIPTIONS,
            "rules": docs_rules.RULES,
        },
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
