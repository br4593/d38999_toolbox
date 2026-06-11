"""Shared helpers for reading/writing large datasets as size-bounded shards.

GitHub warns on files over 50 MiB and rejects pushes over 100 MiB. Large
generated datasets (e.g. ``data/d38999_environment_classification.json`` and
``data/d38999_valid_part_numbers.json``) are therefore checked in as a
*sharded directory* instead of one monolithic JSON file:

    data/<name>/
        index.json              # all top-level keys except the big array,
                                # plus a "_sharding" manifest
        <array>_001.json        # a chunk of the big array (< max_shard_bytes)
        <array>_002.json
        ...

``load_dataset()`` transparently reassembles the original object whether it is
stored as a single ``.json`` file or as a sharded directory, so consumers can
keep passing the legacy ``.json`` path.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

SHARD_META_KEY = "_sharding"
# Keep each shard comfortably under GitHub's 50 MiB warning threshold.
DEFAULT_MAX_SHARD_BYTES = 42 * 1024 * 1024

# Repository ``data/`` directory (scripts/ -> repo root -> data).
DATA_ROOT = Path(__file__).resolve().parents[1] / "data"

# Single source of truth for how dataset files are categorized into folders
# under ``data/``. Keyed by the file's basename (the ".json" logical name is
# used for sharded datasets, whose on-disk form is a directory of shards).
DATASET_CATEGORIES: dict[str, str] = {
    # part-number corpora and their sources
    "d38999_valid_part_numbers.json": "part_numbers",
    "d38999_verified_part_numbers.json": "part_numbers",
    "d38999_part_number_examples.json": "part_numbers",
    "d38999_federalconnectors_secondary_source.json": "part_numbers",
    "d38999_catalog_supported_combinations.json": "part_numbers",
    # DLA QPL scrape outputs
    "qpl_1122_part_numbers.json": "qpl",
    "qpl_1122_part_details.json": "qpl",
    "qpl_1122_revalidation_report.json": "qpl",
    # environment classification audit
    "d38999_environment_classification.json": "environment",
    # decode / validation rule data
    "part_number_rules.json": "rules",
    "pinout_rules.json": "rules",
    "d38999_extracted_rules.json": "rules",
    "conversion_rules.csv": "rules",
    "rule_constraints.csv": "rules",
    "review_needed.json": "rules",
    # converter lookup tables and cross-reference database
    "style_mappings.csv": "converter",
    "finish_mappings.csv": "converter",
    "example_conversions.csv": "converter",
    "d38999_cross_reference.sqlite": "converter",
    # engineering reference and standards
    "std1560.pdf": "reference",
    "standard_definitions.json": "reference",
    "insert_arrangements.json": "reference",
    "insert_arrangements_contacts.csv": "reference",
    "connector_engineering_reference.json": "reference",
    "high_speed_interface_wiring_reference.json": "reference",
    "contact_current_ratings.json": "reference",
    "dla_documents.json": "reference",
    # connector catalogs and visual assets
    "rugged_io_d38999_style_connectors.json": "connectors",
    "d38999_visual_assets.json": "connectors",
}


def data_path(name: str, data_dir: Path | None = None) -> Path:
    """Resolve a dataset file's location under ``data/``.

    ``name`` is the file's basename; the categorized subfolder is looked up in
    :data:`DATASET_CATEGORIES` (single source of truth for the layout). Pass a
    custom ``data_dir`` to resolve against a non-default data directory.
    """
    root = Path(data_dir) if data_dir is not None else DATA_ROOT
    category = DATASET_CATEGORIES.get(name)
    if category:
        return root / category / name
    # Fall back to a recursive search so a misclassified or new name still
    # resolves to wherever the file actually lives under data/.
    matches = sorted(root.glob(f"**/{name}"))
    if matches:
        return matches[0]
    shard_matches = sorted(root.glob(f"**/{Path(name).stem}/index.json"))
    if shard_matches:
        return shard_matches[0].parent.parent / name
    return root / name


def _shard_dir_for(path: Path) -> Path:
    """Map a logical dataset path to its sharded directory.

    ``data/foo.json`` -> ``data/foo``; a path with no suffix is returned as-is.
    """
    path = Path(path)
    return path.with_suffix("") if path.suffix else path


def _camel_to_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def dataset_exists(path: Path) -> bool:
    """True if the dataset is present either as a shard dir or a single file."""
    shard_dir = _shard_dir_for(path)
    if (shard_dir / "index.json").is_file():
        return True
    return Path(path).is_file()


def load_dataset(path: Path, encoding: str = "utf-8-sig") -> Any:
    """Load a dataset stored as a single ``.json`` file or as a shard dir.

    When a sibling shard directory with an ``index.json`` exists it is used and
    the original object is reassembled by concatenating the shard arrays back
    onto the array key recorded in the manifest.
    """
    path = Path(path)
    shard_dir = _shard_dir_for(path)
    index_path = shard_dir / "index.json"
    if index_path.is_file():
        obj = json.loads(index_path.read_text(encoding=encoding))
        sharding = obj.pop(SHARD_META_KEY)
        array_key = sharding["array_key"]
        records: list[Any] = []
        for shard_name in sharding["shards"]:
            shard_text = (shard_dir / shard_name).read_text(encoding=encoding)
            records.extend(json.loads(shard_text))
        obj[array_key] = records
        return obj
    return json.loads(path.read_text(encoding=encoding))


def _chunk_records(
    records: list[Any],
    max_bytes: int,
    indent: int | None,
    separators: tuple[str, str] | None,
) -> list[list[Any]]:
    chunks: list[list[Any]] = []
    current: list[Any] = []
    current_bytes = 2  # opening/closing brackets
    for record in records:
        encoded = json.dumps(
            record, ensure_ascii=False, indent=indent, separators=separators
        )
        record_bytes = len(encoded.encode("utf-8")) + 2  # separator + newline
        if indent:
            # Inside an indented array every line of the record is shifted right
            # by one indent level, so account for that extra whitespace.
            record_bytes += indent * (encoded.count("\n") + 1)
        if current and current_bytes + record_bytes > max_bytes:
            chunks.append(current)
            current = []
            current_bytes = 2
        current.append(record)
        current_bytes += record_bytes
    if current:
        chunks.append(current)
    return chunks or [[]]


def write_sharded_dataset(
    path: Path,
    obj: dict[str, Any],
    array_key: str,
    *,
    max_shard_bytes: int = DEFAULT_MAX_SHARD_BYTES,
    indent: int | None = None,
    shard_prefix: str | None = None,
) -> Path:
    """Write ``obj`` as a sharded directory derived from ``path``.

    ``obj[array_key]`` is split into chunks no larger than ``max_shard_bytes``
    (serialized). All other keys go into ``index.json`` alongside a
    ``_sharding`` manifest. Any pre-existing monolithic ``.json`` file at
    ``path`` is removed so the shards become the single source of truth.
    """
    path = Path(path)
    shard_dir = _shard_dir_for(path)
    shard_dir.mkdir(parents=True, exist_ok=True)
    for stale in shard_dir.glob("*.json"):
        stale.unlink()

    records = list(obj[array_key])
    base = {key: value for key, value in obj.items() if key != array_key}
    separators = (",", ":") if indent is None else None
    chunks = _chunk_records(records, max_shard_bytes, indent, separators)

    prefix = shard_prefix or _camel_to_snake(array_key)
    width = max(3, len(str(len(chunks))))
    shard_names: list[str] = []
    for position, chunk in enumerate(chunks, start=1):
        shard_name = f"{prefix}_{position:0{width}d}.json"
        shard_names.append(shard_name)
        (shard_dir / shard_name).write_text(
            json.dumps(
                chunk, ensure_ascii=False, indent=indent, separators=separators
            )
            + "\n",
            encoding="utf-8",
        )

    base[SHARD_META_KEY] = {
        "array_key": array_key,
        "record_count": len(records),
        "shard_count": len(shard_names),
        "max_shard_bytes": max_shard_bytes,
        "shards": shard_names,
    }
    (shard_dir / "index.json").write_text(
        json.dumps(base, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if path.suffix == ".json" and path.is_file():
        path.unlink()
    return shard_dir
