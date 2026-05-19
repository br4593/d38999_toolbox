# D38999 PDF Research Report

## Scope

This repo currently contains 116 PDF files under `docs/pdfs/` plus one reference PDF at `data/reference/std1560.pdf`.

- `data/dla_documents.json` is the machine-readable inventory for 91 DLA base, supplement, and slash-sheet PDFs.
- `docs/pdfs/manifest.json` inventories the 13 primary manufacturer and standard catalog PDFs downloaded from public sources.
- The major text extractions under `text/` were used as page-tagged working copies for Conesys, TE Deutsch, Glenair, Souriau, Amphenol, Eaton, ITT Cannon, and the MIL base spec.

## PDF Inventory

### High-value catalog PDFs used directly for new rules

| Filename | Source | What it contains | Useful tables | P/N construction | Mating / compatibility | Exact examples | Drawings | Readability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `MIL-DTL-38999-dtl38999.pdf` | DLA | Base MIL-DTL-38999 definition, shell-size codes, classes, contact styles, polarization tables | Yes | Yes | Indirect via slash-sheet family rules | Yes | Yes | Readable |
| `Conesys-MIL-DTL-38999-Series-III.pdf` | Conesys | AE3 Series III part-number development, shell drawings, keying positions, insert availability notes | Yes | Yes | Yes | Yes | Yes | Readable |
| `Conesys-Hermetic.pdf` | Conesys | Hermetic Series I-IV notes, part-number development, blind-mate cautions, shell polarization | Yes | Yes | Yes, with caveats | Yes | Yes | Readable |
| `TE_Deutsch_D38999_Series_III.pdf` | TE Deutsch | Series III quick-reference ordering, military-to-commercial mapping, exact example PNs | Yes | Yes | Indirect | Yes | Limited | Readable |
| `TE_Deutsch_D38999_Series_I.pdf` | TE Deutsch | Series I quick-reference ordering, shell styles, contacts, keying restrictions | Yes | Yes | Indirect | Uses placeholder example | Limited | Readable |
| `Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf` | Glenair | 233-105 ordering tables, finish codes, shell style codes, exact example PN | Yes | Yes | Indirect | Yes | Yes | Readable |
| `Souriau-Mil-DTL-38999-Series-III.pdf` | Souriau / Eaton Souriau | 8D family mapping to D38999 types, shell size to thread tables, mated dimensions, dummy receptacle drawings | Yes | Yes | Yes | Some exact base examples | Yes | Readable |
| `Amphenol_D38999_Series_III.pdf` | Amphenol | TV / CTV family prefixes by shell style and finish, style drawings | Yes | Partial | Indirect | Prefix examples only in extracted text | Yes | Readable |
| `Eaton_D38999_Series_IV.pdf` | Eaton | Series IV ordering, supported keys, finishes, hermetic classes | Yes | Yes | Indirect | Limited in repo text coverage | Yes | Readable |
| `ITT-Cannon-38999-Series-I-II-III.pdf` | ITT Cannon | KJ/KJL/KJA/KJB family cross-reference and ordering | Yes | Yes | Indirect | Not fully extracted in this pass | Yes | Readable |
| `d38999-contact-arrangements.pdf` | Repo research asset | Insert arrangement drawings and geometry used by the app | Yes | N/A | Supports mating validation | N/A | Yes | Readable |
| `d38999-shell-keying.pdf` | Repo research asset | Keying/polarization helper | Yes | N/A | Yes | N/A | Yes | Readable |
| `std1560.pdf` | DLA | MIL-STD-1560 insert arrangement reference used to correct labels | Yes | N/A | Supports mating validation | N/A | Limited | Readable |

### DLA slash-sheet PDFs

`data/dla_documents.json` already inventories 91 DLA PDFs with filename, title, family, series, mount style, contact family, page count, and a text probe. That file should be treated as the authoritative exhaustive list for:

- base spec and supplement PDFs
- approved slash sheets
- initial draft slash sheets
- legacy MS sheets for Series I and II

Key repo-usable examples from that inventory:

- `dtl38999ss20.pdf`: wall-mount Series III receptacle, removable crimp contacts, readable
- `dtl38999ss21.pdf`: Series III hermetic box-mount receptacle, readable
- `dtl38999ss24.pdf`: jam-nut Series III receptacle, readable
- `dtl38999ss26.pdf`: Series III straight plug, readable
- `dtl38999ss40.pdf`: Series IV wall-mount receptacle, readable
- `dtl38999ss46.pdf`: Series IV straight plug with EMI fingers, readable
- `dtl38999ss50.pdf`: Series IV dummy receptacle, readable

### Other repo PDFs worth manual follow-up

| Filename | Notes |
| --- | --- |
| `Catalog MIL DTL 38999.pdf` | Large third-party compilation; useful, but should not override primary manufacturer/DLA citations. |
| `d38999-connector-catalog.pdf` | Generic catalog bundle; use only for supporting visuals after primary source confirmation. |
| `space-grade-d38999-20-datasheet.pdf` and related `space-grade-*` PDFs | Useful for hermetic or space-grade variants, but not fully normalized in this pass. |

## New App-Useful Insights

### Connector identification

- The slash-sheet code is the shell family, not the shell size. This is explicit in the MIL base spec and in TE / Conesys ordering pages. Source: `MIL-DTL-38999-dtl38999.pdf page 3`; `TE_Deutsch_D38999_Series_III.pdf page 3`; `Conesys-MIL-DTL-38999-Series-III.pdf page 3`.
- TE DTS uses numeric shell sizes while military and ACT composite examples keep shell-size letters. The decoder and builder must normalize both representations to the same physical shell size. Source: `TE_Deutsch_D38999_Series_III.pdf page 3`.
- Souriau explicitly maps 8D type 0 to D38999 `/20`, 8D type 7 to `/24`, and 8D type 5 to `/26`. This is useful for cross-manufacturer normalization. Source: `Souriau-Mil-DTL-38999-Series-III.pdf pages 42 to 44`.

### Reciprocal / mating logic

- Shell size, insert arrangement, series/interface, and keying must be held constant across the reciprocal search. Source: `Souriau-Mil-DTL-38999-Series-III.pdf page 44`; `Conesys-MIL-DTL-38999-Series-III.pdf page 50`.
- Pin/socket gender and plug/receptacle role must flip. Source: `MIL-DTL-38999-dtl38999.pdf page 7`; `Conesys-Hermetic.pdf page 6`.
- Keying letters prevent cross mating, but catalog drawings often show only the receptacle mating face and state that the plug view is opposite. The app must explain the view flip rather than implying a different key letter. Source: `Conesys-MIL-DTL-38999-Series-III.pdf page 50`.
- Hermetic receptacles should not get an auto-generated mate without a cited hermetic rule or exact example. Conesys explicitly calls out fixed solder contacts, special arrangements, and factory consultation. Source: `Conesys-Hermetic.pdf pages 6 and 7`.

### Mistakes that create false positives

- Matching accessory thread does not prove electrical reciprocity. It only proves backshell fit. Source: `Conesys-MIL-DTL-38999-Series-III.pdf page 4`; `Souriau-Mil-DTL-38999-Series-III.pdf page 43`.
- Dummy receptacles and protective covers look mechanically related but must never be returned as electrical mates. Source: `MIL-DTL-38999/9B page 1`; `MIL-DTL-38999/50C page 1`; `Souriau-Mil-DTL-38999-Series-III.pdf page 25`.
- Proprietary variants like reinforced locking or lanyard-release styles should not be mixed into standard reciprocal search without a catalog cross-reference. Source: `Souriau-Mil-DTL-38999-Series-III.pdf page 44`; `Conesys-MIL-DTL-38999-Series-III.pdf page 3`.

## Tables Converted Into App Data

- Mating rules and normalized shell styles: `data/d38999_extracted_rules.json`
- Cited example part numbers: `data/d38999_part_number_examples.json`
- Catalog-supported shell-style / contact-style / keying combinations: `data/d38999_catalog_supported_combinations.json`
- Exact verified part numbers seen in catalogs: `data/d38999_verified_part_numbers.json`
- Visual inventory and safe SVG recreation notes: `data/d38999_visual_assets.json`

## Uncertainties And Manual Review Items

- Some Amphenol extracted text exposes commercial prefixes cleanly but not enough exact full part-number examples to mark them as verified.
- The ITT Cannon and Eaton catalogs are present and readable, but only lightly normalized in this pass.
- Proprietary composite, reinforced-locking, space-grade, and third-party catalog bundles need a second extraction pass before they should affect automatic reciprocal generation.

## Recommended Next Extraction Pass

1. Normalize the remaining Series III and Series IV manufacturer families into exact shell-style code maps.
2. Add more exact verified part numbers from Eaton, Amphenol, ITT Cannon, and Souriau product pages.
3. Extend hermetic mating validation with per-slash-sheet contact-style and shell-size constraints.
