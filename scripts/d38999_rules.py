from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


SHELL_SIZE_NUMBERS = {
    "A": "9",
    "B": "11",
    "C": "13",
    "D": "15",
    "E": "17",
    "F": "19",
    "G": "21",
    "H": "23",
    "J": "25",
}

SHELL_SIZE_NUMBERS_PADDED = {
    code: ("09" if number == "9" else number)
    for code, number in SHELL_SIZE_NUMBERS.items()
}

SERIES_BY_SHELL_TYPE = {
    "20": "III",
    "21": "III",
    "23": "III",
    "24": "III",
    "25": "III",
    "26": "III",
    "27": "III",
    "29": "III",
    "30": "III",
    "31": "III",
    "32": "III",
    "33": "III",
    "40": "IV",
    "41": "IV",
    "42": "IV",
    "43": "IV",
    "44": "IV",
    "45": "IV",
    "46": "IV",
    "47": "IV",
    "48": "IV",
    "49": "IV",
}

MIL_SHELL_TYPES = {
    "20": "Series III wall-mount receptacle",
    "21": "Series III hermetic box-mount receptacle",
    "23": "Series III hermetic jam-nut receptacle",
    "24": "Series III jam-nut receptacle",
    "25": "Series III hermetic solder-mount receptacle",
    "26": "Series III straight plug",
    "27": "Series III hermetic weld-mount receptacle",
    "40": "Series IV wall-mount receptacle",
    "41": "Series IV hermetic box-mount receptacle",
    "42": "Series IV box-mount receptacle",
    "43": "Series IV hermetic jam-nut receptacle",
    "44": "Series IV jam-nut receptacle",
    "45": "Series IV hermetic solder-mount receptacle",
    "46": "Series IV EMI straight plug",
    "47": "Series IV non-EMI straight plug",
    "48": "Series IV hermetic weld-mount receptacle",
    "49": "Series IV in-line receptacle",
}

KNOWN_CLASSES = [
    "C",
    "F",
    "G",
    "H",
    "J",
    "K",
    "L",
    "M",
    "N",
    "S",
    "T",
    "W",
    "Y",
    "Z",
]

CONTACT_DESCRIPTIONS = {
    "P": "Pin",
    "S": "Socket",
    "A": "Less pin",
    "B": "Less socket",
    "H": "1500-cycle pin",
    "J": "1500-cycle socket",
    "C": "PC-tail pin",
    "D": "PC-tail socket",
    "X": "Eyelet pin",
    "Y": "Eyelet socket",
    "Z": "Eyelet socket in several commercial systems",
}


@dataclass(frozen=True)
class ParsedPin:
    original: str
    normalized: str
    shell_type: str
    series: str
    service_class: str
    shell_size_code: str
    shell_size_number: str
    shell_size_number_padded: str
    insert: str
    contact: str
    key: str


def parse_d38999_pin(pin: str) -> ParsedPin:
    """Parse a MIL-DTL-38999 Series III/IV PIN.

    The parser accepts common spacing and hyphen variants such as
    "D38999/43 N B - 35 P N" and normalizes them to "D38999/43NB35PN".
    """

    original = pin
    compact = re.sub(r"[\s-]+", "", pin.upper())
    match = re.match(r"^D38999/(\d{2})([A-Z0-9]+)$", compact)
    if not match:
        raise ValueError(f"Not a D38999 PIN: {original!r}")

    shell_type, rest = match.groups()
    series = SERIES_BY_SHELL_TYPE.get(shell_type)
    if series is None:
        raise ValueError(f"Unsupported D38999 shell type /{shell_type}")

    service_class = None
    for code in sorted(KNOWN_CLASSES, key=len, reverse=True):
        if rest.startswith(code):
            service_class = code
            rest = rest[len(code):]
            break
    if service_class is None:
        raise ValueError(f"Cannot parse service class in {original!r}")

    if not rest or rest[0] not in SHELL_SIZE_NUMBERS:
        raise ValueError(f"Cannot parse shell-size code in {original!r}")
    shell_size_code = rest[0]
    rest = rest[1:]

    tail_match = re.match(r"^(\d{1,2})([A-Z])([A-Z])?$", rest)
    if not tail_match:
        raise ValueError(f"Cannot parse insert/contact/key fields in {original!r}")

    insert, contact, key = tail_match.groups()
    key = key or "N"
    normalized = f"D38999/{shell_type}{service_class}{shell_size_code}{insert}{contact}{key}"

    return ParsedPin(
        original=original,
        normalized=normalized,
        shell_type=shell_type,
        series=series,
        service_class=service_class,
        shell_size_code=shell_size_code,
        shell_size_number=SHELL_SIZE_NUMBERS[shell_size_code],
        shell_size_number_padded=SHELL_SIZE_NUMBERS_PADDED[shell_size_code],
        insert=insert,
        contact=contact,
        key=key,
    )


DOCUMENTS = [
    {
        "manufacturer": "DLA",
        "file": "MIL-DTL-38999-dtl38999.pdf",
        "scope": "MIL-DTL-38999 specification, shell size codes and PIN structure",
    },
    {
        "manufacturer": "Amphenol",
        "file": "Amphenol-MIL-DTL-38999-series-I-II.pdf",
        "scope": "Series I LJT and Series II JT commercial and military ordering",
    },
    {
        "manufacturer": "Amphenol",
        "file": "Amphenol_D38999_Series_III.pdf",
        "scope": "Series III TV/CTV commercial and military ordering",
    },
    {
        "manufacturer": "Conesys",
        "file": "Conesys-MIL-DTL-38999-Series-I.pdf",
        "scope": "Series I MS to Aero-Electric AE ordering",
    },
    {
        "manufacturer": "Conesys",
        "file": "Conesys-MIL-DTL-38999-Series-II.pdf",
        "scope": "Series II MS to Aero-Electric AE ordering",
    },
    {
        "manufacturer": "Conesys",
        "file": "Conesys-MIL-DTL-38999-Series-III.pdf",
        "scope": "Series III D38999 to Aero-Electric AE3 ordering",
    },
    {
        "manufacturer": "Conesys",
        "file": "Conesys-Hermetic.pdf",
        "scope": "Hermetic Series I through IV Conesys AE ordering",
    },
    {
        "manufacturer": "Eaton",
        "file": "Eaton_D38999_Series_IV.pdf",
        "scope": "Series IV Breech-Lok general-purpose and hermetic ordering",
    },
    {
        "manufacturer": "Glenair",
        "file": "Glenair-Mil-DTL-38999-Series-I-II-III-IV.pdf",
        "scope": "D38999 Series I through IV hermetic, environmental and special ordering",
    },
    {
        "manufacturer": "ITT Cannon",
        "file": "ITT-Cannon-38999-Series-I-II-III.pdf",
        "scope": "KJ/KJL/KJA/KJB D38999-style ordering",
    },
    {
        "manufacturer": "Souriau",
        "file": "Souriau-Mil-DTL-38999-Series-III.pdf",
        "scope": "8D Series III commercial and MIL-DTL-38999 ordering",
    },
    {
        "manufacturer": "TE Deutsch",
        "file": "TE_Deutsch_D38999_Series_I.pdf",
        "scope": "DJT Series I quick reference",
    },
    {
        "manufacturer": "TE Deutsch",
        "file": "TE_Deutsch_D38999_Series_III.pdf",
        "scope": "DTS/ACT Series III quick reference",
    },
]


RULES: list[dict[str, Any]] = [
    {
        "manufacturer": "Amphenol",
        "product_line": "TV Series III aluminum commercial",
        "format": "amphenol_prefix",
        "series": "III",
        "confidence": "exact for listed aluminum finishes",
        "supported_contacts": list("PSABHJ"),
        "supported_keys": list("NABCDE"),
        "styles": {
            "20": {"description": "Wall mount receptacle", "prefix_by_finish": {"F": "TVPS00RF-", "W": "TVP00RW-", "T": "TVP00DT-", "Z": "TVP00DZ-"}},
            "24": {"description": "Jam nut receptacle", "prefix_by_finish": {"F": "TVS07RF-", "W": "TV07RW-", "T": "TV07DT-", "Z": "TV07DZ-"}},
            "26": {"description": "Straight plug", "prefix_by_finish": {"F": "TVS06RF-", "W": "TV06RW-", "T": "TV06DT-", "Z": "TV06DZ-"}},
        },
        "notes": "Commercial prefixes are from the Amphenol Series III how-to-order table. Composite, stainless and hermetic family names are documented, but the exact finish-specific commercial prefixes were not complete enough in the extracted text to automate safely.",
    },
    {
        "manufacturer": "Conesys",
        "product_line": "Aero-Electric AE3 Series III environmental",
        "format": "conesys",
        "prefix": "AE3",
        "series": "III",
        "confidence": "exact from part-number development table",
        "supported_contacts": list("PSAB"),
        "supported_keys": list("NABCDE"),
        "supported_finishes": list("FWTZKS"),
        "styles": {"20": "20", "24": "24", "26": "26"},
        "notes": "Conesys marks normal N in Series III part numbers.",
    },
    {
        "manufacturer": "Conesys",
        "product_line": "Aero-Electric AE3 Series III hermetic",
        "format": "conesys",
        "prefix": "AE3",
        "series": "III",
        "confidence": "exact from hermetic part-number development table",
        "supported_contacts": list("PXC"),
        "supported_keys": list("NABCDE"),
        "supported_finishes": list("YN"),
        "styles": {"21": "21", "23": "23", "25": "25", "27": "27"},
        "notes": "Hermetic Conesys table lists pin-only solder cup, eyelet and PCB contacts.",
    },
    {
        "manufacturer": "Conesys",
        "product_line": "Aero-Electric AE4 Series IV hermetic",
        "format": "conesys",
        "prefix": "AE4",
        "series": "IV",
        "confidence": "exact with source typo noted",
        "supported_contacts": list("PXC"),
        "supported_keys": list("NABCDEKLMRU"),
        "supported_finishes": list("YN"),
        "allowed_shell_size_codes": list("BCDEFGHJ"),
        "styles": {"41": "41", "43": "43", "45": "45", "48": "48"},
        "notes": "The Conesys table line says 47 for weld mount, but the same catalog page and TOC identify D38999/48 as AE448 weld mount.",
    },
    {
        "manufacturer": "Eaton",
        "product_line": "Breech-Lok Series IV general purpose",
        "format": "eaton",
        "series": "IV",
        "confidence": "exact from ordering table",
        "supported_contacts": list("PSAB"),
        "supported_keys": list("NABCDEKLMRU"),
        "finishes": {code: code for code in "CFGKSTW"},
        "styles": {"40": "00", "42": "02", "44": "07", "46": "G6", "47": "06", "49": "03"},
        "notes": "Class F, W and K QPL status varies by shell type; see Eaton ordering table.",
    },
    {
        "manufacturer": "Eaton",
        "product_line": "Breech-Lok Series IV hermetic",
        "format": "eaton",
        "series": "IV",
        "confidence": "exact from ordering table",
        "supported_contacts": list("CPX"),
        "supported_keys": list("NABCDEKLMRU"),
        "allowed_shell_size_codes": list("BCDEFGHJ"),
        "finishes": {"N": "N", "Y": "Y"},
        "styles": {"41": "H2", "43": "H7", "45": "H1", "48": "H4"},
        "notes": "Eaton lists N and Y hermetic finish classes as QPL certified.",
    },
    {
        "manufacturer": "Glenair",
        "product_line": "233-105 Series III environmental",
        "format": "glenair",
        "series": "III",
        "base": "233-105",
        "confidence": "exact style pattern, finish map from table",
        "supported_contacts": list("PS"),
        "supported_keys": list("NABCDE"),
        "finishes": {
            "F": "ME",
            "W": "NF",
            "Z": "ZN",
            "T": "MT",
            "M": "XM",
            "J": "XW",
            "K": "Z1",
            "L": "ZL",
            "S": "ZL",
        },
        "styles": {"20": "00", "24": "07", "26": "G6"},
        "notes": "Glenair environmental pages list only P and S contacts in this catalog section. Finish Z maps to Glenair ZN per the extracted table; confirm if black zinc-nickel ZR is required.",
    },
    {
        "manufacturer": "Glenair",
        "product_line": "233-100 Series III hermetic",
        "format": "glenair",
        "series": "III",
        "base": "233-100",
        "confidence": "exact from hermetic pages",
        "supported_contacts": list("PXCSZD"),
        "supported_keys": list("NABCDE"),
        "finishes": {"Y": "Z1", "N": "ZL"},
        "styles": {"21": "H2", "23": "H7", "25": "H5", "27": "H8"},
        "notes": "Z1 is CRES passivated, ZL is CRES nickel.",
    },
    {
        "manufacturer": "Glenair",
        "product_line": "234-100 Series IV hermetic",
        "format": "glenair",
        "series": "IV",
        "base": "234-100",
        "confidence": "exact from hermetic pages",
        "supported_contacts": list("PXCSZD"),
        "supported_keys": list("NABCDEKLMRU"),
        "allowed_shell_size_codes": list("BCDEFGHJ"),
        "finishes": {"Y": "Z1", "N": "ZL"},
        "styles": {"41": "H2", "43": "H7", "45": "H5", "48": "H8"},
        "notes": "Series IV hermetic shell size A/09 is not listed.",
    },
    {
        "manufacturer": "ITT Cannon",
        "product_line": "KJA Series III aluminum/stainless D38999-style",
        "format": "itt",
        "series": "III",
        "prefix": "KJA",
        "confidence": "exact pattern; catalog states D38999-style cross-reference only",
        "supported_contacts": list("PSAB"),
        "supported_keys": list("NABCDE"),
        "finishes": {code: code for code in "FGWZ"},
        "styles": {"20": "0", "24": "7", "26": "6"},
        "notes": "ITT catalog disclaimer says the facility/product is not currently DLA QPL/QML certified; use as commercial equivalent.",
    },
    {
        "manufacturer": "ITT Cannon",
        "product_line": "KJB Series III composite D38999-style",
        "format": "itt",
        "series": "III",
        "prefix": "KJB",
        "confidence": "exact pattern; catalog states D38999-style cross-reference only",
        "supported_contacts": list("PSABHJ"),
        "supported_keys": list("NABCDE"),
        "finishes": {"J": "J", "M": "M"},
        "styles": {"20": "0", "26": "6"},
        "notes": "Composite quick-order section lists /20 and /26 styles.",
    },
    {
        "manufacturer": "Souriau",
        "product_line": "8D Series III aluminum/composite/stainless",
        "format": "souriau",
        "series": "III",
        "confidence": "exact from 8D connector part-number pages",
        "supported_contacts": list("PSABHJ"),
        "supported_keys": list("NABCDE"),
        "finishes": {code: code for code in "WFZJMKS"},
        "styles": {"20": "0", "24": "7", "26": "5"},
        "notes": "8D commercial format uses numeric shell size; A becomes 09. H/J contacts are only documented for composite pages, so confirm before use outside J/M classes.",
    },
    {
        "manufacturer": "TE Deutsch",
        "product_line": "DTS Series III aluminum/stainless",
        "format": "te_dts",
        "series": "III",
        "confidence": "exact from TE Deutsch QRG",
        "supported_contacts": list("PSABHJCDXZ"),
        "supported_keys": list("NABCDE"),
        "finishes": {code: code for code in "FGTWZKSLYNH"},
        "styles": {"20": "20", "24": "24", "26": "26", "21": "20", "23": "24", "25": "21", "27": "23"},
        "notes": "DTS commercial uses numeric shell size. Hermetic styles remap to DTS 20/24/21/23 per TE table.",
    },
    {
        "manufacturer": "TE Deutsch",
        "product_line": "ACT Series III composite",
        "format": "te_act",
        "series": "III",
        "confidence": "exact from TE Deutsch QRG",
        "supported_contacts": list("PSABHJ"),
        "supported_keys": list("NABCDE"),
        "finishes": {"J": "J", "M": "M"},
        "styles": {"20": "20", "24": "24", "26": "26"},
        "notes": "ACT commercial uses the military shell-size letter rather than DTS numeric shell size.",
    },
]


def _rule_supports(rule: dict[str, Any], parsed: ParsedPin) -> tuple[bool, str | None]:
    if parsed.series != rule["series"]:
        return False, "series not supported"
    if parsed.shell_type not in rule["styles"]:
        return False, "shell type not supported"
    allowed_shells = rule.get("allowed_shell_size_codes")
    if allowed_shells and parsed.shell_size_code not in allowed_shells:
        return False, "shell size not supported"
    supported_contacts = rule.get("supported_contacts")
    if supported_contacts and parsed.contact not in supported_contacts:
        return False, "contact not supported"
    supported_keys = rule.get("supported_keys")
    if supported_keys and parsed.key not in supported_keys:
        return False, "key position not supported"

    if rule["format"] == "amphenol_prefix":
        finish_map = rule["styles"][parsed.shell_type]["prefix_by_finish"]
        if parsed.service_class not in finish_map:
            return False, "finish/class not automated"
    elif "supported_finishes" in rule:
        if parsed.service_class not in rule["supported_finishes"]:
            return False, "finish/class not supported"
    elif "finishes" in rule:
        if parsed.service_class not in rule["finishes"]:
            return False, "finish/class not supported"

    if rule["manufacturer"] == "Souriau" and parsed.contact in {"H", "J"} and parsed.service_class not in {"J", "M"}:
        return False, "1500-cycle contacts only documented for Souriau composite pages"

    return True, None


def format_candidate(rule: dict[str, Any], parsed: ParsedPin) -> str:
    fmt = rule["format"]
    shell = parsed.shell_type
    cls = parsed.service_class
    insert = parsed.insert
    contact = parsed.contact
    key = parsed.key
    shell_num = parsed.shell_size_number
    shell_num_padded = parsed.shell_size_number_padded
    shell_letter = parsed.shell_size_code

    if fmt == "amphenol_prefix":
        prefix = rule["styles"][shell]["prefix_by_finish"][cls]
        return f"{prefix}{shell_num}-{insert}{contact}{key}"

    if fmt == "conesys":
        return f"{rule['prefix']}{rule['styles'][shell]}{cls}{shell_letter}{insert}{contact}{key}"

    if fmt == "eaton":
        return f"BL{rule['styles'][shell]}{rule['finishes'][cls]}{shell_num}-{insert}{contact}{key}"

    if fmt == "glenair":
        return f"{rule['base']}-{rule['styles'][shell]}{rule['finishes'][cls]}{shell_num_padded}-{insert}{contact}{key}"

    if fmt == "itt":
        return f"{rule['prefix']}{rule['styles'][shell]}T{shell_num}{rule['finishes'][cls]}{insert}{contact}{key}"

    if fmt == "souriau":
        return f"8D{rule['styles'][shell]}-{shell_num_padded}{rule['finishes'][cls]}{insert}{contact}{key}"

    if fmt == "te_dts":
        return f"DTS{rule['styles'][shell]}{rule['finishes'][cls]}{shell_num}{insert}{contact}{key}"

    if fmt == "te_act":
        return f"ACT{rule['styles'][shell]}{rule['finishes'][cls]}{shell_letter}{insert}{contact}{key}"

    raise ValueError(f"Unsupported rule format: {fmt}")


def convert_pin(pin: str, include_unsupported: bool = False) -> dict[str, Any]:
    parsed = parse_d38999_pin(pin)
    candidates: list[dict[str, str]] = []
    unsupported: list[dict[str, str]] = []

    for rule in RULES:
        ok, reason = _rule_supports(rule, parsed)
        if ok:
            candidates.append(
                {
                    "manufacturer": rule["manufacturer"],
                    "product_line": rule["product_line"],
                    "manufacturer_part_number": format_candidate(rule, parsed),
                    "confidence": rule["confidence"],
                    "notes": rule["notes"],
                }
            )
        elif include_unsupported:
            unsupported.append(
                {
                    "manufacturer": rule["manufacturer"],
                    "product_line": rule["product_line"],
                    "reason": reason or "not supported",
                }
            )

    return {
        "input": pin,
        "normalized": parsed.normalized,
        "decoded": {
            "series": parsed.series,
            "shell_type": parsed.shell_type,
            "shell_type_description": MIL_SHELL_TYPES.get(parsed.shell_type, ""),
            "service_class": parsed.service_class,
            "shell_size_code": parsed.shell_size_code,
            "shell_size_number": parsed.shell_size_number,
            "insert": parsed.insert,
            "contact": parsed.contact,
            "contact_description": CONTACT_DESCRIPTIONS.get(parsed.contact, ""),
            "key": parsed.key,
        },
        "candidates": candidates,
        "unsupported": unsupported,
    }

