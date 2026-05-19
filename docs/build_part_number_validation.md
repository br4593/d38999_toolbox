# Build Part Number Validation

## How Build P/N should work

The builder should assemble a normalized decoded object first, then validate it against catalog-backed rules.

Validation flow:

1. Decode shell style, class, shell size, insert arrangement, contact style, and keying.
2. Confirm that the shell style exists in the loaded catalog-supported combinations.
3. Confirm that the contact style and keying are permitted for that shell style.
4. Confirm that the insert arrangement exists in the drawing database.
5. Check the exact built PN against the verified part-number dataset.
6. If not exact, return `VALID_FORMAT_BUT_NOT_CONFIRMED` only when the shell-style rule still supports the combination.

## Status meanings

- `VERIFIED_EXISTS`: exact PN appears in the local cited dataset
- `VALID_FORMAT_BUT_NOT_CONFIRMED`: format is valid and rule-supported, but exact PN has not yet been captured verbatim
- `INVALID_COMBINATION`: shell style, keying, or contact style conflicts with the cited rules
- `MISSING_DATA`: arrangement or shell-style evidence is missing
- `MANUFACTURER_SPECIFIC_UNCERTAIN`: proprietary or hermetic caveat blocks automatic confirmation

## UI behavior

- Show the status label next to the built part number.
- Show the exact reason string used to produce the status.
- Show the supporting source citations used to validate the current combination.
- If the part is only rule-supported, explicitly warn that the exact PN was not found verbatim in the local dataset.

## Verified vs valid-looking vs invalid

### Verified

- `D38999/26FD35PN`
- Seen directly in `TE_Deutsch_D38999_Series_III.pdf page 3`

### Valid-looking but not confirmed

- A decoded Series III `/20` or `/24` mate built from a known `/26` source where shell style, insert arrangement, keying, and opposite contact style are supported, but the exact target PN is not in the verified dataset yet

### Invalid

- Any PN using a shell style not present in the loaded shell-style table
- Any PN with a key letter that the shell style does not support
- Any PN with a contact family not supported by the chosen hermetic or environmental shell family
