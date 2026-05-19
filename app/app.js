(function () {
  "use strict";

  const toolboxData = window.D38999_TOOLBOX_DATA || {};
  const DATA = toolboxData.pinout || window.D38999_DATA || {};
  const converterData = toolboxData.converter || {};
  const researchData = toolboxData.research || {};
  const insertData = DATA.insertArrangements || { arrangements: [] };
  const partRules = DATA.partNumberRules || {};
  const standard = DATA.standardDefinitions || { definitions: {} };
  const dlaDocs = DATA.dlaDocuments || { documents: [], summary: {} };
  const reviewData = DATA.reviewNeeded || { items: [] };
  const extractedRules = researchData.extractedRules || {};
  const supportedCombinations = (researchData.catalogSupportedCombinations || {}).catalogSupportedCombinations || [];
  const verifiedPartNumbers = (researchData.verifiedPartNumbers || {}).verifiedPartNumbers || [];
  const defs = standard.definitions || {};
  const arrangements = (insertData.arrangements || []).slice();
  const reviewById = new Map((reviewData.items || []).map((item) => [item.id, item]));
  const verifiedPartNumberMap = new Map(
    verifiedPartNumbers.map((item) => [String(item.partNumber || "").toUpperCase().replace(/[\s-]+/g, ""), item])
  );
  const styleEntriesBySlashSheet = new Map(
    (extractedRules.normalizedShellStyles || [])
      .filter((item) => /^\/\d+$/.test(item.catalogCode || ""))
      .map((item) => [item.catalogCode, item])
  );
  const catalogMateMap = (() => {
    const out = new Map();
    (extractedRules.matingSlashSheetMap || []).forEach((rule) => {
      const sourceSlashSheet = rule.sourceSlashSheet;
      if (!sourceSlashSheet) return;
      const current = out.get(sourceSlashSheet) || { mates: new Set(), sources: [] };
      (rule.candidateMateSlashSheets || []).forEach((mate) => current.mates.add(mate));
      if (rule.source) current.sources.push(rule.source);
      out.set(sourceSlashSheet, current);

      (rule.candidateMateSlashSheets || []).forEach((mate) => {
        const reverse = out.get(mate) || { mates: new Set(), sources: [] };
        reverse.mates.add(sourceSlashSheet);
        if (rule.source) reverse.sources.push(rule.source);
        out.set(mate, reverse);
      });
    });
    return out;
  })();

  const state = {
    selectedArrangement: null,
    selectedContactIndex: null,
    currentPartNumber: "",
    decoded: null,
    hoveredContactIndex: null,
    pinMatches: new Set(),
    viewBox: null,
    baseViewBox: null,
    isPanning: false,
    panStart: null,
    panViewBox: null,
    activeTab: "home",
    activeManualField: "slash_sheet",
    catalogSort: "id",
    manualSelector: null,
    buildStep: 0,
    buildRendered: false,
    manualRendered: false,
    selectedMateSheet: null,
    activeGaugeFilter: "",
  };

  const $ = (id) => document.getElementById(id);

  const CONTACT_FLIP = {
    A: "B", B: "A",
    C: "D", D: "C",
    G: "U", U: "G",
    H: "J", J: "H",
    P: "S", S: "P",
    R: "M", M: "R",
    X: "Z", Z: "X",
  };

  // Side-profile schematic SVGs for each external shell mounting style
  const SHELL_PROFILES = {
    plug: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <rect x="2" y="24" width="14" height="10" rx="1.5" stroke-width="1.2"/>
      <rect x="16" y="17" width="34" height="24" rx="2" stroke-width="1.5"/>
      <rect x="46" y="9" width="40" height="40" rx="2" stroke-width="1.5"/>
      <line x1="54" y1="10" x2="54" y2="48" stroke-width="0.7" opacity="0.45"/>
      <line x1="62" y1="10" x2="62" y2="48" stroke-width="0.7" opacity="0.45"/>
      <line x1="70" y1="10" x2="70" y2="48" stroke-width="0.7" opacity="0.45"/>
      <line x1="78" y1="10" x2="78" y2="48" stroke-width="0.7" opacity="0.45"/>
      <text x="50" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">Straight Plug</text>
    </svg>`,
    wall_receptacle: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <line x1="2" y1="26" x2="14" y2="26" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="2" y1="32" x2="14" y2="32" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="14" y="19" width="44" height="20" rx="2" stroke-width="1.5"/>
      <rect x="58" y="7" width="12" height="44" rx="1.5" stroke-width="1.5"/>
      <circle cx="64" cy="14" r="2.5" stroke-width="1.3"/>
      <circle cx="64" cy="44" r="2.5" stroke-width="1.3"/>
      <line x1="74" y1="2" x2="74" y2="56" stroke-width="1" stroke-dasharray="3 2.5" opacity="0.35"/>
      <text x="44" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">Wall Flange</text>
    </svg>`,
    jamnut_receptacle: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <line x1="2" y1="26" x2="12" y2="26" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="2" y1="32" x2="12" y2="32" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="12" y="19" width="74" height="20" rx="2" stroke-width="1.5"/>
      <rect x="34" y="10" width="18" height="38" rx="1" stroke-width="1.4"/>
      <line x1="37" y1="11" x2="37" y2="47" stroke-width="0.8" opacity="0.4"/>
      <line x1="41" y1="11" x2="41" y2="47" stroke-width="0.8" opacity="0.4"/>
      <line x1="45" y1="11" x2="45" y2="47" stroke-width="0.8" opacity="0.4"/>
      <line x1="49" y1="11" x2="49" y2="47" stroke-width="0.8" opacity="0.4"/>
      <text x="50" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">Jam-Nut</text>
    </svg>`,
    box_receptacle: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <rect x="6" y="10" width="70" height="38" rx="2.5" stroke-width="1.5"/>
      <rect x="24" y="17" width="34" height="24" rx="1.5" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>
      <circle cx="11" cy="16" r="2.5" stroke-width="1.3"/>
      <circle cx="11" cy="42" r="2.5" stroke-width="1.3"/>
      <circle cx="71" cy="16" r="2.5" stroke-width="1.3"/>
      <circle cx="71" cy="42" r="2.5" stroke-width="1.3"/>
      <text x="44" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">Box Mount</text>
    </svg>`,
    cover: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <rect x="4" y="15" width="54" height="28" rx="3" stroke-width="1.5"/>
      <path d="M58 15 Q72 29 58 43" stroke-width="1.5"/>
      <rect x="62" y="22" width="22" height="14" rx="2" stroke-width="1.2" opacity="0.7"/>
      <text x="45" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">Protective Cover</text>
    </svg>`,
    inline_receptacle: `<svg viewBox="0 0 100 58" fill="none" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" class="shell-profile-svg">
      <line x1="2" y1="26" x2="14" y2="26" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="2" y1="32" x2="14" y2="32" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="14" y="15" width="72" height="28" rx="2.5" stroke-width="1.5"/>
      <line x1="86" y1="26" x2="98" y2="26" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="86" y1="32" x2="98" y2="32" stroke-width="1.2" stroke-linecap="round"/>
      <text x="50" y="56.5" text-anchor="middle" font-size="7.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none" opacity="0.65">In-Line</text>
    </svg>`,
  };

  const SHELL_PROFILE_TYPE = {
    "/20": "wall_receptacle", "/21": "box_receptacle",  "/22": "box_receptacle",
    "/23": "jamnut_receptacle", "/24": "jamnut_receptacle", "/25": "box_receptacle",
    "/26": "plug", "/27": "box_receptacle", "/28": "jamnut_receptacle",
    "/29": "plug", "/30": "plug", "/31": "plug",
    "/32": "cover", "/33": "cover", "/34": "jamnut_receptacle",
    "/35": "wall_receptacle", "/36": "plug",
    "/40": "wall_receptacle", "/41": "box_receptacle", "/42": "box_receptacle",
    "/43": "jamnut_receptacle", "/44": "jamnut_receptacle", "/45": "box_receptacle",
    "/46": "plug", "/47": "plug", "/48": "box_receptacle",
    "/49": "inline_receptacle", "/50": "box_receptacle",
    "/51": "cover", "/52": "cover",
  };

  const SHELL_PROFILE_ASSET = {
    plug: "assets/d38999/svg/d38999-straight-plug.svg",
    wall_receptacle: "assets/d38999/svg/d38999-wall-mount-receptacle.svg",
    jamnut_receptacle: "assets/d38999/svg/d38999-jam-nut-receptacle.svg",
    box_receptacle: "assets/d38999/svg/d38999-receptacle-generic.svg",
    cover: "assets/d38999/svg/d38999-backshell-generic.svg",
    inline_receptacle: "assets/d38999/svg/d38999-receptacle-generic.svg",
  };

  const els = {
    dataStatus: $("dataStatus"),
    selectedStatus: $("selectedStatus"),
    goHomeButton: $("goHomeButton"),
    partNumberInput: $("partNumberInput"),
    decodeButton: $("decodeButton"),
    decodeMessage: $("decodeMessage"),
    slashSheetFilter: $("slashSheetFilter"),
    shellStyleFilter: $("shellStyleFilter"),
    shellFilter: $("shellFilter"),
    arrangementFilter: $("arrangementFilter"),
    countFilter: $("countFilter"),
    sizeFilter: $("sizeFilter"),
    typeFilter: $("typeFilter"),
    genderFilter: $("genderFilter"),
    keyingFilter: $("keyingFilter"),
    catalogGrid: $("catalogGrid"),
    catalogCount: $("catalogCount"),
    catalogSort: $("catalogSort"),
    clearFiltersButton: $("clearFiltersButton"),
    compareA: $("compareA"),
    compareB: $("compareB"),
    comparisonPanel: $("comparisonPanel"),
    viewerTitle: $("viewerTitle"),
    sourceInfo: $("sourceInfo"),
    labelsToggle: $("labelsToggle"),
    outlineToggle: $("outlineToggle"),
    resetViewButton: $("resetViewButton"),
    pinSearchInput: $("pinSearchInput"),
    searchMessage: $("searchMessage"),
    connectorSvg: $("connectorSvg"),
    viewerFrame: $("viewerFrame"),
    decodedPanel: $("decodedPanel"),
    partNumberGuidePanel: $("partNumberGuidePanel"),
    buildPanel: $("buildPanel"),
    buildContent: $("buildContent"),
    homePanel: $("homePanel"),
    manualPanel: $("manualPanel"),
    manualContent: $("manualContent"),
    pinDetailHeader: $("pinDetailHeader"),
    openCatalogLink: $("openCatalogLink"),
  };

  function sourceRef(item) {
    if (!item) return "";
    const pdf = item.source_pdf || standard.source_pdf || "";
    const page = item.source_page ? `p. ${item.source_page}` : "";
    const section = item.section ? `, ${item.section}` : "";
    return [pdf, page].filter(Boolean).join(" ") + section;
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function normalizedCatalogPartNumber(value) {
    return String(value || "").toUpperCase().replace(/[\s-]+/g, "");
  }

  function styleEntryForSlashSheet(slashSheet) {
    return styleEntriesBySlashSheet.get(slashSheet) || null;
  }

  function combinationSupportsSlashSheet(combination, slashSheet) {
    return combination.shellStyleCode === slashSheet || combination.milEquivalent === slashSheet;
  }

  function supportedCatalogRowsForDecoded(decoded) {
    if (!decoded?.ok) return [];
    return supportedCombinations.filter((combination) => {
      if (!combinationSupportsSlashSheet(combination, decoded.slash_sheet)) return false;
      if (Array.isArray(combination.supportedContactStyles) && combination.supportedContactStyles.length) {
        if (!combination.supportedContactStyles.includes(decoded.contact_style)) return false;
      }
      if (Array.isArray(combination.supportedKeying) && combination.supportedKeying.length) {
        if (!combination.supportedKeying.includes(decoded.polarization)) return false;
      }
      return true;
    });
  }

  function catalogValidationForDecoded(decoded) {
    if (!decoded?.ok) {
      return {
        status: "MISSING_DATA",
        reasons: [decoded?.message || "Part number is not decodable."],
        sources: [],
      };
    }

    const exact = verifiedPartNumberMap.get(normalizedCatalogPartNumber(decoded.part_number));
    if (exact) {
      return {
        status: "VERIFIED_EXISTS",
        reasons: ["Exact part number appears in the catalog research dataset."],
        sources: [exact.source],
        verifiedPart: exact,
      };
    }

    if (!decoded.arrangement_exists) {
      return {
        status: "MISSING_DATA",
        reasons: [`Insert arrangement ${decoded.arrangement_id} is not present in the extracted drawing database.`],
        sources: ["d38999-contact-arrangements.pdf"],
      };
    }

    const rows = supportedCatalogRowsForDecoded(decoded);
    if (rows.length) {
      return {
        status: "VALID_FORMAT_BUT_NOT_CONFIRMED",
        reasons: ["The part number fits a cited shell-style, contact-style, and keying rule, but the exact part number was not found verbatim in the catalog examples."],
        sources: rows.map((row) => row.source).filter(Boolean),
        supportingRows: rows,
      };
    }

    const style = styleEntryForSlashSheet(decoded.slash_sheet);
    if (!style) {
      return {
        status: "MISSING_DATA",
        reasons: [`No catalog-backed shell-style record is loaded for ${decoded.slash_sheet}.`],
        sources: [],
      };
    }

    if (style.notes && /hermetic/i.test(style.notes)) {
      return {
        status: "MANUFACTURER_SPECIFIC_UNCERTAIN",
        reasons: [style.notes],
        sources: [style.source].filter(Boolean),
      };
    }

    return {
      status: "INVALID_COMBINATION",
      reasons: ["No cited catalog rule in the local dataset supports this shell-style, contact-style, and keying combination."],
      sources: [style.source].filter(Boolean),
    };
  }

  function scoreMateCandidate(candidate) {
    if (!candidate.isValidMate) return 0;
    let score = 0;
    if (candidate.requiredMatches.series === "matched") score += 0.18;
    if (candidate.requiredMatches.shellSize === "matched") score += 0.18;
    if (candidate.requiredMatches.insertArrangement === "matched") score += 0.18;
    if (candidate.requiredMatches.keying === "matched") score += 0.16;
    if (candidate.requiredOpposites.contactGender) score += 0.16;
    if (candidate.requiredOpposites.matingRole) score += 0.08;
    if (candidate.status === "VERIFIED_EXISTS") score += 0.20;
    if (candidate.status === "VALID_FORMAT_BUT_NOT_CONFIRMED") score += 0.05;
    if (candidate.status === "MANUFACTURER_SPECIFIC_UNCERTAIN") score -= 0.08;
    return Math.max(0, Math.min(0.99, Number(score.toFixed(2))));
  }

  function mateCandidatesForDecoded(decoded) {
    if (!decoded?.ok) return [];
    const style = styleEntryForSlashSheet(decoded.slash_sheet);
    const mapping = catalogMateMap.get(decoded.slash_sheet);
    const mateSheets = mapping ? [...mapping.mates] : [];
    const oppositeContact = CONTACT_FLIP[decoded.contact_style] || "";
    const sourceRole = style?.matingRole || "unknown";
    const oppositeRole = sourceRole === "plug" ? "receptacle" : sourceRole === "receptacle" ? "plug" : "";

    return mateSheets.map((mateSheet) => {
      const targetStyle = styleEntryForSlashSheet(mateSheet);
      const warnings = [];
      const failReasons = [];
      const sources = [...(mapping?.sources || [])];
      if (style?.source) sources.push(style.source);
      if (targetStyle?.source) sources.push(targetStyle.source);

      if (!targetStyle) {
        failReasons.push(`No normalized shell-style record is loaded for ${mateSheet}.`);
      }
      if (targetStyle && targetStyle.participatesInReciprocalSearch === false) {
        failReasons.push(`${mateSheet} is cataloged as an accessory or non-mating part.`);
      }
      if (!oppositeContact) {
        failReasons.push(`Contact style ${decoded.contact_style} does not have a catalog-backed opposite mapping in the local dataset.`);
      }

      const candidatePartNumber = failReasons.length
        ? ""
        : `D38999/${mateSheet.slice(1)}${decoded.class_field}${decoded.shell_code}${decoded.insert_arrangement}${oppositeContact}${decoded.polarization}`;
      const candidateDecoded = candidatePartNumber ? decodePartNumber(candidatePartNumber) : null;
      const validation = candidateDecoded ? catalogValidationForDecoded(candidateDecoded) : { status: "MISSING_DATA", reasons: failReasons, sources: [] };

      if (candidateDecoded?.part_number === decoded.part_number) {
        failReasons.push("Same connector cannot be returned as its own mate.");
      }
      if (candidateDecoded && candidateDecoded.shell_size !== decoded.shell_size) {
        failReasons.push("shell size mismatch");
      }
      if (candidateDecoded && candidateDecoded.arrangement_id !== decoded.arrangement_id) {
        failReasons.push("insert arrangement mismatch");
      }
      if (candidateDecoded && candidateDecoded.polarization !== decoded.polarization) {
        failReasons.push("keying mismatch");
      }
      if (candidateDecoded && candidateDecoded.contact_definition?.contact_gender === decoded.contact_definition?.contact_gender) {
        failReasons.push("same contact gender");
      }
      if (style?.matingRole && targetStyle?.matingRole && oppositeRole && targetStyle.matingRole !== oppositeRole) {
        failReasons.push("same shell role");
      }

      if (style?.notes && /hermetic/i.test(style.notes)) warnings.push(style.notes);
      if (targetStyle?.notes) warnings.push(targetStyle.notes);
      validation.reasons?.forEach((reason) => {
        if (validation.status !== "VALID_FORMAT_BUT_NOT_CONFIRMED") warnings.push(reason);
      });

      const candidate = {
        candidatePartNumber,
        mateSheet,
        manufacturer: "MIL-DTL-38999",
        status: failReasons.length ? "INVALID_COMBINATION" : validation.status,
        isValidMate: failReasons.length === 0 && validation.status !== "INVALID_COMBINATION",
        requiredMatches: {
          series: decoded.slash_sheet_definition?.series_inferred_from_source_text === candidateDecoded?.slash_sheet_definition?.series_inferred_from_source_text ? "matched" : "matched",
          shellSize: candidateDecoded?.shell_size === decoded.shell_size ? "matched" : "failed",
          insertArrangement: candidateDecoded?.arrangement_id === decoded.arrangement_id ? "matched" : "failed",
          keying: candidateDecoded?.polarization === decoded.polarization ? "matched" : "failed",
        },
        requiredOpposites: {
          contactGender: candidateDecoded?.contact_definition?.contact_gender && decoded.contact_definition?.contact_gender && candidateDecoded.contact_definition.contact_gender !== decoded.contact_definition.contact_gender
            ? `${decoded.contact_definition.contact_gender}_to_${candidateDecoded.contact_definition.contact_gender}`
            : "",
          matingRole: oppositeRole && targetStyle?.matingRole === oppositeRole ? `${sourceRole}_to_${targetStyle.matingRole}` : "",
        },
        matchedFields: [
          `series ${decoded.slash_sheet_definition?.series_inferred_from_source_text || "III/IV"}`,
          `shell size ${decoded.shell_size}`,
          `insert ${decoded.arrangement_id}`,
          `keying ${decoded.polarization}`,
        ],
        oppositeFields: [
          sourceRole && targetStyle?.matingRole ? `${sourceRole} -> ${targetStyle.matingRole}` : "",
          oppositeContact ? `${decoded.contact_style} -> ${oppositeContact}` : "",
        ].filter(Boolean),
        conflictingFields: failReasons,
        missingFields: validation.status === "MISSING_DATA" ? ["catalog-backed shell-style or arrangement evidence"] : [],
        warnings: [...new Set(warnings)],
        sources: [...new Set([...sources, ...(validation.sources || [])])],
        targetStyle,
        targetDecoded: candidateDecoded,
      };
      candidate.confidence = scoreMateCandidate(candidate);
      return candidate;
    }).sort((a, b) => b.confidence - a.confidence || naturalCompare(a.mateSheet, b.mateSheet));
  }

  function validationLabel(status) {
    switch (status) {
      case "VERIFIED_EXISTS":
        return "Verified catalog P/N";
      case "VALID_FORMAT_BUT_NOT_CONFIRMED":
        return "Valid format, not confirmed";
      case "INVALID_COMBINATION":
        return "Invalid combination";
      case "MANUFACTURER_SPECIFIC_UNCERTAIN":
        return "Manufacturer-specific uncertainty";
      default:
        return "Missing data";
    }
  }

  function validationClassName(status) {
    if (status === "VERIFIED_EXISTS") return "mating-validation-ok";
    if (status === "VALID_FORMAT_BUT_NOT_CONFIRMED") return "mating-validation-warn";
    return "mating-validation-fail";
  }

  function validationBadgeHtml(status, text) {
    return `<div class="mating-validation ${validationClassName(status)}">
      <svg class="mating-val-icon" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/></svg>
      <span>${escapeHtml(text || validationLabel(status))}</span>
    </div>`;
  }

  function arrangementById(id) {
    return arrangements.find((arr) => arr.id === id) || null;
  }

  function contactKey(contact, index) {
    if (contact.label && contact.label !== "?" && contact.label_confidence !== "needs_review") {
      return contact.label;
    }
    return `__unlabeled_${index + 1}`;
  }

  function contactsWithKeys(arrangement) {
    const contacts = arrangement?.contacts || [];
    const labelCounts = contacts.reduce((counts, contact) => {
      if (contact.label && contact.label !== "?") counts[contact.label] = (counts[contact.label] || 0) + 1;
      return counts;
    }, {});
    return contacts.map((contact, index) => ({
      ...contact,
      _index: index,
      _key:
        contact.label && contact.label !== "?" && labelCounts[contact.label] > 1
          ? `${contact.label}__${index + 1}`
          : contactKey(contact, index),
    }));
  }

  function currentContacts() {
    return contactsWithKeys(state.selectedArrangement);
  }

  function normalizePartNumber(value) {
    const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!compact) return "";
    if (compact === "D38999" || compact === "D38999/") return "D38999/";
    if (compact.startsWith("D38999/")) return compact;
    if (compact.startsWith("D38999")) return compact.replace(/^D38999\/?/, "D38999/");
    if (compact.startsWith("/")) return `D38999${compact}`;
    if (/^\d{2}/.test(compact)) return `D38999/${compact}`;
    return compact;
  }

  function isIncompletePartNumber(partNumber) {
    if (!partNumber || partNumber === "D38999/") return true;
    const prefix = /^D38999\/(\d{0,2})(.*)$/.exec(partNumber);
    if (!prefix) return false;
    return prefix[1].length < 2 || prefix[2].length < 5;
  }

  function setMessage(element, text, warn = false) {
    element.textContent = text || "";
    element.classList.toggle("warn", Boolean(warn));
  }

  function init() {
    const converterRuleCount = (converterData.rules || []).length;
    els.dataStatus.textContent = converterRuleCount
      ? `${arrangements.length} arrangements loaded | ${converterRuleCount} converter rules loaded`
      : `${arrangements.length} arrangements loaded`;
    populateFilters();
    bindEvents();
    renderPartNumberGuide(null);
    renderCatalog();
    if (arrangements.length) {
      selectArrangement(arrangements.find((arr) => arr.id === "17-26") || arrangements[0], true);
    }
    renderDecoded(null);
    renderComparison();
    selectTab("home");
  }

  function populateFilters() {
    const slashSheets = Object.keys(defs.slash_sheets || {}).sort(naturalCompare);
    fillSelect(els.slashSheetFilter, [["", "All / insert arrangements"], ...slashSheets.map((value) => [value, `D38999${value}`])]);

    const shellSizes = unique(arrangements.map((arr) => arr.shell_size)).sort((a, b) => Number(a) - Number(b));
    fillSelect(els.shellFilter, [["", "All"], ...shellSizes.map((value) => [value, value])]);

    const counts = unique(arrangements.map((arr) => String(arr.contact_count))).sort((a, b) => Number(a) - Number(b));
    fillSelect(els.countFilter, [["", "All"], ...counts.map((value) => [value, value])]);

    const sizes = unique(
      arrangements.flatMap((arr) => arr.contact_size_notes || []).map((note) => note.size)
    ).sort(naturalCompare);
    fillSelect(els.sizeFilter, [["", "All"], ...sizes.map((value) => [value, value])]);

    const types = unique(
      arrangements.flatMap((arr) => arr.contacts || []).map((contact) => contact.type)
    ).sort(naturalCompare);
    fillSelect(els.typeFilter, [["", "All"], ...types.map((value) => [value, value])]);

    const arrangementOptions = arrangements.map((arr) => [arr.id, arr.id]);
    fillSelect(els.compareA, arrangementOptions);
    fillSelect(els.compareB, arrangementOptions);
    if (arrangements.length > 1) {
      els.compareA.value = arrangements[0].id;
      els.compareB.value = arrangements[1].id;
    }
  }

  function unique(values) {
    return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
  }

  const selectorFieldOrder = ["slash_sheet", "class_field", "shell_code", "insert_arrangement", "contact_style", "polarization"];

  function blankSelectorSelection() {
    return {
      slash_sheet: "",
      class_field: "",
      shell_code: "",
      insert_arrangement: "",
      contact_style: "",
      polarization: "",
    };
  }

  function selectorSelectionFromDecoded(decoded) {
    if (!decoded?.ok) return blankSelectorSelection();
    const active = decoded;
    return {
      slash_sheet: active.slash_sheet || "",
      class_field: active.class_field || "",
      shell_code: active.shell_code || "",
      insert_arrangement: active.insert_arrangement || "",
      contact_style: active.contact_style || "",
      polarization: active.polarization || "",
    };
  }

  function currentBuildStepFromSelection(selection) {
    const firstEmpty = selectorFieldOrder.findIndex((field) => !selection[field]);
    if (firstEmpty === -1) return selectorFieldOrder.length - 1;
    return firstEmpty;
  }

  function maxBuildStep(selection) {
    return Math.max(0, currentBuildStepFromSelection(selection));
  }

  function syncBuildStep(selection) {
    state.buildStep = Math.min(state.buildStep, maxBuildStep(selection));
  }

  function ensureManualSelectorState(decoded) {
    if (!state.manualSelector) {
      state.manualSelector = selectorSelectionFromDecoded(decoded);
      state.buildStep = currentBuildStepFromSelection(state.manualSelector);
    }
    return state.manualSelector;
  }

  function fillSelect(select, options) {
    select.innerHTML = "";
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
  }

  function bindEvents() {
    els.decodeButton.addEventListener("click", decodeFromInput);
    els.partNumberInput.addEventListener("input", () => decodeFromInput({ automatic: true }));
    els.partNumberInput.addEventListener("focus", () => {
      if (!els.partNumberInput.value.trim()) els.partNumberInput.value = "D38999/";
    });
    els.partNumberInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") decodeFromInput();
    });

    // Example chips in the decoder sidebar
    document.querySelectorAll(".example-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        els.partNumberInput.value = chip.dataset.example;
        decodeFromInput();
      });
    });

    // "Browse the catalog" link in decoder hint
    if (els.openCatalogLink) {
      els.openCatalogLink.addEventListener("click", (event) => {
        event.preventDefault();
        selectTab("catalog");
      });
    }

    document.querySelectorAll("[data-home-target]").forEach((button) => {
      button.addEventListener("click", () => selectTab(button.dataset.homeTarget || "home"));
    });

    // Catalog filters
    for (const element of [
      els.slashSheetFilter,
      els.shellStyleFilter,
      els.shellFilter,
      els.arrangementFilter,
      els.countFilter,
      els.sizeFilter,
      els.typeFilter,
      els.genderFilter,
      els.keyingFilter,
    ]) {
      element.addEventListener("input", renderCatalog);
      element.addEventListener("change", renderCatalog);
    }

    // Clear filters button
    if (els.clearFiltersButton) {
      els.clearFiltersButton.addEventListener("click", clearFilters);
    }

    // Catalog sort
    if (els.catalogSort) {
      els.catalogSort.addEventListener("change", () => {
        state.catalogSort = els.catalogSort.value;
        renderCatalog();
      });
    }

    els.compareA.addEventListener("change", renderComparison);
    els.compareB.addEventListener("change", renderComparison);
    els.labelsToggle.addEventListener("change", renderViewer);
    els.outlineToggle.addEventListener("change", renderViewer);
    els.resetViewButton.addEventListener("click", resetView);
    els.pinSearchInput.addEventListener("input", searchPin);
    document.querySelectorAll("[data-gauge-filter]").forEach((button) => {
      button.addEventListener("click", () => setGaugeFilter(button.dataset.gaugeFilter || ""));
    });
    els.decodedPanel.addEventListener("click", onDecodedPanelClick);
    els.partNumberGuidePanel.addEventListener("click", onManualTokenClick);
    if (els.buildContent) els.buildContent.addEventListener("click", onManualTokenClick);
    if (els.manualContent) els.manualContent.addEventListener("click", onManualTokenClick);
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => selectTab(button.dataset.tab));
    });
    bindPanZoom();
  }

  function clearFilters() {
    els.slashSheetFilter.value = "";
    els.shellStyleFilter.value = "";
    els.shellFilter.value = "";
    els.arrangementFilter.value = "";
    els.countFilter.value = "";
    els.sizeFilter.value = "";
    els.typeFilter.value = "";
    els.genderFilter.value = "";
    els.keyingFilter.value = "";
    renderCatalog();
  }

  function setGaugeFilter(nextFilter) {
    state.activeGaugeFilter = state.activeGaugeFilter === nextFilter ? "" : nextFilter;
    document.querySelectorAll("[data-gauge-filter]").forEach((button) => {
      const active = button.dataset.gaugeFilter === state.activeGaugeFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    renderViewer();
  }

  function onManualTokenClick(event) {
    const selectorButton = event.target.closest("[data-selector-field]");
    if (selectorButton) {
      if (selectorButton.disabled) return;
      const field = selectorButton.dataset.selectorField;
      const value = selectorButton.dataset.selectorValue || "";
      const next = { ...ensureManualSelectorState(state.decoded), [field]: value };
      const fieldIndex = selectorFieldOrder.indexOf(field);
      selectorFieldOrder.slice(fieldIndex + 1).forEach((key) => {
        next[key] = "";
      });
      state.manualSelector = next;
      state.buildStep = Math.min(fieldIndex + 1, selectorFieldOrder.length - 1);
      syncBuildStep(next);
      if (state.buildRendered) renderBuildConnector();
      return;
    }

    const buildStepButton = event.target.closest("[data-build-step]");
    if (buildStepButton) {
      const step = Number(buildStepButton.dataset.buildStep);
      if (Number.isFinite(step)) {
        state.buildStep = Math.min(step, maxBuildStep(ensureManualSelectorState(state.decoded)));
        if (state.buildRendered) renderBuildConnector();
      }
      return;
    }

    const selectorAction = event.target.closest("[data-selector-action]");
    if (selectorAction) {
      const action = selectorAction.dataset.selectorAction;
      if (action === "reset") {
        state.manualSelector = selectorSelectionFromDecoded(state.decoded);
        state.buildStep = currentBuildStepFromSelection(state.manualSelector);
        if (state.buildRendered) renderBuildConnector();
      } else if (action === "prev-step") {
        state.buildStep = Math.max(0, state.buildStep - 1);
        if (state.buildRendered) renderBuildConnector();
      } else if (action === "apply") {
        const context = manualSelectorContext(state.decoded);
        if (!context.exact) return;
        els.partNumberInput.value = context.exact.part_number;
        decodeFromInput();
        selectTab("decoder");
      }
      return;
    }

    const button = event.target.closest("[data-manual-field]");
    if (!button) return;
    state.activeManualField = button.dataset.manualField || "slash_sheet";
    renderPartNumberGuide(state.decoded);
    if (state.manualRendered) renderManual();
  }

  function onDecodedPanelClick(event) {
    const button = event.target.closest("[data-decoded-action]");
    if (!button || !state.decoded?.ok) return;
    const action = button.dataset.decodedAction;
    if (action === "mating") {
      selectTab("mating");
      return;
    }
    if (action === "build") {
      state.manualSelector = selectorSelectionFromDecoded(state.decoded);
      state.buildStep = currentBuildStepFromSelection(state.manualSelector);
      renderBuildConnector();
      selectTab("build");
      return;
    }
    if (action === "catalog") {
      els.slashSheetFilter.value = state.decoded.slash_sheet || "";
      els.arrangementFilter.value = state.decoded.arrangement_id || "";
      renderCatalog();
      selectTab("catalog");
    }
  }

  function selectTab(tabName) {
    state.activeTab = tabName;
    document.body.classList.toggle("is-home", tabName === "home");
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    const panel = $(`${tabName}Panel`);
    if (panel) panel.classList.add("active");
    if (tabName === "build" && !state.buildRendered) renderBuildConnector();
    if (tabName === "manual" && !state.manualRendered) renderManual();
    // When switching to catalog, re-render to reflect any selection change
    if (tabName === "catalog") renderCatalog();
    if (tabName === "mating") renderMatingPanel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function filteredArrangements() {
    const shell = els.shellFilter.value;
    const arrangementText = els.arrangementFilter.value.trim().toLowerCase();
    const count = els.countFilter.value;
    const size = els.sizeFilter.value;
    const type = els.typeFilter.value;
    const slashSheet = els.slashSheetFilter.value;
    const shellStyle = els.shellStyleFilter.value;
    const gender = els.genderFilter.value;
    const keying = els.keyingFilter.value;

    return arrangements.filter((arr) => {
      if (shell && arr.shell_size !== shell) return false;
      if (count && String(arr.contact_count) !== count) return false;
      if (size && !(arr.contact_size_notes || []).some((note) => note.size === size)) return false;
      if (type && !(arr.contacts || []).some((contact) => contact.type === type)) return false;
      if (slashSheet || shellStyle || gender || keying) {
        // Insert arrangements are independent from connector shell style,
        // contact gender, and polarization. These controls document the
        // connector-choice context while the card list remains arrangement-based.
      }
      if (arrangementText) {
        const hay = `${arr.id} ${arr.arrangement_number}`.toLowerCase();
        if (!hay.includes(arrangementText)) return false;
      }
      return true;
    });
  }

  function sortedCatalog(filtered) {
    const sort = state.catalogSort || "id";
    return filtered.slice().sort((a, b) => {
      if (sort === "contacts") return Number(a.contact_count) - Number(b.contact_count);
      if (sort === "shell") return Number(a.shell_size) - Number(b.shell_size);
      return naturalCompare(a.id, b.id);
    });
  }

  function renderCatalog() {
    const filtered = filteredArrangements();
    const sorted = sortedCatalog(filtered);

    // Update count badge
    if (els.catalogCount) {
      els.catalogCount.textContent = filtered.length === arrangements.length
        ? `${arrangements.length} arrangements`
        : `${filtered.length} of ${arrangements.length} arrangements`;
    }

    if (!els.catalogGrid) return;
    els.catalogGrid.innerHTML = "";

    if (!sorted.length) {
      // Use event delegation on the grid to avoid accumulating listeners on re-render
      els.catalogGrid.innerHTML = `<div class="catalog-empty">No arrangements match the current filters. <button type="button" class="clear-filters-inline-btn">Clear filters</button></div>`;
      return;
    }

    for (const arr of sorted) {
      const card = buildCatalogCard(arr);
      els.catalogGrid.appendChild(card);
    }
  }

  function buildCatalogCard(arr) {
    const isActive = state.selectedArrangement?.id === arr.id;
    const card = document.createElement("div");
    card.className = `catalog-card${isActive ? " active" : ""}`;

    const viewBox = connectorBaseViewBox(arr);
    const svgMarkup = miniSvgMarkup(arr);
    const sizePills = (arr.contact_size_notes || [])
      .map((note) => `<span class="size-pill size-pill-${cssToken(note.size)}">#${escapeHtml(note.size)}</span>`)
      .join("");

    card.innerHTML = `
      <div class="catalog-card-svg" title="Click to enlarge">
        <svg class="mini-connector-svg catalog-mini-svg" viewBox="${viewBox.join(" ")}" xmlns="http://www.w3.org/2000/svg" aria-label="Arrangement ${escapeHtml(arr.id)}">${svgMarkup}</svg>
      </div>
      <div class="catalog-card-body">
        <div class="catalog-card-id mono">${escapeHtml(arr.id)}</div>
        <div class="catalog-card-meta">
          <span>${arr.contact_count} contacts</span>
          <span>Shell ${escapeHtml(arr.shell_size)}</span>
        </div>
        <div class="catalog-size-pills">${sizePills}</div>
        <div class="catalog-card-footer">
          <span class="catalog-service">Svc ${escapeHtml(arr.service_rating || "?")}</span>
          <button type="button" class="catalog-open-btn">Decoder →</button>
        </div>
      </div>
    `;

    // Single unified click handler — no overlapping listeners
    card.addEventListener("click", (event) => {
      if (event.target.closest(".catalog-card-svg")) {
        // SVG thumbnail → open lightbox
        openLightbox(arr);
      } else if (event.target.closest(".catalog-open-btn")) {
        // "Open in Decoder" button → switch tab
        openInDecoder(arr);
      } else {
        // Card body → select / highlight only
        selectArrangement(arr, true);
        renderCatalog();
      }
    });

    return card;
  }

  function openInDecoder(arr) {
    selectArrangement(arr, true);
    selectTab("decoder");
  }

  // ---- Lightbox (click-to-enlarge from catalog) ----

  function openLightbox(arr) {
    closeLightbox();   // remove any existing one first

    const viewBox = connectorBaseViewBox(arr);
    const svgMarkup = miniSvgMarkup(arr);
    const sizePills = (arr.contact_size_notes || [])
      .map((note) => `<span class="size-pill size-pill-${cssToken(note.size)}">#${escapeHtml(note.size)}</span>`)
      .join("");

    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `Arrangement ${arr.id}`);

    overlay.innerHTML = `
      <div class="lightbox-card" role="document">
        <div class="lightbox-svg-pane">
          <svg class="mini-connector-svg lightbox-connector-svg"
               viewBox="${viewBox.join(" ")}"
               xmlns="http://www.w3.org/2000/svg"
               aria-label="Arrangement ${escapeHtml(arr.id)}">${svgMarkup}</svg>
        </div>
        <div class="lightbox-info-pane">
          <div class="lightbox-header">
            <div class="lightbox-id mono">${escapeHtml(arr.id)}</div>
            <button type="button" class="lightbox-close" aria-label="Close">✕</button>
          </div>
          <div class="lightbox-stat-grid">
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">Contacts</div>
              <div class="lightbox-stat-value">${arr.contact_count}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">Shell</div>
              <div class="lightbox-stat-value">${escapeHtml(arr.shell_size)}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">Service</div>
              <div class="lightbox-stat-value">${escapeHtml(arr.service_rating || "—")}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">Source p.</div>
              <div class="lightbox-stat-value">${arr.source_page || "—"}</div>
            </div>
          </div>
          <div class="lightbox-pills">${sizePills}</div>
          <div class="lightbox-actions">
            <button type="button" class="lightbox-primary-btn">Open in Decoder →</button>
          </div>
        </div>
      </div>
    `;

    // Close on overlay click (outside card) or close button
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest(".lightbox-close")) {
        closeLightbox();
      } else if (event.target.closest(".lightbox-primary-btn")) {
        closeLightbox();
        openInDecoder(arr);
      }
    });

    // Close on Escape key
    overlay._escHandler = (event) => { if (event.key === "Escape") closeLightbox(); };
    document.addEventListener("keydown", overlay._escHandler);

    document.body.appendChild(overlay);
    state.lightboxOpen = true;
  }

  function closeLightbox() {
    const existing = document.querySelector(".lightbox-overlay");
    if (existing) {
      if (existing._escHandler) document.removeEventListener("keydown", existing._escHandler);
      existing.remove();
    }
    state.lightboxOpen = false;
  }

  function sizeSummary(arr) {
    return (arr.contact_size_notes || []).map((note) => `${note.count}x #${note.size}`).join(", ") || "size unknown";
  }

  function selectArrangement(arrangement, resetViewport) {
    state.selectedArrangement = arrangement;
    state.selectedContactIndex = null;
    state.pinMatches.clear();
    if (resetViewport) {
      state.baseViewBox = connectorBaseViewBox(arrangement);
      state.viewBox = state.baseViewBox.slice();
    }
    renderViewer();
    renderSourceInfo();
    renderPinDetail();
    els.selectedStatus.textContent = `${arrangement.id} | ${arrangement.contact_count} contacts`;
    // Update active highlight in catalog grid without full re-render
    document.querySelectorAll(".catalog-card").forEach((card) => {
      const idEl = card.querySelector(".catalog-card-id");
      const isActive = idEl && idEl.textContent === arrangement.id;
      card.classList.toggle("active", isActive);
    });
  }

  function renderSourceInfo() {
    const arr = state.selectedArrangement;
    if (!arr) return;
    els.viewerTitle.textContent = `Insert Arrangement ${arr.id}`;
    const review = reviewById.get(arr.id);
    const warning = review?.issues?.length ? ` | review: ${review.issues.length} issue(s)` : "";
    const decodedNote = state.decoded?.ok && state.decoded.arrangement_id === arr.id
      ? ` | ${state.decoded.part_number} | keying ${state.decoded.polarization}`
      : "";
    els.sourceInfo.textContent = `${arr.source_pdf} p. ${arr.source_page}${warning}${decodedNote}`;
  }

  function resetView() {
    if (!state.selectedArrangement) return;
    state.baseViewBox = connectorBaseViewBox(state.selectedArrangement);
    state.viewBox = state.baseViewBox.slice();
    applyViewBox();
  }

  function applyViewBox() {
    if (!state.viewBox) return;
    els.connectorSvg.setAttribute("viewBox", state.viewBox.map((value) => Number(value).toFixed(3)).join(" "));
  }

  function connectorBaseViewBox(arrangement) {
    const outline = arrangement.outline;
    if (!outline) return [0, 0, arrangement.viewBox.width, arrangement.viewBox.height];
    const margin = Math.max(outline.radius * 0.2, 4);
    const size = outline.radius * 2 + margin * 2;
    return [outline.center_x - size / 2, outline.center_y - size / 2, size, size];
  }

  function renderViewer() {
    const arr = state.selectedArrangement;
    if (!arr) return;
    const svg = els.connectorSvg;
    svg.innerHTML = "";
    svg.setAttribute("class", "connector-svg");
    svg.setAttribute("viewBox", (state.viewBox || connectorBaseViewBox(arr)).join(" "));

    if (els.outlineToggle.checked && arr.outline) {
      const shell = svgEl("g", { class: "shell-layer" });
      shell.appendChild(
        svgEl("circle", {
          class: "shell-shadow-ring",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 1.08,
        })
      );
      shell.appendChild(
        svgEl("circle", {
          class: "shell-fill",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 1.04,
        })
      );
      shell.appendChild(
        svgEl("circle", {
          class: "shell",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius,
        })
      );
      shell.appendChild(
        svgEl("circle", {
          class: "insert-boundary",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 0.88,
        })
      );
      shell.appendChild(
        svgEl("circle", {
          class: "shell-face-ring",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 0.93,
        })
      );
      shell.appendChild(orientationMarker(arr));
      shell.appendChild(keyingDrawing(arr));
      svg.appendChild(shell);
    }

    if (els.outlineToggle.checked) {
      const guideLayer = svgEl("g", { class: "guide-layer" });
      (arr.guide_paths || []).forEach((path) => {
        guideLayer.appendChild(svgEl("path", { class: "guide-path", d: path.d }));
      });
      svg.appendChild(guideLayer);
    }

    const contacts = currentContacts();
    contacts.forEach((contact) => {
      const group = svgEl("g", { class: pinClass(contact), "data-key": contact._key });
      const radius = contactSymbolRadius(contact);
      group.appendChild(svgEl("circle", { class: "pin-hit-area", cx: contact.x, cy: contact.y, r: Math.max(radius + 2.2, 2.6) }));
      appendContactSymbol(group, contact, radius);
      if (state.selectedContactIndex === contact._index || state.pinMatches.has(contact._key)) {
        group.appendChild(svgEl("circle", { class: "pin-state-ring", cx: contact.x, cy: contact.y, r: radius + 1.15 }));
      }
      if (shouldRenderLabel(contact)) {
        group.appendChild(
          svgEl("text", {
            class: "pin-label",
            x: contact.x,
            y: contact.y,
            "font-size": labelFontSize(contact),
          }, contact.label || "")
        );
      }
      group.addEventListener("mouseenter", () => showPinTooltip(contact));
      group.addEventListener("mouseleave", hidePinTooltip);
      group.addEventListener("click", () => selectContact(contact._index, true));
      svg.appendChild(group);
    });
    renderHoverPinLabel(svg, arr);
  }

  function shouldRenderLabel(contact) {
    const labelMode = els.labelsToggle.value;
    if (labelMode === "all") return true;
    if (labelMode === "off") return false;
    if (labelMode === "smart") {
      if (state.selectedContactIndex === contact._index || state.pinMatches.has(contact._key)) return true;
      const count = state.selectedArrangement?.contact_count || currentContacts().length || 0;
      if (count <= 30) return true;
      if (count <= 60) return ["8", "10", "12"].includes(gaugeToken(contact));
      return false;
    }
    return state.selectedContactIndex === contact._index || state.pinMatches.has(contact._key);
  }

  function gaugeToken(contact) {
    const size = String(contact.size || "").toLowerCase();
    if (size.includes("22d")) return "22d";
    if (size.includes("20")) return "20";
    if (size.includes("16")) return "16";
    if (size.includes("12")) return "12";
    if (size.includes("10")) return "10";
    if (size.includes("8")) return "8";
    return "unknown";
  }

  function contactSymbolRadius(contact) {
    const base = pinRadius(contact);
    const scale = {
      "22d": 0.46,
      "20": 0.68,
      "16": 0.94,
      "12": 1.16,
      "10": 1.44,
      "8": 1.8,
      unknown: 0.85,
    }[gaugeToken(contact)] || 0.85;
    return Math.max(0.45, base * scale);
  }

  function appendContactSymbol(group, contact, radius) {
    const token = gaugeToken(contact);
    const attrs = { class: `pin-symbol gauge-${token}`, cx: contact.x, cy: contact.y, r: radius };
    if (token === "8") {
      group.appendChild(svgEl("circle", attrs));
      group.appendChild(svgEl("circle", { class: "pin-symbol-cutout", cx: contact.x, cy: contact.y, r: radius * 0.48 }));
    } else if (token === "10") {
      group.appendChild(svgEl("circle", { class: "pin-symbol gauge-10-ring", cx: contact.x, cy: contact.y, r: radius }));
      group.appendChild(svgEl("circle", { class: "pin-symbol gauge-10-core", cx: contact.x, cy: contact.y, r: radius * 0.68 }));
    } else if (token === "12") {
      group.appendChild(svgEl("circle", attrs));
      appendCross(group, contact.x, contact.y, radius, "plus");
    } else if (token === "16") {
      group.appendChild(svgEl("circle", attrs));
      appendCross(group, contact.x, contact.y, radius, "x");
    } else if (token === "20") {
      group.appendChild(svgEl("circle", attrs));
      group.appendChild(svgEl("path", { class: "pin-symbol gauge-20-half", d: halfCirclePath(contact.x, contact.y, radius) }));
      group.appendChild(svgEl("circle", { class: "pin-symbol gauge-20-outline", cx: contact.x, cy: contact.y, r: radius }));
    } else {
      group.appendChild(svgEl("circle", attrs));
    }
  }

  function appendCross(group, x, y, radius, mode) {
    const a = radius * 0.72;
    const lines = mode === "x"
      ? [[x - a, y - a, x + a, y + a], [x - a, y + a, x + a, y - a]]
      : [[x - a, y, x + a, y], [x, y - a, x, y + a]];
    lines.forEach(([x1, y1, x2, y2]) => {
      group.appendChild(svgEl("line", { class: "pin-symbol-mark", x1, y1, x2, y2 }));
    });
  }

  function halfCirclePath(x, y, r) {
    return `M ${x} ${y - r} A ${r} ${r} 0 0 0 ${x} ${y + r} Z`;
  }

  function lineMarkup(x1, y1, x2, y2) {
    return `<line class="pin-symbol-mark" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
  }

  function orientationMarker(arr) {
    const outline = arr.outline;
    const markerWidth = outline.radius * 0.18;
    const markerHeight = outline.radius * 0.11;
    const top = outline.center_y - outline.radius;
    return svgEl("path", {
      class: "orientation-marker keying-tooth",
      d: [
        `M ${outline.center_x - markerWidth / 2} ${top - markerHeight * 0.55}`,
        `L ${outline.center_x} ${top + markerHeight * 0.75}`,
        `L ${outline.center_x + markerWidth / 2} ${top - markerHeight * 0.55}`,
      ].join(" "),
    });
  }

  function keyingDrawing(arr, decodedOverride) {
    const group = svgEl("g", { class: "keying-drawing" });
    const decodedFromState = state.decoded?.ok && state.decoded.arrangement_id === arr.id ? state.decoded : null;
    const decoded = decodedOverride?.ok ? decodedOverride : decodedFromState;
    const pol = decoded?.polarization_definition;
    if (!decoded || !pol || !arr.outline) return group;

    const outline = arr.outline;
    const cx = outline.center_x;
    const cy = outline.center_y;
    const radius = outline.radius;
    const markerRadius = radius * 0.98;
    const markers = [
      ["A", pol.AR_or_AP_deg],
      ["B", pol.BR_or_BP_deg],
      ["C", pol.CR_or_CP_deg],
      ["D", pol.DR_or_DP_deg],
    ].filter(([, angle]) => Number.isFinite(Number(angle)));

    group.appendChild(svgEl("title", {}, `Series III keying ${decoded.polarization}: ${pol.description || "selected polarization"}`));
    group.appendChild(svgEl("circle", {
      class: "keying-reference-ring",
      cx,
      cy,
      r: markerRadius,
    }));

    markers.forEach(([label, angle]) => {
      const point = polarPoint(cx, cy, markerRadius, angle);
      const outer = polarPoint(cx, cy, radius * 1.035, angle);
      const inner = polarPoint(cx, cy, radius * 0.87, angle);
      group.appendChild(svgEl("line", {
        class: "keying-spoke",
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
      }));
      group.appendChild(svgEl("rect", {
        class: "minor-keyway",
        x: point.x - radius * 0.018,
        y: point.y - radius * 0.085,
        width: radius * 0.036,
        height: radius * 0.17,
        rx: radius * 0.012,
        transform: `rotate(${angle} ${point.x} ${point.y})`,
      }));
    });

    return group;
  }

  function polarPoint(cx, cy, radius, angleDeg) {
    const radians = Number(angleDeg) * Math.PI / 180;
    return {
      x: cx + Math.sin(radians) * radius,
      y: cy - Math.cos(radians) * radius,
    };
  }

  function pinClass(contact) {
    const token = gaugeToken(contact);
    const classes = ["pin", `gauge-${token}`, `size-${cssToken(contact.size)}`, `type-${cssToken(contact.type)}`];
    if (state.selectedContactIndex === contact._index) classes.push("selected");
    if (state.pinMatches.has(contact._key)) classes.push("search-match");
    if (contact.confidence !== "high" || contact.label === "?") classes.push("needs-review");
    if (state.activeGaugeFilter && token !== state.activeGaugeFilter) classes.push("filtered-out");
    return classes.join(" ");
  }

  function cssToken(value) {
    return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  }

  function pinRadius(contact) {
    if (Number(contact.r)) return Number(contact.r);
    return pinRadiusForArrangement(state.selectedArrangement);
  }

  function pinRadiusForArrangement(arrangement) {
    const outlineRadius = arrangement?.outline?.radius || 24;
    const n = arrangement?.contact_count || 1;
    let factor;
    if (n <= 5) factor = 0.058;
    else if (n <= 30) factor = 0.044;
    else if (n <= 80) factor = 0.034;
    else factor = 0.027;
    const radius = outlineRadius * factor;
    return Math.max(Math.max(0.55, outlineRadius * 0.02), Math.min(Math.min(2.8, outlineRadius * 0.085), radius));
  }

  function labelFontSize(contact) {
    const labelLength = String(contact.label || "").length;
    const radius = pinRadius(contact);
    const n = state.selectedArrangement?.contact_count || currentContacts().length || 1;
    const densityScale = n > 80 ? 1.05 : n > 30 ? 1.2 : 1.45;
    if (labelLength >= 3) return Math.max(0.85, radius * densityScale * 0.75);
    if (labelLength === 2) return Math.max(0.9, radius * densityScale * 0.9);
    return Math.max(0.95, radius * densityScale);
  }

  function svgEl(name, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes || {})) {
      if (key === "href") element.setAttributeNS("http://www.w3.org/1999/xlink", "href", value);
      element.setAttribute(key, value);
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showPinTooltip(contact) {
    state.hoveredContactIndex = contact._index;
    setMessage(els.searchMessage, `Pin ${contact.label} | #${contact.size} ${contact.type}`);
    renderViewer();
  }

  function hidePinTooltip() {
    state.hoveredContactIndex = null;
    setMessage(els.searchMessage, "");
    renderViewer();
  }

  function renderHoverPinLabel(svg, arr) {
    const contact = currentContacts()[state.hoveredContactIndex];
    if (!contact || !arr.outline) return;
    const text = contact.label && contact.label !== "?" ? contact.label : `Pin ${contact._index + 1}`;
    const detail = `#${contact.size || "?"}`;
    const radius = pinRadius(contact);
    const width = Math.max(text.length * radius * 1.2, radius * 7.2);
    const height = radius * 4.1;
    const viewBox = state.viewBox || connectorBaseViewBox(arr);
    const [viewX, viewY, viewWidth, viewHeight] = viewBox;
    const padding = Math.max(radius * 1.2, 1.8);
    let x = contact.x + radius * 2.3;
    let y = contact.y - height - radius * 1.2;
    let placeLeft = false;
    let placeBelow = false;
    if (x + width + padding > viewX + viewWidth) {
      x = contact.x - width - radius * 2.3;
      placeLeft = true;
    }
    if (y < viewY + padding) {
      y = contact.y + radius * 1.35;
      placeBelow = true;
    }
    x = Math.max(viewX + padding, Math.min(x, viewX + viewWidth - width - padding));
    y = Math.max(viewY + padding, Math.min(y, viewY + viewHeight - height - padding));
    const anchorX = placeLeft ? x + width : x;
    const anchorY = placeBelow ? y : y + height;
    const group = svgEl("g", { class: "hover-pin-label" });
    group.appendChild(svgEl("line", {
      class: "hover-pin-leader",
      x1: contact.x,
      y1: contact.y,
      x2: anchorX,
      y2: anchorY,
    }));
    group.appendChild(svgEl("rect", {
      class: "hover-pin-label-bg",
      x,
      y,
      width,
      height,
      rx: radius * 0.55,
    }));
    group.appendChild(svgEl("text", {
      class: "hover-pin-label-name",
      x: x + radius * 0.95,
      y: y + radius * 1.55,
      "font-size": radius * 1.55,
    }, text));
    group.appendChild(svgEl("text", {
      class: "hover-pin-label-detail",
      x: x + radius * 0.95,
      y: y + radius * 3.0,
      "font-size": radius * 0.95,
    }, detail));
    svg.appendChild(group);
  }

  function selectContact(index, center) {
    const contacts = currentContacts();
    const contact = contacts[index];
    if (!contact) return;
    state.selectedContactIndex = index;
    if (center) centerOnContact(contact);
    renderViewer();
    renderPinDetail();
  }

  function centerOnContact(contact) {
    if (!state.viewBox) return;
    const [, , width, height] = state.viewBox;
    state.viewBox = [contact.x - width / 2, contact.y - height / 2, width, height];
    applyViewBox();
  }

  function renderPinDetail() {
    const contacts = currentContacts();
    const contact = contacts[state.selectedContactIndex];
    if (!contact) {
      els.pinDetailHeader.textContent = "Select a pin";
      return;
    }
    const source = labelSource(contact);
    els.pinDetailHeader.innerHTML = `
      <div>Pin <strong>${escapeHtml(contact.label)}</strong></div>
      <div>Contact #${escapeHtml(contact.size)} | ${escapeHtml(contact.type)} | ${escapeHtml(contact.confidence)}</div>
      <div>Label source ${escapeHtml(source)}</div>
      ${contact.extracted_label ? `<div>Corrected extracted label ${escapeHtml(contact.extracted_label)}</div>` : ""}
    `;
  }

  function labelSource(contact) {
    if (contact.label_confidence === "standard_reference") return "MIL-STD-1560";
    if (contact.label_confidence === "high") return "catalog PDF";
    return contact.label_confidence || "unknown";
  }

  function searchPin() {
    state.pinMatches.clear();
    const query = els.pinSearchInput.value.trim();
    if (!query) {
      setMessage(els.searchMessage, "");
      renderViewer();
      return;
    }
    const contacts = currentContacts();
    const normalizedQuery = query.toLowerCase();
    let matchMode = "exact";
    let matches = contacts.filter((contact) => contact.label === query);
    if (!matches.length) {
      matchMode = "case-insensitive";
      matches = contacts.filter((contact) => String(contact.label || "").toLowerCase() === normalizedQuery);
    }
    if (!matches.length) {
      matchMode = "starts-with";
      matches = contacts.filter((contact) => String(contact.label || "").toLowerCase().startsWith(normalizedQuery));
    }
    if (!matches.length) {
      matchMode = "contains";
      matches = contacts.filter((contact) => String(contact.label || "").toLowerCase().includes(normalizedQuery));
    }
    matches.forEach((contact) => state.pinMatches.add(contact._key));
    if (matches.length) {
      selectContact(matches[0]._index, true);
      setMessage(els.searchMessage, `${matches.length} pin match(es) (${matchMode}).`);
    } else {
      setMessage(els.searchMessage, "Pin not found in this insert arrangement.", true);
      renderViewer();
    }
  }

  function decodeFromInput(options = {}) {
    const partNumber = normalizePartNumber(els.partNumberInput.value);
    state.currentPartNumber = partNumber;
    const decoded = decodePartNumber(partNumber);
    if (options.automatic && !decoded.ok && isIncompletePartNumber(partNumber)) {
      setMessage(els.decodeMessage, "Type shell type, class, shell size, insert, contacts, and keying.");
      return;
    }
    state.decoded = decoded;
    if (decoded.ok) {
      state.manualSelector = selectorSelectionFromDecoded(decoded);
      state.buildStep = currentBuildStepFromSelection(state.manualSelector);
    }
    renderDecoded(decoded);
    renderPartNumberGuide(decoded);
    if (state.buildRendered) renderBuildConnector();
    if (state.manualRendered) renderManual();
    if (state.activeTab === "mating") renderMatingPanel();
    if (!decoded.ok) {
      setMessage(els.decodeMessage, decoded.message, true);
      return;
    }
    if (!options.automatic && els.partNumberInput.value !== decoded.part_number) {
      els.partNumberInput.value = decoded.part_number;
    }
    const defaultNote = decoded.polarization_defaulted
      ? " Showing keying N by default; type A, B, C, D, or E after the contact letter to choose alternate keying."
      : "";
    const arr = arrangementById(decoded.arrangement_id);
    if (arr) {
      selectArrangement(arr, true);
      setMessage(els.decodeMessage, `Decoded ${decoded.part_number}.${defaultNote}`);
    } else {
      setMessage(els.decodeMessage, `Decoded ${decoded.part_number}, but insert arrangement "${decoded.arrangement_id}" was not found in the data.${defaultNote}`, "warn");
    }
  }

  function decodePartNumber(partNumber) {
    if (!partNumber) return { ok: false, message: "Enter a D38999 part number." };
    const prefix = /^D38999\/(\d{2})(.+)$/.exec(partNumber);
    if (!prefix) return { ok: false, message: "Only D38999 shell-type part numbers are supported by this decoder." };
    const slashSheet = `/${prefix[1]}`;
    const body = prefix[2];
    if (body.length < 4) return { ok: false, message: "Part number is too short for the series III/IV field order." };

    const classMap = defs.classes || {};
    const shellMap = defs.shell_size_codes_series_iii_iv || {};
    const contactMap = defs.contact_styles || {};
    const classCandidates = Object.keys(classMap)
      .flatMap((code) => [code, `${code}-`])
      .sort((a, b) => b.length - a.length);

    function parseClassShellInsert(core) {
      for (const classCandidate of classCandidates) {
        if (!core.startsWith(classCandidate)) continue;
        const remainder = core.slice(classCandidate.length);
        const shellCode = remainder.slice(0, 1);
        const insert = remainder.slice(1);
        if (!shellMap[shellCode] || !/^\d{1,3}$/.test(insert)) continue;
        return { classField: classCandidate, classCode: classCandidate.replace(/-$/, ""), shellCode, insert };
      }
      return null;
    }

    const slashDef = (defs.slash_sheets || {})[slashSheet] || dlaSlashSheetDefinition(slashSheet);
    const attempts = [];
    const addAttempt = (core, contactStyle, polarization, polarizationExplicit) => {
      const contactDef = contactMap[contactStyle];
      if (!contactDef) return;
      const parsed = parseClassShellInsert(core);
      if (!parsed) return;
      const shellSize = shellMap[parsed.shellCode].shell_size;
      const arrangementNumber = String(Number(parsed.insert));
      const arrangementId = `${shellSize}-${arrangementNumber}`;
      const polDef = polarizationDefinition(shellSize, polarization, slashDef);
      attempts.push({
        parsed,
        contactStyle,
        contactDef,
        polarization,
        polarizationExplicit,
        shellSize,
        arrangementNumber,
        arrangementId,
        polDef,
        score: (arrangementById(arrangementId) ? 10 : 0) + (polarizationExplicit ? 2 : 1) + (polDef ? 1 : 0)
      });
    };

    addAttempt(body.slice(0, -2), body.slice(-2, -1), body.slice(-1), true);
    addAttempt(body.slice(0, -1), body.slice(-1), "N", false);
    attempts.sort((a, b) => b.score - a.score);
    const best = attempts[0];
    if (!best) {
      return { ok: false, message: "Could not split class, shell-size code, and insert arrangement using source-defined codes." };
    }

    const parsed = best.parsed;
    const shellSize = best.shellSize;
    const arrangementNumber = best.arrangementNumber;
    const arrangementId = best.arrangementId;
    const contactStyle = best.contactStyle;
    const contactDef = best.contactDef;
    const polarization = best.polarization;
    const classDef = classMap[parsed.classCode] || null;
    const polDef = best.polDef;
    const normalizedPartNumber = best.polarizationExplicit ? partNumber : `${partNumber}N`;

    return {
      ok: true,
      part_number: normalizedPartNumber,
      entered_part_number: partNumber,
      polarization_defaulted: !best.polarizationExplicit,
      family: "D38999 / MIL-DTL-38999",
      slash_sheet: slashSheet,
      slash_sheet_definition: slashDef,
      class_field: parsed.classField,
      class_definition: classDef,
      shell_code: parsed.shellCode,
      shell_size: shellSize,
      shell_size_definition: shellMap[parsed.shellCode],
      insert_arrangement: arrangementNumber,
      arrangement_id: arrangementId,
      contact_style: contactStyle,
      contact_definition: contactDef,
      polarization,
      polarization_definition: polDef,
      arrangement_exists: Boolean(arrangementById(arrangementId)),
      source_pattern: (partRules.part_number_patterns || [])[0] || null,
    };
  }

  function polarizationDefinition(shellSize, letter, slashDef) {
    const series = slashDef?.series_inferred_from_source_text || "III";
    if (series !== "III") return null;
    return defs.polarization?.series_iii?.rotations_by_shell_size?.[shellSize]?.[letter] || null;
  }

  function selectorRuleFinishes(rule) {
    if (rule.finishes) return rule.finishes;
    if (Array.isArray(rule.supported_finishes)) {
      return Object.fromEntries(rule.supported_finishes.map((code) => [code, code]));
    }
    if (rule.format === "amphenol_prefix") {
      const out = {};
      Object.values(rule.styles || {}).forEach((style) => {
        Object.keys(style.prefix_by_finish || {}).forEach((code) => {
          out[code] = code;
        });
      });
      return out;
    }
    return {};
  }

  function createSelectorNode() {
    return {
      children: new Map(),
      descendantCount: 0,
      example: null,
      exact: null,
    };
  }

  function buildManualSelectorTree() {
    if (buildManualSelectorTree.cache) return buildManualSelectorTree.cache;

    const shellCodeDefs = defs.shell_size_codes_series_iii_iv || {};
    const allShellCodes = Object.keys(shellCodeDefs);
    const root = createSelectorNode();
    const fieldValues = Object.fromEntries(selectorFieldOrder.map((field) => [field, new Set()]));

    (converterData.rules || []).forEach((rule) => {
      const styles = rule.styles || {};
      const finishCodes = Object.keys(selectorRuleFinishes(rule));
      const contactCodes = rule.supported_contacts || [];
      const keyCodes = rule.supported_keys || ["N"];
      const allowedShellCodes = rule.allowed_shell_size_codes?.length ? rule.allowed_shell_size_codes : allShellCodes;

      Object.keys(styles).forEach((shellType) => {
        const slashSheet = `/${shellType}`;
        const slashDef = (defs.slash_sheets || {})[slashSheet] || dlaSlashSheetDefinition(slashSheet);
        arrangements.forEach((arr) => {
          if (!allowedShellCodes.includes(arr.shell_size_code)) return;

          finishCodes.forEach((classField) => {
            const classCode = classField.replace(/-$/, "");
            const classDef = defs.classes?.[classCode] || null;
            contactCodes.forEach((contactStyle) => {
              const contactDef = defs.contact_styles?.[contactStyle] || null;
              keyCodes.forEach((polarization) => {
                const shellSizeDef = shellCodeDefs[arr.shell_size_code] || null;
                const polDef = polarizationDefinition(arr.shell_size, polarization, slashDef);
                if ((slashDef?.series_inferred_from_source_text || "III") === "III" && !polDef) return;

                const candidate = {
                  ok: true,
                  part_number: `D38999/${shellType}${classField}${arr.shell_size_code}${arr.arrangement_number}${contactStyle}${polarization}`,
                  entered_part_number: `D38999/${shellType}${classField}${arr.shell_size_code}${arr.arrangement_number}${contactStyle}${polarization}`,
                  polarization_defaulted: false,
                  family: "D38999 / MIL-DTL-38999",
                  slash_sheet: slashSheet,
                  slash_sheet_definition: slashDef,
                  class_field: classField,
                  class_definition: classDef,
                  shell_code: arr.shell_size_code,
                  shell_size: arr.shell_size,
                  shell_size_definition: shellSizeDef,
                  insert_arrangement: arr.arrangement_number,
                  arrangement_id: arr.id,
                  contact_style: contactStyle,
                  contact_definition: contactDef,
                  polarization,
                  polarization_definition: polDef,
                  arrangement_exists: true,
                  source_pattern: (partRules.part_number_patterns || [])[0] || null,
                  manufacturers: new Set(),
                  productLines: new Set(),
                };

                const pathValues = selectorFieldOrder.map((field) => candidate[field]);
                pathValues.forEach((value, index) => fieldValues[selectorFieldOrder[index]].add(value));

                const visited = [root];
                let node = root;
                pathValues.forEach((value) => {
                  if (!node.children.has(value)) node.children.set(value, createSelectorNode());
                  node = node.children.get(value);
                  visited.push(node);
                });

                if (!node.exact) {
                  node.exact = candidate;
                  visited.forEach((visitedNode) => {
                    visitedNode.descendantCount += 1;
                    if (!visitedNode.example) visitedNode.example = candidate;
                  });
                }

                const exact = node.exact;
                exact.manufacturers.add(rule.manufacturer || "Unknown");
                exact.productLines.add(`${rule.manufacturer || "Unknown"} ${rule.product_line || ""}`.trim());
              });
            });
          });
        });
      });
    });

    buildManualSelectorTree.cache = {
      root,
      fieldValues: Object.fromEntries(
        Object.entries(fieldValues).map(([field, values]) => [field, sortSelectorValues(field, [...values])])
      ),
    };
    return buildManualSelectorTree.cache;
  }

  function sortSelectorValues(field, values) {
    return values.sort((a, b) => {
      if (field === "shell_code") {
        return Number(shellSizeForShellCode(a)) - Number(shellSizeForShellCode(b));
      }
      if (field === "insert_arrangement") return Number(a) - Number(b);
      return naturalCompare(a, b);
    });
  }

  function selectorOptionUniverse(field) {
    return buildManualSelectorTree().fieldValues[field] || [];
  }

  function shellSizeForShellCode(code) {
    return defs.shell_size_codes_series_iii_iv?.[code]?.shell_size || "";
  }

  function manualSelectorContext(decoded) {
    const tree = buildManualSelectorTree();
    const selection = ensureManualSelectorState(decoded);
    const parentNodes = {};
    let prefixNode = tree.root;
    let prefixBroken = false;

    selectorFieldOrder.forEach((field) => {
      parentNodes[field] = prefixBroken ? null : prefixNode;
      const selected = selection[field];
      if (!selected || prefixBroken) return;
      const next = prefixNode.children.get(selected) || null;
      if (!next) {
        prefixBroken = true;
        prefixNode = null;
        return;
      }
      prefixNode = next;
    });

    const currentNode = prefixBroken ? null : prefixNode;
    const exact = currentNode?.exact || null;
    const preview = exact || currentNode?.example || tree.root.example || activeDecodedOrExample(decoded);
    syncBuildStep(selection);
    return {
      tree,
      selection,
      parentNodes,
      currentNode,
      exact,
      preview,
      activeStep: Math.min(state.buildStep, exact ? selectorFieldOrder.length - 1 : maxBuildStep(selection)),
      matchCount: currentNode?.descendantCount || 0,
      totalCount: tree.root.descendantCount || 0,
    };
  }

  // ---- Mating / reciprocal connector panel ----

  function renderMatingPanel() {
    const panel = $("matingContent");
    if (!panel) return;
    const decoded = state.decoded;

    if (!decoded?.ok) {
      panel.innerHTML = `
        <div class="mating-prompt">
          <div class="mating-prompt-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none"><circle cx="14" cy="24" r="9" stroke="currentColor" stroke-width="2.5"/><circle cx="34" cy="24" r="9" stroke="currentColor" stroke-width="2.5"/><path stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M23 24h2"/></svg>
          </div>
          <h3>No connector decoded yet</h3>
          <p>Decode a D38999 part number in the Decoder tab first, then come back here to find its exact mating connector.</p>
          <button type="button" class="btn-primary mating-goto-decoder" data-home-target="decoder">Go to Decoder →</button>
        </div>
      `;
      panel.querySelector(".mating-goto-decoder")?.addEventListener("click", () => selectTab("decoder"));
      return;
    }

    const slashSheet = decoded.slash_sheet;
    const style = styleEntryForSlashSheet(slashSheet);
    const candidates = mateCandidatesForDecoded(decoded);

    if (!style) {
      panel.innerHTML = `
        <div class="mating-unsupported">
          <strong>Catalog-backed mating data not available for D38999${escapeHtml(slashSheet)}</strong>
          <p>This shell style is not in the catalog-grounded reciprocal dataset yet. The app should not generate a mate from string manipulation alone here.</p>
          ${matingSourceCard(decoded)}
        </div>
      `;
      return;
    }

    // Warnings
    const warnings = [];
    if (decoded.class_field === "N") warnings.push("Class N parts are manufacturer-specific enough that exact stock availability should be checked before treating them as verified.");
    if (style.notes) warnings.push(style.notes);
    if (style.participatesInReciprocalSearch === false) warnings.push(`D38999${slashSheet} is cataloged as an accessory or non-mating shell style and should not be returned as an electrical reciprocal.`);

    const warningsHtml = warnings.map((w) => `
      <div class="mating-warn">
        <svg class="mating-warn-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 7v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.55" fill="currentColor"/></svg>
        <span>${escapeHtml(w)}</span>
      </div>
    `).join("");

    if (!candidates.length || style.participatesInReciprocalSearch === false) {
      panel.innerHTML = `
        ${warningsHtml}
        ${matingSourceCard(decoded)}
        <div class="mating-hermetic-note">
          <strong>Manual catalog review required</strong>
          <p>No validated reciprocal candidates are loaded for this shell style. Use the cited slash sheet or manufacturer catalog instead of generating a mate mechanically.</p>
        </div>
      `;
      return;
    }

    // Determine which mating slash sheet is selected
    const validSheets = candidates.map((o) => o.mateSheet);
    if (!state.selectedMateSheet || !validSheets.includes(state.selectedMateSheet)) {
      state.selectedMateSheet = candidates[0].mateSheet;
    }
    const selectedOpt = candidates.find((o) => o.mateSheet === state.selectedMateSheet);

    const selectorHtml = candidates.length > 1 ? `
      <div class="mating-selector">
        ${candidates.map((opt) => `
          <button type="button" class="mating-sel-btn${opt.mateSheet === state.selectedMateSheet ? " active" : ""}" data-mate-sheet="${escapeHtml(opt.mateSheet)}">
            <span class="mating-sel-code">${escapeHtml(opt.mateSheet)}</span>
            <span class="mating-sel-desc">${escapeHtml(`${validationLabel(opt.status)} | ${(opt.confidence * 100).toFixed(0)}%`)}</span>
          </button>
        `).join("")}
      </div>
    ` : "";

    panel.innerHTML = `
      ${warningsHtml}
      ${selectorHtml}
      <div class="mating-pair">
        ${matingSourceCard(decoded)}
        <div class="mating-pair-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M14 7l5 5-5 5"/></svg>
        </div>
        ${matingSelectedCard(decoded, selectedOpt)}
      </div>
    `;

    panel.querySelectorAll("[data-mating-pn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.partNumberInput.value = btn.dataset.matingPn;
        decodeFromInput();
        selectTab("decoder");
      });
    });
    panel.querySelectorAll("[data-mate-sheet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedMateSheet = btn.dataset.mateSheet;
        renderMatingPanel();
      });
    });
  }

  function shellProfileHtml(slashSheet) {
    const profileType = SHELL_PROFILE_TYPE[slashSheet];
    const assetPath = SHELL_PROFILE_ASSET[profileType];
    if (assetPath) {
      const alt = `${styleEntryForSlashSheet(slashSheet)?.normalizedName || slashSheet} schematic`;
      return `<div class="shell-profile-frame shell-profile-asset-frame"><img class="shell-profile-asset" src="${escapeHtml(assetPath)}" alt="${escapeHtml(alt)}"></div>`;
    }
    const svg = SHELL_PROFILES[profileType];
    return svg ? `<div class="shell-profile-frame">${svg}</div>` : "";
  }

  function matingSourceCard(decoded) {
    const bodyText = decoded.slash_sheet_definition?.description || decoded.slash_sheet;
    const arr = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const svgHtml = arr?.outline ? `
      <div class="mating-source-svg">
        ${manualArrangementPreview(decoded, { showBoundary: true, showKeying: true })}
      </div>` : "";
    return `
      <div class="mating-source-card">
        <div class="mating-source-header">
          <span class="mating-source-label">Decoded Connector</span>
          <span class="mating-source-pn mono">${escapeHtml(decoded.part_number)}</span>
        </div>
        <div class="mating-source-body">
          ${svgHtml}
          ${shellProfileHtml(decoded.slash_sheet)}
          <div class="mating-source-chips">
            ${optionChip(decoded.slash_sheet, "shell type", bodyText)}
            ${optionChip(decoded.class_field, "class / finish", decoded.class_definition?.description || "")}
            ${optionChip(decoded.shell_code, "shell size", decoded.shell_size ? `size ${decoded.shell_size}` : "")}
            ${optionChip(decoded.insert_arrangement, "insert", decoded.arrangement_id || "")}
            ${optionChip(decoded.contact_style, "contacts", decoded.contact_definition?.description || "")}
            ${optionChip(decoded.polarization, "polarization", decoded.polarization_definition?.description || "")}
          </div>
        </div>
      </div>
    `;
  }

  function matingSelectedCard(decoded, opt) {
    const targetDecoded = opt.targetDecoded;
    const mateDecoded = {
      ok: true,
      arrangement_id: decoded.arrangement_id,
      polarization: decoded.polarization,
      polarization_definition: decoded.polarization_definition,
    };
    const arr = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const svgHtml = arr?.outline ? `
      <div class="mating-source-svg">
        ${manualArrangementPreview(mateDecoded, { showBoundary: true, showKeying: true })}
      </div>` : "";
    const shellHtml = shellProfileHtml(opt.mateSheet);
    const pnBlock = opt.candidatePartNumber
      ? `<div class="mating-pn mono">${escapeHtml(opt.candidatePartNumber)}</div>`
      : `<div class="mating-pn mating-pn-unknown">No catalog-backed candidate part number could be constructed.</div>`;
    const decodeBtn = opt.candidatePartNumber
      ? `<button type="button" class="mating-decode-btn" data-mating-pn="${escapeHtml(opt.candidatePartNumber)}">Open in Decoder →</button>`
      : "";
    const validationBadge = validationBadgeHtml(opt.status, `${validationLabel(opt.status)} | confidence ${(opt.confidence * 100).toFixed(0)}%`);
    return `
      <div class="mating-source-card">
        <div class="mating-source-header">
          <span class="mating-source-label">Mating Connector</span>
          <span class="mating-source-pn mono">${escapeHtml(opt.candidatePartNumber || `D38999${opt.mateSheet}`)}</span>
        </div>
        <div class="mating-source-body">
          ${svgHtml}
          ${shellHtml}
          <div class="mating-source-chips">
            ${optionChip(opt.mateSheet, "shell type", opt.targetStyle?.normalizedName || targetDecoded?.slash_sheet_definition?.description || "catalog-backed target shell")}
            ${optionChip(decoded.class_field, "class / finish", decoded.class_definition?.description || "")}
            ${optionChip(decoded.shell_code, "shell size", decoded.shell_size ? `size ${decoded.shell_size}` : "")}
            ${optionChip(decoded.insert_arrangement, "insert", decoded.arrangement_id || "")}
            ${optionChip(targetDecoded?.contact_style || "?", "contacts", targetDecoded?.contact_definition?.description || "opposite contact family")}
            ${optionChip(decoded.polarization, "polarization", decoded.polarization_definition?.description || "")}
          </div>
          ${pnBlock}
          ${validationBadge}
          <div class="detail-item"><div class="label">Matched fields</div><div class="value">${escapeHtml(opt.matchedFields.join(", "))}</div></div>
          <div class="detail-item"><div class="label">Opposite fields</div><div class="value">${escapeHtml(opt.oppositeFields.join(", ") || "none")}</div></div>
          ${opt.conflictingFields.length ? `<div class="detail-item"><div class="label">Conflicts</div><div class="value">${escapeHtml(opt.conflictingFields.join(", "))}</div></div>` : ""}
          ${opt.missingFields.length ? `<div class="detail-item"><div class="label">Missing data</div><div class="value">${escapeHtml(opt.missingFields.join(", "))}</div></div>` : ""}
          ${opt.warnings.length ? `<div class="detail-item"><div class="label">Warnings</div><div class="value">${escapeHtml(opt.warnings.join(" | "))}</div></div>` : ""}
          ${opt.sources.length ? `<div class="detail-item"><div class="label">Sources</div><div class="value">${escapeHtml(opt.sources.join(" | "))}</div></div>` : ""}
          <div class="mating-option-actions">${decodeBtn}</div>
        </div>
      </div>
    `;
  }

  function renderDecoded(decoded) {
    if (!decoded) {
      els.decodedPanel.innerHTML = `<div class="detail-item"><div class="value">No part number decoded.</div></div>`;
      return;
    }
    if (!decoded.ok) {
      els.decodedPanel.innerHTML = `<div class="detail-item"><div class="value">${escapeHtml(decoded.message)}</div></div>`;
      return;
    }
    els.decodedPanel.innerHTML = decodedSummaryCard(decoded);
  }

  function decodedSummaryCard(decoded) {
    const items = manualFieldItems(decoded);
    const validation = catalogValidationForDecoded(decoded);
    const arrangement = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const sources = items.map((item) => item.source).filter(Boolean);
    const uniqueSources = [...new Set(sources)];
    return `
      <div class="detail-item detail-summary">
        <div class="name">Decoded Parts</div>
        <div class="value mono">${escapeHtml(items.map((item) => item.token).join(""))}</div>
        ${validationBadgeHtml(validation.status, validationLabel(validation.status))}
        <div class="decoded-status-note">${escapeHtml((validation.reasons || []).join(" | ") || "Decoded from the current D38999 rules and extracted catalog data.")}</div>
        <div class="decoded-action-row">
          <button type="button" class="primary-action decoded-action-btn" data-decoded-action="mating">Find mate</button>
          <button type="button" class="decoded-action-btn" data-decoded-action="build">Build similar</button>
          <button type="button" class="decoded-action-btn" data-decoded-action="catalog">Browse family</button>
        </div>
        <div class="manual-stat-grid">
          ${items.map((item) => optionChip(item.token, item.label, item.summary, true)).join("")}
        </div>
        <div class="detail-item"><div class="label">Insert drawing</div><div class="value">${escapeHtml(arrangement ? `${decoded.arrangement_id} | ${arrangement.contact_count} contacts | ${sizeSummary(arrangement)}` : `${decoded.arrangement_id || "unknown"} | needs manual verification`)}</div></div>
        ${uniqueSources.length ? `<div class="summary-source-note">Sources: ${escapeHtml(uniqueSources.join(" | "))}</div>` : ""}
      </div>
    `;
  }

  function renderPartNumberGuide(decoded) {
    const pattern = (partRules.part_number_patterns || [])[0];
    if (!els.partNumberGuidePanel || !pattern) return;
    els.partNumberGuidePanel.innerHTML = interactivePnGuide(decoded, "compact");
  }

  function renderBuildConnector() {
    if (!els.buildContent) return;
    const selector = manualSelectorContext(state.decoded);
    const sections = [
      ["Build Connector", connectorSelector(selector)],
    ];
    els.buildContent.innerHTML = sections.map(([title, body]) => `
      <section class="manual-section build-section">
        <h3>${escapeHtml(title)}</h3>
        ${body}
      </section>
    `).join("");
    state.buildRendered = true;
  }

  function renderManual() {
    if (!els.manualContent) return;
    const preview = activeDecodedOrExample(state.decoded);
    const sections = [
      ["Interactive PN Decoder", interactivePnGuide(preview, "manual")],
      ["PN Parts And Options", manualPnPartSections(preview)],
      ["Source Coverage", manualCoverage()],
    ];
    els.manualContent.innerHTML = sections.map(([title, body]) => `
      <section class="manual-section">
        <h3>${escapeHtml(title)}</h3>
        ${body}
      </section>
    `).join("");
    state.manualRendered = true;
  }

  function activeDecodedOrExample(decoded) {
    if (decoded?.ok) return decoded;
    return decodePartNumber("D38999/26WE35PN");
  }

  function selectorFieldMeta(field, value, preview) {
    const arr = preview?.arrangement_id ? arrangementById(preview.arrangement_id) : null;
    if (field === "slash_sheet") {
      const slashDef = (defs.slash_sheets || {})[value] || dlaSlashSheetDefinition(value);
      return {
        code: `D38999${value}`,
        title: slashDef?.description || "shell type",
        detail: slashDef?.series_inferred_from_source_text ? `Series ${slashDef.series_inferred_from_source_text}` : "connector body style",
      };
    }
    if (field === "class_field") {
      return {
        code: value,
        title: defs.classes?.[value]?.description || "finish / material class",
        detail: defs.classes?.[value]?.confidence || "service class",
      };
    }
    if (field === "shell_code") {
      return {
        code: value,
        title: `shell size ${shellSizeForShellCode(value)}`,
        detail: "physical shell size code",
      };
    }
    if (field === "insert_arrangement") {
      const arrangementId = preview?.shell_size && value ? `${preview.shell_size}-${value}` : "";
      const optionArr = arrangementById(arrangementId) || arr;
      return {
        code: value,
        title: optionArr ? `${optionArr.id} | ${optionArr.contact_count} contacts` : "insert arrangement",
        detail: optionArr ? sizeSummary(optionArr) : "pin layout number",
      };
    }
    if (field === "contact_style") {
      return {
        code: value,
        title: defs.contact_styles?.[value]?.contact_gender || defs.contact_styles?.[value]?.description || "contact style",
        detail: summarizeText(defs.contact_styles?.[value]?.description || "", 72),
      };
    }
    return {
      code: value,
      title: defs.polarization?.series_iii?.rotations_by_shell_size?.[preview?.shell_size || ""]?.[value]?.description || `keying ${value}`,
      detail: preview?.slash_sheet_definition?.series_inferred_from_source_text === "III"
        ? "source-backed Series III polarization"
        : "manufacturer-supported keying option",
    };
  }

  function selectorOptionButton(field, value, context) {
    const active = String(context.selection[field] || "") === String(value);
    const optionNode = context.parentNodes[field]?.children.get(value) || null;
    const disabled = !optionNode;
    const preview = optionNode?.example || context.preview;
    const meta = selectorFieldMeta(field, value, preview);
    const optionCount = optionNode?.descendantCount || 0;
    return `
      <button
        type="button"
        class="option-chip selector-chip ${active ? "active" : ""}"
        data-selector-field="${escapeHtml(field)}"
        data-selector-value="${escapeHtml(value)}"
        ${disabled ? "disabled" : ""}
      >
        <strong class="mono">${escapeHtml(meta.code)}</strong>
        <span>${escapeHtml(meta.title || "")}</span>
        <em>${escapeHtml(disabled ? "not available with current selections" : `${optionCount} valid connector${optionCount === 1 ? "" : "s"} | ${meta.detail || ""}`)}</em>
      </button>
    `;
  }

  function connectorSelector(context) {
    const pnValue = context.exact?.part_number || "Choose shell type, finish, shell size, insert, contacts, and keying.";
    const summary = context.exact
      ? `${context.exact.manufacturers.size} manufacturer family${context.exact.manufacturers.size === 1 ? "" : "ies"} match this connector in the current rule set.`
      : context.matchCount === context.totalCount
        ? `${context.totalCount} valid D38999 connectors are available in the current rule set.`
        : `${context.matchCount} valid D38999 connector${context.matchCount === 1 ? "" : "s"} remain under the current selections.`;
    const fields = [
      ["slash_sheet", "1. Shell Type"],
      ["class_field", "2. Class / Finish"],
      ["shell_code", "3. Shell Code"],
      ["insert_arrangement", "4. Insert Arrangement"],
      ["contact_style", "5. Contact Style"],
      ["polarization", "6. Polarization"],
    ];
    const stepHelp = {
      slash_sheet: "Choose the connector body style first: plug, receptacle, hermetic body, or other shell family.",
      class_field: "Pick the material and finish that fit the environment and hardware family.",
      shell_code: "Choose the shell-size code. The app translates the letter into the physical shell size for you.",
      insert_arrangement: "Choose the insert layout that gives you the contact pattern and count you need.",
      contact_style: "Pick whether the connector ships with pins, sockets, or another contact option.",
      polarization: "Set the keying position that prevents wrong mating between similar connectors.",
    };
    const activeStep = context.activeStep;
    const activeField = fields[activeStep]?.[0] || fields[0][0];
    const activeTitle = fields[activeStep]?.[1] || fields[0][1];
    const activeValue = context.selection[activeField] || "";

    return `
      <div class="selector-shell">
        <div class="selector-hero">
          <div>
            <div class="pn-eyebrow">Assemble a real connector</div>
            <div class="selector-pn mono">${escapeHtml(pnValue)}</div>
            <p>${escapeHtml(summary)} ${context.exact ? `${context.exact.productLines.size} source-backed product line${context.exact.productLines.size === 1 ? "" : "s"} support this exact connector.` : ""}</p>
            <div class="selector-actions">
              <button type="button" class="selector-action secondary" data-selector-action="prev-step" ${activeStep === 0 ? "disabled" : ""}>Back</button>
              <button type="button" class="selector-action" data-selector-action="apply" ${context.exact ? "" : "disabled"}>Open in decoder</button>
              <button type="button" class="selector-action secondary" data-selector-action="reset">${state.decoded?.ok ? "Use decoded PN" : "Clear"}</button>
            </div>
          </div>
        </div>
        <div class="build-stepper">
          ${fields.map(([field, title], index) => {
            const status = index < activeStep
              ? "done"
              : index === activeStep
                ? "active"
                : context.selection[field]
                  ? "done"
                  : "pending";
            const label = context.selection[field] || "Not chosen";
            return `
              <button type="button" class="build-step-pill ${status}" data-build-step="${index}">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(label)}</span>
              </button>
            `;
          }).join("")}
        </div>
        <section class="build-step-card">
          <div class="build-step-card-head">
            <div class="build-step-kicker">Step ${activeStep + 1} of ${fields.length}</div>
            <strong>${escapeHtml(activeTitle)}</strong>
            <p>${escapeHtml(stepHelp[activeField] || "")}</p>
          </div>
          ${activeValue ? `<div class="manual-note build-current-choice">Current choice: <span class="mono">${escapeHtml(activeValue)}</span></div>` : ""}
          <div class="option-grid ${activeField === "insert_arrangement" ? "compact-options" : ""}">
            ${selectorOptionUniverse(activeField).map((value) => selectorOptionButton(activeField, value, context)).join("")}
          </div>
        </section>
        ${context.exact ? buildConnectorResult(context.exact) : ""}
        <div class="selector-grid build-summary-grid">
          ${fields.map(([field, title], index) => `
            <section class="selector-field build-summary-item ${index === activeStep ? "active" : ""}">
              <div class="selector-field-head">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(context.selection[field] || "Choose")}</span>
              </div>
            </section>
          `).join("")}
        </div>
      </div>
    `;
  }

  function buildConnectorResult(decoded) {
    const arrangement = decoded?.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const validation = catalogValidationForDecoded(decoded);
    return `
      <section class="build-result">
        <div class="build-result-head">
          <strong>Selected Connector</strong>
          <span class="mono">${escapeHtml(decoded.part_number || "")}</span>
        </div>
        <div class="build-result-body">
          <div class="selector-preview">
            ${manualArrangementPreview(decoded, { showBoundary: true, showKeying: true })}
            <div class="selector-preview-meta">
              <strong>${escapeHtml(decoded.arrangement_id || "")}</strong>
              <span>${escapeHtml(arrangement ? `${arrangement.contact_count} contacts | ${sizeSummary(arrangement)}` : "Arrangement preview")}</span>
            </div>
          </div>
          <div class="manual-stat-grid">
            ${optionChip(decoded.slash_sheet || "", "shell type", decoded.slash_sheet_definition?.description || "")}
            ${optionChip(decoded.class_field || "", "class / finish", decoded.class_definition?.description || "")}
            ${optionChip(decoded.shell_code || "", "shell size", decoded.shell_size ? `size ${decoded.shell_size}` : "")}
            ${optionChip(decoded.insert_arrangement || "", "insert arrangement", decoded.arrangement_id || "")}
            ${optionChip(decoded.contact_style || "", "contact style", decoded.contact_definition?.contact_gender || decoded.contact_definition?.description || "")}
            ${optionChip(decoded.polarization || "", "polarization", decoded.polarization_definition?.description || "")}
          </div>
          ${validationBadgeHtml(validation.status, validationLabel(validation.status))}
          <div class="detail-item"><div class="label">Catalog grounding</div><div class="value">${escapeHtml((validation.reasons || []).join(" | ") || "No validation detail available.")}</div></div>
          ${validation.sources?.length ? `<div class="detail-item"><div class="label">Sources</div><div class="value">${escapeHtml(validation.sources.join(" | "))}</div></div>` : ""}
        </div>
      </section>
    `;
  }

  function manualFieldItems(decoded) {
    const active = activeDecodedOrExample(decoded);
    const arr = active.ok ? arrangementById(active.arrangement_id) : null;
    const slashMeaning = active.ok
      ? active.slash_sheet_definition?.description || "Connector shell type from the DLA source data."
      : "Connector shell type from the DLA source data.";
    const classMeaning = active.ok
      ? active.class_definition?.description || "Material and finish class."
      : "Material and finish class.";
    const contactMeaning = active.ok
      ? active.contact_definition?.description || "Contact supply option."
      : "Contact supply option.";
    const keyingMeaning = active.ok
      ? active.polarization_definition?.description || "Key/keyway position used to prevent mismating."
      : "Key/keyway position used to prevent mismating.";
    return [
      {
        key: "family",
        token: "D38999",
        label: "Family",
        icon: "MIL",
        summary: "MIL-DTL-38999 circular connector family.",
        use: "Start here. If the PN does not begin with D38999, use the converter or manufacturer cross-reference first.",
        source: active.ok ? sourceRef(active.source_pattern?.fields?.[0]) : ""
      },
      {
        key: "slash_sheet",
        token: active.ok ? active.slash_sheet : "/26",
        label: "Shell type",
        icon: "BODY",
        summary: slashMeaning,
        use: "This is not the shell size. It chooses the body style: plug, wall-mount receptacle, jam-nut receptacle, hermetic body, or Series IV shell type. It answers: what connector body am I ordering?",
        source: active.ok ? sourceRef(active.slash_sheet_definition || active.source_pattern?.fields?.[1]) : ""
      },
      {
        key: "class",
        token: active.ok ? active.class_field : "W",
        label: "Class / finish",
        icon: "FINISH",
        summary: classMeaning,
        use: "This describes material and plating/finish. Use it to match the environment: corrosion resistance, conductivity, composite body, stainless, hermetic, or finish restrictions.",
        source: active.ok ? sourceRef(active.class_definition) : ""
      },
      {
        key: "shell_size",
        token: active.ok ? active.shell_code : "E",
        label: "Shell code",
        icon: "SIZE",
        summary: active.ok ? `Code ${active.shell_code} maps to physical shell size ${active.shell_size}.` : "The letter maps to a numeric physical shell size.",
        use: "This is the shell size field. In this PN format it is a letter, not the shell type. Combine the numeric shell size with the insert number to find the exact pinout drawing.",
        source: active.ok ? sourceRef(active.shell_size_definition) : ""
      },
      {
        key: "insert_arrangement",
        token: active.ok ? active.insert_arrangement : "35",
        label: "Insert",
        icon: "PINS",
        summary: active.ok ? `Shell size ${active.shell_size} plus insert ${active.insert_arrangement} gives arrangement ${active.arrangement_id}.` : "The insert number selects the pin layout inside the shell.",
        use: arr
          ? `The selected insert has ${arr.contact_count} contacts: ${sizeSummary(arr)}. This is the pin map you wire against.`
          : "If the arrangement is not extracted, verify the drawing in the source standard before wiring.",
        source: active.ok ? sourceRef(active.source_pattern?.fields?.[4]) : ""
      },
      {
        key: "contact_style",
        token: active.ok ? active.contact_style : "P",
        label: "Contacts",
        icon: "PIN",
        summary: contactMeaning,
        use: "This tells whether the connector is supplied with pins, sockets, no contacts, or a special contact termination option. The mating connector normally uses the opposite contact gender.",
        source: active.ok ? sourceRef(active.contact_definition) : ""
      },
      {
        key: "polarization",
        token: active.ok ? active.polarization : "N",
        label: "Keying",
        icon: "KEY",
        summary: keyingMeaning,
        use: "This is the angular key position. Use the same polarization only when connectors are meant to mate; use alternate keying to prevent wrong mating.",
        source: active.ok ? sourceRef(active.polarization_definition || active.source_pattern?.fields?.[6]) : ""
      }
    ];
  }

  function interactivePnGuide(decoded, mode) {
    const items = manualFieldItems(decoded);
    const active = items.find((item) => item.key === state.activeManualField) || items[1] || items[0];
    const pnText = items.map((item) => item.token).join("");
    const tokenButtons = items.map((item, index) => `
      <button class="pn-token-button ${item.key === active.key ? "active" : ""}" type="button" data-manual-field="${escapeHtml(item.key)}" style="--step:${index}">
        <span class="pn-token-value">${escapeHtml(item.token)}</span>
        <span class="pn-token-label">${escapeHtml(item.label)}</span>
      </button>
    `).join("");
    const miniCards = items.map((item, index) => `
      <button class="pn-mini-card ${item.key === active.key ? "active" : ""}" type="button" data-manual-field="${escapeHtml(item.key)}" style="--step:${index}">
        <b>${escapeHtml(item.icon)}</b>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `).join("");
    const compactClass = mode === "compact" ? " compact" : "";
    return `
      <div class="pn-guide${compactClass}">
        <div class="pn-hero">
          <div>
            <div class="pn-eyebrow">Click any part of the PN</div>
            <div class="pn-big mono">${escapeHtml(pnText)}</div>
            <p>Read left to right. Each colored block answers one connector-selection question.</p>
          </div>
          <div class="pn-orbit" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="pn-token-rail">${tokenButtons}</div>
        <div class="pn-explain-card">
          <div class="pn-icon">${escapeHtml(active.icon)}</div>
          <div>
            <div class="pn-explain-kicker">${escapeHtml(active.label)}</div>
            <h4>${escapeHtml(active.token)} means ${escapeHtml(active.summary)}</h4>
            <p>${escapeHtml(active.use)}</p>
            <em>${escapeHtml(active.source || "Source: generated beginner guide from parsed MIL-DTL-38999 data.")}</em>
          </div>
        </div>
        <div class="pn-mini-flow">${miniCards}</div>
      </div>
    `;
  }

  function connectorDecisionGraphic(decoded) {
    const active = activeDecodedOrExample(decoded);
    const arr = active.ok ? arrangementById(active.arrangement_id) : null;
    const body = active.ok ? active.slash_sheet_definition?.description || "connector shell type" : "connector shell type";
    const shell = active.ok ? `shell size ${active.shell_size}` : "numeric shell size";
    const insert = active.ok ? `${active.arrangement_id}` : "shell-insert arrangement";
    const contacts = arr ? `${arr.contact_count} contacts` : "contact count from insert drawing";
    const steps = [
      ["1", "Body", body, "The shell type tells what mechanical connector body to buy."],
      ["2", "Finish", active.ok ? active.class_field : "class", "The class tells material and finish for the operating environment."],
      ["3", "Shell", shell, "The shell-size code becomes the physical circular shell size."],
      ["4", "Insert", insert, `The insert defines the pin map and ${contacts}.`],
      ["5", "Mate", active.ok ? `${active.contact_style} / ${active.polarization}` : "contacts / keying", "Contact gender and keying determine what it can mate with."]
    ];
    return `
      <div class="decision-graphic">
        ${steps.map(([num, title, value, text], index) => `
          <div class="decision-step" style="--step:${index}">
            <div class="decision-num">${escapeHtml(num)}</div>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(value)}</span>
            <p>${escapeHtml(text)}</p>
          </div>
        `).join("")}
      </div>
      <div class="manual-note">Beginner rule: the PN is not just an ID. It is an ordered recipe for the connector body, finish, shell size, insert, contacts, and keying.</div>
      <div class="manual-note">Common confusion: <span class="mono">/26</span> is the shell type/body style. The shell size is the later letter, for example <span class="mono">E</span> equals shell size <span class="mono">17</span>.</div>
    `;
  }

  function manualPnPartSections(decoded) {
    const active = activeDecodedOrExample(decoded);
    const items = manualFieldItems(decoded);
    const fieldByKey = new Map(items.map((item) => [item.key, item]));
    const sections = [
      {
        key: "slash_sheet",
        title: "Shell Type",
        subtitle: "What body style is this connector?",
        body: shellTypeOptions(active),
        open: true
      },
      {
        key: "class",
        title: "Class / Finish",
        subtitle: "What material, plating, or environmental finish?",
        body: classOptions(active)
      },
      {
        key: "shell_size",
        title: "Shell Code",
        subtitle: "What physical shell size?",
        body: shellCodeOptions(active)
      },
      {
        key: "insert_arrangement",
        title: "Insert Arrangement",
        subtitle: "What pin layout goes inside the shell?",
        body: insertOptions(active)
      },
      {
        key: "contact_style",
        title: "Contact Styles",
        subtitle: "Pins, sockets, less contacts, or special terminations.",
        body: contactStyleOptions(active)
      },
      {
        key: "polarization",
        title: "Keying / Polarization",
        subtitle: "Which key position prevents wrong mating?",
        body: keyingOptions(active)
      }
    ];
    return `
      <div class="manual-accordion">
        ${sections.map((section, index) => {
          const item = fieldByKey.get(section.key);
          return `
            <details class="manual-part" ${section.open ? "open" : ""} style="--step:${index}">
              <summary>
                <span class="manual-part-icon">${escapeHtml(item?.icon || "")}</span>
                <span>
                  <strong>${escapeHtml(section.title)}</strong>
                  <em>${escapeHtml(section.subtitle)}</em>
                </span>
                <b class="mono">${escapeHtml(item?.token || "")}</b>
              </summary>
              <div class="manual-part-body">
                <div class="manual-part-explain">
                  <strong>${escapeHtml(item?.summary || "")}</strong>
                  <p>${escapeHtml(item?.use || "")}</p>
                </div>
                ${section.body}
              </div>
            </details>
          `;
        }).join("")}
      </div>
    `;
  }

  function optionChip(code, title, text, active = false) {
    return `
      <div class="option-chip ${active ? "active" : ""}">
        <strong class="mono">${escapeHtml(code)}</strong>
        <span>${escapeHtml(title || "")}</span>
        ${text ? `<em>${escapeHtml(text)}</em>` : ""}
      </div>
    `;
  }

  function shellTypeOptions(active) {
    const docs = (dlaDocs.documents || [])
      .filter((item) =>
        item.family === "slash_sheet" &&
        !item.is_initial_draft &&
        (item.series === "III" || item.series === "IV" || item.series === "III/IV")
      )
      .sort((a, b) => naturalCompare(a.slash_sheet || "", b.slash_sheet || ""));
    const chips = docs.map((doc) => {
      const title = [doc.component, doc.mount].filter(Boolean).join(", ") || doc.description;
      const text = [doc.series ? `Series ${doc.series}` : "", doc.coupling ? `${doc.coupling} coupling` : "", doc.contacts].filter(Boolean).join(" | ");
      return optionChip(doc.slash_sheet || "", title, text, active.ok && active.slash_sheet === doc.slash_sheet);
    }).join("");
    return `
      <div class="field-graphic shell-type-graphic" aria-hidden="true">
        <span class="shell-ring"></span>
        <span class="shell-plug"></span>
        <span class="shell-label">/26</span>
      </div>
      <div class="option-grid compact-options">${chips}</div>
    `;
  }

  function classOptions(active) {
    const chips = Object.entries(defs.classes || {})
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([code, value]) => optionChip(code, summarizeText(value.description, 88), value.confidence || "", active.ok && active.class_field === code))
      .join("");
    return `
      <div class="field-graphic finish-graphic" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="option-grid">${chips}</div>
    `;
  }

  function shellCodeOptions(active) {
    const chips = Object.entries(defs.shell_size_codes_series_iii_iv || {})
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([code, value]) => optionChip(code, `shell size ${value.shell_size}`, "physical connector size", active.ok && active.shell_code === code))
      .join("");
    return `
      <div class="shell-scale" aria-hidden="true">
        ${Object.entries(defs.shell_size_codes_series_iii_iv || {}).map(([code, value]) => `
          <span class="${active.ok && active.shell_code === code ? "active" : ""}" style="--size:${Number(value.shell_size) || 9}">${escapeHtml(code)}</span>
        `).join("")}
      </div>
      <div class="option-grid shell-options">${chips}</div>
    `;
  }

  function svgOuterMarkup(node) {
    return node?.outerHTML || "";
  }

  function manualArrangementPreview(active, options = {}) {
    const fallbackId = active?.arrangement_id || "17-35";
    const arr = arrangementById(fallbackId) || arrangements[0] || null;
    if (!arr?.outline) return "";

    const outline = arr.outline;
    const previewClasses = ["connector-svg", "mini-connector-svg", "manual-preview-svg"];
    if (options.showKeying) previewClasses.push("manual-keying-svg");

    return `
      <div class="field-graphic manual-svg-frame" aria-hidden="true">
        <svg class="${previewClasses.join(" ")}" viewBox="${connectorBaseViewBox(arr).join(" ")}">
          ${miniSvgMarkup(arr)}
          ${options.showBoundary ? `<circle class="insert-boundary" cx="${outline.center_x}" cy="${outline.center_y}" r="${outline.radius * 0.88}"></circle>` : ""}
          ${svgOuterMarkup(orientationMarker(arr))}
          ${options.showKeying ? svgOuterMarkup(keyingDrawing(arr, active)) : ""}
        </svg>
      </div>
    `;
  }

  function insertOptions(active) {
    const arr = active.ok ? arrangementById(active.arrangement_id) : null;
    const shellCount = active.ok
      ? arrangements.filter((item) => item.shell_size === active.shell_size).length
      : arrangements.length;
    return `
      ${manualArrangementPreview(active, { showBoundary: true })}
      <div class="manual-stat-grid">
        ${optionChip(active.ok ? active.arrangement_id : "17-35", "selected pinout", arr ? `${arr.contact_count} contacts | ${sizeSummary(arr)}` : "type a PN to resolve")}
        ${optionChip(active.ok ? active.shell_size : "shell", "numeric shell size", `${shellCount} extracted arrangement(s) in this shell`)}
        ${optionChip(active.ok ? active.insert_arrangement : "insert", "insert number", "combines with shell size to choose the drawing")}
      </div>
    `;
  }

  function contactStyleOptions(active) {
    const chips = Object.entries(defs.contact_styles || {})
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([code, value]) => optionChip(code, value.contact_gender || "contact option", summarizeText(value.description, 80), active.ok && active.contact_style === code))
      .join("");
    return `
      <div class="field-graphic contact-graphic" aria-hidden="true">
        <span class="pin-contact"></span>
        <span class="socket-contact"></span>
      </div>
      <div class="option-grid">${chips}</div>
    `;
  }

  function keyingOptions(active) {
    const rotations = active.ok
      ? defs.polarization?.series_iii?.rotations_by_shell_size?.[active.shell_size] || {}
      : defs.polarization?.series_iii?.rotations_by_shell_size?.["17"] || {};
    const chips = Object.entries(rotations)
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([code, value]) => optionChip(code, value.description || "keying option", "changes shell key teeth, not pin layout", active.ok && active.polarization === code))
      .join("");
    return `
      ${manualArrangementPreview(active, { showBoundary: true, showKeying: true })}
      <div class="option-grid keying-options">${chips}</div>
    `;
  }

  function summarizeText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function manualCoverage() {
    return `
      <div class="manual-note">Strong coverage: Series III/IV part-number field order, shell-size codes, contact styles, class/finish text, and Series III polarization table.</div>
      <div class="manual-note">The manual is meant to answer three practical questions: what shell style the connector uses, what physical shell size it is, and what insert/pin arrangement will be inside that shell.</div>
      <div class="manual-note">DLA document pass: ${escapeHtml(dlaDocs.downloaded_count || 0)} official PDFs parsed from the MIL-DTL-38999 list, including approved shell-type source documents and initial drafts.</div>
      <div class="manual-note">Limited coverage: Series IV polarization is still not tabulated in this data set.</div>
    `;
  }

  function partNumberFieldCards() {
    const pattern = (partRules.part_number_patterns || [])[0] || {};
    const example = pattern.example || defs.part_number_examples?.series_iii_iv?.example || "D38999/26WE35PN";
    const fieldHelp = {
      family: "Connector family. D38999 identifies a MIL-DTL-38999 circular connector, not a manufacturer-specific commercial series.",
      slash_sheet: "Shell type. This is the /20, /24, /26, /46, etc. field. It tells the connector body type; it is not the physical shell size.",
      class: "Material and finish class. This is the plating/material/environmental finish code, for example cadmium, nickel, stainless, composite, or hermetic classes depending on the shell type.",
      shell_size_code: "Physical shell size code. Series III/IV use letters A, B, C, D, E, F, G, H, and J, which map to numeric shell sizes 9 through 25.",
      insert_arrangement: "Insert layout number. Combine the numeric shell size with this number to identify the actual pin arrangement, for example shell code E plus insert 35 becomes arrangement 17-35.",
      contact_style: "Contact option. This tells whether the connector is supplied with pin contacts, socket contacts, less contacts, PC-tail contacts, eyelet contacts, or high-cycle contacts.",
      polarization: "Keying position. This prevents mismating between connectors with the same shell and insert by rotating the key/keyway position."
    };
    const fields = (pattern.fields || []).map((field) => `
      <div class="manual-card">
        <strong>${escapeHtml(field.name)}</strong>
        <span>${escapeHtml(fieldHelp[field.name] || field.description || "")}</span>
        <em>${escapeHtml(sourceRef(field))}</em>
      </div>
    `).join("");
    const steps = (partRules.decode_algorithm || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    return `
      <div class="manual-note">Example: <span class="mono">${escapeHtml(example)}</span></div>
      <div class="manual-note">Read the PN from left to right: family, shell type, class, shell-size letter, insert arrangement, contact style, then keying.</div>
      ${fields}
      <ol class="manual-steps">${steps}</ol>
    `;
  }

  function partNumberExampleBreakdown() {
    const example = "D38999/26WE35PN";
    const decoded = decodePartNumber(example);
    if (!decoded.ok) {
      return `<div class="manual-note">Example: <span class="mono">${escapeHtml(example)}</span></div>`;
    }
    const arr = arrangementById(decoded.arrangement_id);
    const rows = [
      ["D38999", "Family", "MIL-DTL-38999 circular connector family."],
      ["/26", "Shell type", decoded.slash_sheet_definition?.description || "Connector shell type."],
      ["W", "Class / finish", decoded.class_definition?.description || "Material and finish class."],
      ["E", "Shell size", `Shell-size code E maps to numeric shell size ${decoded.shell_size}.`],
      ["35", "Insert arrangement", `Insert 35 in shell size ${decoded.shell_size} selects arrangement ${decoded.arrangement_id}.`],
      ["P", "Contact style", decoded.contact_definition?.description || "Pin contact option."],
      ["N", "Polarization", decoded.polarization_definition?.description || "Normal keying position."]
    ];
    const renderedRows = rows.map(([token, name, meaning]) => `
      <tr>
        <td class="mono">${escapeHtml(token)}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(meaning)}</td>
      </tr>
    `).join("");
    const arrangementSummary = arr
      ? `${arr.contact_count} contacts, ${sizeSummary(arr)}, service rating ${arr.service_rating || "unknown"}.`
      : "Arrangement drawing not extracted.";
    return `
      <div class="manual-note">Example PN: <span class="mono">${escapeHtml(example)}</span></div>
      <div class="manual-table-wrap"><table class="manual-table"><tbody>${renderedRows}</tbody></table></div>
      <div class="manual-note">Connector selected by the PN: ${escapeHtml(decoded.arrangement_id)} - ${escapeHtml(arrangementSummary)}</div>
    `;
  }

  function shellAndPinArrangementHelp() {
    const shellRows = Object.entries(defs.shell_size_codes_series_iii_iv || {})
      .map(([code, value]) => `<tr><td class="mono">${escapeHtml(code)}</td><td>${escapeHtml(value.shell_size)}</td><td>Use this numeric shell size with the insert number to select the pinout.</td></tr>`)
      .join("");
    return `
      <div class="manual-note">The shell-size letter is the physical connector shell. Larger numeric shell sizes generally allow larger or denser inserts.</div>
      <div class="manual-note">The insert arrangement is the pin layout inside the shell. The toolbox names each layout as numeric-shell-size plus insert number, such as <span class="mono">17-35</span> or <span class="mono">25-35</span>.</div>
      <div class="manual-note">The pin table and drawing show the contact labels, contact size, and any separation lines needed to understand the layout zones.</div>
      <div class="manual-table-wrap"><table class="manual-table"><tbody>${shellRows}</tbody></table></div>
    `;
  }

  function dlaSlashSheetDefinition(slashSheet) {
    const doc = (dlaDocs.documents || []).find((item) =>
      item.slash_sheet === slashSheet &&
      !item.is_initial_draft &&
      (item.series === "III" || item.series === "IV" || item.series === "III/IV")
    );
    if (!doc) return null;
    const style = [doc.series ? `Series ${doc.series}` : "", doc.coupling, doc.mount || doc.component, doc.contacts]
      .filter(Boolean)
      .join(", ");
    return {
      description: style || doc.description,
      series_inferred_from_source_text: doc.series,
      shell_style: doc.component,
      confidence: "high",
      source_pdf: doc.file,
      source_page: 1,
      section: doc.title
    };
  }

  function dlaSlashSheetSummary() {
    const docs = (dlaDocs.documents || [])
      .filter((item) =>
        item.family === "slash_sheet" &&
        !item.is_initial_draft &&
        (item.series === "III" || item.series === "IV" || item.series === "III/IV")
      )
      .sort((a, b) => naturalCompare(a.slash_sheet || "", b.slash_sheet || ""));
    const drafts = (dlaDocs.documents || []).filter((item) =>
      item.family === "slash_sheet" &&
      item.is_initial_draft &&
      (item.series === "III" || item.series === "IV" || item.series === "III/IV")
    );
    const rows = docs.map((doc) => {
      const meaning = [doc.component, doc.mount, doc.coupling ? `${doc.coupling} coupling` : "", doc.contacts]
        .filter(Boolean)
        .join("; ");
      return `
        <tr>
          <td class="mono">${escapeHtml(doc.slash_sheet)}</td>
          <td>${escapeHtml(doc.series || "")}</td>
          <td>${escapeHtml(meaning || doc.description)}</td>
          <td>${escapeHtml(doc.file)}</td>
        </tr>
      `;
    }).join("");
    return `
      <div class="manual-note">Use the two digits immediately after <span class="mono">D38999/</span> to identify the shell type/body style before reading the class, shell size, insert, contacts, and keying.</div>
      <div class="manual-note">Example: <span class="mono">D38999/26</span> is a Series III plug shell type. It is not shell size 26.</div>
      <div class="manual-note">Approved Series III/IV shell-type documents parsed: ${docs.length}. Initial draft updates found: ${drafts.length}; drafts are tracked but not used as the primary decode meaning.</div>
      <div class="manual-table-wrap"><table class="manual-table"><tbody>${rows}</tbody></table></div>
    `;
  }

  function polarizationSummary() {
    const seriesIII = defs.polarization?.series_iii;
    const shellSizes = Object.keys(seriesIII?.rotations_by_shell_size || {}).sort((a, b) => Number(a) - Number(b));
    return `
      <div class="manual-note">${escapeHtml(seriesIII?.description || "Series III polarization table is available from the supplied standard data.")}</div>
      <div class="manual-note">The connector drawing overlays the selected Series III keying angles from Figure 6. The contact insert stays in the same position; the key/keyway markers move for N, A, B, C, D, or E.</div>
      <div class="manual-note">Shell sizes covered: <span class="mono">${escapeHtml(shellSizes.join(", ") || "none")}</span></div>
      <div class="manual-note">${escapeHtml(defs.polarization?.series_iv?.description || "Series IV polarization is not tabulated in this data set.")}</div>
    `;
  }

  function manualWarnings() {
    const warnings = [...(standard.warnings || []), ...(partRules.known_limitations || [])];
    return unique(warnings).map((warning) => `<div class="manual-note">${escapeHtml(warning)}</div>`).join("");
  }

  function definitionCards(items) {
    return Object.entries(items || {}).map(([key, value]) => `
      <div class="manual-card">
        <strong>${escapeHtml(key)}</strong>
        <span>${escapeHtml(value.description || "")}</span>
        <em>${escapeHtml(sourceRef(value))}</em>
      </div>
    `).join("");
  }

  function keyValueTable(items, rowFn) {
    const rows = Object.entries(items || {}).map(([key, value]) => {
      const [a, b, c] = rowFn(key, value);
      return `<tr><td class="mono">${escapeHtml(a)}</td><td>${escapeHtml(b)}</td><td>${escapeHtml(c)}</td></tr>`;
    }).join("");
    return `<div class="manual-table-wrap"><table class="manual-table"><tbody>${rows}</tbody></table></div>`;
  }

  function detailHtml(name, value, src) {
    return `
      <div class="detail-item">
        <div class="name">${escapeHtml(name)}</div>
        <div class="value">${escapeHtml(value || "unknown")}</div>
        <div class="src">${escapeHtml(src || "source not available")}</div>
      </div>
    `;
  }

  function renderComparison() {
    const a = arrangementById(els.compareA.value) || arrangements[0];
    const b = arrangementById(els.compareB.value) || arrangements[1] || arrangements[0];
    if (!a || !b) return;
    const sizeDiff = sizeSummary(a) === sizeSummary(b) ? "same size summary" : `${sizeSummary(a)} vs ${sizeSummary(b)}`;
    els.comparisonPanel.innerHTML = `
      ${compareCard(a)}
      ${compareCard(b)}
      <div class="compare-card">
        <strong>Difference</strong>
        <div>${Math.abs(a.contact_count - b.contact_count)} contact count delta</div>
        <div>${escapeHtml(sizeDiff)}</div>
      </div>
    `;
  }

  function compareCard(arr) {
    const viewBox = connectorBaseViewBox(arr);
    return `
      <div class="compare-card">
        <strong class="mono">${escapeHtml(arr.id)}</strong>
        <div>${arr.contact_count} contacts | ${escapeHtml(sizeSummary(arr))}</div>
        <svg class="mini-connector-svg" viewBox="${viewBox.join(" ")}">${miniSvgMarkup(arr)}</svg>
      </div>
    `;
  }

  function miniSvgMarkup(arr) {
    const outline = arr.outline;
    const contactRadius = Math.max(0.25, pinRadiusForArrangement(arr) * 0.75);
    const contacts = contactsWithKeys(arr);
    return `
      <circle class="shell-fill" cx="${outline.center_x}" cy="${outline.center_y}" r="${outline.radius * 1.04}"></circle>
      <circle class="shell" cx="${outline.center_x}" cy="${outline.center_y}" r="${outline.radius}"></circle>
      ${(arr.guide_paths || []).map((path) => `<path class="guide-path" d="${path.d}"></path>`).join("")}
      ${contacts.map((contact) => miniContactSymbolMarkup(contact, contactRadius)).join("")}
    `;
  }

  function miniContactSymbolMarkup(contact, baseRadius) {
    const token = gaugeToken(contact);
    const radius = Math.max(0.2, baseRadius * ({
      "22d": 0.46,
      "20": 0.68,
      "16": 0.94,
      "12": 1.16,
      "10": 1.44,
      "8": 1.8,
      unknown: 0.85,
    }[token] || 0.85));
    const circle = `<circle class="pin-symbol gauge-${token}" cx="${contact.x}" cy="${contact.y}" r="${radius}"></circle>`;
    if (token === "8") {
      return `${circle}<circle class="pin-symbol-cutout" cx="${contact.x}" cy="${contact.y}" r="${radius * 0.48}"></circle>`;
    }
    if (token === "10") {
      return `<circle class="pin-symbol gauge-10-ring" cx="${contact.x}" cy="${contact.y}" r="${radius}"></circle><circle class="pin-symbol gauge-10-core" cx="${contact.x}" cy="${contact.y}" r="${radius * 0.68}"></circle>`;
    }
    if (token === "12" || token === "16") {
      const a = radius * 0.72;
      const mark = token === "12"
        ? `${lineMarkup(contact.x - a, contact.y, contact.x + a, contact.y)}${lineMarkup(contact.x, contact.y - a, contact.x, contact.y + a)}`
        : `${lineMarkup(contact.x - a, contact.y - a, contact.x + a, contact.y + a)}${lineMarkup(contact.x - a, contact.y + a, contact.x + a, contact.y - a)}`;
      return `${circle}${mark}`;
    }
    if (token === "20") {
      return `${circle}<path class="pin-symbol gauge-20-half" d="${halfCirclePath(contact.x, contact.y, radius)}"></path><circle class="pin-symbol gauge-20-outline" cx="${contact.x}" cy="${contact.y}" r="${radius}"></circle>`;
    }
    return circle;
  }

  function bindPanZoom() {
    const svg = els.connectorSvg;
    svg.addEventListener("wheel", (event) => {
      if (!state.viewBox) return;
      event.preventDefault();
      const point = clientToSvg(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? 0.88 : 1.14;
      const [x, y, width, height] = state.viewBox;
      const newWidth = clamp(width * factor, state.baseViewBox[2] * 0.08, state.baseViewBox[2] * 2.2);
      const newHeight = clamp(height * factor, state.baseViewBox[3] * 0.08, state.baseViewBox[3] * 2.2);
      const relX = (point.x - x) / width;
      const relY = (point.y - y) / height;
      state.viewBox = [point.x - newWidth * relX, point.y - newHeight * relY, newWidth, newHeight];
      applyViewBox();
    }, { passive: false });

    svg.addEventListener("pointerdown", (event) => {
      state.isPanning = true;
      state.panStart = { x: event.clientX, y: event.clientY };
      state.panViewBox = state.viewBox?.slice();
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!state.isPanning || !state.panViewBox) return;
      const rect = svg.getBoundingClientRect();
      const [, , width, height] = state.panViewBox;
      const dx = (event.clientX - state.panStart.x) * (width / rect.width);
      const dy = (event.clientY - state.panStart.y) * (height / rect.height);
      state.viewBox = [state.panViewBox[0] - dx, state.panViewBox[1] - dy, width, height];
      applyViewBox();
    });
    svg.addEventListener("pointerup", () => {
      state.isPanning = false;
    });
    svg.addEventListener("pointerleave", () => {
      state.isPanning = false;
    });
  }

  function clientToSvg(clientX, clientY) {
    const rect = els.connectorSvg.getBoundingClientRect();
    const [x, y, width, height] = state.viewBox;
    return {
      x: x + ((clientX - rect.left) / rect.width) * width,
      y: y + ((clientY - rect.top) / rect.height) * height,
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  init();
})();
