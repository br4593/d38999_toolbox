# Rugged D38999-Style I/O Connectors — Phase 0 Coverage Gap Matrix

Working research artifact for the "vast I/O research" effort. Tracks what the toolbox already
covers vs. what must be researched/added. Source of truth for current coverage:

- Data: `data/rugged_io_d38999_style_connectors.json` (+ `app/data/` mirror)
- Families: `RUGGED_IO_FAMILIES` / `FAMILY_SVG_MAP` in `app/converter.js`
- SVGs: `assets/d38999/svg/` (+ `app/assets/d38999/svg/` after `build_app.py`)
- Visual asset index: `data/d38999_visual_assets.json`

Legend: ✅ present · ⚠️ partial / needs verification · ❌ missing

---

## 1. Current-state matrix (existing families)

View columns: **PN-struct** = documented part-number structure · **Verified PNs** = exact
purchasable PNs on file · **Face** = mating-face SVG · **Side/mount** = profile + mount-style SVGs
(plug / jam-nut / flange / feedthru / standoff) · **Dims** = panel cutout & body dimensions captured.

| Vendor | Family (prefix) | Interface | PN-struct | Verified PNs | Face | Side/mount | Dims |
|---|---|---|---|---|---|---|---|
| Amphenol Socapex | RJFTV | RJ45 Ethernet | ⚠️ | ✅ | ✅ | ✅ (plug/jam/sqflange/redflange/bulkhead/standoff) | ❌ |
| Amphenol Socapex | RJF | RJ45 (26482 bayonet) | ⚠️ | ⚠️ | ✅ | ✅ (plug/jam) | ❌ |
| Cinch | C-RJFTV | RJ45 Ethernet | ⚠️ | ✅ | ✅ (shared) | ⚠️ (plug/jam/sqflange) | ❌ |
| Amphenol Socapex | USBFTV | USB 2.0 Type-A | ⚠️ | ✅ | ✅ | ✅ (plug/jam/sqflange/bulkhead) | ❌ |
| Amphenol Socapex | USB3FTV | USB 3.x Type-A | ⚠️ | ✅ | ✅ | ✅ (plug/jam/sqflange/redflange/standoff) | ❌ |
| Amphenol Socapex | USB3CFTV | USB-C / USB 3.2 | ⚠️ | ✅ | ✅ | ✅ (plug/jam/sqflange/standoff) | ❌ |
| Amphenol Socapex | USBBFTV | USB Type-B | ❌ | ❌ | ✅ | ❌ (face only) | ❌ |
| Amphenol Socapex | HDMIFTV | HDMI 2.0 | ❌ | ❌ | ✅ | ✅ (plug/jam/sqflange/redflange/standoff) | ❌ |
| Amphenol Socapex | MDPFTV | Mini DisplayPort | ❌ | ❌ | ✅ | ⚠️ (plug/jam/sqflange) | ❌ |
| Glenair SuperNine | 233-3xx RJ45 | RJ45 Cat5e/6A | ✅ | ✅ | ✅ | ❌ (face only) | ❌ |
| Glenair SuperNine | 244-00x RJ45 TVS | RJ45 Cat5e TVS | ⚠️ | ❌ | ✅ | ❌ (face only) | ❌ |
| Glenair SuperNine | 233-34x/37x USB | USB 2.0/3.0 | ✅ | ✅ | ✅ | ❌ (face only) | ❌ |
| Glenair SuperSeal | 233-35x USB3-A | USB 3.0/3.2 Gen1 | ⚠️ | ✅ | ✅ | ❌ (face only) | ⚠️ (some from PDFs) |
| Glenair SuperSeal | 233-38x USB-C | USB 3.2 Gen2 Type-C | ⚠️ | ❌ | ✅ | ❌ (face only) | ❌ |
| Glenair SuperNine | 233-36x HDMI | HDMI 2.0 | ⚠️ | ❌ | ✅ | ❌ (face only) | ❌ |
| Glenair SuperSeal | 233-376/379 DP | DisplayPort 1.4 | ⚠️ | ❌ | ✅ | ❌ (face only) | ⚠️ |

### Current-state takeaways
- **Side/profile + mount views**: Amphenol families are well covered; **every Glenair family is face-only** → largest visual gap.
- **PN structure**: documented for Glenair RJ45/USB; missing for Amphenol HDMI/MDP/USB-B and Glenair USB-C/HDMI/DP.
- **Verified PNs**: thin for Amphenol HDMI/MDP/USB-B and several Glenair video/USB-C families.
- **Dimensions / panel cutout**: essentially uncaptured everywhere → needed to draw accurate side views.

---

## 2. Missing interfaces (within existing vendors)

| Vendor | Interface to add | Notes / target series |
|---|---|---|
| Amphenol Socapex | Full-size DisplayPort | currently only Mini-DP (MDPFTV) |
| Amphenol Socapex | HDMI 2.1 | verify if available beyond HDMI 2.0 |
| Amphenol Socapex | USB-C 3.2 Gen2 verified PNs | structure + exacts missing |
| Glenair | RJ45 10GBASE-T / Cat6A side views | dims for cutouts |
| Glenair | Quadrax / 10G Ethernet inserts | 38999 insert-based Ethernet |
| Glenair | Fiber (MT / expanded-beam) in 38999 | SuperNine fiber |

---

## 3. Missing vendors (net-new families to research)

| Vendor | Likely rugged I/O lines | Interfaces |
|---|---|---|
| TE Connectivity / DEUTSCH | rugged RJ45 / USB / video modules | Ethernet, USB |
| ITT Cannon | rugged Ethernet / USB / fiber | Ethernet, USB, fiber |
| Souriau / Eaton | 8D-based I/O, Ethernet/USB modules | Ethernet, USB |
| Conesys | D38999-style I/O | Ethernet, USB |
| Radiall | RF/coax + fiber in 38999 shells | RF, fiber |
| Times Microwave | coax-in-38999 | RF/coax |
| Smiths / Hypertronics | high-speed rugged I/O | Ethernet, high-speed |
| Amphenol RF / SV Microwave | SMA/SMP/SMPM in 38999 | RF/coax |

---

## 4. Missing interface CLASSES (cross-vendor)

| Interface class | Status | Research target |
|---|---|---|
| RF / coax (SMA, SMP/SMPM, TNC, BNC, N) | ❌ none | RF-in-38999 shells |
| Fiber optic (MT/MTP, expanded-beam) | ❌ none | Glenair/Amphenol/TE fiber |
| Video SDI / 3G-SDI coax | ❌ none | rugged broadcast/ISR video |
| Databus (MIL-STD-1553, ARINC, CAN, RS-485) | ❌ none | hybrid signal modules |
| USB4 / Thunderbolt | ❌ none | verify rugged availability |
| M12 X-coded in 38999 shell | ❌ none | industrial-mil crossover |
| Hybrid power+signal+data | ⚠️ standard families only | mixed-insert I/O |

---

## 5. Visual asset gap summary (all 3 view types requested)

| View type | Status | Priority action |
|---|---|---|
| Side / profile (elevation) | ❌ no dedicated elevation SVGs; only mount-style drawings exist | add `<family>-side.svg` per family; **Glenair first** |
| Face (new families) | ✅ existing, ❌ for net-new families | create face SVG per new family added |
| Per-mount variants (plug/jam-nut/flange/feedthru/standoff) | ✅ Amphenol, ❌ Glenair | add mount SVGs + register in `FAMILY_SVG_MAP` for Glenair |

---

## 6. Phase plan (driven by this matrix)

1. **Phase 1 — Ethernet & USB**: TE/DEUTSCH + ITT rugged RJ45/USB; add side/mount SVGs for all
   Glenair RJ45/USB families; capture panel-cutout dims.
2. **Phase 2 — Video**: complete HDMI 2.0/2.1 + DisplayPort (Amphenol full-size DP, Glenair HDMI/DP
   verified PNs + side views); add SDI/coax video.
3. **Phase 3 — RF/coax + fiber**: SMA/SMP/TNC-in-38999, MT/expanded-beam fiber.
4. **Phase 4 — Databus & hybrid**: 1553/CAN/RS-485, mixed power+signal+data.

Each phase: update JSON → add SVGs to BOTH svg dirs → register prefix in
`RUGGED_IO_FAMILIES`/`FAMILY_SVG_MAP` → `python3 scripts/build_app.py` →
`python3 scripts/smoke_test_connectors.py --full --quiet` (expect 0 failures, known benign warnings only).

## Guardrails
- Only verbatim manufacturer PNs become `verified_purchasable_pns`; inferred go to `example_pns` with warnings.
- Capture dimensions/cutouts directly from drawing tables (needed for accurate side views).
- Save fetched datasheets under `docs/pdfs/`; record `source` URL + local path per family.
