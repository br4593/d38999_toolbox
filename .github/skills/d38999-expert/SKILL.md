---
name: d38999-expert
description: >
  Expert knowledge base for MIL-DTL-38999 / D38999 circular connectors.
  Use this skill when the user asks about D38999 part numbers, insert
  arrangements, shell types, classes, finishes, contact styles, manufacturer
  cross-references, mating rules, or the d38999_toolbox app. Covers Series
  I–IV anatomy, part-number decoding, reciprocal connector logic, and
  manufacturer equivalents for Amphenol, Conesys, Eaton, Glenair, ITT Cannon,
  Souriau, and TE Deutsch.
---

# D38999 Expert Skill

This skill provides authoritative, data-backed knowledge for the
MIL-DTL-38999 (D38999) circular connector standard and the `d38999_toolbox`
app in this repository. Always cite data as sourced from `dtl38999.pdf`,
manufacturer catalogs, or extracted JSON when giving answers.

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
| `data/standard_definitions.json` | Classes, contact styles, series definitions. |
| `data/part_number_rules.json`    | Shell-size codes, contact styles, decode algorithm. |
| `data/insert_arrangements.json`  | 63 arrangements and contact coordinates. |

### Regeneration commands

```bash
python scripts/extract_arrangements.py          # → app/data/insert_arrangements.json + SVGs
python scripts/extract_standard_definitions.py  # → app/data/standard_definitions.json + part_number_rules.json
python scripts/extract_dla_documents.py         # → app/data/dla_documents.json
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
