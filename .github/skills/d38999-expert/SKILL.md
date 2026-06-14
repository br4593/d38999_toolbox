---
name: d38999-expert
description: >
  Expert knowledge base for MIL-DTL-38999 / D38999 circular connectors.
  Use this skill when the user asks about D38999 part numbers, insert
  arrangements, shell types, classes, finishes, contact styles, manufacturer
  cross-references, mating rules, contact current ratings / wire gauge,
  current derating, parallel power contacts, high-speed and protocol wiring
  (Ethernet, USB, HDMI, DisplayPort, DVI, CAN, RS-485), rugged D38999-style
  I/O connectors (RJ45, USB, video), connector selection and pin allocation,
  QPL / qualified part-number lookups, environment suitability, or the
  d38999_toolbox app. Covers Series I–IV anatomy, part-number decoding,
  reciprocal connector logic, and manufacturer equivalents for Amphenol,
  Conesys, Eaton, Glenair, ITT Cannon, Souriau, and TE Deutsch.
---

# D38999 Expert Skill

This skill provides authoritative, data-backed knowledge for the
MIL-DTL-38999 (D38999) circular connector standard and the `d38999_toolbox`
app in this repository. Always cite data as sourced from `dtl38999.pdf`,
manufacturer catalogs, or extracted JSON when giving answers.

---

## Repository Data & Document Map

When answering, prefer this repository's extracted datasets and source PDFs over
memory. Cite the file you used.

### Source PDFs (`docs/pdfs/`)

| Location | Contents |
|----------|----------|
| `specs/MIL-DTL-38999-dtl38999.pdf` | The MIL-DTL-38999 detail specification (primary source of truth). |
| `specs/dtl38999sup1.pdf` | Supplement 1 — series-specific slash-sheet family lists. |
| `specs/dtl38999suppliersmemo.pdf` | DLA suppliers memo. |
| `specs/slash-sheets/dtl38999ss##.pdf` | 46 individual slash-sheet drawings (`/9`,`/10`,`/20`–`/52`,`/60`–`/62`, plus `id##` initial drafts). |
| `specs/ms-sheets/ms####.pdf` | 42 MS-sheet drawings for Series I / II (MS27466–MS27662, MS27342…). |
| `reference/d38999-contact-arrangements.pdf` | MIL-STD-1560 insert-arrangement geometry (source of `insert_arrangements.json`). |
| `reference/d38999-shell-keying.pdf` | Shell keying / polarization rotation angles. |
| `catalogs/<vendor>/` | Manufacturer catalogs: amphenol, conesys, eaton, glenair, itt-cannon, souriau, te-deutsch, general. |
| `datasheets/glenair-superseal/`, `glenair-space-grade/`, `te-tv/`, `other/` | Product-line datasheets (rugged USB, space-grade, TV series). |
| `manifest.json` | Manifest of all 143 committed PDFs, sorted by path; each entry is `{file, path, category, bytes, url}` where `category` is derived from the folder (e.g. `catalog/amphenol`, `specs/slash-sheets`) and `url` is the upstream source (null when unknown). |

### Extracted datasets (`data/`)

| File | What it holds |
|------|---------------|
| `standard_definitions.json` | Series, classes, contact styles, shell-size codes, **keying rotation angles**, slash-sheets — each with `dtl38999.pdf` page/section citations and a confidence tag. |
| `part_number_rules.json` | Shell-size codes, contact styles and the decode algorithm. |
| `pinout_rules.json` | Pin-label / gauge rules used by the pinout decoder. |
| `insert_arrangements.json` | 63 arrangements, ~1,747 contacts: per-contact x/y, contact size, service rating, SVG crop. |
| `insert_materials.json` | Insert-system **materials & coloring**: hard dielectric insert, resilient interfacial seal / rear grommet, hermetic glass insert, potting compound — with spec citations and (non-standardized) observed colors. |
| `contact_current_ratings.json` | Per-contact-size test current (A) + wire AWG range, with catalog sources. |
| `connector_engineering_reference.json` | Current ratings, **derating** tables, parallel-contact engineering, protocol wiring, pin-allocation guidance, selection scoring. |
| `high_speed_interface_wiring_reference.json` | USB 2/3/C, HDMI, DisplayPort, DVI, VGA, DPI wiring + D38999 design rules. |
| `rugged_io_d38999_style_connectors.json` | Rugged D38999-style RJ45 / USB / video / 10G families and selection logic. |
| `d38999_extracted_rules.json` | Mating slash-sheet map, mating rules, opposite fields, keying options, **rear accessory threads**. |
| `d38999_catalog_supported_combinations.json` | Per-manufacturer supported shell styles / contacts / keying for reciprocal search. |
| `d38999_verified_part_numbers.json` | PNs that appear verbatim in a manufacturer catalog (`VERIFIED_EXISTS`). |
| `d38999_part_number_examples.json` | Worked decode examples with source page + validation status. |
| `d38999_valid_part_numbers.json` | Unified DB of **37,030** unique valid PNs with evidence level + environment tags. |
| `d38999_federalconnectors_secondary_source.json` | Secondary-source distributor index (35k+ exact PNs, lower trust). |
| `qpl_1122_part_numbers.json` / `qpl_1122_part_details.json` | DLA QPL-1122: **13,344** qualified PNs with CAGE / qualified source. |
| `qpl_1122_revalidation_report.json` | Slash-sheet + CAGE-code distribution and revalidation diffs. |
| `d38999_environment_classification.json` | Per-PN environment suitability audit (space, marine, salt-fog, vacuum…). |
| `conversion_rules.csv`, `finish_mappings.csv`, `style_mappings.csv`, `rule_constraints.csv`, `example_conversions.csv` | Tabular converter rules backing the cross-reference logic. |
| `d38999_cross_reference.sqlite` | SQLite build of the converter rule tables. |
| `dla_documents.json` | DLA Land & Maritime source catalog: 91 MIL-DTL-38999 documents (title, file, url, slash_sheet, family, series, is_initial_draft). Output of `scripts/extract_dla_documents.py`; a `build_app.py` input. |
| `d38999_visual_assets.json` | Registry of 44 visual assets (id, type, manufacturer, series, shellStyle, source, usage, copyrightStatus, file) that drive the app's connector graphics; a `build_app.py` input. |
| `review_needed.json` | Extraction-QA flags: 7 arrangement crops needing manual review (severity, issues, crop_bbox); a `build_app.py` input. |

**Trust order:** manufacturer-verified catalog PN → QPL-qualified → catalog-format-valid
→ secondary-source distributor index. Never present a secondary-source PN as "verified".

---

## Part-Number Anatomy (Series III / IV)

Format: `D38999/[slash-sheet][class][shell-size-code][insert-arrangement][contact-style][polarization]`

Example: `D38999/26WE35PN`

| Field             | Value | Meaning                            |
|-------------------|-------|------------------------------------|
| Slash-sheet       | `/26` | Series III straight plug           |
| Class/finish      | `W`   | Olive drab cadmium plate           |
| Shell-size code   | `E`   | Shell size 17                      |
| Insert arrangement| `35`  | MIL-STD-1560 arrangement 35        |
| Contact style     | `P`   | Pin contacts                       |
| Polarization      | `N`   | Normal (default) keying            |

### Decode algorithm
1. Normalize to uppercase and remove spaces.
2. Require prefix `D38999/` followed by a two-digit slash-sheet number.
3. Parse the final character as polarization and the preceding character as contact style.
4. Parse the remaining body by matching a known class designator followed by a known Series III/IV shell-size code letter and a numeric insert arrangement.
5. Resolve shell size from Table I and combine as shell-size–insert (e.g., shell code `E` + insert `35` → 17-35).

---

## Series Definitions

| Series | Description |
|--------|-------------|
| I      | Scoop-proof, bayonet coupling, inch-pound dimensions. |
| II     | Non-scoop-proof, bayonet coupling, low silhouette, inch-pound dimensions. |
| III    | Scoop-proof, triple-start self-locking threaded coupling, metric dimensions. |
| IV     | Scoop-proof, breech coupling, metric dimensions. |

---

## Shell-Size Codes (Series III / IV — TABLE I)

| Code | Shell Size |
|------|-----------|
| A    | 9         |
| B    | 11        |
| C    | 13        |
| D    | 15        |
| E    | 17        |
| F    | 19        |
| G    | 21        |
| H    | 23        |
| J    | 25        |

Source: `dtl38999.pdf` p. 3, "TABLE I. Shell size code for series III and IV part numbering."

---

## Slash-Sheet Reference (Series III / IV)

### Series III environmental (threaded)
| Slash-sheet | Role           |
|-------------|----------------|
| `/20`       | Wall receptacle |
| `/24`       | Jam-nut receptacle |
| `/26`       | Straight plug  |

### Series III hermetic
| Slash-sheet | Role                        |
|-------------|-----------------------------|
| `/21`       | Hermetic wall receptacle    |
| `/23`       | Hermetic jam-nut receptacle |
| `/25`       | Hermetic straight plug      |
| `/27`       | Hermetic straight plug (alt)|

### Series IV environmental (breech)
| Slash-sheet | Role                  |
|-------------|-----------------------|
| `/40`       | Wall receptacle       |
| `/42`       | Box receptacle        |
| `/44`       | Box receptacle (alt)  |
| `/46`       | Straight plug         |
| `/47`       | In-line receptacle    |
| `/49`       | Jam-nut receptacle    |

### Series IV hermetic
| Slash-sheet | Role                        |
|-------------|-----------------------------|
| `/41`       | Hermetic wall receptacle    |
| `/43`       | Hermetic jam-nut receptacle |
| `/45`       | Hermetic straight plug      |
| `/48`       | Hermetic weld-mount receptacle |

### Series I / II (MS-sheet families)

Series I and II are inch-pound, bayonet-coupling connectors numbered under the legacy
**MS27xxx** scheme rather than `D38999/` slash sheets. Their drawings live in
`docs/pdfs/specs/ms-sheets/` (e.g. `MS27466`, `MS27467`, `MS27468`, `MS27656`). Slash
sheets `/9` and `/10` (`specs/slash-sheets/dtl38999ss9.pdf`, `dtl38999ss10.pdf`) cover
Series I crimp/removable-contact wall and box receptacles.

**Mating rule:** A plug (`/26`, `/46`) mates with its reciprocal receptacle (`/20`, `/24` for Series III; `/40`, `/42`, `/44`, `/49` for Series IV). Never plug-to-plug or receptacle-to-receptacle.

---

## Classes / Finishes (Series III / IV — TABLE II)

| Code | Finish / Material |
|------|-------------------|
| A    | Nickel + cadmium plate; silver to light iridescent yellow. |
| B    | Olive drab cadmium plate over suitable underplate; conductive. |
| C    | Hard anodic, nonconductive coating. |
| D    | Fused tin plate, reflowed; inhibited tin whisker growth. |
| E    | Electrically conductive stainless steel, passivated. |
| F    | Electrically conductive electroless nickel. |
| G    | Same finish family as F. |
| H    | Electrically conductive, corrosion-resistant steel, passivated. |
| J    | Olive drab cadmium plate, dynamic salt-spray requirements. |
| K    | Electrically conductive, corrosion-resistant steel, passivated. |
| L    | Electrodeposited nickel. |
| M    | Electroless nickel or electrodeposited nickel; dynamic salt-spray. |
| N    | Electrodeposited nickel. |
| R    | Electroless or electrodeposited nickel; higher corrosion requirement. |
| S    | Electrodeposited nickel. |
| T    | Nickel fluorocarbon polymer; nonreflective. |
| U    | Nickel + cadmium plate; silver to light iridescent yellow. |
| V    | Tin-zinc alloy; conductive; not approved for NAVAIR use. |
| W    | Olive drab cadmium plate over suitable underplate; conductive. |
| Y    | Electrically conductive, corrosion-resistant steel, passivated. |
| Z    | Zinc-nickel, type D black; nonreflective. |
| AA   | Tri-nickel alloy plate; electroless nickel. |
| AB   | Same as class V. |

Double-character classes (e.g., `AA`) use a trailing hyphen in the PN: `D38999/26AA-E35PN`.

---

## Contact Styles

| Code | Gender | Description |
|------|--------|-------------|
| P    | Pin    | Standard, including hermetics with solder cups. |
| S    | Socket | Standard, including hermetics with solder cups. |
| H    | Pin    | 1500-cycle contact. |
| J    | Socket | 1500-cycle contact. |
| X    | Pin    | Eyelet termination (hermetic only). |
| Z    | Socket | Eyelet termination (hermetic only). |
| C    | Pin    | Feed-thru (hermetic only). |
| D    | Socket | Feed-thru (hermetic only). |
| R    | Pin    | Rhodium plating, including hermetics with solder cups. |
| M    | Socket | Rhodium plating, including hermetics with solder cups. |
| G    | Pin    | Heavy gold plating, including hermetics with solder cups. |
| U    | Socket | Heavy gold plating, including hermetics with solder cups. |
| A    | Pin    | Insert less standard pin contacts (contacts shipped separately). |
| B    | Socket | Insert less standard socket contacts (contacts shipped separately). |

Source: `dtl38999.pdf` p. 7, "1.4.2 Contact styles."

---

## Polarization / Keying

Series III keying letters: `A`, `B`, `C`, `D`, `E` (rotated positions) and `N` (normal/default). Angle values are tabulated in Figure 6 of the standard. Missing polarization defaults to `N`.

**Mating rule:** Plug and receptacle must have the **same** keying letter.

---

## Mating Rules Summary

| Field            | Rule |
|------------------|------|
| Series interface | Must match (or be explicitly cross-referenced by catalog). |
| Shell size       | Must match exactly. |
| Insert arrangement | Must match exactly. |
| Keying letter    | Must match exactly. |
| Contact gender   | Must be opposite (pin ↔ socket). |
| Plug/receptacle role | Must be opposite. |
| Finish/class     | May differ (not part of mating interface). |
| Rear termination | May differ if slash-sheet supports it. |

**Verification status values:**
- `VERIFIED_EXISTS` — exact PN found in catalog data.
- `VALID_FORMAT_BUT_NOT_CONFIRMED` — format valid, all fields supported by cited rules, but exact PN not in dataset.
- `INVALID_COMBINATION` — one or more required fields conflict.
- `MISSING_DATA` — insufficient catalog data to validate.
- `MANUFACTURER_SPECIFIC_UNCERTAIN` — manufacturer caveat blocks auto-confirmation.

---

## Insert Arrangements

The app includes **63 insert arrangements** and **1,747 contacts** extracted from `d38999-contact-arrangements.pdf`. Each arrangement is indexed by shell size and arrangement number (e.g., `17-35` = shell size 17, arrangement 35). Arrangement data lives in `app/data/insert_arrangements.json` and SVG crops in `app/assets/svg/`.

Each contact entry has: pin label, contact size (gauge), x/y coordinates, and a gauge symbol for the drawing.

---

## Insert Materials & Coloring

The **insert** is "the insulating dielectric within a connector shell… [it] houses the
contacts" (`dtl38999.pdf` §6 definitions, p.67). MIL-DTL-38999 controls the insert/seal
**materials** but **not their color** — insert and seal color is **not standardized**,
varies by manufacturer / material grade / lot, and **must never be used to identify,
qualify, mate-check, or verify a connector**. Data: `data/reference/insert_materials.json`.

| Part (what you see) | Spec material | Typical real-world color (observation only) |
|---------------------|---------------|---------------------------------------------|
| **Hard dielectric insert** — rigid body that retains contacts; the face of a socket connector | Reinforced epoxy resin or other rigid dielectric (often glass-filled DAP/epoxy; PPS/LCP/PEEK on high-temp lines) | Varies — most often **blue or green**; also tan/buff, black, brown |
| **Interfacial seal** — resilient front face of pin inserts, with raised rings around each pin | Silicone or fluorosilicone rubber | **Blue** predominates (the signature 38999 pin face); also red/orange, grey |
| **Rear grommet** — resilient back section, seals around each wire | Silicone or fluorosilicone rubber | **Blue** predominates; also red/orange, grey/black |
| **Hermetic insert** — contacts fused in glass (no polymer face) | Vitreous (sintered/compression) glass; + rigid dielectric socket support for styles D/S/Z/M/U | Translucent **green / amber / blue-green** |
| Sealing / cavity-fill / potting compound | RTV silicone per MIL-A-46146 | n/a |

Source: `dtl38999.pdf` §3.3.2 Materials (p.13–14), §3.4.3.4 Mating seals (p.19), §3.4.7
Cavity fill (p.21), §6 Definitions (p.67); Conesys Hermetic catalog p.6 (glass insulator).

- **Color tracks material grade, not the reverse.** Different qualified insert materials
  (for different CTI / temperature / arc-tracking needs) can look different — e.g. Souriau /
  Amphenol Socapex **"E" inserts** (CTI ≤100 V, ≤200 °C) vs **"V" inserts** (CTI ≤400 V, per
  VG96944). The grade is the real identifier, not the color (`Catalog MIL DTL 38999.pdf` p.114, 118).
- **Don't confuse with SHELL color features (these *are* spec-controlled):** Series III/IV
  **red band** = fully mated, **blue band** = rear-release contact retention; Series IV breech
  sheets `/40`, `/42`, `/47` call out a **blue color band** + **red unmated indicator**;
  contact ID characters marked on the insert face are preferably **white** (`dtl38999.pdf` p.29).

---

## Contact Sizes, Current Ratings & Wire Gauge

Per-contact maximum continuous **test current** at sea level, 25 °C ambient, mated
(Service Rating M). Larger size *number* = physically smaller contact = lower current.
A connector's current capacity is set by its **contact sizes**, not its shell size.

| Contact size | Current (A) | Wire AWG range | Role |
|--------------|-------------|----------------|------|
| 22D / 22     | 5.0   | 28–22 | Signal / low-power |
| 20           | 7.5   | 24–20 | General-purpose signal / light power |
| 16           | 13.0  | 20–16 | Medium power |
| 12           | 23.0  | 14–12 | High power (MS3348 bushing needed with 12 AWG) |
| 10           | 33.0  | 12–10 | High power |
| 8            | 46.0  | 8     | Heavy power |
| 4            | 78.0  | 4     | Very heavy power |
| 0            | 150.0 | 0     | Maximum power |

- **Size-8/12 coax and twinax** contacts are RF/data contacts with **no continuous
  power-current rating** — never use them for power loads.
- These are per-contact ceilings, **not** circuit guarantees: derate for bundle density,
  ambient temperature, and altitude (see below).

Source: `data/contact_current_ratings.json`, `data/connector_engineering_reference.json`
(Conesys Series III and ITT Cannon catalog electrical-data tables).

---

## Current Derating

Multiply the single-contact rating by the applicable factors. When several apply, multiply
them together.

**By number of energized contacts** (thermal coupling):

| Energized | 1 | 2 | 3 | 5 | 7 | 10 | 15 | 20 | 25 | 30 | 37 | 50 |
|-----------|---|---|---|---|---|----|----|----|----|----|----|----|
| Factor    |1.0|0.9|0.85|0.78|0.74|0.70|0.66|0.63|0.60|0.58|0.56|0.52|

**By ambient temperature:** 25 °C → 1.0, 50 °C → 0.85, 75 °C → 0.70, 100 °C → 0.55,
125 °C → 0.40 (and lower above that).

**By altitude:** sea level → 1.0, 5 kft → 0.95, 10 kft → 0.90, 20 kft → 0.82,
40 kft → 0.65, 70 kft → lower (reduced convective cooling).

Source: `data/connector_engineering_reference.json` → `derating`.

---

## Parallel Power Contacts

To carry more current than one contact allows, parallel contacts of the **same size and
length**, but design for **uneven current sharing** (Kirchhoff's Current Law: branch
currents divide by branch resistance, not equally).

- Size up first, parallel second: prefer a larger single contact (e.g. 2× size 12 ≈ 41 A
  derated) over many small ones.
- Apply the energized-contact derating to **every** paralleled contact.
- Mismatched crimp resistance, wire length, or contact wear causes one contact to hog
  current and overheat — the dominant failure mode.

Worked example (`connector_engineering_reference.json`): for 20 A continuous at 28 VDC,
do **not** use 3× size-20 at face value (22.5 A); derated for 3 energized contacts they
give 6.375 A each. Use 2× size-12 (≈20.7 A each derated) instead.

---

## Rear Accessory Thread by Shell Size (Series III)

Rear-accessory / jam-nut reference thread (metric) for backshell selection:

| Shell size | Thread | Shell size | Thread |
|-----------|--------|-----------|--------|
| 09 | M12 × 1 | 19 | M28 × 1 |
| 11 | M15 × 1 | 21 | M31 × 1 |
| 13 | M18 × 1 | 23 | M34 × 1 |
| 15 | M22 × 1 | 25 | M37 × 1 |
| 17 | M25 × 1 |    |        |

Source: `d38999_extracted_rules.json` → `accessoryThreads` (Souriau Series III catalog p. 43).

---

## High-Speed & Protocol Wiring

Use this when someone wants to carry a named protocol through a D38999 connector. Data:
`data/high_speed_interface_wiring_reference.json` and the `protocol_wiring_requirements`
block of `connector_engineering_reference.json`.

### Ethernet over D38999

| Protocol | Pairs | Conductors | Impedance | Notes |
|----------|-------|------------|-----------|-------|
| 100BASE-TX | 2 | 4 | 100 Ω diff | 1 TX pair, 1 RX pair. |
| 1000BASE-T | 4 | 8 | 100 Ω diff | All 4 pairs bidirectional. |
| 2.5/5GBASE-T | 4 | 8 | 100 Ω diff | Needs Cat6A-class controlled-impedance contacts. |
| 100BASE-T1 / 1000BASE-T1 | 1 | 2 | 100 Ω diff | Single-pair automotive Ethernet. |

### Other interfaces (conductor count / D38999 feasibility)

| Interface | Conductors | Diff pairs | Controlled-Z needed | D38999 feasible |
|-----------|-----------|------------|---------------------|-----------------|
| USB 2.0 | 5 | 1 | recommended | Yes |
| USB 3.x | 9–11 | 3+ | **required** | With twinax/quadrax |
| USB Type-C | 7–24 | case-dependent | required for SS lanes | Case-dependent; USB4/Thunderbolt: **no** |
| HDMI 1.x/2.0 | 11+ | 4 | **required** | With high-speed contacts |
| DisplayPort | 14+ | 4 lanes | **required** | With high-speed contacts |
| DVI-D single | 14 | 4 | required | With high-speed contacts |
| VGA / DPI RGB | analog | — | shielding | Yes |

### D38999 high-speed design rules

- **HSI-001** — USB 3.x, HDMI, DisplayPort or DVI-D ⇒ require **controlled-impedance
  contacts** (twinax, quadrax, or vendor-qualified high-speed contacts), not ordinary
  size-22/20 power-signal pins.
- Match the contact's differential impedance to the protocol (90 Ω USB, 100 Ω Ethernet/
  HDMI/DP).
- USB-C is a connector *system* (orientation/CC/PD), not just a pinout — carrying USB-C
  signals through a D38999 needs CC resistors / a PD controller at each end.
- **Do not** attempt USB4 / Thunderbolt through a generic D38999 — it needs full PHY,
  retimers and extreme SI control.
- Keep shield drains adjacent to their pairs; keep high-speed pairs away from power
  contacts.

For ready-made solutions, prefer a purpose-built rugged family (next section) over
hand-wiring a high-speed protocol into a generic insert.

---

## Rugged D38999-Style I/O, Video & High-Speed Connectors

When a user needs Ethernet, USB, video or 10G **through a 38999-style shell**, recommend a
dedicated family instead of raw contacts. Data: `data/rugged_io_d38999_style_connectors.json`.

| Interface | Vendor | Family |
|-----------|--------|--------|
| RJ45 Ethernet | Amphenol Socapex/PCD | RJFTV, RJFTVX (ATEX), TV µCOM-10Gb+ |
| RJ45 Ethernet | Cinch | C-RJFTV |
| RJ45 Ethernet | Glenair | SuperNine RJ45, SuperNine RJ45 TVS (transient suppression) |
| RJ45 Ethernet | TE / POLAMCO | POLAMCO RJ45 |
| USB 2.0/3.x A | Amphenol Socapex/PCD | USBFTV, USB3FTV |
| USB-C / USB 3.2 | Amphenol Socapex/PCD | USB3CFTV |
| USB 2.0/3.0 | Glenair | SuperNine USB, SuperSeal USB 3.0 Type-A, SuperSeal USB 3.2 Gen 2 Type-C |
| HDMI | Amphenol Socapex/PCD | HDMIFTV |
| HDMI 2.0 | Glenair | SuperNine HDMI |
| Mini DP / DisplayPort | Amphenol Socapex/PCD | MDPFTV |
| DisplayPort 1.4 | Glenair | SuperSeal DisplayPort 1.4 |
| 10G+ Ethernet / high-speed | Glenair | SpeedMaster 10G |
| High-speed rugged data | PIC Wire | MACHFORCE |

For ordinary signal/power, the standard 38999 families are Amphenol Tri-Start TV/CTV,
TE DEUTSCH DTS/ACT, Eaton/Souriau 8D, Glenair SuperNine, and ITT Cannon KJA/KJB.

**Ethernet cable category:** Cat5e (≤1 Gbps, 100 MHz) → Cat6A (10 Gbps, 500 MHz) → Cat7/
high-speed modules for >10G; pick by required speed and run length.

---

## Connector Selection & Pin Allocation

### Selection scoring (weights)

`connector_engineering_reference.json` → `connector_selection_scoring`:

| Criterion | Weight | Meaning |
|-----------|--------|---------|
| electrical_fit | 30 | All required contacts available in the correct sizes. |
| current_margin | 20 | Adequate derating margin on power contacts. |
| signal_integrity | 15 | Correct contact types for high-speed signals. |
| spare_contacts | 10 | Spares for future expansion. |
| shell_size | 10 | Smallest shell that fits (weight/space). |
| separation | 10 | Physical separation of power vs. signal. |
| availability | 5 | Standard arrangement over exotic. |

### Pin-allocation priority

1. Power supply (V+, V−/RTN) — grouped, symmetric.
2. Power return / ground — paired with supply.
3. Chassis/frame ground — separate from signal ground where possible.
4. Shield drains — near their signal pairs.
5. High-speed differential pairs — grouped, away from power.
6. Differential buses (RS-485/422, CAN) — pairs adjacent.
7. Low-speed single-ended (UART, RS-232, discretes).
8. Spares — distributed for flexibility.

**Separation rules:** keep high-current contacts away from high-speed signals; never route a
CAN/RS-485 pair between two power contacts; place ground/return contacts between power and
signal groups.

---

## Manufacturer Cross-Reference

### Amphenol (Series III aluminum environmental — `/20`, `/24`, `/26`)

Pattern: `[prefix][numeric shell]-[insert][contact][key]`

| Slash-sheet | Class | Prefix        |
|-------------|-------|---------------|
| `/20`       | F     | `TVPS00RF-`   |
| `/20`       | W     | `TVP00RW-`    |
| `/20`       | T     | `TVP00DT-`    |
| `/20`       | Z     | `TVP00DZ-`    |
| `/24`       | F     | `TVS07RF-`    |
| `/24`       | W     | `TV07RW-`     |
| `/24`       | T     | `TV07DT-`     |
| `/24`       | Z     | `TV07DZ-`     |
| `/26`       | F     | `TVS06RF-`    |
| `/26`       | W     | `TV06RW-`     |
| `/26`       | T     | `TV06DT-`     |
| `/26`       | Z     | `TV06DZ-`     |

Example: `D38999/26WD35PN` → `TV06RW-15-35PN`

---

### Conesys / Aero-Electric

Pattern: `AE3[slash][class][shell-code][insert][contact][key]` (Series III)
Pattern: `AE4[slash][class][shell-code][insert][contact][key]` (Series IV)

Examples:
- `D38999/26WD35PN` → `AE326WD35PN`
- `D38999/43NB35PN` → `AE443NB35PN`

---

### Eaton (Series IV)

Pattern: `BL[style][finish][numeric shell]-[insert][contact][key]`

| D38999       | Eaton style |
|--------------|-------------|
| `/40`        | `00`        |
| `/42`        | `02`        |
| `/44`        | `07`        |
| `/46`        | `G6`        |
| `/47`        | `06`        |
| `/49`        | `03`        |
| `/41` (herm) | `H2`        |
| `/43` (herm) | `H7`        |
| `/45` (herm) | `H1`        |
| `/48` (herm) | `H4`        |

Example: `D38999/46WB35PN` → `BLG6W11-35PN`

---

### Glenair

Pattern: `233-105-[style][finish][numeric shell]-[insert][contact][key]` (Series III env.)
Pattern: `233-100-[style][finish][numeric shell]-[insert][contact][key]` (Series III herm.)
Pattern: `234-100-[style][finish][numeric shell]-[insert][contact][key]` (Series IV herm.)

Glenair finish codes:

| MIL class | Glenair code |
|-----------|--------------|
| F         | ME           |
| W         | NF           |
| Z         | ZN           |
| T         | MT           |
| M         | XM           |
| J         | XW           |
| Y         | Z1           |
| N         | ZL           |

Example: `D38999/26WD35PN` → `233-105-G6NF15-35PN`

---

### ITT Cannon (Series III — `/20`, `/24`, `/26`)

Pattern: `KJA[style]T[numeric shell][finish][insert][contact][key]`
Composite: `KJB[style]T[numeric shell][finish][insert][contact][key]`

Example: `D38999/26WD35PN` → `KJA6T15W35PN`

---

### Souriau 8D Series (Series III — `/20`, `/24`, `/26`)

Pattern: `8D[style]-[numeric shell][finish][insert][contact][key]`

| D38999 | Souriau style |
|--------|--------------|
| `/20`  | `0`          |
| `/24`  | `7`          |
| `/26`  | `5`          |

Example: `D38999/26WD35PN` → `8D5-15W35PN`

---

### TE Deutsch (Series III)

Aluminum/stainless: `DTS[slash][finish][numeric shell][insert][contact][key]`
Composite (ACT): `ACT[slash][finish][shell-code][insert][contact][key]`

Example: `D38999/26WD35PN` → `DTS26W1535PN`

---

## Qualified Products (QPL-1122) & Part-Number Databases

The repo carries scraped DLA qualification data and a unified valid-PN database. Use these
to answer "is this a real part?" and "who makes it?".

### QPL-1122 (DLA qualified products list)

- **13,344** qualified part numbers (`qpl_1122_part_numbers.json`,
  `qpl_1122_part_details.json`), across **21** slash sheets and **18** CAGE codes.
- Slash-sheet distribution (top): `/26` 1,977 · `/20` 1,499 · `/24` 952 · `/46` 433 ·
  `/40` 278 · `/44` 239 · `/42` 222 · `/49` 98 · `/33` 94.
- Top qualified manufacturers (CAGE / qualified part count):

  | CAGE | Manufacturer | Parts |
  |------|--------------|-------|
  | F0225 | Souriau | 16,413 |
  | 59976 | Aero-Electric Connector (Conesys) | 8,258 |
  | 77820 | Amphenol Corp | 7,885 |
  | 1R6R9 | Corsair Electrical Connectors | 7,423 |
  | F6162 | Amphenol Socapex / DC Electronics | 5,815 |
  | 06324 | Glenair, Inc. | 5,254 |
  | 34222 | Hi Rel Connectors | 2,931 |
  | 11139 | TE Connectivity / Tyco | 1,566 |
  | 0D0V6 | Cooper Interconnect | 1,410 |

- Legacy **`M38999/9-…`, `M38999/10-…`** and **`MS27466…`** entries are Series I/II
  qualified parts that don't decode with the Series III/IV algorithm — treat them as
  Series I/II MS-sheet products.

### Unified valid part-number database

`d38999_valid_part_numbers.json` — **37,030** unique valid PNs. Each `partNumbers` record
carries `decoded`, `nsn`, `qualifiedSources` (CAGE/company), `environment_tags`, and an
`evidenceLevel`:

| Evidence level | Count | Meaning |
|----------------|-------|---------|
| `manufacturer_verified_exact` | 3 | Appears verbatim in a manufacturer catalog. |
| `qpl_and_secondary_exact` | 4,227 | In QPL **and** the distributor index. |
| `qpl_qualified_source` | 1,787 | QPL-qualified family. |
| `secondary_exact_supported` | 31,013 | Distributor index only (lowest trust). |

**6,017** parts carry an NSN / qualified source. Always report the evidence level with a PN.

---

## Environment Suitability Tags

`d38999_environment_classification.json` audits each PN against environment profiles
(evidence encoded in `scripts/d38999_environment.py`). Available tags and approximate
counts within the 37k-PN set:

| Tag | Parts | Tag | Parts |
|-----|-------|-----|-------|
| aerospace_general / aircraft_fixed_wing | 36,858 | high_temperature | 19,523 |
| land (general/military/vehicle) | 36,858 | outdoor_exposed | 26,374 |
| high_vibration / high_shock | 36,858 | marine_above_deck / salt_fog / coastal | 20,496 |
| sealed_weatherproof | 36,858 | vacuum | 10,454 |
| high_emi_rfi | 36,855 | space | 885 |

Use this to answer "is this connector OK for space / salt-fog / vacuum?": most 38999
parts pass general aerospace/land/marine, while **space** (885) and **vacuum** (10,454)
qualification is restricted to specific finishes/hermetic styles.

---

## App Features (d38999_toolbox)

The app (`app/index.html`) is a self-contained offline single-page web app. No server or build step is required to run it.

| Tab / Feature       | What it does |
|---------------------|-------------|
| **Pinout decoder**  | Accepts `D38999/26WE35PN` or shorthand `26WE35PN`; renders the connector drawing with gauge-specific pin symbols and hover labels. Defaults P/N input to `D38999/`. |
| **Insert browser**  | Browse all 63 insert arrangements; filter by shell size; compare two arrangements side by side. |
| **Converter**       | Convert D38999 PNs to Amphenol, Conesys, Eaton, Glenair, ITT Cannon, Souriau, and TE Deutsch candidates, and back. |
| **Manual**          | Interactive PN guide with beginner-facing explanations; DLA Series III/IV shell-type document summaries. |

### Key app files

| File                   | Purpose |
|------------------------|---------|
| `app/app.js`           | Pinout decoder, insert browser, manual. |
| `app/converter.js`     | Manufacturer cross-reference converter. |
| `app/app-data.js`      | Generated: embedded JSON + converter rules (baked by `scripts/build_app.py`). |
| `app/data/*.json`      | Extraction outputs loaded at runtime. |
| `scripts/d38999_rules.py` | Converter rule database (source of truth for cross-reference logic). |
| `scripts/d38999_environment.py` | Environment-suitability classifier logic + evidence. |
| `data/standard_definitions.json` | Classes, contact styles, series definitions, keying angles. |
| `data/part_number_rules.json`    | Shell-size codes, contact styles, decode algorithm. |
| `data/insert_arrangements.json`  | 63 arrangements and contact coordinates. |
| `data/insert_materials.json` | Insert-system materials & coloring (hard insert, interfacial seal, grommet, hermetic glass). |
| `data/connector_engineering_reference.json` | Current ratings, derating, protocol wiring, selection scoring. |
| `data/high_speed_interface_wiring_reference.json` | USB / HDMI / DisplayPort / DVI / VGA wiring rules. |
| `data/rugged_io_d38999_style_connectors.json` | Rugged D38999-style RJ45 / USB / video / 10G families. |
| `data/qpl_1122_*.json` | DLA QPL-1122 qualified part numbers + details + revalidation report. |
| `data/d38999_valid_part_numbers.json` | Unified 37k-PN database with evidence levels and environment tags. |

### Regeneration commands

```bash
python scripts/extract_arrangements.py          # → app/data/insert_arrangements.json + SVGs
python scripts/extract_standard_definitions.py  # → app/data/standard_definitions.json + part_number_rules.json
python scripts/extract_dla_documents.py         # → data/dla_documents.json
python scripts/scrape_qpl_part_numbers.py       # → data/qpl_1122_part_numbers.json
python scripts/scrape_qpl_part_details.py       # → data/qpl_1122_part_details.json
python scripts/reconcile_qpl_revalidation.py    # → data/qpl_1122_revalidation_report.json
python scripts/scrape_federalconnectors.py      # → data/d38999_federalconnectors_secondary_source.json
python scripts/build_valid_d38999_pns.py        # → data/d38999_valid_part_numbers.json
python scripts/d38999_environment.py            # → data/d38999_environment_classification.json
python scripts/build_d38999_database.py         # → data/*.csv + data/*.sqlite
python scripts/build_app.py                     # → app/app-data.js (bundle)
```

### CLI converter

```bash
python scripts/convert_d38999.py D38999/26WD35PN
python scripts/convert_d38999.py D38999/26WD35PN --json
python scripts/convert_d38999.py D38999/26WD35PN --csv
```

---

## Common Questions & Answers

**Q: What does `D38999/26WE35PN` mean?**
Series III straight plug (`/26`), olive drab cadmium finish (`W`), shell size 17 (`E`), insert arrangement 35, pin contacts (`P`), normal keying (`N`).

**Q: What receptacles mate with a `/26` plug?**
`/20` (wall receptacle) and `/24` (jam-nut receptacle). Shell size, insert arrangement, and keying must all match; contact gender must be opposite (socket).

**Q: How do I find the Amphenol equivalent of `D38999/26WD35PN`?**
`TV06RW-15-35PN`. Use the app Converter tab or `python scripts/convert_d38999.py D38999/26WD35PN`.

**Q: What is shell size `H`?**
Shell size 23 (Series III/IV Table I).

**Q: What is the difference between contact styles `P` and `H`?**
Both are pin contacts. `P` is standard; `H` is a 1500-cycle rated pin contact.

**Q: Can class `C` (hard anodic) mate with class `W` (cadmium)?**
Yes — finish/class is not part of the mating interface. Shell size, insert arrangement, and keying must match; roles and contact genders must be opposite.

**Q: What is the `N` polarization?**
Normal (default) keying — the keying tooth is at the standard rotational position as defined in Figure 6 of the standard. If polarization is omitted from a PN, `N` is assumed.

**Q: How much current can a size-20 contact carry, and what wire fits it?**
7.5 A continuous at sea level / 25 °C, accepting 24–20 AWG wire. Derate for multiple energized contacts, temperature and altitude (see Current Derating). Source: `data/contact_current_ratings.json`.

**Q: I need 20 A continuous through a D38999 — what contacts?**
Don't trust face-value ratings. Two size-12 contacts (23 A each, ×0.90 derating for 2 energized ≈ 20.7 A each) is the clean answer; avoid paralleling many small contacts. See Parallel Power Contacts.

**Q: Can I run gigabit Ethernet / HDMI / USB 3 through a D38999?**
Yes, but only with controlled-impedance contacts (twinax/quadrax or vendor high-speed contacts) — rule HSI-001. For a turnkey solution use a rugged D38999-style family (RJFTV, SuperNine RJ45, HDMIFTV, SpeedMaster 10G…). USB4/Thunderbolt is **not** feasible through a generic D38999.

**Q: Is `D38999/26WD35PN` a real, qualified part?**
Check `data/d38999_valid_part_numbers.json` (37,030 unique PNs) for its evidence level, and `data/qpl_1122_part_numbers.json` (13,344 DLA-qualified PNs) for QPL qualification. Report the evidence level — manufacturer-verified > QPL-qualified > secondary-source.

**Q: Who makes D38999 connectors / which CAGE codes are qualified?**
Top QPL-1122 qualified sources: Souriau (F0225), Aero-Electric/Conesys (59976), Amphenol (77820), Corsair (1R6R9), Amphenol Socapex (F6162), Glenair (06324). See the QPL-1122 section.

**Q: Is a D38999 connector suitable for space or salt-fog?**
Most 38999 parts pass general aerospace/land/marine/salt-fog. Space (≈885 PNs) and vacuum (≈10,454) qualification is limited to specific finishes/hermetic styles — check `data/d38999_environment_classification.json`.

**Q: What's the rear accessory thread for a shell size 17?**
M25 × 1 (Series III). See Rear Accessory Thread by Shell Size.

**Q: What about Series I/II part numbers like MS27466 or M38999/9-…?**
Those are Series I/II (inch-pound, bayonet) products under the legacy MS27xxx / `M38999/9,/10` scheme. Their drawings are in `docs/pdfs/specs/ms-sheets/`; they do not decode with the Series III/IV algorithm.
