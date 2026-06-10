# D38999 Visual Asset Notes

## Useful source drawings

| Drawing type | Source | Why it matters | Direct use? |
| --- | --- | --- | --- |
| Straight plug side profile | `Conesys-MIL-DTL-38999-Series-III.pdf page 49`; `Souriau-Mil-DTL-38999-Series-III.pdf page 44` | Explains plug body, coupling nut, and mating length | Recreate only |
| Wall-mount receptacle outline | `Conesys-MIL-DTL-38999-Series-III.pdf page 4`; `Souriau-Mil-DTL-38999-Series-III.pdf page 43` | Good icon for receptacle family selection | Recreate only |
| Jam-nut receptacle outline | `Conesys-MIL-DTL-38999-Series-III.pdf page 48`; `Souriau-Mil-DTL-38999-Series-III.pdf page 43` | Helps explain rear-panel mounting | Recreate only |
| Keying / polarization diagram | `Conesys-MIL-DTL-38999-Series-III.pdf page 50` | Explains normal vs A/B/C/D/E and the plug/receptacle view reversal | Recreate only |
| Shell size / thread table | `Souriau-Mil-DTL-38999-Series-III.pdf page 43` | Useful backshell and shell-size helper | Recreate only |
| Dummy receptacle drawing | `Souriau-Mil-DTL-38999-Series-III.pdf page 25`; `MIL-DTL-38999/9B page 1`; `MIL-DTL-38999/50C page 1` | Good warning visual to separate protection parts from live mates | Recreate only |
| Insert arrangement front views | `d38999-contact-arrangements.pdf pages 3 to 9` | Already used in app and safe to redraw from extracted geometry | Safe if redrawn |

## Created simplified SVGs

The repo now includes simplified technical SVGs in `assets/svg/` for:

- generic plug
- generic receptacle
- wall-mount receptacle
- jam-nut receptacle
- straight plug
- backshell / accessory
- keying helper
- shell-size helper
- insert placeholder

These are intentionally schematic and should not be treated as dimensionally certified drawings.

## Copyright / safety notes

- Do not embed catalog page fragments directly in the app.
- Use catalog drawings as geometry references only.
- Keep labels generic and omit logos, title blocks, and original page ornamentation.
