(function () {
  "use strict";

  const DATA = (window.D38999_TOOLBOX_DATA && window.D38999_TOOLBOX_DATA.converter) || {};
  const shellSizeNumbers = DATA.shell_size_numbers || {};
  const seriesByShellType = DATA.series_by_shell_type || {};
  const milShellTypes = DATA.mil_shell_types || {};
  const knownClasses = DATA.known_classes || [];
  const contactDescriptions = DATA.contact_descriptions || {};
  const rules = DATA.rules || [];
  const hermeticShellTypes = new Set(["21", "23", "25", "27", "41", "43", "45", "48"]);

  const shellCodeByNumber = Object.fromEntries(
    Object.entries(shellSizeNumbers).flatMap(([code, number]) => {
      const padded = number === "9" ? "09" : number;
      return [[number, code], [padded, code]];
    })
  );
  const numericShellSizes = Object.values(shellSizeNumbers).sort((a, b) => b.length - a.length);

  function getFormat(rule) {
    return rule.format || "";
  }

  function getStyles(rule) {
    return rule.styles || {};
  }

  function getFinishes(rule) {
    if (rule.finishes) return rule.finishes;
    if (Array.isArray(rule.supported_finishes)) {
      return Object.fromEntries(rule.supported_finishes.map((code) => [code, code]));
    }
    if (getFormat(rule) === "amphenol_prefix") {
      const out = {};
      Object.values(getStyles(rule)).forEach((style) => {
        Object.keys(style.prefix_by_finish || {}).forEach((code) => {
          out[code] = code;
        });
      });
      return out;
    }
    return {};
  }

  function getSupportedContacts(rule) {
    return rule.supported_contacts || [];
  }

  function getSupportedKeys(rule) {
    return rule.supported_keys || [];
  }

  function getAllowedShellSizeCodes(rule) {
    return rule.allowed_shell_size_codes || [];
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function cleanD38999(value) {
    return String(value || "").toUpperCase().replace(/[\s-]+/g, "");
  }

  function cleanManufacturer(value) {
    return String(value || "").toUpperCase().replace(/\s+/g, "");
  }

  function paddedShellSize(code) {
    const number = shellSizeNumbers[code];
    return number === "9" ? "09" : number;
  }

  function makeParsed(original, shellType, serviceClass, shellSizeCode, insert, contact, key) {
    if (!seriesByShellType[shellType]) {
      throw new Error(`Unsupported D38999 shell type /${shellType}`);
    }
    if (!shellSizeNumbers[shellSizeCode]) {
      throw new Error(`Unsupported shell-size code ${shellSizeCode}`);
    }
    return {
      original,
      normalized: `D38999/${shellType}${serviceClass}${shellSizeCode}${insert}${contact}${key || "N"}`,
      shellType,
      series: seriesByShellType[shellType],
      serviceClass,
      shellSizeCode,
      shellSizeNumber: shellSizeNumbers[shellSizeCode],
      shellSizeNumberPadded: paddedShellSize(shellSizeCode),
      insert,
      contact,
      key: key || "N",
    };
  }

  function parseD38999Pin(value) {
    const compact = cleanD38999(value);
    const match = compact.match(/^D38999\/(\d{2})([A-Z0-9]+)$/);
    if (!match) {
      throw new Error("Not a D38999 PIN");
    }

    const [, shellType, restRaw] = match;
    if (!seriesByShellType[shellType]) {
      throw new Error(`Unsupported D38999 shell type /${shellType}`);
    }

    let rest = restRaw;
    const serviceClass = knownClasses.find((code) => rest.startsWith(code));
    if (!serviceClass) {
      throw new Error("Cannot parse service class");
    }
    rest = rest.slice(serviceClass.length);

    const shellSizeCode = rest[0];
    if (!shellSizeNumbers[shellSizeCode]) {
      throw new Error("Cannot parse shell-size code");
    }
    rest = rest.slice(1);

    const tail = rest.match(/^(\d{1,2})([A-Z])([A-Z])?$/);
    if (!tail) {
      throw new Error("Cannot parse insert/contact/key fields");
    }

    return makeParsed(value, shellType, serviceClass, shellSizeCode, tail[1], tail[2], tail[3] || "N");
  }

  function ruleSupports(rule, parsed) {
    if (parsed.series !== rule.series) return false;
    if (!Object.prototype.hasOwnProperty.call(getStyles(rule), parsed.shellType)) return false;
    const allowedShells = getAllowedShellSizeCodes(rule);
    if (allowedShells.length && !allowedShells.includes(parsed.shellSizeCode)) return false;
    const supportedContacts = getSupportedContacts(rule);
    if (supportedContacts.length && !supportedContacts.includes(parsed.contact)) return false;
    const supportedKeys = getSupportedKeys(rule);
    if (supportedKeys.length && !supportedKeys.includes(parsed.key)) return false;

    if (getFormat(rule) === "amphenol_prefix") {
      const style = getStyles(rule)[parsed.shellType];
      if (!style.prefix_by_finish || !style.prefix_by_finish[parsed.serviceClass]) return false;
    } else if (rule.supported_finishes) {
      if (!rule.supported_finishes.includes(parsed.serviceClass)) return false;
    } else if (Object.keys(getFinishes(rule)).length && !getFinishes(rule)[parsed.serviceClass]) {
      return false;
    }

    if (rule.manufacturer === "Souriau" && "HJ".includes(parsed.contact) && !"JM".includes(parsed.serviceClass)) {
      return false;
    }

    return true;
  }

  function formatCandidate(rule, parsed) {
    const shell = parsed.shellType;
    const cls = parsed.serviceClass;
    const insert = parsed.insert;
    const contact = parsed.contact;
    const key = parsed.key;
    const shellNum = parsed.shellSizeNumber;
    const shellPad = parsed.shellSizeNumberPadded;
    const shellLetter = parsed.shellSizeCode;
    const format = getFormat(rule);

    switch (format) {
      case "amphenol_prefix":
        return `${getStyles(rule)[shell].prefix_by_finish[cls]}${shellNum}-${insert}${contact}${key}`;
      case "conesys":
        return `${rule.prefix}${getStyles(rule)[shell]}${cls}${shellLetter}${insert}${contact}${key}`;
      case "eaton":
        return `BL${getStyles(rule)[shell]}${getFinishes(rule)[cls]}${shellNum}-${insert}${contact}${key}`;
      case "glenair":
        return `${rule.base}-${getStyles(rule)[shell]}${getFinishes(rule)[cls]}${shellPad}-${insert}${contact}${key}`;
      case "itt":
        return `${rule.prefix}${getStyles(rule)[shell]}T${shellNum}${getFinishes(rule)[cls]}${insert}${contact}${key}`;
      case "souriau":
        return `8D${getStyles(rule)[shell]}-${shellPad}${getFinishes(rule)[cls]}${insert}${contact}${key}`;
      case "te_dts":
        return `DTS${getStyles(rule)[shell]}${getFinishes(rule)[cls]}${shellNum}${insert}${contact}${key}`;
      case "te_act":
        return `ACT${getStyles(rule)[shell]}${getFinishes(rule)[cls]}${shellLetter}${insert}${contact}${key}`;
      default:
        throw new Error(`Unsupported rule format ${format}`);
    }
  }

  function convertParsed(parsed) {
    return rules
      .filter((rule) => ruleSupports(rule, parsed))
      .map((rule) => ({
        manufacturer: rule.manufacturer,
        product_line: rule.product_line,
        manufacturer_part_number: formatCandidate(rule, parsed),
        confidence: rule.confidence,
        notes: rule.notes,
      }));
  }

  function pushIfUnique(rows, row) {
    const key = `${row.parsed.normalized}|${row.source}`;
    if (!rows.some((item) => `${item.parsed.normalized}|${item.source}` === key)) {
      rows.push(row);
    }
  }

  function parseTailWithKnownShellNumber(tail) {
    for (const shellNumber of numericShellSizes) {
      if (!tail.startsWith(shellNumber)) continue;
      const rest = tail.slice(shellNumber.length);
      const match = rest.match(/^([A-Z])(\d{1,2})([A-Z])([A-Z])$/);
      if (match) {
        return {
          shellSizeCode: shellCodeByNumber[shellNumber],
          serviceClass: match[1],
          insert: match[2],
          contact: match[3],
          key: match[4],
        };
      }
    }
    return null;
  }

  function parseTailWithClassThenShellNumber(tail, finishes) {
    const finishCodes = Object.keys(finishes).sort((a, b) => b.length - a.length);
    for (const serviceClass of finishCodes) {
      if (!tail.startsWith(serviceClass)) continue;
      const restAfterClass = tail.slice(serviceClass.length);
      for (const shellNumber of numericShellSizes) {
        if (!restAfterClass.startsWith(shellNumber)) continue;
        const rest = restAfterClass.slice(shellNumber.length);
        const match = rest.match(/^(\d{1,2})([A-Z])([A-Z])$/);
        if (match) {
          return {
            shellSizeCode: shellCodeByNumber[shellNumber],
            serviceClass,
            insert: match[1],
            contact: match[2],
            key: match[3],
          };
        }
      }
    }
    return null;
  }

  function reverseParseAmphenol(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "amphenol_prefix").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        Object.entries(style.prefix_by_finish || {}).forEach(([serviceClass, prefix]) => {
          if (!compact.startsWith(prefix)) return;
          const tail = compact.slice(prefix.length);
          const match = tail.match(/^(\d{1,2})-(\d{1,2})([A-Z])([A-Z])$/);
          if (!match) return;
          const shellSizeCode = shellCodeByNumber[match[1]];
          if (!shellSizeCode) return;
          const parsed = makeParsed(compact, shellType, serviceClass, shellSizeCode, match[2], match[3], match[4]);
          pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
        });
      });
    });
  }

  function reverseParseConesys(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "conesys").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `${rule.prefix}${style}`;
        if (!compact.startsWith(prefix)) return;
        const main = compact.slice(prefix.length).split("-")[0];
        const serviceClass = (rule.supported_finishes || []).find((code) => main.startsWith(code));
        if (!serviceClass) return;
        const rest = main.slice(serviceClass.length);
        const shellSizeCode = rest[0];
        const match = rest.slice(1).match(/^(\d{1,2})([A-Z])([A-Z])$/);
        if (!match || !shellSizeNumbers[shellSizeCode]) return;
        const parsed = makeParsed(compact, shellType, serviceClass, shellSizeCode, match[1], match[2], match[3]);
        if (ruleSupports(rule, parsed)) {
          pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
        }
      });
    });
  }

  function reverseParseEaton(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "eaton").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `BL${style}`;
        if (!compact.startsWith(prefix)) return;
        const tail = compact.slice(prefix.length);
        Object.keys(getFinishes(rule)).forEach((serviceClass) => {
          if (!tail.startsWith(serviceClass)) return;
          const match = tail.slice(serviceClass.length).match(/^(\d{1,2})-(\d{1,2})([A-Z])([A-Z])$/);
          if (!match) return;
          const shellSizeCode = shellCodeByNumber[match[1]];
          if (!shellSizeCode) return;
          const parsed = makeParsed(compact, shellType, serviceClass, shellSizeCode, match[2], match[3], match[4]);
          if (ruleSupports(rule, parsed)) {
            pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
          }
        });
      });
    });
  }

  function reverseParseGlenair(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "glenair").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `${rule.base}-${style}`;
        if (!compact.startsWith(prefix)) return;
        const tail = compact.slice(prefix.length);
        const finishEntries = Object.entries(getFinishes(rule)).sort((a, b) => b[1].length - a[1].length);
        finishEntries.forEach(([serviceClass, finishCode]) => {
          if (!tail.startsWith(finishCode)) return;
          const match = tail.slice(finishCode.length).match(/^(\d{1,2})-(\d{1,2})([A-Z])([A-Z])$/);
          if (!match) return;
          const shellSizeCode = shellCodeByNumber[match[1]];
          if (!shellSizeCode) return;
          const parsed = makeParsed(compact, shellType, serviceClass, shellSizeCode, match[2], match[3], match[4]);
          if (ruleSupports(rule, parsed)) {
            pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
          }
        });
      });
    });
  }

  function reverseParseItt(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "itt").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `${rule.prefix}${style}T`;
        if (!compact.startsWith(prefix)) return;
        const parsedTail = parseTailWithKnownShellNumber(compact.slice(prefix.length));
        if (!parsedTail) return;
        const parsed = makeParsed(compact, shellType, parsedTail.serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
        if (ruleSupports(rule, parsed)) {
          pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
        }
      });
    });
  }

  function reverseParseSouriau(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "souriau").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `8D${style}-`;
        if (!compact.startsWith(prefix)) return;
        const parsedTail = parseTailWithKnownShellNumber(compact.slice(prefix.length));
        if (!parsedTail) return;
        const parsed = makeParsed(compact, shellType, parsedTail.serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
        if (ruleSupports(rule, parsed)) {
          pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
        }
      });
    });
  }

  function reverseParseTeDts(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "te_dts").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `DTS${style}`;
        if (!compact.startsWith(prefix)) return;
        const parsedTail = parseTailWithClassThenShellNumber(compact.slice(prefix.length), getFinishes(rule));
        if (!parsedTail) return;
        const hermetic = "YNH".includes(parsedTail.serviceClass);
        if (hermetic !== hermeticShellTypes.has(shellType)) return;
        const parsed = makeParsed(compact, shellType, parsedTail.serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
        if (ruleSupports(rule, parsed)) {
          pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
        }
      });
    });
  }

  function reverseParseTeAct(compact, rows) {
    rules.filter((rule) => getFormat(rule) === "te_act").forEach((rule) => {
      Object.entries(getStyles(rule)).forEach(([shellType, style]) => {
        const prefix = `ACT${style}`;
        if (!compact.startsWith(prefix)) return;
        const tail = compact.slice(prefix.length);
        Object.keys(getFinishes(rule)).forEach((serviceClass) => {
          if (!tail.startsWith(serviceClass)) return;
          const rest = tail.slice(serviceClass.length);
          const shellSizeCode = rest[0];
          const match = rest.slice(1).match(/^(\d{1,2})([A-Z])([A-Z])$/);
          if (!match || !shellSizeNumbers[shellSizeCode]) return;
          const parsed = makeParsed(compact, shellType, serviceClass, shellSizeCode, match[1], match[2], match[3]);
          if (ruleSupports(rule, parsed)) {
            pushIfUnique(rows, { parsed, source: `${rule.manufacturer} ${rule.product_line}` });
          }
        });
      });
    });
  }

  function reverseParseManufacturerPin(value) {
    const compact = cleanManufacturer(value);
    const rows = [];
    reverseParseAmphenol(compact, rows);
    reverseParseConesys(compact, rows);
    reverseParseEaton(compact, rows);
    reverseParseGlenair(compact, rows);
    reverseParseItt(compact, rows);
    reverseParseSouriau(compact, rows);
    reverseParseTeDts(compact, rows);
    reverseParseTeAct(compact, rows);
    return rows;
  }

  // D38999-style rugged I/O connector families (not standard D38999 insert arrangements)
  const RUGGED_IO_FAMILIES = [
    { prefix: "RJFTV", family: "RJFTV", vendor: "Amphenol Socapex", interface: "RJ45 Ethernet", shellSize: "19", relation: "MIL-DTL-38999 Series III style rugged RJ45", svg: "rjftv-face.svg" },
    { prefix: "C-RJFTV", family: "C-RJFTV", vendor: "Cinch", interface: "RJ45 Ethernet", shellSize: "19", relation: "D38999 Series III style rugged RJ45", svg: "rjftv-face.svg" },
    { prefix: "CRJFTV", family: "C-RJFTV", vendor: "Cinch", interface: "RJ45 Ethernet", shellSize: "19", relation: "D38999 Series III style rugged RJ45", svg: "rjftv-face.svg" },
    { prefix: "RJF", family: "RJF", vendor: "Amphenol Socapex", interface: "RJ45 Ethernet", shellSize: "18", relation: "MIL-DTL-26482 bayonet style rugged RJ45", svg: "rjf-face.svg" },
    { prefix: "USB3CFTV", family: "USB3CFTV", vendor: "Amphenol Socapex", interface: "USB-C / USB 3.2", shellSize: "11", relation: "Size 11 D38999-style rugged USB-C", svg: "usb3cftv-face.svg" },
    { prefix: "USB3FTV", family: "USB3FTV", vendor: "Amphenol Socapex", interface: "USB 3.x Type-A", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB 3", svg: "usb3ftv-face.svg" },
    { prefix: "USBFTV", family: "USBFTV", vendor: "Amphenol Socapex", interface: "USB 2.0 Type-A", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB", svg: "usbftv-face.svg" },
    { prefix: "USBBFTV", family: "USBBFTV", vendor: "Amphenol Socapex", interface: "USB-B", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB-B", svg: "usbbftv-face.svg" },
    { prefix: "USBF", family: "USBFTV", vendor: "Amphenol Socapex", interface: "USB 2.0", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB", svg: "usbftv-face.svg" },
    { prefix: "HDMIFTV", family: "HDMIFTV", vendor: "Amphenol Socapex", interface: "HDMI 2.0", shellSize: "17", relation: "D38999-style rugged HDMI", svg: "hdmiftv-face.svg" },
    { prefix: "MDPFTV", family: "MDPFTV", vendor: "Amphenol Socapex", interface: "Mini DisplayPort", shellSize: "13", relation: "D38999-style rugged Mini DisplayPort", svg: "mdpftv-face.svg" },
  ];

  // Map shell type digit to mounting style name and SVG suffix
  const SHELL_TYPE_MAP = {
    "6": { mount: "Plug", suffix: "plug" },
    "7": { mount: "Jam Nut Receptacle", suffix: "jam-nut-receptacle" },
    "2": { mount: "Square Flange Receptacle", suffix: "square-flange-receptacle" },
  };

  // Map family prefix to available mounting SVGs
  const FAMILY_SVG_MAP = {
    "RJFTV":    { plug: "rjftv-plug.svg", "jam-nut-receptacle": "rjftv-jam-nut-receptacle.svg", "square-flange-receptacle": "rjftv-square-flange-receptacle.svg", "reduced-flange-receptacle": "rjftv-reduced-flange-receptacle.svg", "through-bulkhead": "rjftv-through-bulkhead.svg", "standoff-receptacle": "rjftv-standoff-receptacle.svg", face: "rjftv-face.svg" },
    "C-RJFTV":  { plug: "rjftv-plug.svg", "jam-nut-receptacle": "rjftv-jam-nut-receptacle.svg", "square-flange-receptacle": "rjftv-square-flange-receptacle.svg", face: "rjftv-face.svg" },
    "RJF":      { plug: "rjf-plug.svg", "jam-nut-receptacle": "rjf-jam-nut-receptacle.svg", face: "rjf-face.svg" },
    "USB3CFTV": { plug: "usb3cftv-plug.svg", "jam-nut-receptacle": "usb3cftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usb3cftv-square-flange-receptacle.svg", "standoff-receptacle": "usb3cftv-standoff-receptacle.svg", face: "usb3cftv-face.svg" },
    "USB3FTV":  { plug: "usb3ftv-plug.svg", "jam-nut-receptacle": "usb3ftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usb3ftv-square-flange-receptacle.svg", "reduced-flange-receptacle": "usb3ftv-reduced-flange-receptacle.svg", "standoff-receptacle": "usb3ftv-standoff-receptacle.svg", face: "usb3ftv-face.svg" },
    "USBFTV":   { plug: "usbftv-plug.svg", "jam-nut-receptacle": "usbftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usbftv-square-flange-receptacle.svg", "through-bulkhead": "usbftv-through-bulkhead.svg", face: "usbftv-face.svg" },
    "USBBFTV":  { face: "usbbftv-face.svg" },
    "HDMIFTV":  { plug: "hdmiftv-plug.svg", "jam-nut-receptacle": "hdmiftv-jam-nut-receptacle.svg", "square-flange-receptacle": "hdmiftv-square-flange-receptacle.svg", "reduced-flange-receptacle": "hdmiftv-reduced-flange-receptacle.svg", "standoff-receptacle": "hdmiftv-standoff-receptacle.svg", face: "hdmiftv-face.svg" },
    "MDPFTV":   { plug: "mdpftv-plug.svg", "jam-nut-receptacle": "mdpftv-jam-nut-receptacle.svg", "square-flange-receptacle": "mdpftv-square-flange-receptacle.svg", face: "mdpftv-face.svg" },
  };

  function recognizeRuggedIo(value) {
    // Strip leading "D38999/" if user typed it in the decoder field
    const cleaned = String(value || "").replace(/^D38999\//i, "");
    const upper = cleaned.toUpperCase().replace(/[\s-]+/g, "");
    // Sort by prefix length descending so longer prefixes match first (e.g. USB3CFTV before USB3FTV before USBFTV)
    for (const entry of RUGGED_IO_FAMILIES) {
      const prefix = entry.prefix.toUpperCase().replace(/[\s-]+/g, "");
      if (upper.startsWith(prefix)) {
        const suffix = cleaned.slice(entry.prefix.length).replace(/^[\s-]+/, "");
        // Detect shell type from first character of suffix (6=plug, 7=jam nut, 2=square flange)
        const shellTypeChar = suffix.charAt(0);
        const shellTypeInfo = SHELL_TYPE_MAP[shellTypeChar] || null;
        const familySvgs = FAMILY_SVG_MAP[entry.family] || {};
        // Select appropriate SVG: mounting-specific if available, otherwise face view
        let selectedSvg = entry.svg;
        let mountingType = "";
        if (shellTypeInfo && familySvgs[shellTypeInfo.suffix]) {
          selectedSvg = familySvgs[shellTypeInfo.suffix];
          mountingType = shellTypeInfo.mount;
        }
        // Check for stand-off deviation codes
        if (suffix.includes("F459")) {
          if (familySvgs["standoff-receptacle"]) selectedSvg = familySvgs["standoff-receptacle"];
          mountingType = "Stand-off (PCB)";
        } else if (suffix.includes("F312") || suffix.includes("F311") || suffix.includes("F059") || suffix.includes("F058")) {
          if (familySvgs["reduced-flange-receptacle"]) selectedSvg = familySvgs["reduced-flange-receptacle"];
          mountingType = "Reduced Flange";
        }
        return {
          recognized: true,
          input: value,
          family: entry.family,
          vendor: entry.vendor,
          interface: entry.interface,
          shell_size: entry.shellSize,
          d38999_relation: entry.relation,
          svg: selectedSvg,
          face_svg: familySvgs.face || entry.svg,
          mounting_type: mountingType,
          suffix: suffix,
          connector_type: mountingType ? `D38999-style ${mountingType}` : "D38999-style rugged I/O",
          note: "This is a D38999-style derivative connector, not a standard MIL-DTL-38999 insert arrangement. Verify exact PN with manufacturer catalog.",
        };
      }
    }
    return { recognized: false };
  }

  function convertInput(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      throw new Error("Enter a part number.");
    }

    // Check for rugged I/O family first
    const ruggedResult = recognizeRuggedIo(trimmed);
    if (ruggedResult.recognized) {
      return {
        mode: "rugged_io",
        query: trimmed,
        ruggedInfo: ruggedResult,
        results: [],
      };
    }

    try {
      const parsed = parseD38999Pin(trimmed);
      return {
        mode: "d38999",
        query: trimmed,
        results: [{ parsed, source: "D38999 input", candidates: convertParsed(parsed) }],
      };
    } catch {
      const inferred = reverseParseManufacturerPin(trimmed);
      if (!inferred.length) {
        throw new Error("The part number was not recognized by the current rule set.");
      }
      return {
        mode: "manufacturer",
        query: trimmed,
        results: inferred.map((row) => ({ ...row, candidates: convertParsed(row.parsed) })),
      };
    }
  }

  function decodedFields(parsed) {
    return [
      ["Series", parsed.series],
      ["Shell type", `/${parsed.shellType}`],
      ["Class", parsed.serviceClass],
      ["Shell size", `${parsed.shellSizeCode} = ${parsed.shellSizeNumber}`],
      ["Insert", parsed.insert],
      ["Contact", `${parsed.contact} ${contactDescriptions[parsed.contact] || ""}`.trim()],
      ["Keying", parsed.key],
      ["Description", milShellTypes[parsed.shellType] || ""],
    ];
  }

  function copyText(text, button) {
    const done = () => {
      const original = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = original;
      }, 900);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
    done();
  }

  function renderError(panel, message) {
    panel.innerHTML = "";
    const block = document.createElement("div");
    block.className = "error-state";
    block.textContent = message;
    panel.appendChild(block);
  }

  function renderEmpty(panel) {
    panel.innerHTML = "";
    const block = document.createElement("div");
    block.className = "empty-state";
    block.textContent = "Ready";
    panel.appendChild(block);
  }

  function renderResults(panel, payload) {
    panel.innerHTML = "";

    // Handle rugged I/O connector recognition
    if (payload.mode === "rugged_io" && payload.ruggedInfo) {
      const info = payload.ruggedInfo;
      const faceSvg = info.face_svg || info.svg;
      const mountSvg = info.svg !== faceSvg ? info.svg : "";
      const block = document.createElement("div");
      block.className = "result-block rugged-io-result";
      block.innerHTML = `
        <div class="rugged-io-header">
          <h3 class="rugged-io-family">${info.family}</h3>
          <span class="rugged-io-type">${info.connector_type}</span>
        </div>
        <dl class="decode-grid">
          <div><dt>Input</dt><dd>${info.input}</dd></div>
          <div><dt>Vendor</dt><dd>${info.vendor}</dd></div>
          <div><dt>Family</dt><dd>${info.family}</dd></div>
          <div><dt>Interface</dt><dd>${info.interface}</dd></div>
          <div><dt>Shell Size</dt><dd>${info.shell_size}</dd></div>
          <div><dt>D38999 Relation</dt><dd>${info.d38999_relation}</dd></div>
          ${info.mounting_type ? `<div><dt>Mounting</dt><dd>${info.mounting_type}</dd></div>` : ""}
          ${info.suffix ? `<div><dt>Suffix/Config</dt><dd>${info.suffix}</dd></div>` : ""}
        </dl>
        <div class="rugged-io-note">${info.note}</div>
        <div class="rugged-io-svg">
          ${faceSvg ? `<img src="assets/d38999/svg/${faceSvg}" alt="${info.family} face" style="max-width:100px;max-height:100px;opacity:0.8"/>` : ""}
          ${mountSvg ? `<img src="assets/d38999/svg/${mountSvg}" alt="${info.family} profile" style="max-width:160px;max-height:80px;opacity:0.7;margin-left:12px"/>` : ""}
        </div>
      `;
      panel.appendChild(block);
      return;
    }

    const template = document.getElementById("conversionTemplate");

    payload.results.forEach((result) => {
      const node = template.content.cloneNode(true);
      const normalized = node.querySelector(".normalized");
      const sourceLine = node.querySelector(".source-line");
      const copyD38999 = node.querySelector(".copy-d38999");
      const decodeGrid = node.querySelector(".decode-grid");
      const tbody = node.querySelector("tbody");

      normalized.textContent = result.parsed.normalized;
      sourceLine.textContent = payload.mode === "manufacturer" ? `Matched ${result.source}` : milShellTypes[result.parsed.shellType] || "D38999";
      copyD38999.addEventListener("click", () => copyText(result.parsed.normalized, copyD38999));

      decodedFields(result.parsed).forEach(([label, value]) => {
        const wrapper = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        wrapper.append(dt, dd);
        decodeGrid.appendChild(wrapper);
      });

      result.candidates.forEach((candidate) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td></td>
          <td></td>
          <td><span class="candidate-pn"></span></td>
          <td><span class="confidence"></span></td>
          <td class="note-cell"></td>
          <td><button type="button" class="copy-btn">Copy</button></td>
        `;
        row.children[0].textContent = candidate.manufacturer;
        row.children[1].textContent = candidate.product_line;
        row.querySelector(".candidate-pn").textContent = candidate.manufacturer_part_number;
        row.querySelector(".confidence").textContent = candidate.confidence;
        row.querySelector(".note-cell").textContent = candidate.notes;
        row.querySelector(".copy-btn").addEventListener("click", (event) => copyText(candidate.manufacturer_part_number, event.currentTarget));
        tbody.appendChild(row);
      });

      if (!result.candidates.length) {
        const message = document.createElement("div");
        message.className = "no-candidates";
        message.textContent = "Decoded successfully, but no automated manufacturer candidates matched this exact class/style/contact combination.";
        node.querySelector(".result-block").appendChild(message);
      }

      panel.appendChild(node);
    });
  }

  function initUi() {
    const form = document.getElementById("converterForm");
    const input = document.getElementById("pnInput");
    const clearBtn = document.getElementById("clearBtn");
    const panel = document.getElementById("resultPanel");
    const count = document.getElementById("ruleCount");
    count.textContent = `${rules.length} rule sets`;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        renderResults(panel, convertInput(input.value));
      } catch (error) {
        renderError(panel, error.message);
      }
    });

    clearBtn.addEventListener("click", () => {
      input.value = "";
      input.focus();
      renderEmpty(panel);
    });

    document.querySelectorAll("[data-sample]").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.sample;
        renderResults(panel, convertInput(input.value));
      });
    });

    renderEmpty(panel);
  }

  const api = {
    rules,
    parseD38999Pin,
    reverseParseManufacturerPin,
    convertInput,
    convertParsed,
    recognizeRuggedIo,
    RUGGED_IO_FAMILIES,
  };

  globalThis.D38999Converter = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUi);
  } else {
    initUi();
  }
})();
