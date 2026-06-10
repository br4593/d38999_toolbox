#!/usr/bin/env python3
"""Exhaustive D38999 round-trip test harness.

Enumerates a broad cross-product of MIL-DTL-38999 part numbers, runs each
through the Python forward converter (`scripts.d38999_rules.convert_pin`),
and round-trips every produced manufacturer PN back through the JS
reverse parser (`app/converter.js`) driven via Node over a JSONL pipe.

Round-trip equality is asserted with two documented tolerances:
  * a missing trailing default polarization (`N`) is normalized in/out;
  * if a single rule maps more than one D38999 slash-sheet to the same
    manufacturer prefix/suffix string ("lossy equivalence class"), any
    slash-sheet in that class is accepted as a valid round-trip target.

Usage:
    python scripts/exhaustive_roundtrip_test.py            # default ~3000 PNs
    python scripts/exhaustive_roundtrip_test.py --limit 500
    python scripts/exhaustive_roundtrip_test.py --rule Glenair --quiet
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.d38999_rules import (  # noqa: E402
    RULES,
    SHELL_SIZE_NUMBERS,
    convert_pin,
    format_candidate,
    parse_d38999_pin,
    _rule_supports,
)

DATA_FILE_CANDIDATES = [
    ROOT / "data" / "insert_arrangements.json",
    ROOT / "app" / "data" / "insert_arrangements.json",
]
NODE_HELPER = ROOT / "scripts" / "_reverse_parse_node_helper.js"
DEFAULT_LIMIT = 3000

PRIMARY_CONTACTS = ("P", "S")
PRIMARY_KEYS = ("N", "A", "B", "C", "D", "E")
EXTRA_CLASSES_FOR_COVERAGE = ("AA", "AB")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def load_inserts_by_shell() -> dict[str, list[str]]:
    for path in DATA_FILE_CANDIDATES:
        if path.exists() and path.stat().st_size > 0:
            data = json.loads(path.read_text())
            by_shell: dict[str, list[str]] = defaultdict(list)
            for a in data.get("arrangements", []):
                code = a.get("shell_size_code")
                num = a.get("arrangement_number")
                if code and num:
                    by_shell[code].append(str(num))
            return {k: sorted(set(v), key=lambda x: (len(x), x)) for k, v in by_shell.items()}
    raise FileNotFoundError("No populated insert_arrangements.json found")


def rule_class_codes(rule: dict[str, Any]) -> list[str]:
    if rule["format"] == "amphenol_prefix":
        seen: set[str] = set()
        for st in rule["styles"].values():
            seen.update(st.get("prefix_by_finish", {}).keys())
        return sorted(seen)
    if "supported_finishes" in rule:
        return list(rule["supported_finishes"])
    if "finishes" in rule:
        return list(rule["finishes"].keys())
    return []


def rule_shell_size_codes(rule: dict[str, Any]) -> list[str]:
    allowed = rule.get("allowed_shell_size_codes")
    if allowed:
        return list(allowed)
    return list(SHELL_SIZE_NUMBERS.keys())  # A..J


def lossy_equivalence_classes(rule: dict[str, Any]) -> dict[str, frozenset[str]]:
    """Return {shell_type -> frozenset of accepted shell_types} for any rule
    whose styles dict maps multiple D38999 slash-sheets to the same
    manufacturer-side value (per shell_type + class, where applicable).

    Currently the catalog has no intra-rule collisions; this routine is
    written generically so future rule additions are tolerated automatically.
    """
    groups: dict[str, set[str]] = {}
    if rule["format"] == "amphenol_prefix":
        per_class: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        for st, body in rule["styles"].items():
            for cls, prefix in body.get("prefix_by_finish", {}).items():
                per_class[cls][prefix].add(st)
        for buckets in per_class.values():
            for shell_types in buckets.values():
                if len(shell_types) > 1:
                    for st in shell_types:
                        groups.setdefault(st, set()).update(shell_types)
    else:
        inv: dict[str, set[str]] = defaultdict(set)
        for st, val in rule["styles"].items():
            inv[val].add(st)
        for shell_types in inv.values():
            if len(shell_types) > 1:
                for st in shell_types:
                    groups.setdefault(st, set()).update(shell_types)
    return {k: frozenset(v) for k, v in groups.items()}


def normalize_for_compare(pn: str) -> str:
    """Apply documented round-trip normalization: strip trailing default
    polarization ``N`` so that ``D38999/26WD35PN`` and ``D38999/26WD35P``
    compare equal."""
    parsed = parse_d38999_pin(pn)
    norm = parsed.normalized
    if norm.endswith("N"):
        return norm[:-1]
    return norm


def enumerate_candidates(
    inserts_by_shell: dict[str, list[str]],
    rule_filter: str | None,
) -> Iterable[tuple[dict[str, Any] | None, str]]:
    """Yield (rule_or_None, d38999_pn). When rule is None the PN is a
    coverage-only iteration (e.g. classes AA/AB) and is not expected to
    produce candidates from any rule."""
    classes_union: set[str] = set()
    for rule in RULES:
        classes_union.update(rule_class_codes(rule))
    classes_union.update(EXTRA_CLASSES_FOR_COVERAGE)

    for rule in RULES:
        if rule_filter and rule_filter.lower() not in rule["product_line"].lower() \
                and rule_filter.lower() not in rule["manufacturer"].lower():
            continue
        for shell_type in rule["styles"].keys():
            for cls in sorted(set(rule_class_codes(rule))):
                for code in rule_shell_size_codes(rule):
                    inserts = inserts_by_shell.get(code, [])
                    if not inserts:
                        continue
                    contacts = [c for c in PRIMARY_CONTACTS if c in rule.get("supported_contacts", PRIMARY_CONTACTS)]
                    if not contacts:
                        contacts = list(rule.get("supported_contacts", PRIMARY_CONTACTS))[:2]
                    keys_ = [k for k in PRIMARY_KEYS if k in rule.get("supported_keys", PRIMARY_KEYS)]
                    if not keys_:
                        keys_ = list(rule.get("supported_keys", PRIMARY_KEYS))[:1] or ["N"]
                    for ins in inserts:
                        for contact in contacts:
                            for key in keys_:
                                pn = f"D38999/{shell_type}{cls}{code}{ins}{contact}{key}"
                                yield rule, pn

    # Edge-case coverage iteration: classes AA / AB across one shell type per series.
    for cls in EXTRA_CLASSES_FOR_COVERAGE:
        for shell_type in ("26", "46"):
            for code in ("B", "D", "G"):
                inserts = inserts_by_shell.get(code, [])
                if not inserts:
                    continue
                ins = inserts[0]
                yield None, f"D38999/{shell_type}{cls}{code}{ins}PN"


def sample_pns(pairs: list[tuple[dict[str, Any] | None, str]], limit: int) -> list[tuple[dict[str, Any] | None, str]]:
    if len(pairs) <= limit:
        return pairs
    rng = random.Random(0)
    indices = sorted(rng.sample(range(len(pairs)), limit))
    return [pairs[i] for i in indices]


# --------------------------------------------------------------------------- #
# Node helper plumbing
# --------------------------------------------------------------------------- #

class NodeReverseParser:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            ["/usr/bin/node", str(NODE_HELPER), str(ROOT / "app")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        ready = self.proc.stdout.readline()
        if not ready or '"ready"' not in ready:
            err = self.proc.stderr.read()
            raise RuntimeError(f"Node helper failed to start: {ready!r} stderr={err!r}")

    def reverse(self, pn: str, req_id: int) -> dict[str, Any]:
        try:
            self.proc.stdin.write(json.dumps({"id": req_id, "pn": pn}) + "\n")
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
            if not line:
                return {"id": req_id, "error": "node_pipe_closed", "candidates": []}
            return json.loads(line)
        except (BrokenPipeError, ValueError) as e:
            return {"id": req_id, "error": f"node_io: {e}", "candidates": []}

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()


# --------------------------------------------------------------------------- #
# Test core
# --------------------------------------------------------------------------- #

def run_exhaustive_roundtrip(
    limit: int = DEFAULT_LIMIT,
    rule_filter: str | None = None,
    quiet: bool = False,
) -> int:
    inserts = load_inserts_by_shell()
    all_pairs = list(enumerate_candidates(inserts, rule_filter))
    sampled = sample_pns(all_pairs, limit)

    lossy_by_rule: dict[str, dict[str, frozenset[str]]] = {}
    for rule in RULES:
        cls = lossy_equivalence_classes(rule)
        if cls:
            lossy_by_rule[rule["product_line"]] = cls

    per_rule_pass: dict[str, int] = defaultdict(int)
    per_rule_fail: dict[str, int] = defaultdict(int)
    pn_no_candidates = 0
    pn_skipped_aa_ab = 0
    failures: list[str] = []

    node = NodeReverseParser()
    try:
        for idx, (origin_rule, pn) in enumerate(sampled):
            try:
                fwd = convert_pin(pn)
            except Exception as e:
                if origin_rule is None:
                    pn_skipped_aa_ab += 1
                    continue
                per_rule_fail[origin_rule["product_line"]] += 1
                if len(failures) < 20:
                    failures.append(f"FORWARD_PARSE: {pn} -> {e}")
                continue
            candidates = fwd.get("candidates", [])
            if not candidates:
                if origin_rule is None:
                    pn_skipped_aa_ab += 1
                else:
                    pn_no_candidates += 1
                continue

            wanted_norm = normalize_for_compare(fwd["normalized"])
            parsed_input = parse_d38999_pin(pn)

            for cand in candidates:
                mfr = cand["manufacturer_part_number"]
                product_line = cand["product_line"]
                rule = next((r for r in RULES if r["product_line"] == product_line), None)
                accepted_shell_types = {parsed_input.shell_type}
                if rule and product_line in lossy_by_rule:
                    accepted_shell_types |= lossy_by_rule[product_line].get(parsed_input.shell_type, frozenset())

                resp = node.reverse(mfr, idx)
                if resp.get("error"):
                    per_rule_fail[product_line] += 1
                    if len(failures) < 20:
                        failures.append(f"NODE_ERR: {pn} -> {mfr}: {resp['error']}")
                    continue
                rev_cands = resp.get("candidates") or []
                matched = False
                got_norms: list[str] = []
                for rc in rev_cands:
                    parsed = rc.get("parsed") or {}
                    got = parsed.get("normalized")
                    if not got:
                        continue
                    got_norms.append(got)
                    try:
                        got_pn = parse_d38999_pin(got)
                    except Exception:
                        continue
                    got_norm = normalize_for_compare(got)
                    if got_pn.shell_type in accepted_shell_types and (
                        got_norm[len("D38999/" + got_pn.shell_type):]
                        == wanted_norm[len("D38999/" + parsed_input.shell_type):]
                    ):
                        matched = True
                        break

                if matched:
                    per_rule_pass[product_line] += 1
                else:
                    per_rule_fail[product_line] += 1
                    if len(failures) < 20:
                        failures.append(
                            f"ROUNDTRIP: {pn} -> {mfr} -> {got_norms or rev_cands or 'no_reverse'}"
                        )
    finally:
        node.close()

    total_pass = sum(per_rule_pass.values())
    total_fail = sum(per_rule_fail.values())

    if not quiet:
        print(f"\nEnumerated {len(all_pairs)} (rule, PN) combos; tested sample of {len(sampled)}.")
        print(f"Total candidate round-trips: pass={total_pass} fail={total_fail}"
              f" no_candidates={pn_no_candidates} aa_ab_skipped={pn_skipped_aa_ab}")
        print("\nPer-rule results (candidate round-trips):")
        seen_rules = sorted(set(list(per_rule_pass) + list(per_rule_fail)))
        for r in seen_rules:
            print(f"  {r:<55} pass={per_rule_pass[r]:>5}  fail={per_rule_fail[r]:>5}")
        if lossy_by_rule:
            print("\nLossy equivalence classes detected:")
            for r, mapping in lossy_by_rule.items():
                print(f"  {r}: {dict(mapping)}")
        else:
            print("\nLossy equivalence classes detected: none")
        if failures:
            print(f"\nFirst {len(failures)} failures:")
            for f in failures:
                print(f"  {f}")

    if total_fail == 0:
        if quiet:
            print(f"exhaustive_roundtrip: PASS  ({len(sampled)} PNs, {total_pass} round-trips)")
        else:
            print("\nexhaustive_roundtrip: PASS")
        return 0

    if quiet:
        print(f"exhaustive_roundtrip: FAIL  ({total_fail} failures in {len(sampled)} PNs)")
    else:
        print(f"\nexhaustive_roundtrip: FAIL ({total_fail} round-trip failures)")
    return 1


def _main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    ap.add_argument("--rule", type=str, default=None,
                    help="Substring filter applied to rule product_line or manufacturer.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    return run_exhaustive_roundtrip(limit=args.limit, rule_filter=args.rule, quiet=args.quiet)


if __name__ == "__main__":
    sys.exit(_main())
