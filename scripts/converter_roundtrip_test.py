#!/usr/bin/env python3
"""
Round-trip test for the live ``app/converter.js`` reverse parser.

Drives the real JS converter through Node and asserts that a curated list of
manufacturer part numbers decode to the expected normalized D38999 form. Covers
every active rule family plus the published PCB / deviation-suffix variants.

Usage:
    python3 scripts/converter_roundtrip_test.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"


# (input_pn, expected_normalized_d38999, description)
CASES: list[tuple[str, str, str]] = [
    # ---- Native D38999 ----
    ("D38999/24WC35PN", "D38999/24WC35PN", "native D38999 input"),

    # ---- Amphenol TV Series III commercial ----
    ("TV07RW-13-35PN", "D38999/24WC35PN", "Amphenol TV class W, dashed"),
    ("TV07RW1335PN",   "D38999/24WC35PN", "Amphenol TV class W, no-dash"),
    ("TV07DT-13-35PN", "D38999/24TC35PN", "Amphenol TV class T (Durmalon)"),
    ("TV07DZ-13-35PN", "D38999/24ZC35PN", "Amphenol TV class Z (catalog uses DZ, not ZN)"),
    ("TVPS00RF-11-35PN", "D38999/20FB35PN", "Amphenol TV class F"),
    ("TVS07RK-11-35PN", "D38999/24KB35PN", "Amphenol TV class K (passivated SS firewall)"),
    ("TVS07RS-11-35PN", "D38999/24SB35PN", "Amphenol TV class S (Ni-plated SS firewall)"),
    ("TVS07RB-11-35PN", "D38999/24BB35PN", "Amphenol TV class B (marine bronze)"),
    ("TVS07RL-11-35PN", "D38999/24LB35PN", "Amphenol TV class L (Ni-plated SS non-firewall)"),

    # ---- Amphenol TV Series III hermetic ----
    ("TVS07Y-11-35PN", "D38999/23YB35PN", "Amphenol TV hermetic class Y"),
    ("TVS07YN-11-35PN", "D38999/23NB35PN", "Amphenol TV hermetic class N"),

    # ---- Amphenol PCB variants (CI/LI + F### deviation suffix) ----
    ("TV07WCI2111PF459", "D38999/24WG11PN", "PCB jam-nut + CI modifier + F459 standoff"),
    ("TVP00WCI0935P",    "D38999/20WA35PN", "PCB wall-mount + CI + shell-9 + insert-35"),
    ("TVP00WCI1135SA",   "D38999/20WB35SA", "PCB wall-mount + CI + shell-11 + insert-35 + key A"),

    # ---- Amphenol CTV composite ----
    ("CTV07RW-11-35PN", "D38999/24JB35PN", "Amphenol CTV composite class J"),
    ("CTVS07RF-11-35PN", "D38999/24MB35PN", "Amphenol CTV composite class M"),

    # ---- Conesys Aero-Electric AE3 / AE4 ----
    ("AE324WB35PN", "D38999/24WB35PN", "Conesys AE3 environmental"),
    ("AE321YB35PN", "D38999/21YB35PN", "Conesys AE3 hermetic"),
    ("AE443NB35PN", "D38999/43NB35PN", "Conesys AE4 hermetic"),

    # ---- Glenair 233/234 ----
    ("233-105-07NF13-35PN", "D38999/24WC35PN", "Glenair 233-105 env, class W (NF=OD cad)"),
    ("233-105-00ME17-35PN", "D38999/20FE35PN", "Glenair 233-105 env, class F (ME=EN)"),
    ("233-100-H7Z111-35PN", "D38999/23YB35PN", "Glenair 233-100 hermetic class Y"),
    ("234-100-H7Z111-35PN", "D38999/43YB35PN", "Glenair 234-100 Series IV hermetic"),

    # ---- ITT Cannon ----
    ("KJA7T13W35PN", "D38999/24WC35PN", "ITT KJA Series III, jam-nut"),
    ("KJA0T13W35PN", "D38999/20WC35PN", "ITT KJA Series III, wall-mount"),

    # ---- Souriau 8D ----
    ("8D7-13W35PN", "D38999/24WC35PN", "Souriau 8D jam-nut, dashed"),
    ("8D713W35PN",  "D38999/24WC35PN", "Souriau 8D jam-nut, no-dash"),
    ("8D5-13W35PN", "D38999/26WC35PN", "Souriau 8D plug"),

    # ---- TE Deutsch DTS / ACT ----
    ("DTS24W1335PN", "D38999/24WC35PN", "TE DTS Series III environmental"),
    ("DTS20Y1135PN", "D38999/21YB35PN", "TE DTS Series III hermetic"),
    ("ACT24MB35PN",  "D38999/24MB35PN", "TE ACT composite"),

    # ---- Eaton Breech-Lok Series IV ----
    ("BL00W-13-35PN", "D38999/40WC35PN", "Eaton BL Series IV wall-mount"),
    ("BL00W1335PN",   "D38999/40WC35PN", "Eaton BL Series IV no-dash"),
    ("BLH2Y1135PN",   "D38999/41YB35PN", "Eaton BL Series IV hermetic"),
]


JS_HARNESS = r"""
const fs = require('fs');
const path = require('path');
const args = JSON.parse(fs.readFileSync(0, 'utf8'));
const APP = args.app;
global.window = {};
eval(fs.readFileSync(path.join(APP, 'app-data.js'), 'utf8'));
global.document = { getElementById: () => null, addEventListener: () => {}, readyState: 'loading' };
eval(fs.readFileSync(path.join(APP, 'converter.js'), 'utf8'));

const out = [];
for (const [pn, expected, desc] of args.cases) {
  try {
    const r = global.D38999Converter.convertInput(pn);
    const got = (r.results || []).map((x) => x.parsed && x.parsed.normalized).filter(Boolean);
    out.push({ pn, expected, desc, got, status: got.includes(expected) ? 'PASS' : 'FAIL' });
  } catch (e) {
    out.push({ pn, expected, desc, err: e.message, status: 'ERROR' });
  }
}
process.stdout.write(JSON.stringify(out));
"""


def main() -> int:
    if shutil.which("node") is None:
        print("ERROR: node is required to run the JS converter", file=sys.stderr)
        return 2

    proc = subprocess.run(
        ["node", "-e", JS_HARNESS],
        input=json.dumps({"app": str(APP), "cases": CASES}),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        print("node failed:", proc.stderr, file=sys.stderr)
        return proc.returncode

    results = json.loads(proc.stdout)
    width = max(len(r["pn"]) for r in results)
    pass_n = fail_n = 0
    for r in results:
        status = r["status"]
        if status == "PASS":
            pass_n += 1
            print(f"  PASS    {r['pn']:<{width}}  =>  {r['expected']}   ({r['desc']})")
        else:
            fail_n += 1
            detail = r.get("err") or f"got {r['got']}"
            print(f"  {status}   {r['pn']:<{width}}  expected {r['expected']}, {detail}   ({r['desc']})")

    print()
    print(f"Round-trip: {pass_n}/{pass_n + fail_n} passed")
    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
