# Reciprocal Connector Logic

## Rule Set

The app should treat a reciprocal connector as a catalog-backed candidate that matches the front mating interface, not as a string mutation.

### Must match

- Series / interface family
- Shell size
- Insert arrangement
- Keying / polarization letter

### Must be opposite

- Plug vs receptacle role
- Pin vs socket contact gender

### May differ

- Finish / class, if the catalog does not make it part of the mating interface
- Rear termination style, if the slash sheet supports that contact family
- Mounting details, if the mating interface remains the same

### Needs catalog lookup

- Hermetic variants
- Accessory thread / backshell fit
- Proprietary sub-families and reinforced locking variants

## Catalog grounding requirement

The reciprocal finder should return one of these statuses for every candidate:

- `VERIFIED_EXISTS`: exact candidate part number appears in the catalog data
- `VALID_FORMAT_BUT_NOT_CONFIRMED`: exact candidate PN not seen, but every field is supported by a cited construction rule
- `INVALID_COMBINATION`: one or more required fields conflict
- `MISSING_DATA`: not enough catalog-backed data is loaded to validate the candidate
- `MANUFACTURER_SPECIFIC_UNCERTAIN`: manufacturer caveat or proprietary family blocks automatic confirmation

## Pseudocode

```text
input: source connector PN or decoded object

1. Decode source PN into normalized fields.
2. Validate source PN against catalog-backed shell-style, contact-style, and keying rules.
3. Stop early if source shell style is an accessory, dummy receptacle, or unsupported family.
4. Determine source role and required opposite role.
5. Determine required opposite contact gender.
6. Keep shell size, insert arrangement, and keying fixed.
7. Query catalog-backed mating slash-sheet map for allowed opposite shell styles.
8. For each allowed shell style:
   a. Construct a candidate PN only if the contact flip is catalog-supported.
   b. Decode the candidate.
   c. Validate the candidate against exact verified part numbers first.
   d. If not exact, validate against cited shell-style / contact-style / keying rules.
   e. Record matched fields, opposite fields, conflicts, missing data, warnings, and source citations.
9. Rank valid candidates by required matches plus verification status.
10. Never present an unconfirmed candidate as verified.
```

## Ranking / scoring

Use weighted scoring only after the candidate passes the hard gates.

- Series match: high weight
- Shell size match: required hard gate
- Insert arrangement match: required hard gate
- Keying match: required hard gate
- Contact gender opposite: required hard gate
- Plug/receptacle opposite: required hard gate
- Exact verified part number: large bonus
- Valid format but not exact: small bonus
- Missing data or manufacturer-specific uncertainty: penalty

## Edge cases

- Hermetic receptacles: do not auto-confirm a mate without hermetic evidence.
- Dummy receptacles and protective covers: exclude from electrical mate results.
- Same connector returned as its own mate: always invalid.
- Unsupported contact flip: return `MISSING_DATA` or `MANUFACTURER_SPECIFIC_UNCERTAIN`, not a fake PN.

## Examples

### Valid unconfirmed reciprocal

- Source: `D38999/26WE35PN`
- Required mate: Series III receptacle, shell size 17, insert 17-35, keying N, socket contacts
- Candidate slash sheets: `/20`, `/24`
- Candidate status: `VALID_FORMAT_BUT_NOT_CONFIRMED` unless the exact PN is present in the verified dataset

### Verified reciprocal family example

- Source family example: `D38999/26FD35PN`
- Exact verified source example appears in `TE_Deutsch_D38999_Series_III.pdf page 3`
- Reciprocal rules still require catalog validation for the target PN; the app must not label the target as verified unless that exact target PN is in the dataset

### Invalid examples

- Plug with pin contacts matched to another pin connector
- Same shell size but different insert arrangement
- Same arrangement but different key letter
- Dummy receptacle returned as a live reciprocal
