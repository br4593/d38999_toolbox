# D38999 Manufacturer Part Number Guide

This workspace contains the PDFs downloaded from `https://d38999.federalconnectors.com/`, extracted text, a rule database, and a converter script.

## Files

- `pdfs/` - downloaded source PDFs and `manifest.json` with source URLs.
- `text/` - PyMuPDF text extraction for each PDF.
- `data/d38999_cross_reference.sqlite` - SQLite database of conversion rules.
- `data/*.csv` - CSV exports of the same rule tables.
- `scripts/convert_d38999.py` - command-line converter.
- `scripts/build_d38999_database.py` - rebuilds the SQLite and CSV files from the rule source.

## Quick Use

Run:

```powershell
python scripts\convert_d38999.py D38999/26WD35PN
```

Example result for `D38999/26WD35PN`:

| Manufacturer | Candidate manufacturer PN |
|---|---|
| Amphenol | TV06RW-15-35PN |
| Conesys | AE326WD35PN |
| Glenair | 233-105-G6NF15-35PN |
| ITT Cannon | KJA6T15W35PN |
| Souriau | 8D5-15W35PN |
| TE Deutsch | DTS26W1535PN |

Other useful modes:

```powershell
python scripts\convert_d38999.py "D38999/43 N B - 35 P N" --csv
python scripts\convert_d38999.py D38999/20MD35PN --json
python scripts\build_d38999_database.py
```

## D38999 PIN Anatomy

For Series III and IV, the MIL PIN is:

`D38999/[shell type][class][shell-size letter][insert arrangement][contact type][keying]`

Example: `D38999/26WD35PN`

| Field | Value | Meaning |
|---|---:|---|
| Shell type | `/26` | Series III straight plug |
| Class | `W` | Aluminum, olive drab cadmium |
| Shell size | `D` | Size 15 |
| Insert | `35` | MIL-STD-1560 insert arrangement |
| Contact | `P` | Pin contacts |
| Key | `N` | Normal keying |

Series III and IV shell-size letters convert as:

| A | B | C | D | E | F | G | H | J |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 9 | 11 | 13 | 15 | 17 | 19 | 21 | 23 | 25 |

## Manufacturer Coverage

### Amphenol

Source PDFs: `Amphenol_D38999_Series_III.pdf`, `Amphenol-MIL-DTL-38999-series-I-II.pdf`

Automated coverage:

- Series III aluminum commercial TV parts for `/20`, `/24`, `/26`
- Classes `F`, `W`, `T`, `Z`
- Contacts `P`, `S`, `A`, `B`, `H`, `J`

Pattern:

- `/20` wall receptacle: `TVPS00RF-`, `TVP00RW-`, `TVP00DT-`, `TVP00DZ-`
- `/24` jam nut: `TVS07RF-`, `TV07RW-`, `TV07DT-`, `TV07DZ-`
- `/26` plug: `TVS06RF-`, `TV06RW-`, `TV06DT-`, `TV06DZ-`
- Then append `[numeric shell]-[insert][contact][key]`

Example: `D38999/26WD35PN` -> `TV06RW-15-35PN`

The Amphenol PDF also documents CTV composite, TVS stainless, and hermetic families, but the extracted text did not preserve every finish-specific commercial prefix clearly enough to automate without risk. Those are summarized in the database notes, not emitted as exact candidates.

### Conesys / Aero-Electric

Source PDFs: `Conesys-MIL-DTL-38999-Series-III.pdf`, `Conesys-Hermetic.pdf`

Automated coverage:

- Series III environmental `/20`, `/24`, `/26`: `AE3[style][class][shell letter][insert][contact][key]`
- Series III hermetic `/21`, `/23`, `/25`, `/27`: same `AE3` pattern
- Series IV hermetic `/41`, `/43`, `/45`, `/48`: `AE4[style][class][shell letter][insert][contact][key]`

Examples:

- `D38999/26WD35PN` -> `AE326WD35PN`
- `D38999/21YB35PN` -> `AE321YB35PN`
- `D38999/43NB35PN` -> `AE443NB35PN`

Note: the Conesys Series IV hermetic ordering table text has a weld-mount typo, but the catalog TOC and product page identify `/48` as `AE448`; the converter uses `/48`.

### Eaton

Source PDF: `Eaton_D38999_Series_IV.pdf`

Automated coverage:

- Series IV general-purpose `/40`, `/42`, `/44`, `/46`, `/47`, `/49`
- Series IV hermetic `/41`, `/43`, `/45`, `/48`

Pattern:

`BL[style][finish][numeric shell]-[insert][contact][key]`

Key style mappings:

| D38999 | Eaton style |
|---|---|
| /40 | 00 |
| /42 | 02 |
| /44 | 07 |
| /46 | G6 |
| /47 | 06 |
| /49 | 03 |
| /41 | H2 |
| /43 | H7 |
| /45 | H1 |
| /48 | H4 |

Examples:

- `D38999/46WB35PN` -> `BLG6W11-35PN`
- `D38999/43NB35PN` -> `BLH7N11-35PN`

### Glenair

Source PDF: `Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf`

Automated coverage:

- Series III environmental `/20`, `/24`, `/26`: `233-105`
- Series III hermetic `/21`, `/23`, `/25`, `/27`: `233-100`
- Series IV hermetic `/41`, `/43`, `/45`, `/48`: `234-100`

Examples:

- `D38999/26WD35PN` -> `233-105-G6NF15-35PN`
- `D38999/20MD35PN` -> `233-105-00XM15-35PN`
- `D38999/43NB35PN` -> `234-100-H7ZL11-35PN`

Important finish mappings used:

| MIL class | Glenair code |
|---|---|
| F | ME |
| W | NF |
| Z | ZN |
| T | MT |
| M | XM |
| J | XW |
| Y | Z1 |
| N | ZL |

The Glenair environmental pages list only `P` and `S` contacts in the covered section. Less-contact `A` and `B` variants may require factory confirmation.

### ITT Cannon

Source PDF: `ITT-Cannon-38999-Series-I-II-III.pdf`

Automated coverage:

- Series III aluminum/stainless D38999-style `/20`, `/24`, `/26`: `KJA`
- Series III composite D38999-style `/20`, `/26`: `KJB`

Pattern:

`KJA[style]T[numeric shell][finish][insert][contact][key]`

or composite:

`KJB[style]T[numeric shell][finish][insert][contact][key]`

Examples:

- `D38999/26WD35PN` -> `KJA6T15W35PN`
- `D38999/20MD35PN` -> `KJB0T15M35PN`

The ITT PDF states these are D38999-style commercial cross-references, not DLA QPL/QML MIL part numbers.

### Souriau

Source PDF: `Souriau-Mil-DTL-38999-Series-III.pdf`

Automated coverage:

- 8D Series III `/20`, `/24`, `/26`
- Aluminum classes `W`, `F`, `Z`
- Composite classes `J`, `M`
- Stainless classes `K`, `S`

Pattern:

`8D[style]-[numeric shell][finish][insert][contact][key]`

Style mappings:

| D38999 | Souriau 8D style |
|---|---|
| /20 | 0 |
| /24 | 7 |
| /26 | 5 |

Examples:

- `D38999/26WD35PN` -> `8D5-15W35PN`
- `D38999/20MD35PN` -> `8D0-15M35PN`

The Souriau catalog documents `H` and `J` 1500-cycle contacts on composite pages; the converter blocks them for other Souriau material classes unless the rule is expanded after factory confirmation.

### TE Deutsch

Source PDFs: `TE_Deutsch_D38999_Series_III.pdf`, `TE_Deutsch_D38999_Series_I.pdf`

Automated coverage:

- DTS Series III aluminum/stainless `/20`, `/24`, `/26`
- DTS Series III hermetic `/21`, `/23`, `/25`, `/27`
- ACT Series III composite `/20`, `/24`, `/26`

Patterns:

- DTS: `DTS[style][finish][numeric shell][insert][contact][key]`
- ACT: `ACT[style][finish][shell-size letter][insert][contact][key]`

Examples:

- `D38999/26WD35PN` -> `DTS26W1535PN`
- `D38999/20MD35PN` -> `ACT20MD35PN`
- `D38999/21YB35PN` -> `DTS20Y1135PN`

The TE Series I guide uses DJT commercial numbers for MS274xx Series I parts. That is included in the written guide context, but the automated converter is for D38999 slash-number Series III and IV PINs.

## Database Notes

The SQLite database is rule-based. It does not enumerate every possible insert arrangement; it stores the documented manufacturer patterns and applies them to the entered D38999 PIN.

Useful tables:

- `conversion_rules` - one row per automated manufacturer/product-line rule.
- `style_mappings` - maps D38999 slash shell types to manufacturer style codes.
- `finish_mappings` - maps D38999 classes to manufacturer finish codes.
- `rule_constraints` - contact/key/shell-size restrictions.
- `source_documents` - downloaded PDF sources used for the rules.
- `example_conversions` - sample output rows.

Example SQLite query:

```sql
SELECT manufacturer, product_line, format, confidence
FROM conversion_rules
ORDER BY manufacturer, product_line;
```

## Procurement Caveats

Use these conversions as sourcing candidates, not as final procurement authority. Before ordering, confirm:

- QPL/QML status when the purchase requires a MIL-qualified part.
- Exact finish requirement, especially zinc-nickel, space-grade, stainless/firewall, and RoHS variants.
- Whether contacts are supplied, omitted, or require an `L/C`, `L`, or other less-contacts suffix.
- Insert arrangements that use coax, twinax, quadrax, power, PCB-tail, or nonstandard contacts.
- Manufacturer-specific suffixes for modifications, backshell kits, clinch nuts, outgassing, caps, lanyard, and special packaging.

