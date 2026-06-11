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
