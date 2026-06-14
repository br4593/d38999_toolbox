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
  const numericShellSizes = Array.from(
    new Set(
      Object.values(shellSizeNumbers).flatMap((number) =>
        number === "9" ? ["09", "9"] : [number]
      )
    )
  ).sort((a, b) => b.length - a.length);

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
    return String(value || "").toUpperCase().replace(/[\s-]+/g, "");
  }

  function stripDashes(value) {
    return String(value || "").replace(/-/g, "");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  // i18n helpers — converter.js loads after i18n.js, so window.D38999_I18N exists.
  function i18n() {
    return window.D38999_I18N || null;
  }
  function T(key, fallback) {
    const x = i18n();
    return x && typeof x.t === "function" ? x.t(key, fallback) : (fallback != null ? fallback : key);
  }
  function Tf(key, vars, fallback) {
    let str = T(key, fallback);
    if (vars) {
      Object.keys(vars).forEach((name) => {
        str = str.replace(new RegExp("\\{" + name + "\\}", "g"), vars[name]);
      });
    }
    return str;
  }

  // Last successful payload, so the open result re-renders on language change.
  let lastPayload = null;

  function parseShellInsertContactKey(tail) {
    for (const shellNumber of numericShellSizes) {
      if (!tail.startsWith(shellNumber)) continue;
      const rest = tail.slice(shellNumber.length);
      // Full form: insert + contact + key (e.g. "35PN")
      const match = rest.match(/^(\d{1,3})([A-Z])([A-Z])$/);
      if (match) {
        return {
          shellSizeCode: shellCodeByNumber[shellNumber],
          insert: match[1],
          contact: match[2],
          key: match[3],
        };
      }
      // No-key form: insert + contact only — assume normal keying (e.g. "35P" from PCB PNs)
      const matchNoKey = rest.match(/^(\d{1,3})([A-Z])$/);
      if (matchNoKey) {
        return {
          shellSizeCode: shellCodeByNumber[shellNumber],
          insert: matchNoKey[1],
          contact: matchNoKey[2],
          key: "N",
        };
      }
    }
    return null;
  }

  // Strip Amphenol deviation and option suffixes before tail parsing.
  // Handles: F404, F459, F472, F485, F404LF, F404LFC, -LC, -LF, quadrax/PCB modifiers CI/LI/GQ/Q/G.
  function stripAmphenolSuffixes(tail) {
    return tail
      .replace(/-LC$/i, "")
      .replace(/F\d{3}(?:LFC|LF)?$/i, "")
      .replace(/-LF$/i, "");
  }

  // Derive the PCB-variant base prefix from a crimp prefix.
  // Crimp: "TV07RW-" → clean "TV07RW" → PCB base "TV07W" (remove the R before the finish letter).
  function pcbBaseFromCrimpPrefix(cleanPrefix) {
    // The R appears immediately before the finish class letter at the end of the prefix.
    return cleanPrefix.replace(/R([A-Z]+)$/, "$1");
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

    // Try class candidates longest-first; only accept one whose remainder
    // parses as <shell-size-code><insert><contact>[<key>]. This handles
    // overlapping prefixes like "A" vs "AA"/"AB" (double-letter classes
    // use a trailing hyphen that cleanD38999 has already stripped).
    const sortedClasses = knownClasses.slice().sort((a, b) => b.length - a.length);
    let serviceClass = null;
    let shellSizeCode = null;
    let tail = null;
    for (const code of sortedClasses) {
      if (!restRaw.startsWith(code)) continue;
      const afterClass = restRaw.slice(code.length);
      if (!afterClass || !shellSizeNumbers[afterClass[0]]) continue;
      const m = afterClass.slice(1).match(/^(\d{1,2})([A-Z])([A-Z])?$/);
      if (!m) continue;
      serviceClass = code;
      shellSizeCode = afterClass[0];
      tail = m;
      break;
    }
    if (!serviceClass) throw new Error("Cannot parse service class");

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
          const cleanPrefix = stripDashes(prefix);
          let rawTail = null;

          if (compact.startsWith(cleanPrefix)) {
            // Standard crimp match: e.g. TV07RW1735PN
            rawTail = compact.slice(cleanPrefix.length);
          } else {
            // PCB variant: no R in prefix, optional CI/LI modifier after finish letter.
            // e.g. TV07RW- → PCB base TV07W, then CI/LI stripped → TV07WCI2111PF459 → tail 2111PF459
            const pcbBase = pcbBaseFromCrimpPrefix(cleanPrefix);
            if (pcbBase !== cleanPrefix && compact.startsWith(pcbBase)) {
              let rest = compact.slice(pcbBase.length);
              if (rest.startsWith("GQW") || rest.startsWith("GQF")) rest = rest.slice(2); // ground+quadrax
              else if (rest.startsWith("GQ")) rest = rest.slice(2);
              else if (rest.startsWith("RQ")) rest = rest.slice(2); // crimp quadrax
              if (rest.startsWith("CI") || rest.startsWith("LI")) rest = rest.slice(2);
              else if (rest.startsWith("G") || rest.startsWith("Q")) rest = rest.slice(1);
              rawTail = rest;
            }
          }

          if (!rawTail) return;
          const tail = stripAmphenolSuffixes(rawTail);
          const parsedTail = parseShellInsertContactKey(tail);
          if (!parsedTail) return;
          const parsed = makeParsed(compact, shellType, serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
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
          const parsedTail = parseShellInsertContactKey(tail.slice(serviceClass.length));
          if (!parsedTail) return;
          const parsed = makeParsed(compact, shellType, serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
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
        const prefix = stripDashes(`${rule.base}-${style}`);
        if (!compact.startsWith(prefix)) return;
        const tail = compact.slice(prefix.length);
        const finishEntries = Object.entries(getFinishes(rule)).sort((a, b) => b[1].length - a[1].length);
        finishEntries.forEach(([serviceClass, finishCode]) => {
          if (!tail.startsWith(finishCode)) return;
          const parsedTail = parseShellInsertContactKey(tail.slice(finishCode.length));
          if (!parsedTail) return;
          const parsed = makeParsed(compact, shellType, serviceClass, parsedTail.shellSizeCode, parsedTail.insert, parsedTail.contact, parsedTail.key);
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
        const prefix = `8D${style}`;
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
    { prefix: "RJFTV", family: "RJFTV", vendor: "Amphenol Socapex", interface: "RJ45 Ethernet", shellSize: "19", relation: "MIL-DTL-38999 Series III style rugged RJ45", gender: "Varies by PN (RJ45 jack = female, plug = male)", svg: "rjftv-face.svg" },
    { prefix: "C-RJFTV", family: "C-RJFTV", vendor: "Cinch", interface: "RJ45 Ethernet", shellSize: "19", relation: "D38999 Series III style rugged RJ45", gender: "Varies by PN (RJ45 jack = female, plug = male)", svg: "rjftv-face.svg" },
    { prefix: "CRJFTV", family: "C-RJFTV", vendor: "Cinch", interface: "RJ45 Ethernet", shellSize: "19", relation: "D38999 Series III style rugged RJ45", gender: "Varies by PN (RJ45 jack = female, plug = male)", svg: "rjftv-face.svg" },
    { prefix: "RJF", family: "RJF", vendor: "Amphenol Socapex", interface: "RJ45 Ethernet", shellSize: "18", relation: "MIL-DTL-26482 bayonet style rugged RJ45", gender: "Varies by PN (RJ45 jack = female, plug = male)", svg: "rjf-face.svg" },
    { prefix: "UTO", family: "Souriau UTO/UTS RJ45", vendor: "Souriau / Eaton", interface: "RJ45 Ethernet", shellSize: "18", relation: "Souriau UTO bayonet-coupling rugged Cat5e RJ45 (MIL-DTL-26482 style, NOT D38999 Series III intermateable)", gender: "Varies by PN (plug = male RJ45 cordset, receptacle = female RJ45)", svg: "souriau-uto-uts-rj45-face.svg" },
    { prefix: "UTS", family: "Souriau UTO/UTS RJ45", vendor: "Souriau / Eaton", interface: "RJ45 Ethernet", shellSize: "18", relation: "Souriau UTS thermoplastic bayonet-coupling rugged Cat5e RJ45 (MIL-DTL-26482 style, NOT D38999 Series III intermateable)", gender: "Varies by PN (plug = male RJ45 cordset, receptacle = female RJ45)", svg: "souriau-uto-uts-rj45-face.svg" },
    { prefix: "USB3CFTV", family: "USB3CFTV", vendor: "Amphenol Socapex", interface: "USB-C / USB 3.2", shellSize: "11", relation: "Size 11 D38999-style rugged USB-C", gender: "Varies by PN (USB-C receptacle = female, plug = male)", svg: "usb3cftv-face.svg" },
    { prefix: "USB3FTV", family: "USB3FTV", vendor: "Amphenol Socapex", interface: "USB 3.x Type-A", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB 3", gender: "Varies by PN (USB Type-A receptacle = female, plug = male)", svg: "usb3ftv-face.svg" },
    { prefix: "USBFTV", family: "USBFTV", vendor: "Amphenol Socapex", interface: "USB 2.0 Type-A", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB", gender: "Varies by PN (USB Type-A receptacle = female, plug = male)", svg: "usbftv-face.svg" },
    { prefix: "USBBFTV", family: "USBBFTV", vendor: "Amphenol Socapex", interface: "USB-B", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB-B", gender: "Varies by PN (USB-B receptacle = female, plug = male)", svg: "usbbftv-face.svg" },
    { prefix: "USBF", family: "USBFTV", vendor: "Amphenol Socapex", interface: "USB 2.0", shellSize: "15", relation: "MIL-DTL-38999 Series III style rugged USB", gender: "Varies by PN (USB Type-A receptacle = female, plug = male)", svg: "usbftv-face.svg" },
    { prefix: "HDMIFTV", family: "HDMIFTV", vendor: "Amphenol Socapex", interface: "HDMI 2.0", shellSize: "17", relation: "D38999-style rugged HDMI", gender: "Varies by PN (HDMI receptacle = female, plug = male)", svg: "hdmiftv-face.svg" },
    { prefix: "MDPFTV", family: "MDPFTV", vendor: "Amphenol Socapex", interface: "Mini DisplayPort", shellSize: "13", relation: "D38999-style rugged Mini DisplayPort", gender: "Varies by PN (Mini DisplayPort receptacle = female, plug = male)", svg: "mdpftv-face.svg" },
    { prefix: "TV06UCOM", family: "TV µCOM-10Gb+", vendor: "Amphenol Socapex / Amphenol PCD", interface: "10G+ Ethernet", shellSize: "11", relation: "Size 11 MIL-DTL-38999 Series III shell with proprietary high-speed insert (10 Gbps+)", gender: "Varies by module code (P = male / pin, S = female / socket)", svg: "tv-ucom-face.svg", mountSvg: "d38999-straight-plug.svg", mountType: "Plug" },
    { prefix: "TVP00UCOM", family: "TV µCOM-10Gb+", vendor: "Amphenol Socapex / Amphenol PCD", interface: "10G+ Ethernet", shellSize: "11", relation: "Size 11 MIL-DTL-38999 Series III shell with proprietary high-speed insert (10 Gbps+)", gender: "Varies by module code (P = male / pin, S = female / socket)", svg: "tv-ucom-face.svg", mountSvg: "d38999-wall-mount-receptacle.svg", mountType: "Square Flange Receptacle" },
    { prefix: "TV07UCOM", family: "TV µCOM-10Gb+", vendor: "Amphenol Socapex / Amphenol PCD", interface: "10G+ Ethernet", shellSize: "11", relation: "Size 11 MIL-DTL-38999 Series III shell with proprietary high-speed insert (10 Gbps+)", gender: "Varies by module code (P = male / pin, S = female / socket)", svg: "tv-ucom-face.svg", mountSvg: "d38999-jam-nut-receptacle.svg", mountType: "Jam-Nut Receptacle" },
    // Glenair SuperNine / SuperSeal rugged I/O families
    { prefix: "233-312", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type rugged RJ45 plug", gender: "Male RJ45 plug", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-300", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type rugged RJ45 plug coupler", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-301", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 receptacle, crimp contacts", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-302", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 receptacle, PC tails", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-303", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 receptacle, solder cups", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-304", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 plug/receptacle adapter", gender: "Male RJ45 plug one side, female RJ45 jack other", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-305", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 / Quadrax", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45/Quadrax interface adapter", gender: "Female RJ45 jack (RJ45 side)", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "233-330", family: "SuperNine-RJ45", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e/6A", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 feedthru receptacle", gender: "Female RJ45 jack (both sides)", svg: "glenair-supernine-rj45-face.svg" },
    { prefix: "244-001", family: "SuperNine-RJ45-TVS", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e TVS", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 TVS jam-nut receptacle", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-tvs-face.svg" },
    { prefix: "244-002", family: "SuperNine-RJ45-TVS", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e TVS", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 TVS wall mount receptacle", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-tvs-face.svg" },
    { prefix: "244-003", family: "SuperNine-RJ45-TVS", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e TVS", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 TVS jam-nut receptacle", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-tvs-face.svg" },
    { prefix: "244-004", family: "SuperNine-RJ45-TVS", vendor: "Glenair", interface: "RJ45 Ethernet Cat5e TVS", shellSize: "19", relation: "SuperNine MIL-DTL-38999 Series III type RJ45 TVS wall mount receptacle", gender: "Female RJ45 jack", svg: "glenair-supernine-rj45-tvs-face.svg" },
    { prefix: "233-340", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "15", relation: "SuperNine MIL-DTL-38999 Series III type USB coupler", gender: "Female USB Type-A (both sides)", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-342", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "15", relation: "SuperNine MIL-DTL-38999 Series III type USB receptacle, PC tails", gender: "Female USB Type-A", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-343", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "15", relation: "SuperNine MIL-DTL-38999 Series III type USB receptacle, solder cup", gender: "Female USB Type-A", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-344", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "15", relation: "SuperNine MIL-DTL-38999 Series III type USB receptacle adapter, MIL-STD-1560", gender: "Female USB Type-A", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-345", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "15", relation: "SuperNine MIL-DTL-38999 Series III type USB receptacle, crimp contacts", gender: "Female USB Type-A", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-370", family: "SuperNine-USB", vendor: "Glenair", interface: "USB 2.0 / USB 3.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type USB feedthru receptacle", gender: "Female USB Type-A (both sides)", svg: "glenair-supernine-usb-face.svg" },
    { prefix: "233-350", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 panel mount receptacle", gender: "Female USB 3.0 Type-A", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount receptacle" },
    { prefix: "233-352", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 receptacle, PC tails", gender: "Female USB 3.0 Type-A", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount receptacle" },
    { prefix: "233-353", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 receptacle, solder cup", gender: "Female USB 3.0 Type-A", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount receptacle" },
    { prefix: "233-354", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 receptacle, breakout board", gender: "Female USB 3.0 Type-A", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount receptacle" },
    { prefix: "233-355", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 female-to-female feedthru", gender: "Female USB 3.0 Type-A (both sides)", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount feed-thru" },
    { prefix: "233-357", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 receptacle with threaded standoff", gender: "Female USB 3.0 Type-A", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-profile.svg", mountType: "Size 15 panel-mount receptacle, threaded standoff" },
    { prefix: "233-358", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 plug adapter for cordset", gender: "Male USB 3.0 Type-A plug (via cordset)", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-plug-profile.svg", mountType: "USB cordset plug adapter" },
    { prefix: "233-392", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 memory-stick plug", gender: "Male USB 3.0 Type-A plug", svg: "glenair-superseal-usb3-face.svg", mountSvg: "glenair-superseal-usb3-plug-profile.svg", mountType: "USB memory-stick plug" },
    { prefix: "2330-0445", family: "SuperSeal-USB3", vendor: "Glenair", interface: "USB 3.0 / USB 3.2 Gen 1 Type-A", shellSize: "15", relation: "SuperSeal 38999 type USB 3.0 cable jumper to commercial USB Type-A plug", gender: "Male USB 3.0 Type-A plug (commercial cable end)", svg: "glenair-superseal-usb3-face.svg" },
    { prefix: "233-380", family: "SuperSeal-USB32C", vendor: "Glenair", interface: "USB 3.2 Gen 2 Type-C", shellSize: "13", relation: "SuperSeal 38999 type USB 3.2 Gen 2 Type-C receptacle, female-to-female", gender: "Female USB Type-C (both sides)", svg: "glenair-superseal-usbc-face.svg", mountSvg: "glenair-superseal-usbc-profile.svg", mountType: "Size 13 panel-mount receptacle" },
    { prefix: "233-381", family: "SuperSeal-USB32C", vendor: "Glenair", interface: "USB 3.2 Gen 2 Type-C", shellSize: "13", relation: "SuperSeal 38999 type USB 3.2 Gen 2 Type-C feedthrough", gender: "Female USB Type-C (both sides)", svg: "glenair-superseal-usbc-face.svg", mountSvg: "glenair-superseal-usbc-profile.svg", mountType: "Size 13 panel-mount feed-thru" },
    { prefix: "233-382", family: "SuperSeal-USB32C", vendor: "Glenair", interface: "USB 3.2 Gen 2 Type-C", shellSize: "13", relation: "SuperSeal 38999 type USB 3.2 Gen 2 Type-C receptacle, PC tails", gender: "Female USB Type-C", svg: "glenair-superseal-usbc-face.svg", mountSvg: "glenair-superseal-usbc-profile.svg", mountType: "Size 13 panel-mount receptacle" },
    { prefix: "233-384", family: "SuperSeal-USB32C", vendor: "Glenair", interface: "USB 3.2 Gen 2 Type-C", shellSize: "13", relation: "SuperSeal 38999 type USB 3.2 Gen 2 Type-C receptacle, breakout board", gender: "Female USB Type-C", svg: "glenair-superseal-usbc-face.svg", mountSvg: "glenair-superseal-usbc-profile.svg", mountType: "Size 13 panel-mount receptacle" },
    { prefix: "233-388", family: "SuperSeal-USB32C", vendor: "Glenair", interface: "USB 3.2 Gen 2 Type-C", shellSize: "13", relation: "SuperSeal 38999 type USB 3.2 Gen 2 Type-C drive-thru plug", gender: "Male USB Type-C plug", svg: "glenair-superseal-usbc-face.svg", mountSvg: "glenair-superseal-usbc-profile.svg", mountType: "Size 13 drive-thru plug" },
    { prefix: "233-360", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 panel mount coupler", gender: "Female HDMI Type-A (both sides)", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-362", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 receptacle, PC tails", gender: "Female HDMI Type-A", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-363", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 receptacle, solder cups", gender: "Female HDMI Type-A", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-364", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 receptacle, breakout board", gender: "Female HDMI Type-A", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-365", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 feedthru coupler", gender: "Female HDMI Type-A (both sides)", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-368", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 plug", gender: "Female HDMI Type-A receptacle", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "2330-0455", family: "SuperNine-HDMI", vendor: "Glenair", interface: "HDMI 2.0", shellSize: "17", relation: "SuperNine MIL-DTL-38999 Series III type HDMI 2.0 cable assembly to commercial HDMI plug", gender: "Male HDMI Type-A plug (commercial cable end)", svg: "glenair-supernine-hdmi-face.svg" },
    { prefix: "233-376", family: "SuperSeal-DP", vendor: "Glenair", interface: "DisplayPort 1.4", shellSize: "17", relation: "SuperSeal 38999 type DisplayPort 1.4 receptacle with shielded DisplayPort coupler", gender: "Female DisplayPort (both sides)", svg: "glenair-superseal-dp-face.svg" },
    { prefix: "233-379", family: "SuperSeal-DP", vendor: "Glenair", interface: "DisplayPort 1.4", shellSize: "17", relation: "SuperSeal 38999 type DisplayPort 1.4 receptacle, DisplayPort to PC tail termination", gender: "Female DisplayPort", svg: "glenair-superseal-dp-face.svg" },
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
    // Souriau UTO/UTS is a MIL-DTL-26482 bayonet-coupling RJ45 (not D38999 intermateable); only a face view is drawn.
    "Souriau UTO/UTS RJ45": { face: "souriau-uto-uts-rj45-face.svg" },
    "USB3CFTV": { plug: "usb3cftv-plug.svg", "jam-nut-receptacle": "usb3cftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usb3cftv-square-flange-receptacle.svg", "standoff-receptacle": "usb3cftv-standoff-receptacle.svg", face: "usb3cftv-face.svg" },
    "USB3FTV":  { plug: "usb3ftv-plug.svg", "jam-nut-receptacle": "usb3ftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usb3ftv-square-flange-receptacle.svg", "reduced-flange-receptacle": "usb3ftv-reduced-flange-receptacle.svg", "standoff-receptacle": "usb3ftv-standoff-receptacle.svg", face: "usb3ftv-face.svg" },
    "USBFTV":   { plug: "usbftv-plug.svg", "jam-nut-receptacle": "usbftv-jam-nut-receptacle.svg", "square-flange-receptacle": "usbftv-square-flange-receptacle.svg", "through-bulkhead": "usbftv-through-bulkhead.svg", face: "usbftv-face.svg" },
    "USBBFTV":  { face: "usbbftv-face.svg" },
    "HDMIFTV":  { plug: "hdmiftv-plug.svg", "jam-nut-receptacle": "hdmiftv-jam-nut-receptacle.svg", "square-flange-receptacle": "hdmiftv-square-flange-receptacle.svg", "reduced-flange-receptacle": "hdmiftv-reduced-flange-receptacle.svg", "standoff-receptacle": "hdmiftv-standoff-receptacle.svg", face: "hdmiftv-face.svg" },
    "MDPFTV":   { plug: "mdpftv-plug.svg", "jam-nut-receptacle": "mdpftv-jam-nut-receptacle.svg", "square-flange-receptacle": "mdpftv-square-flange-receptacle.svg", face: "mdpftv-face.svg" },
    "TV µCOM-10Gb+": { plug: "d38999-straight-plug.svg", "jam-nut-receptacle": "d38999-jam-nut-receptacle.svg", "square-flange-receptacle": "d38999-wall-mount-receptacle.svg", face: "tv-ucom-face.svg" },
    // Glenair SuperNine / SuperSeal families: face + side profile (+ mount variants where drawn).
    // Mount tokens for these appear after the series code (00/D0 wall, CM/07 jam-nut, G6 plug),
    // so they are matched by the Glenair mount-token detection below, not by suffix char 0.
    "SuperNine-RJ45":     { face: "glenair-supernine-rj45-face.svg", side: "glenair-supernine-rj45-profile.svg", plug: "glenair-supernine-rj45-plug.svg", "jam-nut-receptacle": "glenair-supernine-rj45-jam-nut-receptacle.svg", "wall-mount-receptacle": "glenair-supernine-rj45-wall-mount-receptacle.svg" },
    "SuperNine-RJ45-TVS": { face: "glenair-supernine-rj45-tvs-face.svg", side: "glenair-supernine-rj45-tvs-profile.svg", "jam-nut-receptacle": "glenair-supernine-rj45-jam-nut-receptacle.svg", "wall-mount-receptacle": "glenair-supernine-rj45-wall-mount-receptacle.svg" },
    "SuperNine-USB":      { face: "glenair-supernine-usb-face.svg", side: "glenair-supernine-usb-profile.svg", plug: "glenair-supernine-usb-plug.svg", "jam-nut-receptacle": "glenair-supernine-usb-jam-nut-receptacle.svg", "wall-mount-receptacle": "glenair-supernine-usb-wall-mount-receptacle.svg" },
    "SuperSeal-USB3":     { face: "glenair-superseal-usb3-face.svg", side: "glenair-superseal-usb3-profile.svg", plug: "glenair-superseal-usb3-plug-profile.svg" },
    "SuperSeal-USB32C":   { face: "glenair-superseal-usbc-face.svg", side: "glenair-superseal-usbc-profile.svg" },
    "SuperNine-HDMI":     { face: "glenair-supernine-hdmi-face.svg", side: "glenair-supernine-hdmi-profile.svg", plug: "glenair-supernine-hdmi-plug.svg", "jam-nut-receptacle": "glenair-supernine-hdmi-jam-nut-receptacle.svg", "wall-mount-receptacle": "glenair-supernine-hdmi-wall-mount-receptacle.svg" },
    "SuperSeal-DP":       { face: "glenair-superseal-dp-face.svg", side: "glenair-superseal-dp-profile.svg", "jam-nut-receptacle": "glenair-superseal-dp-jam-nut-receptacle.svg", "wall-mount-receptacle": "glenair-superseal-dp-wall-mount-receptacle.svg" },
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
        // Families that ship a dedicated side/profile elevation default to it (e.g. Glenair),
        // so the viewer can show face + side side-by-side.
        if (familySvgs.side) {
          selectedSvg = familySvgs.side;
          mountingType = "Side Profile";
        }
        // Per-entry size/profile drawing (used by families encoded by dash number, e.g. Glenair SuperSeal)
        if (entry.mountSvg) {
          selectedSvg = entry.mountSvg;
          mountingType = entry.mountType || "";
        }
        if (shellTypeInfo && familySvgs[shellTypeInfo.suffix]) {
          selectedSvg = familySvgs[shellTypeInfo.suffix];
          mountingType = shellTypeInfo.mount;
        }
        // Glenair SuperNine / SuperSeal mount-token detection. The mount code appears after the
        // series letters (not at suffix position 0), so scan the suffix for known mount tokens.
        // Shell/cat/key/port fields never contain "00"/"D0"/"G6"/"CM"/"07", so substring match is safe.
        if (familySvgs.side) {
          const u = suffix.toUpperCase();
          if (/G6/.test(u) && familySvgs.plug) {
            selectedSvg = familySvgs.plug;
            mountingType = "Plug";
          } else if (/D0/.test(u) && familySvgs["wall-mount-receptacle"]) {
            selectedSvg = familySvgs["wall-mount-receptacle"];
            mountingType = "Wall Mount Receptacle (round holes)";
          } else if (/00/.test(u) && familySvgs["wall-mount-receptacle"]) {
            selectedSvg = familySvgs["wall-mount-receptacle"];
            mountingType = "Wall Mount Receptacle (slotted holes)";
          } else if (/(CM|07)/.test(u) && familySvgs["jam-nut-receptacle"]) {
            selectedSvg = familySvgs["jam-nut-receptacle"];
            mountingType = "Jam-Nut Receptacle";
          }
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
          interface_gender: entry.gender || "",
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
      throw new Error(T("converter.error.enterPn", "Enter a part number."));
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
        throw new Error(T("converter.error.notRecognized", "The part number was not recognized by the current rule set."));
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
      [T("converter.field.series", "Series"), parsed.series],
      [T("converter.field.shellType", "Shell type"), `/${parsed.shellType}`],
      [T("converter.field.class", "Class"), parsed.serviceClass],
      [T("converter.field.shellSize", "Shell size"), `${parsed.shellSizeCode} = ${parsed.shellSizeNumber}`],
      [T("converter.field.insert", "Insert"), parsed.insert],
      [T("converter.field.contact", "Contact"), `${parsed.contact} ${contactDescriptions[parsed.contact] || ""}`.trim()],
      [T("converter.field.keying", "Keying"), parsed.key],
      [T("converter.field.description", "Description"), milShellTypes[parsed.shellType] || ""],
    ];
  }

  function copyText(text, button) {
    const done = () => {
      const original = button.textContent;
      button.textContent = T("converter.copied", "Copied");
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
    lastPayload = null;
    panel.innerHTML = "";
    const block = document.createElement("div");
    block.className = "empty-state";
    block.textContent = T("converter.ready", "Ready");
    panel.appendChild(block);
  }

  function renderResults(panel, payload) {
    lastPayload = payload;
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
          <h3 class="rugged-io-family">${esc(info.family)}</h3>
          <span class="rugged-io-type">${esc(info.connector_type)}</span>
        </div>
        <dl class="decode-grid">
          <div><dt>${esc(T("converter.io.input", "Input"))}</dt><dd>${esc(info.input)}</dd></div>
          <div><dt>${esc(T("converter.io.vendor", "Vendor"))}</dt><dd>${esc(info.vendor)}</dd></div>
          <div><dt>${esc(T("converter.io.family", "Family"))}</dt><dd>${esc(info.family)}</dd></div>
          <div><dt>${esc(T("converter.io.interface", "Interface"))}</dt><dd>${esc(info.interface)}</dd></div>
          <div><dt>${esc(T("converter.io.shellSize", "Shell Size"))}</dt><dd>${esc(info.shell_size)}</dd></div>
          <div><dt>${esc(T("converter.io.relation", "D38999 Relation"))}</dt><dd>${esc(info.d38999_relation)}</dd></div>
          ${info.mounting_type ? `<div><dt>${esc(T("converter.io.mounting", "Mounting"))}</dt><dd>${esc(info.mounting_type)}</dd></div>` : ""}
          ${info.suffix ? `<div><dt>${esc(T("converter.io.suffix", "Suffix/Config"))}</dt><dd>${esc(info.suffix)}</dd></div>` : ""}
        </dl>
        <div class="rugged-io-note">${esc(info.note)}</div>
        <div class="rugged-io-svg">
          ${faceSvg ? `<img src="assets/svg/${esc(faceSvg)}" alt="${esc(info.family)} face" style="max-width:100px;max-height:100px;opacity:0.8"/>` : ""}
          ${mountSvg ? `<img src="assets/svg/${esc(mountSvg)}" alt="${esc(info.family)} profile" style="max-width:160px;max-height:80px;opacity:0.7;margin-left:12px"/>` : ""}
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
      const openInDecoder = node.querySelector(".open-in-decoder");
      const exportReport = node.querySelector(".export-report");
      const decodeGrid = node.querySelector(".decode-grid");
      const tbody = node.querySelector("tbody");

      normalized.textContent = result.parsed.normalized;
      sourceLine.textContent = payload.mode === "manufacturer"
        ? Tf("converter.matched", { source: result.source }, "Matched {source}")
        : milShellTypes[result.parsed.shellType] || "D38999";
      copyD38999.addEventListener("click", () => copyText(result.parsed.normalized, copyD38999));
      if (openInDecoder) {
        openInDecoder.addEventListener("click", () => {
          const pn = result.parsed.normalized;
          if (!pn) return;
          const partInput = document.getElementById("partNumberInput");
          if (partInput) partInput.value = pn;
          const tabBtn = document.querySelector('[data-tab="decoder"]');
          if (tabBtn) tabBtn.click();
          const decBtn = document.getElementById("decodeButton");
          if (decBtn) decBtn.click();
        });
      }
      if (exportReport) {
        exportReport.addEventListener("click", () => {
          const pn = result.parsed.normalized;
          if (!pn) return;
          const userInput = (document.getElementById("pnInput")?.value || "").trim();
          const viaInput = (payload.mode === "manufacturer" && userInput && userInput.toUpperCase() !== pn.toUpperCase())
            ? userInput : null;
          const vendor = payload.mode === "manufacturer" ? (result.source || "").split(" ")[0] : null;
          document.dispatchEvent(new CustomEvent("d38999:export-report", {
            detail: { partNumber: pn, viaInput, vendor },
          }));
        });
      }

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
        const copyBtn = row.querySelector(".copy-btn");
        copyBtn.textContent = T("converter.copyBtn", "Copy");
        copyBtn.addEventListener("click", (event) => copyText(candidate.manufacturer_part_number, event.currentTarget));
        tbody.appendChild(row);
      });

      if (!result.candidates.length) {
        const message = document.createElement("div");
        message.className = "no-candidates";
        message.textContent = T("converter.noCandidates", "Decoded successfully, but no automated manufacturer candidates matched this exact class/style/contact combination.");
        node.querySelector(".result-block").appendChild(message);
      }

      panel.appendChild(node);
    });

    const x = i18n();
    if (x && typeof x.apply === "function") x.apply(panel);
  }

  function initUi() {
    const form = document.getElementById("converterForm");
    const input = document.getElementById("pnInput");
    const clearBtn = document.getElementById("clearBtn");
    const panel = document.getElementById("resultPanel");
    const count = document.getElementById("ruleCount");
    const mfrsEl = document.getElementById("converterManufacturers");

    const manufacturers = (() => {
      const EXCLUDED = new Set(["MIL-DTL-38999", "Repo-generated"]);
      return [...new Set(
        rules
          .map((rule) => String(rule.manufacturer || "")
            // collapse helper labels like "Conesys / Souriau reference geometry" -> "Conesys"
            .split(" / ")[0]
            .replace(/\s+reference geometry$/i, "")
            .trim())
          .filter((name) => name && !EXCLUDED.has(name))
      )].sort((a, b) => a.localeCompare(b));
    })();

    // Refresh language-dependent chrome (rule-set count, catalog tooltip).
    function refreshChrome() {
      if (count) count.textContent = Tf("converter.ruleSets", { count: rules.length }, `${rules.length} rule sets`);
      if (mfrsEl) {
        mfrsEl.textContent = manufacturers.length ? manufacturers.join(", ") : "—";
        mfrsEl.title = Tf("converter.catalogsCovered", { count: manufacturers.length }, `${manufacturers.length} manufacturer catalogs covered`);
      }
    }
    refreshChrome();

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

    const x = i18n();
    if (x && typeof x.onChange === "function") {
      x.onChange(() => {
        refreshChrome();
        if (lastPayload) renderResults(panel, lastPayload);
        else renderEmpty(panel);
      });
    }

    renderEmpty(panel);
  }

  function partNumberFromParsed(p) {
    if (!p) return "";
    return `D38999/${p.shellType}${p.serviceClass}${p.shellSizeCode}${p.insert}${p.contact}${p.key || "N"}`;
  }

  const KNOWN_VENDORS = [
    "Amphenol", "Conesys", "Eaton", "Glenair",
    "ITT Cannon", "Souriau", "TE Deutsch", "TE Connectivity",
  ];

  function vendorFromSource(source) {
    const s = String(source || "");
    for (const v of KNOWN_VENDORS) {
      if (s.startsWith(v)) return v;
    }
    const space = s.indexOf(" ");
    return space > 0 ? s.slice(0, space) : s;
  }

  // Public smart-decoder helper: given any string, returns ranked candidates that
  // map a manufacturer PN back to a normalized D38999 PN with full vendor
  // cross-reference. Empty array if nothing matches.
  function reverseConvert(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    const rows = reverseParseManufacturerPin(trimmed);
    const out = [];
    const seen = new Set();
    rows.forEach((row) => {
      const d38999 = partNumberFromParsed(row.parsed);
      if (!d38999) return;
      const key = `${row.source}|${d38999}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        vendor: vendorFromSource(row.source),
        source: row.source,
        d38999PartNumber: d38999,
        parsed: row.parsed,
        confidence: typeof row.parsed.confidence === "number" ? row.parsed.confidence : 0.85,
        candidates: convertParsed(row.parsed),
      });
    });
    out.sort((a, b) =>
      (b.confidence - a.confidence) ||
      a.vendor.localeCompare(b.vendor) ||
      a.d38999PartNumber.localeCompare(b.d38999PartNumber)
    );
    return out;
  }

  const api = {
    rules,
    parseD38999Pin,
    reverseParseManufacturerPin,
    reverseConvert,
    partNumberFromParsed,
    convertInput,
    convertParsed,
    recognizeRuggedIo,
    RUGGED_IO_FAMILIES,
    FAMILY_SVG_MAP,
  };

  globalThis.D38999Converter = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUi);
  } else {
    initUi();
  }
})();
