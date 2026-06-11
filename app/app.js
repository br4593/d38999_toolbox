(function () {
  "use strict";

  // i18n bridge: app.js reads translated UI-chrome strings through T()/Tf().
  // Falls back to the literal key/fallback when i18n.js is absent.
  const I18N = window.D38999_I18N || {
    t: function (k, f) { return f != null ? f : k; },
    onChange: function () {},
    getLang: function () { return "en"; },
    isRTL: function () { return false; },
    apply: function () {},
  };
  function T(key, fallback) { return I18N.t(key, fallback); }
  function Tf(key, params) {
    return T(key).replace(/\{(\w+)\}/g, function (_match, name) {
      return params && params[name] != null ? params[name] : "";
    });
  }

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
  const validPartNumbersData = researchData.validPartNumbers || {};
  const validPartNumbers = validPartNumbersData.partNumbers || [];
  const environmentFilterDefinitions = validPartNumbersData.environment_filter_definitions || [];
  const environmentFilterOrder = environmentFilterDefinitions.map((item) => item.filter_key).filter(Boolean);
  const environmentFilterMap = new Map(
    environmentFilterDefinitions.map((item) => [item.filter_key, item])
  );
  const verifiedPartNumbers = (researchData.verifiedPartNumbers || {}).verifiedPartNumbers || [];
  const federalConnectorsSecondarySource = researchData.federalConnectorsSecondarySource || {};
  const secondarySourceEntries = federalConnectorsSecondarySource.entries || [];
  const secondarySourceImportableOverlaps = federalConnectorsSecondarySource.importableOverlaps || [];
  const defs = standard.definitions || {};
  const arrangements = (insertData.arrangements || []).slice();
  const contactCurrentRatings = DATA.contactCurrentRatings || { ratings: [] };
  const contactCurrentBySize = new Map(
    (contactCurrentRatings.ratings || []).map((entry) => [String(entry.contact_size), entry])
  );
  const reviewById = new Map((reviewData.items || []).map((item) => [item.id, item]));
  const validPartNumberMap = new Map(
    validPartNumbers.map((item) => [String(item.normalizedPartNumber || item.partNumber || "").toUpperCase().replace(/[\s-]+/g, ""), item])
  );
  const verifiedPartNumberMap = new Map(
    verifiedPartNumbers.map((item) => [String(item.partNumber || "").toUpperCase().replace(/[\s-]+/g, ""), item])
  );
  const secondarySourcePartNumberMap = new Map(
    secondarySourceEntries.map((item) => [String(item.normalizedPartNumber || item.partNumber || "").toUpperCase().replace(/[\s-]+/g, ""), item])
  );
  const secondarySourceImportableMap = new Map(
    secondarySourceImportableOverlaps.map((item) => [String(item.partNumber || "").toUpperCase().replace(/[\s-]+/g, ""), item])
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
    buildEnvironmentFilter: "",
    buildCurrentFilter: 0,
    ruggedView: null,
    ruggedViewFamily: null,
    viewMode: "engineering",
  };

  const EXACT_VALIDATION_STATUSES = new Set(["EXACT_PN_MATCH", "VERIFIED_EXISTS", "SECONDARY_SOURCE_EXACT"]);
  const SHELL_STYLE_LABELS = {
    "wall mount receptacle": "Wall-mount receptacle",
    "jam nut receptacle": "Jam-nut receptacle",
    "straight plug": "Straight plug",
    "straight plug with emi fingers": "RFI/EMI straight plug",
    "box mount receptacle": "Box-mount receptacle",
    "inline receptacle": "Inline receptacle",
    "box mount hermetic receptacle": "Hermetic box-mount receptacle",
    "jam nut hermetic receptacle": "Hermetic jam-nut receptacle",
    "solder mount hermetic receptacle": "Hermetic solder-mount receptacle",
    "weld mount hermetic receptacle": "Hermetic weld-mount receptacle",
    "dummy receptacle": "Dummy receptacle",
    "protective cap for plug": "Protective cap for plug",
    "protective cap for receptacle": "Protective cap for receptacle",
  };
  const SHELL_STYLE_DESCRIPTIONS = {
    "wall mount receptacle": "A fixed connector mounted to a panel or equipment wall with a flange. It usually mates with a cable plug.",
    "jam nut receptacle": "A panel-mounted connector secured with a rear jam nut. It is useful when you want a compact round panel cutout instead of a flange.",
    "straight plug": "A cable-side connector that plugs into a receptacle. It is typically used on the harness or cable end.",
    "straight plug with emi fingers": "A cable-side plug with shielding fingers to improve EMI/RFI continuity when used with the correct backshell and cable-shield termination.",
    "box mount receptacle": "A fixed connector mounted directly to an equipment box or enclosure.",
    "inline receptacle": "A cable-side receptacle used for cable-to-cable inline connections rather than a direct panel mount.",
    "box mount hermetic receptacle": "A sealed receptacle mounted to a box or bulkhead to prevent gas or fluid leakage through the connector body.",
    "jam nut hermetic receptacle": "A hermetic panel receptacle retained with a rear jam nut for compact sealed installations.",
    "solder mount hermetic receptacle": "A hermetic receptacle intended for sealed wall or bulkhead installations where solder termination is required.",
    "weld mount hermetic receptacle": "A hermetic receptacle welded into a panel or pressure boundary to maintain a sealed barrier.",
    "dummy receptacle": "A protection or stowage part rather than an electrical mating connector.",
    "protective cap for plug": "An accessory cap used to protect a plug when it is unmated. It is not an electrical mate.",
    "protective cap for receptacle": "An accessory cap used to protect a receptacle when it is unmated. It is not an electrical mate.",
  };
  const ENVIRONMENT_TAG_LABELS = {
    land_general: "General land use",
    land_vehicle: "Land vehicle",
    land_military: "Military land systems",
    desert_dust: "Desert / dust",
    high_vibration: "High vibration",
    high_shock: "High shock",
    marine_above_deck: "Marine / above-deck",
    salt_fog: "Salt fog",
    coastal: "Coastal exposure",
    aerospace_general: "Aerospace",
    aircraft_fixed_wing: "Fixed-wing aircraft",
    industrial: "Industrial",
    outdoor_exposed: "Outdoor exposed",
    high_temperature: "High temperature",
    low_temperature: "Low temperature",
    high_emi_rfi: "High EMI/RFI",
    fuel_oil_hydraulic_exposure: "Fuel, oil, and hydraulic exposure",
    sealed_weatherproof: "Sealed / weatherproof",
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
    plug: "assets/svg/conesys-d38999-26-straight-plug.svg",
    wall_receptacle: "assets/svg/conesys-d38999-20-wall-mount-receptacle.svg",
    jamnut_receptacle: "assets/svg/conesys-d38999-24-jam-nut-receptacle.svg",
    box_receptacle: "assets/svg/d38999-receptacle-generic.svg",
    cover: "assets/svg/conesys-d38999-33-cover.svg",
    inline_receptacle: "assets/svg/d38999-receptacle-generic.svg",
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
    ioGrid: $("ioGrid"),
    ioCount: $("ioCount"),
    ioCategoryFilter: $("ioCategoryFilter"),
    ioVendorFilter: $("ioVendorFilter"),
    ioShellFilter: $("ioShellFilter"),
    ioSearch: $("ioSearch"),
    ioClearButton: $("ioClearButton"),
    compareA: $("compareA"),
    compareB: $("compareB"),
    comparisonPanel: $("comparisonPanel"),
    viewerTitle: $("viewerTitle"),
    sourceInfo: $("sourceInfo"),
    labelsToggle: $("labelsToggle"),
    outlineToggle: $("outlineToggle"),
    viewModeEngBtn: $("viewModeEngBtn"),
    viewModeRealBtn: $("viewModeRealBtn"),
    resetViewButton: $("resetViewButton"),
    viewerReportButton: $("viewerReportButton"),
    viewerReportBadge: $("viewerReportBadge"),
    viewerBatchButton: $("viewerBatchButton"),
    viewerExportHint: $("viewerExportHint"),
    batchReportDialog: $("batchReportDialog"),
    batchReportInput: $("batchReportInput"),
    batchReportStatus: $("batchReportStatus"),
    batchReportRun: $("batchReportRun"),
    batchReportCancel: $("batchReportCancel"),
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

    const validExact = validPartNumberMap.get(normalizedCatalogPartNumber(decoded.part_number));
    if (validExact) {
      return {
        status: "EXACT_PN_MATCH",
        reasons: ["Exact part number match found in the valid D38999 database."],
        sources: summarizedValidPartSources(validExact),
        exactPart: validExact,
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

    const secondaryExact = secondarySourcePartNumberMap.get(normalizedCatalogPartNumber(decoded.part_number));
    if (secondaryExact) {
      return {
        status: "SECONDARY_SOURCE_EXACT",
        reasons: ["Exact part number match found in the local research data."],
        sources: [secondaryExact.sourcePage, secondaryExact.productUrl, ...((secondaryExact.crossCheck && secondaryExact.crossCheck.manufacturerSupportSources) || [])].filter(Boolean),
        secondaryPart: secondaryExact,
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
    if (candidate.status === "EXACT_PN_MATCH") score += 0.20;
    if (candidate.status === "VERIFIED_EXISTS") score += 0.20;
    if (candidate.status === "SECONDARY_SOURCE_EXACT") score += 0.1;
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

  function normalizeDisplayKey(value) {
    return String(value || "")
      .trim()
      .replace(/[\s_]+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function displayTextScore(value) {
    const text = String(value || "");
    if (!text) return -1;
    let score = 0;
    if (text.trim() === text) score += 1;
    if (!text.includes("_")) score += 3;
    if (/[A-Z][a-z]/.test(text)) score += 2;
    if (!/^[A-Z0-9_ /-]+$/.test(text)) score += 2;
    if (/[/-]/.test(text)) score += 1;
    score += Math.min(text.length, 48) / 100;
    return score;
  }

  function preferredDisplayText(current, candidate) {
    if (!current) return candidate;
    if (!candidate) return current;
    const currentScore = displayTextScore(current);
    const candidateScore = displayTextScore(candidate);
    if (candidateScore > currentScore) return candidate;
    if (candidateScore === currentScore && candidate.length > current.length) return candidate;
    return current;
  }

  function humanizeEnum(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const tokenMap = {
      iii: "III",
      iv: "IV",
      mil: "MIL",
      dtl: "DTL",
      pn: "PN",
      qpl: "QPL",
      emi: "EMI",
      rfi: "RFI",
    };
    return text
      .replace(/[_-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const lower = token.toLowerCase();
        if (tokenMap[lower]) return tokenMap[lower];
        if (/^[a-z]\d$/i.test(token)) return token.toUpperCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ")
      .replace(/\bPn\b/g, "PN")
      .replace(/\bQpl\b/g, "QPL")
      .replace(/\bEmi\b/g, "EMI")
      .replace(/\bRfi\b/g, "RFI");
  }

  function dedupeDisplayItems(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const out = [];
    const seen = new Map();
    const getLabel = options.getLabel || ((item) => {
      if (item == null) return "";
      if (typeof item === "string" || typeof item === "number") return String(item);
      return item.label || item.title || item.name || item.text || item.code || item.source || "";
    });
    const getKey = options.getKey || ((item) => {
      if (item == null) return "";
      if (typeof item === "string" || typeof item === "number") return normalizeDisplayKey(item);
      const semanticBits = [
        item.type,
        item.label,
        item.source_type,
        item.source_name,
        item.source,
        item.qpl,
        item.file,
        item.matched_part_number,
        item.match_type,
        item.partNumber,
        item.part_number,
        item.code,
      ].filter(Boolean);
      return normalizeDisplayKey(semanticBits.join(" | "));
    });
    const mapOutput = options.mapOutput || ((item, label) => {
      if (item == null || typeof item === "string" || typeof item === "number") return label;
      if (Object.prototype.hasOwnProperty.call(item, "label")) return { ...item, label };
      return { ...item, displayLabel: label };
    });

    list.forEach((item) => {
      const label = String(getLabel(item) || "").trim();
      const key = String(getKey(item) || normalizeDisplayKey(label)).trim();
      if (!label || !key) return;
      const existing = seen.get(key);
      if (!existing) {
        out.push(mapOutput(item, label));
        seen.set(key, { index: out.length - 1, label });
        return;
      }
      const preferred = preferredDisplayText(existing.label, label);
      if (preferred !== existing.label) {
        existing.label = preferred;
        out[existing.index] = mapOutput(item, preferred);
      }
    });

    return out.filter(Boolean);
  }

  function joinDisplayItems(items, separator = ", ", fallback = "", options = {}) {
    const labels = dedupeDisplayItems(items, {
      ...options,
      mapOutput: (item, label) => label,
    });
    return labels.length ? labels.join(separator) : fallback;
  }

  function readableList(items) {
    const list = dedupeDisplayItems(items, { mapOutput: (item, label) => label });
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;
    return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  }

  function ensureSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return /[.!?]$/.test(value) ? value : `${value}.`;
  }

  function firstSentence(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    const match = value.match(/^[^.!?]+[.!?]/);
    return match ? match[0].trim() : ensureSentence(value);
  }

  function isExactValidationStatus(status) {
    return EXACT_VALIDATION_STATUSES.has(status);
  }

  function shellStyleInfo(input) {
    const decoded = typeof input === "string" ? { slash_sheet: input } : input || {};
    const slashSheet = decoded.slash_sheet || decoded.slashSheet || "";
    const slashDefinition = decoded.slash_sheet_definition || decoded.slashSheetDefinition || dlaSlashSheetDefinition(slashSheet);
    const styleEntry = slashSheet ? styleEntryForSlashSheet(slashSheet) : null;
    const rawName = styleEntry?.normalizedName || slashDefinition?.shell_style || slashDefinition?.description || "";
    return {
      slashSheet,
      slashDefinition,
      styleEntry,
      rawName,
      key: normalizeDisplayKey(rawName),
    };
  }

  function getShellStyleLabel(input) {
    const info = shellStyleInfo(input);
    if (SHELL_STYLE_LABELS[info.key]) return SHELL_STYLE_LABELS[info.key];
    if (info.rawName) return humanizeEnum(info.rawName);
    if (info.slashDefinition?.description) return info.slashDefinition.description;
    return info.slashSheet || "Shell style";
  }

  function getShellStyleDescription(input) {
    const info = shellStyleInfo(input);
    if (SHELL_STYLE_DESCRIPTIONS[info.key]) return SHELL_STYLE_DESCRIPTIONS[info.key];
    if (info.styleEntry?.notes) return info.styleEntry.notes;
    if (info.slashDefinition?.description) return info.slashDefinition.description;
    return "This slash sheet selects the connector body style.";
  }

  function getEnvironmentLabel(tag) {
    const key = normalizeDisplayKey(tag).replace(/ /g, "_");
    return ENVIRONMENT_TAG_LABELS[key] || humanizeEnum(tag);
  }

  function contactSummaryText(decoded) {
    const gender = normalizeDisplayKey(decoded?.contact_definition?.contact_gender || "");
    if (gender === "pin") return "using pin contacts";
    if (gender === "socket") return "using socket contacts";
    const styleCode = String(decoded?.contact_style || "").toUpperCase();
    if (styleCode === "P") return "using pin contacts";
    if (styleCode === "S") return "using socket contacts";
    const description = String(decoded?.contact_definition?.description || "").trim();
    if (description) return `contact style: ${description}`;
    return "Contact gender is not specified.";
  }

  function summaryValidationHighlight(validation) {
    if (!validation) return "";
    const sourcePresence = validation.exactPart?.sourcePresence || {};
    if (sourcePresence.manufacturerVerified) return "It is backed by manufacturer catalog research.";
    if (sourcePresence.federalConnectorsExact) return "It is backed by Federal Connectors data.";
    if (sourcePresence.catalogExample) return "It matches a catalog example in the loaded research data.";
    if (validation.status === "VERIFIED_EXISTS") return "It is backed by the catalog research dataset.";
    if (validation.status === "SECONDARY_SOURCE_EXACT") return "It is backed by Federal Connectors data.";
    return "";
  }

  function environmentSummarySentence(part) {
    if (!part) return "";
    const note = firstSentence(part.environment_notes);
    if (note) return note;
    const scored = Object.entries(part.environment_score || {})
      .filter(([, score]) => Number(score) >= 4)
      .map(([filterKey]) => environmentFilterLabel(filterKey, true).toLowerCase());
    if (scored.length) return `The loaded data points to ${readableList(scored)} service.`;
    const tags = dedupeDisplayItems(part.environment_tags || [], {
      getLabel: (item) => getEnvironmentLabel(item),
      mapOutput: (item, label) => label,
    }).slice(0, 3);
    if (tags.length) return `Environment tags include ${readableList(tags)}.`;
    return "";
  }

  function buildValidationEvidenceText(validation) {
    if (!validation) return "Validation source is not available.";
    const sourceText = joinDisplayItems(validation.sources || [], " | ", "");
    if (isExactValidationStatus(validation.status) && sourceText) {
      return summarizeText(`Validation sources: ${sourceText}`, 220);
    }
    const reasonText = joinDisplayItems(validation.reasons || [], " | ", "");
    if (reasonText) return summarizeText(reasonText, 220);
    if (sourceText) return summarizeText(`Sources: ${sourceText}`, 220);
    return "Validation source is not available.";
  }

  function buildConnectorHumanSummary(decoded, options = {}) {
    if (!decoded?.ok) return String(options.emptyText || "").trim();
    const validation = options.validation || catalogValidationForDecoded(decoded);
    const shellLabel = getShellStyleLabel(decoded) || "Connector";
    const shellSizeText = decoded.shell_size ? `shell size ${decoded.shell_size}` : "shell size not specified";
    const arrangementText = decoded.arrangement_id
      ? `insert arrangement ${decoded.arrangement_id}`
      : decoded.insert_arrangement
        ? `insert arrangement ${decoded.insert_arrangement}`
        : "insert arrangement is not specified";
    const contactText = contactSummaryText(decoded);
    const leadBits = [shellLabel, shellSizeText, arrangementText];
    if (contactText && !/^Contact gender is not specified\.?$/i.test(contactText)) {
      leadBits.push(contactText);
    }
    const sentences = [ensureSentence(leadBits.join(", "))];
    const shellDescription = getShellStyleDescription(decoded);
    if (shellDescription) sentences.push(ensureSentence(shellDescription));
    const validationHighlight = summaryValidationHighlight(validation);
    if (validationHighlight) sentences.push(ensureSentence(validationHighlight));
    const environmentSummary = environmentSummarySentence(validation?.exactPart || validation?.verifiedPart || validation?.secondaryPart);
    if (environmentSummary) sentences.push(ensureSentence(environmentSummary));
    if (/^Contact gender is not specified\.?$/i.test(contactText)) sentences.push("Contact gender is not specified.");
    const matePartNumber = String(options.matePartNumber || decoded.mating_connector_pn || decoded.reciprocal_connector_pn || "").trim();
    if (matePartNumber) {
      sentences.push(`Known mate: ${matePartNumber}.`);
    } else if (options.includeMateStatus !== false) {
      sentences.push("Mating connector is not listed.");
    }
    const summary = dedupeDisplayItems(sentences, { mapOutput: (item, label) => label }).join(" ");
    return summarizeText(summary, 420);
  }

  function connectorSummaryDetailHtml(decoded, options = {}) {
    const summary = buildConnectorHumanSummary(decoded, options) || String(options.emptyText || "").trim();
    if (!summary) return "";
    return `<div class="detail-item detail-summary connector-summary"><div class="name">${escapeHtml(options.label || "Connector summary")}</div><div class="value">${escapeHtml(summary)}</div></div>`;
  }

  function getValidationStatusLabel(status) {
    switch (status) {
      case "EXACT_PN_MATCH":
      case "VERIFIED_EXISTS":
      case "SECONDARY_SOURCE_EXACT":
        return T("val.exact");
      case "VALID_FORMAT_BUT_NOT_CONFIRMED":
        return T("val.formatValid");
      case "INVALID_COMBINATION":
        return T("val.unsupported");
      case "MANUFACTURER_SPECIFIC_UNCERTAIN":
        return T("val.needsReview");
      default:
        return T("val.missingData");
    }
  }

  function validationLabel(status) {
    return getValidationStatusLabel(status);
  }

  function validationClassName(status) {
    if (status === "EXACT_PN_MATCH") return "mating-validation-ok";
    if (status === "VERIFIED_EXISTS") return "mating-validation-ok";
    if (status === "SECONDARY_SOURCE_EXACT") return "mating-validation-ok";
    if (status === "VALID_FORMAT_BUT_NOT_CONFIRMED") return "mating-validation-warn";
    return "mating-validation-fail";
  }

  function validationBadgeHtml(status, text) {
    return `<div class="mating-validation ${validationClassName(status)}">
      <svg class="mating-val-icon" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.3"/></svg>
      <span>${escapeHtml(text || validationLabel(status))}</span>
    </div>`;
  }

  function validationSummaryHtml(validation, options = {}) {
    if (!validation?.status) return "";
    if (isExactValidationStatus(validation.status)) {
      return exactCatalogHitHtml(validation, options.partNumber || "", { hidePartNumber: options.hidePartNumber !== false });
    }
    const bits = [validationLabel(validation.status)];
    if (Number.isFinite(options.confidence)) bits.push(Tf("val.confidence", { pct: (options.confidence * 100).toFixed(0) }));
    return validationBadgeHtml(validation.status, bits.join(" | "));
  }

  function summarizedValidPartSources(part) {
    if (!part) return [];
    const bits = [];
    (part.manufacturers || []).forEach((manufacturer) => bits.push(manufacturer));
    (part.qpls || []).forEach((qpl) => bits.push(`QPL ${qpl}`));
    (part.sources || []).forEach((source) => {
      if (!source) return;
      if (source.type === "manufacturer_verified" && source.citation) bits.push(source.citation);
      else if (source.type === "catalog_example") bits.push([source.sourcePdf, source.sourcePage ? `page ${source.sourcePage}` : ""].filter(Boolean).join(" "));
      else if (source.type === "federalconnectors_exact") bits.push("Federal Connectors index");
      else if (source.type === "qpl" && source.qpl) bits.push(`QPL ${source.qpl}`);
    });
    return dedupeDisplayItems(bits, { mapOutput: (item, label) => label });
  }

  function environmentFilterLabel(filterKey, short = false) {
    const definition = environmentFilterMap.get(filterKey);
    if (!definition) return filterKey;
    if (!short) return definition.filter_name || filterKey;
    const shortLabels = {
      land: "Land",
      sea: "Sea",
      air: "Air",
      space: "Space",
      industrial: "Industrial",
    };
    return shortLabels[filterKey] || definition.filter_name || filterKey;
  }

  function environmentScore(part, filterKey) {
    return Number(part?.environment_score?.[filterKey] || 0);
  }

  function partFitsEnvironment(part, filterKey) {
    if (!filterKey) return true;
    return environmentScore(part, filterKey) >= 3;
  }

  function environmentBadgesHtml(part) {
    if (!part) return "";
    const keys = (environmentFilterOrder.length ? environmentFilterOrder : ["land", "sea", "air", "space", "industrial"])
      .filter((filterKey) => environmentScore(part, filterKey) >= 3);
    if (!keys.length) return "";
    return `
      <div class="exact-catalog-hit-subtitle">${escapeHtml(T("env.fit"))}</div>
      <div class="environment-badge-row">
        ${keys.map((filterKey) => {
          const score = environmentScore(part, filterKey);
          const conditional = score === 3;
          const label = conditional
            ? Tf("env.conditional", { label: environmentFilterLabel(filterKey, true) })
            : environmentFilterLabel(filterKey, true);
          return `<span class="environment-badge${conditional ? " conditional" : ""}">${escapeHtml(label)}</span>`;
        }).join("")}
      </div>
    `;
  }

  function environmentNotesHtml(part) {
    if (!part?.environment_notes) return "";
    return `<div class="exact-catalog-hit-meta">${escapeHtml(part.environment_notes)}</div>`;
  }

  function exactCatalogHitHtml(validation, partNumberOverride = "", options = {}) {
    const exactPart = validation?.exactPart;
    const verified = validation?.verifiedPart;
    const secondary = validation?.secondaryPart;
    if (!exactPart && !verified && !secondary) return "";
    const hidePartNumber = Boolean(options.hidePartNumber);
    const title = T("val.exact");
    return `<div class="exact-catalog-hit">
      <div class="exact-catalog-hit-title">${escapeHtml(title)}</div>
      ${hidePartNumber ? "" : `<div class="exact-catalog-hit-part mono">${escapeHtml(partNumberOverride || exactPart?.partNumber || verified?.partNumber || secondary?.partNumber || "")}</div>`}
      ${exactPart ? environmentBadgesHtml(exactPart) : ""}
      ${exactPart ? environmentNotesHtml(exactPart) : ""}
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
    const ruggedConv = globalThis.D38999Converter;
    if (ruggedConv && ruggedConv.recognizeRuggedIo && ruggedConv.recognizeRuggedIo(compact).recognized) {
      return compact;
    }
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
    if (!element) return;
    element.textContent = text || "";
    element.classList.toggle("warn", Boolean(warn));
  }

  function init() {
    const converterRuleCount = (converterData.rules || []).length;
    els.dataStatus.textContent = converterRuleCount
      ? Tf("status.dataBoth", { count: arrangements.length, rules: converterRuleCount })
      : Tf("status.dataArrangements", { count: arrangements.length });
    populateFilters();
    bindEvents();
    renderPartNumberGuide(null);
    renderCatalog();
    if (arrangements.length) {
      selectArrangement(arrangements.find((arr) => arr.id === "17-26") || arrangements[0], true);
    }
    renderDecoded(null);
    renderComparison();
    initRouting();
    I18N.onChange(rerenderForLanguage);
  }

  // Repaint JS-generated content when the language changes. Static DOM text is
  // already handled by i18n.js (applyTranslations) before listeners fire; this
  // only refreshes content that app.js renders dynamically.
  function rerenderForLanguage() {
    const converterRuleCount = (converterData.rules || []).length;
    els.dataStatus.textContent = converterRuleCount
      ? Tf("status.dataBoth", { count: arrangements.length, rules: converterRuleCount })
      : Tf("status.dataArrangements", { count: arrangements.length });
    renderRecentStrips();
    const ruggedActive = Boolean(state.decoded && state.decoded.ok && state.decoded.rugged_io);
    if (state.selectedArrangement && !ruggedActive) {
      els.selectedStatus.textContent = Tf("status.selected", {
        id: state.selectedArrangement.id,
        count: state.selectedArrangement.contact_count,
      });
      els.selectedStatus.hidden = false;
      renderSourceInfo();
      renderPinDetail();
    }
    renderDecoded(state.decoded);
    renderPartNumberGuide(state.decoded);
    renderComparison();
    if (state.activeTab === "catalog") renderCatalog();
    if (state.activeTab === "io") renderIoCatalog();
    if (state.activeTab === "mating") renderMatingPanel();
    if (state.activeTab === "build" && state.buildRendered) renderBuildConnector();
    if (state.activeTab === "manual" && state.manualRendered) renderManual();
  }

  function populateFilters() {
    const slashSheets = Object.keys(defs.slash_sheets || {}).sort(naturalCompare);
    fillSelect(els.slashSheetFilter, [["", T("filter.allInsert")], ...slashSheets.map((value) => [value, `D38999${value}`])]);

    const shellSizes = unique(arrangements.map((arr) => arr.shell_size)).sort((a, b) => Number(a) - Number(b));
    fillSelect(els.shellFilter, [["", T("common.all")], ...shellSizes.map((value) => [value, value])]);

    const counts = unique(arrangements.map((arr) => String(arr.contact_count))).sort((a, b) => Number(a) - Number(b));
    fillSelect(els.countFilter, [["", T("common.all")], ...counts.map((value) => [value, value])]);

    const sizes = unique(
      arrangements.flatMap((arr) => arr.contact_size_notes || []).map((note) => note.size)
    ).sort(naturalCompare);
    fillSelect(els.sizeFilter, [["", T("common.all")], ...sizes.map((value) => [value, value])]);

    const types = unique(
      arrangements.flatMap((arr) => arr.contacts || []).map((contact) => contact.type)
    ).sort(naturalCompare);
    fillSelect(els.typeFilter, [["", T("common.all")], ...types.map((value) => [value, value])]);

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
      state.manualSelector = blankSelectorSelection();
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

  function bindThemeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    // Each named style maps to a base theme (drives all existing component
    // rules) plus an optional D38999 finish overlay (data-style) that re-skins
    // the palette and tints the connector drawing's default shell.
    const STYLE_GROUPS = [
      {
        label: "Interface",
        items: [
          { id: "light",          name: "Light",          base: "light",          finish: null, swatch: ["#fbfaf6", "#2f5c8a"] },
          { id: "dark",           name: "Dark",           base: "dark",           finish: null, swatch: ["#1f2329", "#5e8fc4"] },
          { id: "blueprint",      name: "Blueprint",      base: "blueprint",      finish: null, swatch: ["#f6f1e1", "#1f5fa8"] },
          { id: "blueprint-dark", name: "Oscilloscope",   base: "blueprint-dark", finish: null, swatch: ["#0a1322", "#7dd3fc"] },
        ],
      },
      {
        label: "D38999 finishes",
        items: [
          { id: "olive",   name: "Olive Drab",     base: "light", finish: "olive",   swatch: ["#6b6a4b", "#3e3f2b"] },
          { id: "cadmium", name: "Cadmium",        base: "light", finish: "cadmium", swatch: ["#d6d2c2", "#9a7b2e"] },
          { id: "nickel",  name: "Satin Nickel",   base: "light", finish: "nickel",  swatch: ["#a7abb1", "#4f6675"] },
          { id: "zinc",    name: "Black Zinc",     base: "dark",  finish: "zinc",    swatch: ["#1a1c1e", "#6d97c8"] },
          { id: "grey",    name: "Gun-Metal Grey", base: "dark",  finish: "grey",    swatch: ["#565b61", "#8fb3d6"] },
        ],
      },
    ];
    const STYLES = {};
    STYLE_GROUPS.forEach((g) => g.items.forEach((it) => { STYLES[it.id] = it; }));

    const root = document.documentElement;
    let menu = null;

    const apply = (id) => {
      const def = STYLES[id] || STYLES.light;
      root.setAttribute("data-theme", def.base);
      if (def.finish) root.setAttribute("data-style", def.finish);
      else root.removeAttribute("data-style");
      const isDarkLike = def.base === "dark" || def.base === "blueprint-dark";
      toggle.setAttribute("aria-pressed", isDarkLike ? "true" : "false");
      const label = "Style: " + def.name;
      toggle.setAttribute("title", label);
      toggle.setAttribute("aria-label", label);
      if (menu) {
        menu.querySelectorAll(".style-menu-item").forEach((btn) => {
          btn.setAttribute("aria-checked", btn.dataset.styleId === def.id ? "true" : "false");
        });
      }
    };

    // Infer the active style id from persisted value, falling back to the
    // attributes resolved by the pre-paint bootstrap.
    const currentId = () => {
      let saved = null;
      try { saved = localStorage.getItem("d38999.theme"); } catch (e) { /* ignore */ }
      if (saved && STYLES[saved]) return saved;
      const style = root.getAttribute("data-style");
      if (style) {
        const hit = Object.values(STYLES).find((s) => s.finish === style);
        if (hit) return hit.id;
      }
      const theme = root.getAttribute("data-theme");
      const baseHit = Object.values(STYLES).find((s) => !s.finish && s.base === theme);
      return baseHit ? baseHit.id : "light";
    };

    const closeMenu = () => {
      if (!menu) return;
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };

    const onDocClick = (e) => {
      if (menu && !menu.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) closeMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") { closeMenu(); toggle.focus(); }
    };

    const buildMenu = () => {
      menu = document.createElement("div");
      menu.className = "style-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "App style");
      menu.hidden = true;
      STYLE_GROUPS.forEach((group) => {
        const wrap = document.createElement("div");
        wrap.className = "style-menu-group";
        const lab = document.createElement("div");
        lab.className = "style-menu-group-label";
        lab.textContent = group.label;
        wrap.appendChild(lab);
        group.items.forEach((it) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "style-menu-item";
          btn.setAttribute("role", "menuitemradio");
          btn.dataset.styleId = it.id;
          const sw = document.createElement("span");
          sw.className = "style-menu-swatch";
          sw.style.background = `linear-gradient(135deg, ${it.swatch[0]} 0 54%, ${it.swatch[1]} 54% 100%)`;
          const nm = document.createElement("span");
          nm.className = "style-menu-name";
          nm.textContent = it.name;
          const ck = document.createElement("span");
          ck.className = "style-menu-check";
          ck.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
          btn.append(sw, nm, ck);
          btn.addEventListener("click", () => {
            apply(it.id);
            try { localStorage.setItem("d38999.theme", it.id); } catch (e) { /* storage unavailable */ }
            closeMenu();
            toggle.focus();
          });
          wrap.appendChild(btn);
        });
        menu.appendChild(wrap);
      });
      document.body.appendChild(menu);
    };

    const openMenu = () => {
      if (!menu) buildMenu();
      apply(currentId()); // refresh checked state
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      const r = toggle.getBoundingClientRect();
      menu.style.visibility = "hidden";
      const mw = menu.offsetWidth;
      let left = r.right - mw;
      if (left < 8) left = 8;
      menu.style.left = left + "px";
      menu.style.top = (r.bottom + 6) + "px";
      menu.style.visibility = "";
      const firstChecked = menu.querySelector('.style-menu-item[aria-checked="true"]') || menu.querySelector(".style-menu-item");
      if (firstChecked) firstChecked.focus();
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("resize", closeMenu);
      window.addEventListener("scroll", closeMenu, true);
    };

    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      if (menu && !menu.hidden) closeMenu();
      else openMenu();
    });

    // Track system changes only while the user has no explicit preference,
    // and only between the two non-finish base themes.
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (event) => {
        let saved = null;
        try { saved = localStorage.getItem("d38999.theme"); } catch (e) { /* ignore */ }
        if (!saved) apply(event.matches ? "dark" : "light");
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    apply(currentId());
  }

  /* ---------------------------------------------------------------------
     Phase 2 — cross-tool flow: deep-linking, recent/favorites, global search
     --------------------------------------------------------------------- */

  const ROUTE_TABS = new Set(["home", "decoder", "mating", "catalog", "io", "converter", "build", "manual"]);
  const RECENT_KEY = "d38999.recent";
  const FAV_KEY = "d38999.favorites";
  const RECENT_MAX = 12;

  function loadStoredList(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }

  function pushRecentPartNumber(pn) {
    if (!pn) return;
    const next = [pn, ...loadStoredList(RECENT_KEY).filter((x) => x !== pn)].slice(0, RECENT_MAX);
    saveStoredList(RECENT_KEY, next);
    renderRecentStrips();
  }

  function toggleFavoritePartNumber(pn) {
    if (!pn) return;
    const favs = loadStoredList(FAV_KEY);
    const next = favs.includes(pn) ? favs.filter((x) => x !== pn) : [pn, ...favs];
    saveStoredList(FAV_KEY, next);
    renderRecentStrips();
  }

  function recentStripHtml() {
    const favs = loadStoredList(FAV_KEY);
    const recents = loadStoredList(RECENT_KEY).filter((pn) => !favs.includes(pn));
    const ordered = [...favs, ...recents];
    if (!ordered.length) return "";
    const favSet = new Set(favs);
    return ordered.map((pn) => {
      const isFav = favSet.has(pn);
      const display = pn.replace(/^D38999\//, "");
      return `
        <span class="recent-item${isFav ? " is-fav" : ""}">
          <button type="button" class="example-chip recent-chip" data-recent-pn="${escapeHtml(pn)}" title="${escapeHtml(pn)}">${escapeHtml(display)}</button>
          <button type="button" class="recent-star" data-fav-pn="${escapeHtml(pn)}" aria-label="${isFav ? T("recent.removeFav") : T("recent.addFav")}" aria-pressed="${isFav}">${isFav ? "\u2605" : "\u2606"}</button>
        </span>`;
    }).join("");
  }

  function renderRecentStrips() {
    const html = recentStripHtml();
    const hasItems = Boolean(html);
    for (const [stripId, sectionId] of [["recentChips", "recentSection"], ["homeRecent", "homeRecentSection"]]) {
      const strip = document.getElementById(stripId);
      const section = document.getElementById(sectionId);
      if (strip) strip.innerHTML = html;
      if (section) section.hidden = !hasItems;
    }
  }

  function bindRecentStrips() {
    const handler = (event) => {
      const decodeBtn = event.target.closest("[data-recent-pn]");
      if (decodeBtn) {
        els.partNumberInput.value = decodeBtn.dataset.recentPn;
        decodeFromInput();
        selectTab("decoder");
        return;
      }
      const favBtn = event.target.closest("[data-fav-pn]");
      if (favBtn) toggleFavoritePartNumber(favBtn.dataset.favPn);
    };
    ["recentChips", "homeRecent"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", handler);
    });
    renderRecentStrips();
  }

  function sendToConverter(value) {
    const input = document.getElementById("pnInput");
    const form = document.getElementById("converterForm");
    if (!input || !form) return;
    input.value = value || "";
    selectTab("converter");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }

  function bindGlobalSearch() {
    const input = document.getElementById("globalSearch");
    if (!input) return;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        routeGlobalSearch(input.value);
      }
    });
  }

  function routeGlobalSearch(raw) {
    const q = String(raw || "").trim();
    if (!q) return;
    // Arrangement id like 17-26
    if (/^\d{1,2}-\d{1,3}$/.test(q)) {
      const arr = arrangementById(q);
      els.arrangementFilter.value = q;
      renderCatalog();
      if (arr) selectArrangement(arr, true);
      selectTab("catalog");
      return;
    }
    // D38999 or shorthand recognized by the decoder
    const norm = normalizePartNumber(q);
    const decoded = decodePartNumber(norm);
    if (decoded.ok) {
      els.partNumberInput.value = norm;
      decodeFromInput();
      selectTab("decoder");
      return;
    }
    // Otherwise treat as a manufacturer part number
    sendToConverter(q);
  }

  function computeRouteHash() {
    const tab = state.activeTab || "home";
    const pn = state.decoded?.ok ? state.decoded.part_number : "";
    if (tab === "decoder" && pn) return `decoder/${encodeURIComponent(pn)}`;
    if (tab === "mating" && pn) return `mating/${encodeURIComponent(pn)}`;
    if (tab === "converter" && state.lastConverterInput) return `converter/${encodeURIComponent(state.lastConverterInput)}`;
    return tab;
  }

  function syncRouteHash() {
    if (!state.routingReady) return;
    const next = `#${computeRouteHash()}`;
    if (next === location.hash) return;
    state.suppressHashRoute = true;
    location.hash = next;
    setTimeout(() => { state.suppressHashRoute = false; }, 0);
  }

  function applyRouteHash(rawHash) {
    const hash = String(rawHash || "").replace(/^#/, "");
    if (!hash) return false;
    const slash = hash.indexOf("/");
    const tab = (slash === -1 ? hash : hash.slice(0, slash)).toLowerCase();
    const payload = slash === -1 ? "" : decodeURIComponent(hash.slice(slash + 1));
    if (!ROUTE_TABS.has(tab)) return false;

    if ((tab === "decoder" || tab === "mating") && payload) {
      els.partNumberInput.value = payload;
      decodeFromInput();
      selectTab(tab);
      return true;
    }
    if (tab === "converter" && payload) {
      sendToConverter(payload);
      return true;
    }
    selectTab(tab);
    return true;
  }

  function initRouting() {
    state.routingReady = true;
    window.addEventListener("hashchange", () => {
      if (state.suppressHashRoute) return;
      applyRouteHash(location.hash);
    });
    if (!applyRouteHash(location.hash)) selectTab("home");
  }

  const SHORTCUT_TAB_MAP = {
    "1": "home",
    "2": "decoder",
    "3": "mating",
    "4": "catalog",
    "5": "io",
    "6": "converter",
    "7": "build",
    "8": "manual",
  };

  function sortedArrangementList() {
    return arrangements.slice().sort((a, b) => {
      const pa = String(a.id).split("-").map((n) => parseInt(n, 10) || 0);
      const pb = String(b.id).split("-").map((n) => parseInt(n, 10) || 0);
      return (pa[0] - pb[0]) || (pa[1] - pb[1]);
    });
  }

  function stepArrangement(direction) {
    const list = sortedArrangementList();
    if (!list.length) return;
    const current = state.selectedArrangement?.id;
    let idx = current ? list.findIndex((a) => a.id === current) : -1;
    idx = (idx + direction + list.length) % list.length;
    const next = list[idx];
    if (state.activeTab !== "catalog") {
      els.arrangementFilter.value = "";
      renderCatalog();
      selectTab("catalog");
    }
    selectArrangement(next, true);
  }

  function closeShortcutsOverlay() {
    const existing = document.getElementById("shortcutsOverlay");
    if (!existing) return false;
    existing.remove();
    document.getElementById("shortcutsButton")?.focus();
    return true;
  }

  function openShortcutsOverlay() {
    if (document.getElementById("shortcutsOverlay")) return;
    const rows = [
      ["/", T("sc.search")],
      ["?", T("sc.toggle")],
      ["1 – 8", T("sc.tabs")],
      ["[ &nbsp; ]", T("sc.step")],
      ["Esc", T("sc.close")],
    ];
    const overlay = document.createElement("div");
    overlay.className = "shortcuts-overlay";
    overlay.id = "shortcutsOverlay";
    overlay.innerHTML =
      '<div class="shortcuts-card" role="dialog" aria-modal="true" aria-label="' + escapeHtml(T("header.shortcutsAria")) + '">' +
      '<div class="shortcuts-head"><h2>' + escapeHtml(T("header.shortcutsAria")) + '</h2>' +
      '<button class="shortcuts-close" type="button" aria-label="' + escapeHtml(T("common.close")) + '">\u00d7</button></div>' +
      '<table class="shortcuts-table"><tbody>' +
      rows
        .map((row) => {
          const keys = row[0]
            .split(" ")
            .map((k) => (k === "&nbsp;" ? " " : `<kbd>${k}</kbd>`))
            .join("");
          return `<tr><td>${keys}</td><td>${row[1]}</td></tr>`;
        })
        .join("") +
      "</tbody></table></div>";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest(".shortcuts-close")) {
        closeShortcutsOverlay();
      }
    });
    document.body.appendChild(overlay);
  }

  function toggleShortcutsOverlay() {
    if (!closeShortcutsOverlay()) openShortcutsOverlay();
  }

  function bindKeyboardShortcuts() {
    document.getElementById("shortcutsButton")?.addEventListener("click", toggleShortcutsOverlay);
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (event.key === "Escape") {
        if (closeShortcutsOverlay()) return;
        const sm = document.getElementById("decodeSmartSuggestion");
        if (sm && !sm.hidden) { clearSmartSuggestion(); return; }
        if (typing && typeof target.blur === "function") target.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        document.getElementById("globalSearch")?.focus();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        toggleShortcutsOverlay();
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        stepArrangement(-1);
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        stepArrangement(1);
        return;
      }
      if (SHORTCUT_TAB_MAP[event.key]) {
        event.preventDefault();
        selectTab(SHORTCUT_TAB_MAP[event.key]);
      }
    });
  }

  function bindEvents() {
    bindThemeToggle();
    bindGlobalSearch();
    bindRecentStrips();
    bindKeyboardShortcuts();
    const convForm = document.getElementById("converterForm");
    const convInput = document.getElementById("pnInput");
    if (convForm && convInput) {
      convForm.addEventListener("submit", () => {
        state.lastConverterInput = convInput.value.trim();
        syncRouteHash();
      });
    }
    els.decodeButton.addEventListener("click", decodeFromInput);
    els.partNumberInput.addEventListener("input", () => decodeFromInput({ automatic: true }));
    bindSmartSuggestionHandlers();
    bindViewerExportControls();
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

    // I/O Connectors catalog filters
    for (const element of [
      els.ioCategoryFilter,
      els.ioVendorFilter,
      els.ioShellFilter,
      els.ioSearch,
    ]) {
      if (!element) continue;
      element.addEventListener("input", renderIoCatalog);
      element.addEventListener("change", renderIoCatalog);
    }
    if (els.ioClearButton) els.ioClearButton.addEventListener("click", clearIoFilters);
    if (els.ioGrid) {
      els.ioGrid.addEventListener("click", (event) => {
        if (event.target.closest(".io-clear-inline-btn")) clearIoFilters();
      });
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
    els.labelsToggle.addEventListener("click", togglePinLabels);
    els.labelsToggle.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        togglePinLabels();
      }
    });
    els.outlineToggle.addEventListener("change", renderViewer);
    if (els.viewModeEngBtn) els.viewModeEngBtn.addEventListener("click", () => setViewMode("engineering"));
    if (els.viewModeRealBtn) els.viewModeRealBtn.addEventListener("click", () => setViewMode("real"));
    initViewMode();
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
    bindSprintAEnhancements();
  }

  /* ---------- Sprint A UX enhancements ---------- */
  const SA_KEYS = {
    disclaimer: "d38999.disclaimer.dismissed",
    lastPn: "d38999.lastPn",
  };

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function safeStorageDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function bindSprintAEnhancements() {
    // 1) Dismissible disclaimer (persisted).
    const disclaimer = document.getElementById("appDisclaimer");
    const dismissBtn = document.getElementById("disclaimerDismiss");
    if (disclaimer && safeStorageGet(SA_KEYS.disclaimer) === "1") {
      disclaimer.hidden = true;
    }
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => {
        if (disclaimer) disclaimer.hidden = true;
        safeStorageSet(SA_KEYS.disclaimer, "1");
      });
    }

    // 2) Paste-aware decode: collapse the immediate input-handler decode and
    //    run a single decode after the paste settles into the input.
    if (els.partNumberInput) {
      els.partNumberInput.addEventListener("paste", () => {
        state._sprintAPasteIncoming = true;
        // Two RAF + 0ms gives the input value time to update across browsers.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          state._sprintAPasteIncoming = false;
          decodeFromInput({ automatic: true });
        }));
      });
    }

    // 3) Persist last decoded P/N; prefill on next visit only when input is
    //    empty / placeholder so we never overwrite an in-progress entry.
    if (els.partNumberInput && !els.partNumberInput.value.replace(/D38999\/?/i, "").trim()) {
      const stored = safeStorageGet(SA_KEYS.lastPn);
      if (stored && stored.length >= 4) {
        els.partNumberInput.value = stored;
      }
    }

    // 4) Sprint C: global click-to-copy on any [data-copy-pn] element.
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-copy-pn]");
      if (!target) return;
      const value = target.getAttribute("data-copy-pn");
      if (!value) return;
      copyTextSimple(value).then(() => flashCopied(target));
    });
  }

  function copyTextSimple(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    }
    return Promise.resolve(copyTextFallback(text));
  }

  function copyTextFallback(text) {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    } catch (e) { /* swallow */ }
  }

  function flashCopied(el) {
    if (!el) return;
    el.classList.add("pn-copied-flash");
    const prevTitle = el.getAttribute("title");
    el.setAttribute("title", T("common.copied") || "Copied");
    setTimeout(() => {
      el.classList.remove("pn-copied-flash");
      if (prevTitle != null) el.setAttribute("title", prevTitle);
    }, 900);
  }

  function rememberLastPartNumber(pn) {
    if (!pn || pn.length < 4) { safeStorageDel(SA_KEYS.lastPn); return; }
    safeStorageSet(SA_KEYS.lastPn, pn);
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
    const environmentButton = event.target.closest("[data-build-environment]");
    if (environmentButton) {
      const nextFilter = environmentButton.dataset.buildEnvironment || "";
      if (state.buildEnvironmentFilter !== nextFilter) {
        state.buildEnvironmentFilter = nextFilter;
        if (state.buildRendered) renderBuildConnector();
      }
      return;
    }

    const currentButton = event.target.closest("[data-build-current]");
    if (currentButton) {
      const nextCurrent = Number(currentButton.dataset.buildCurrent) || 0;
      if (state.buildCurrentFilter !== nextCurrent) {
        state.buildCurrentFilter = nextCurrent;
        if (state.buildRendered) renderBuildConnector();
      }
      return;
    }

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
        state.manualSelector = blankSelectorSelection();
        state.buildStep = currentBuildStepFromSelection(state.manualSelector);
        state.buildEnvironmentFilter = "";
        state.buildCurrentFilter = 0;
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
    const keyChip = event.target.closest("[data-keying-letter]");
    if (keyChip) { onKeyingChipClick(event); return; }
    const whyToggle = event.target.closest("[data-why-toggle]");
    if (whyToggle) {
      const chip = whyToggle.closest(".decoded-field-chip");
      const panel = chip?.querySelector(".field-why");
      if (panel) {
        const open = panel.hasAttribute("hidden");
        if (open) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
        whyToggle.setAttribute("aria-expanded", open ? "true" : "false");
      }
      return;
    }
    const button = event.target.closest("[data-decoded-action]");
    if (!button || !state.decoded?.ok) return;
    const action = button.dataset.decodedAction;
    if (action === "mating") {
      selectTab("mating");
      return;
    }
    if (action === "build") {
      state.manualSelector = blankSelectorSelection();
      state.buildStep = currentBuildStepFromSelection(state.manualSelector);
      state.buildEnvironmentFilter = "";
      state.buildCurrentFilter = 0;
      renderBuildConnector();
      selectTab("build");
      return;
    }
    if (action === "catalog") {
      els.slashSheetFilter.value = state.decoded.slash_sheet || "";
      els.arrangementFilter.value = state.decoded.arrangement_id || "";
      renderCatalog();
      selectTab("catalog");
      return;
    }
    if (action === "converter") {
      sendToConverter(state.decoded.part_number);
      return;
    }
    if (action === "csv") {
      exportDecodedCsv(state.decoded);
      return;
    }
    if (action === "print") {
      window.print();
    }
  }

  function selectTab(tabName) {
    state.activeTab = tabName;
    document.body.classList.toggle("is-home", tabName === "home");
    document.querySelectorAll(".tab-button").forEach((button) => {
      const isActive = button.dataset.tab === tabName;
      button.classList.toggle("active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    const panel = $(`${tabName}Panel`);
    if (panel) panel.classList.add("active");
    if (tabName === "build" && !state.buildRendered) renderBuildConnector();
    if (tabName === "manual" && !state.manualRendered) renderManual();
    // When switching to catalog, re-render to reflect any selection change
    if (tabName === "catalog") renderCatalog();
    if (tabName === "io") renderIoCatalog();
    if (tabName === "mating") renderMatingPanel();
    window.scrollTo({ top: 0, behavior: "smooth" });
    syncRouteHash();
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

  // Deduplicated rugged I/O interface entries for catalog display (lazy — converter loads after app.js)
  let _ruggedIoCatalogEntries = null;
  function ruggedIoCatalogEntries() {
    if (_ruggedIoCatalogEntries !== null) return _ruggedIoCatalogEntries;
    const converter = globalThis.D38999Converter;
    if (!converter || !converter.RUGGED_IO_FAMILIES) { return []; }
    const seen = new Set();
    const entries = [];
    for (const entry of converter.RUGGED_IO_FAMILIES) {
      if (seen.has(entry.family)) continue;
      seen.add(entry.family);
      entries.push(entry);
    }
    _ruggedIoCatalogEntries = entries;
    return entries;
  }

  // ---- I/O Connectors catalog (rugged USB / RJ45 / HDMI / DisplayPort) ----

  const IO_CATEGORY_ORDER = ["RJ45 / Ethernet", "USB", "USB-C", "HDMI", "DisplayPort", "Other"];

  function ioCategoryFor(entry) {
    const i = String(entry.interface || "").toLowerCase();
    if (i.includes("rj45") || i.includes("ethernet")) return "RJ45 / Ethernet";
    if (i.includes("type-c") || i.includes("usb-c")) return "USB-C";
    if (i.includes("usb")) return "USB";
    if (i.includes("hdmi")) return "HDMI";
    if (i.includes("displayport")) return "DisplayPort";
    return "Other";
  }

  function ioVendorLabel(entry) {
    const v = String(entry.vendor || "").trim();
    if (/glenair/i.test(v)) return "Glenair";
    if (/cinch/i.test(v)) return "Cinch";
    if (/amphenol/i.test(v)) return "Amphenol";
    if (/te |deutsch|connectivity/i.test(v)) return "TE / Deutsch";
    return v || "Other";
  }

  function ioNormToken(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Best-effort join to the richer rugged_io dataset for example part numbers.
  // RUGGED_IO_FAMILIES family tokens that differ from the rich dataset family names.
  const IO_FAMILY_ALIASES = {
    SUPERSEALUSB3: "SUPERSEALUSB30TYPEA",
    SUPERSEALUSB32C: "SUPERSEALUSB32GEN2TYPEC",
    SUPERSEALDP: "SUPERSEALDISPLAYPORT14",
  };

  let _ioRichIndex = null;
  function ioRichIndex() {
    if (_ioRichIndex) return _ioRichIndex;
    _ioRichIndex = new Map();
    const io = toolboxData.ruggedIo || {};
    // Index both the general rugged I/O and the rugged video datasets so HDMI/DP/Mini-DP
    // families also surface example part numbers in the catalog.
    const groups = [
      io.rugged_io_d38999_style_connectors || [],
      io.rugged_video_d38999_style_connectors || [],
    ];
    for (const group of groups) {
      for (const r of group) {
        const key = ioNormToken(r.family);
        if (key && !_ioRichIndex.has(key)) _ioRichIndex.set(key, r);
      }
    }
    return _ioRichIndex;
  }

  function ioRichFor(entry) {
    const token = ioNormToken(entry.family);
    return ioRichIndex().get(token) || ioRichIndex().get(IO_FAMILY_ALIASES[token]) || null;
  }

  function ioInferGender(text) {
    const s = String(text || "").toLowerCase();
    if (!s) return null;
    if (/\b(plug|cordset|cable[- ]?side|male)\b/.test(s)) return "male";
    if (/\b(receptacle|jack|female|jam[- ]?nut|feed[- ]?thru|feedthru|bulkhead|panel[- ]?mount|wall[- ]?mount)\b/.test(s)) return "female";
    return null;
  }

  function ioExamplePns(entry) {
    const rich = ioRichFor(entry);
    if (!rich) return [];
    const verified = (rich.verified_purchasable_pns || []).map((v) => ({ pn: v.pn, description: v.description || "" }));
    const plain = (rich.example_pns || []).map((pn) => ({ pn, description: "" }));
    // Prefer the curated short example list; fall back to verified-purchasable.
    const list = plain.length ? plain : verified;
    // If we have descriptions on the verified list and the plain list lacks gender clues,
    // attach descriptions by PN-match so chip icons can still be inferred.
    const descByPn = new Map(verified.map((v) => [v.pn, v.description]));
    return list.slice(0, 3).map((item) => {
      const desc = item.description || descByPn.get(item.pn) || "";
      return { pn: item.pn, gender: ioInferGender(desc), description: desc };
    });
  }

  function ioGenderGlyph(g) {
    if (g === "female") return `<span class="io-gender io-gender-female" title="Female (receptacle/jack)" aria-label="Female">♀</span>`;
    if (g === "male") return `<span class="io-gender io-gender-male" title="Male (plug)" aria-label="Male">♂</span>`;
    return "";
  }

  // Condense a long interface_gender ordering rule into a short list of the
  // connector variants for the catalog card. The full rule stays in the lightbox.
  function ioGenderSummary(rule, fallback) {
    const s = String(rule || "").toLowerCase();
    if (!s) return fallback || "";
    const hasPlug = /\bplug\b|free connector|cable[- ]?side|cable plug|cordset/.test(s);
    const recepTypes = [];
    if (/square[- ]?flange/.test(s) && !/no square[- ]?flange/.test(s)) recepTypes.push("square-flange");
    if (/jam[- ]?nut/.test(s) && !/no jam[- ]?nut/.test(s)) recepTypes.push("jam-nut");
    if (/wall[- ]?mount/.test(s) && !/no wall[- ]?mount/.test(s)) recepTypes.push("wall-mount");
    const parts = [];
    if (hasPlug) parts.push("plug");
    if (recepTypes.length) {
      parts.push(recepTypes.join(" / ") + (recepTypes.length > 1 ? " receptacles" : " receptacle"));
    } else if (/receptacle|jack/.test(s)) {
      parts.push("panel receptacle");
    }
    if (/feed[- ]?thr(u|ough)/.test(s)) parts.push("feedthrough");
    if (/bulkhead/.test(s)) parts.push("bulkhead");
    return parts.length ? parts.join(", ") : (fallback || "");
  }

  // Friendly labels for the view variants available in FAMILY_SVG_MAP.
  const IO_VIEW_LABELS = {
    face: "face",
    side: "side",
    plug: "plug",
    "jam-nut-receptacle": "jam-nut",
    "wall-mount-receptacle": "wall-mount",
    "square-flange-receptacle": "sq-flange",
    "reduced-flange-receptacle": "red-flange",
    "standoff-receptacle": "standoff",
    "through-bulkhead": "feed-thru",
  };
  const IO_VIEW_ORDER = [
    "face", "side", "plug", "jam-nut-receptacle", "wall-mount-receptacle",
    "square-flange-receptacle", "reduced-flange-receptacle", "standoff-receptacle", "through-bulkhead",
  ];

  // ---- Rugged I/O multi-view helpers (face / side / mount variants) ----

  function ruggedFamilyViewMap(family) {
    const converter = globalThis.D38999Converter;
    const map = converter && converter.FAMILY_SVG_MAP;
    return (map && map[family]) || {};
  }

  function ruggedAvailableViewKeys(family) {
    const svgs = ruggedFamilyViewMap(family);
    return IO_VIEW_ORDER.filter((k) => svgs[k]);
  }

  function ruggedViewLabel(key) {
    return IO_VIEW_LABELS[key] || key;
  }

  // Map the SVG that recognizeRuggedIo() auto-picked back to a view key so the
  // switcher opens on the same drawing the decoder chose.
  function ruggedDefaultViewKey(decoded) {
    const svgs = ruggedFamilyViewMap(decoded.family);
    const picked = decoded.svg;
    for (const k of IO_VIEW_ORDER) {
      if (svgs[k] && svgs[k] === picked) return k;
    }
    if (svgs.face && decoded.face_svg === svgs.face) return "face";
    const keys = ruggedAvailableViewKeys(decoded.family);
    return keys.includes("face") ? "face" : keys[0] || "face";
  }

  function ruggedViewSwitcherHtml(views, selectedView, attr) {
    if (!views || views.length <= 1) return "";
    const dataAttr = attr || "data-rugged-view";
    return `<div class="rugged-view-switcher" role="tablist" aria-label="${escapeHtml(T("rugged.viewsAria", "Connector views"))}">${views
      .map((k) => `<button type="button" role="tab" class="rugged-view-btn${k === selectedView ? " active" : ""}" aria-selected="${k === selectedView ? "true" : "false"}" ${dataAttr}="${escapeHtml(k)}">${escapeHtml(ruggedViewLabel(k))}</button>`)
      .join("")}</div>`;
  }

  // Builds the main image (selected view) plus the face as a small reference when
  // a non-face view is selected. `family` resolves the SVG set; `altBase` labels it.
  function ruggedViewStageHtml(family, selectedView, altBase) {
    const svgs = ruggedFamilyViewMap(family);
    const mainSvg = svgs[selectedView] || svgs.face;
    const faceSvg = svgs.face;
    const base = escapeHtml(altBase || family);
    if (!mainSvg) {
      return `<div class="rugged-face-placeholder">${escapeHtml(Tf("rugged.faceUnavailable", { family: altBase || family }))}</div>`;
    }
    const showFaceRef = faceSvg && selectedView !== "face";
    const mainFig = `
      <figure class="rugged-view-figure rugged-view-main">
        <img class="rugged-face-img" src="assets/svg/${escapeHtml(mainSvg)}" alt="${base} ${escapeHtml(ruggedViewLabel(selectedView))}"/>
        <figcaption class="rugged-view-figcap">${escapeHtml(ruggedViewLabel(selectedView))}</figcaption>
      </figure>`;
    const refFig = showFaceRef ? `
      <figure class="rugged-view-figure rugged-view-ref">
        <img class="rugged-mount-img" src="assets/svg/${escapeHtml(faceSvg)}" alt="${base} ${escapeHtml(ruggedViewLabel("face"))}"/>
        <figcaption class="rugged-view-figcap">${escapeHtml(ruggedViewLabel("face"))}</figcaption>
      </figure>` : "";
    return `<div class="rugged-face-stage">${mainFig}${refFig}</div>`;
  }

  // ---- Rugged I/O reciprocal (mating) suggestions ----
  // Mating axis for rugged I/O is the shell coupling: a cable "plug" shell mates a
  // panel "receptacle" shell (jam-nut / wall / flange / feed-thru). recognizeRuggedIo()
  // already derives that coupling as `mounting_type`, so we classify from it rather than
  // from vendor description text (Glenair calls some female jacks "plug coupler").

  function ruggedRoleFromMounting(mountingType) {
    const s = String(mountingType || "").toLowerCase();
    if (!s) return "";
    if (s === "plug" || /\bplug\b|drive[- ]?thru|cordset|memory stick|cable/.test(s)) return "plug";
    if (/receptacle|jam[- ]?nut|wall|flange|stand[- ]?off|feed[- ]?thru|bulkhead/.test(s)) return "receptacle";
    return "";
  }

  function ruggedRoleLabel(role) {
    if (role === "plug") return T("rugged.rolePlug", "cable plug");
    if (role === "receptacle") return T("rugged.roleReceptacle", "panel receptacle");
    return T("rugged.roleUnknown", "coupling not auto-detected");
  }

  // Given a recognized rugged-I/O result, returns reciprocal candidates drawn ONLY from
  // catalog PNs (verified → VERIFIED_EXISTS, example → VALID_FORMAT_BUT_NOT_CONFIRMED).
  function ruggedMateCandidatesFor(decoded) {
    const converter = globalThis.D38999Converter;
    if (!decoded?.rugged_io || !converter?.recognizeRuggedIo) return null;

    const family = decoded.family;
    const sourceNorm = normalizedCatalogPartNumber(decoded.part_number || decoded.input || "");
    const sourceRole = ruggedRoleFromMounting(decoded.mounting_type);

    const rich = ioRichFor({ family });
    const warnings = [...(rich?.warnings || [])];
    const intermateNote = /not\s+(d38999|mil-dtl-38999)|does not mate/i.test(String(decoded.d38999_relation || "") + (rich?.warnings || []).join(" "));

    // Gather catalog PNs for the family: verified (high trust) + example (format-valid).
    const seen = new Set();
    const pool = [];
    (rich?.verified_purchasable_pns || []).forEach((v) => {
      if (v && v.pn) pool.push({ pn: v.pn, description: v.description || "", status: "VERIFIED_EXISTS" });
    });
    (rich?.example_pns || []).forEach((pn) => {
      if (pn) pool.push({ pn, description: "", status: "VALID_FORMAT_BUT_NOT_CONFIRMED" });
    });

    const candidates = [];
    for (const item of pool) {
      const norm = normalizedCatalogPartNumber(item.pn);
      if (!norm || norm === sourceNorm || seen.has(norm)) continue;
      const rec = converter.recognizeRuggedIo(item.pn);
      if (!rec.recognized || rec.family !== family) continue;
      const role = ruggedRoleFromMounting(rec.mounting_type);
      if (!role) continue;
      // Keep opposite-coupling members; if the source coupling is unknown, surface both.
      if (sourceRole && role === sourceRole) continue;
      seen.add(norm);
      candidates.push({
        partNumber: item.pn,
        description: item.description || rec.d38999_relation || "",
        role,
        roleLabel: ruggedRoleLabel(role),
        mountingType: rec.mounting_type || "",
        interface: rec.interface || decoded.interface,
        shellSize: rec.shell_size || decoded.shell_size,
        family,
        status: item.status,
        sources: rich?.sources || [],
        recognized: rec,
      });
    }

    // Rank: verified first, then opposite-role match certainty, then PN.
    candidates.sort((a, b) => {
      if (a.status !== b.status) return a.status === "VERIFIED_EXISTS" ? -1 : 1;
      return naturalCompare(a.partNumber, b.partNumber);
    });

    return {
      recognized: true,
      family,
      interface: decoded.interface,
      shellSize: decoded.shell_size,
      vendor: decoded.vendor,
      sourceRole,
      sourceRoleLabel: ruggedRoleLabel(sourceRole),
      candidates: candidates.slice(0, 12),
      selectionQuestions: rich?.selection_questions || [],
      warnings,
      notIntermateable: intermateNote,
    };
  }

  function filteredIoConnectors() {
    const category = els.ioCategoryFilter ? els.ioCategoryFilter.value : "";
    const vendor = els.ioVendorFilter ? els.ioVendorFilter.value : "";
    const shell = els.ioShellFilter ? els.ioShellFilter.value : "";
    const text = els.ioSearch ? els.ioSearch.value.trim().toLowerCase() : "";
    return ruggedIoCatalogEntries().filter((entry) => {
      if (category && ioCategoryFor(entry) !== category) return false;
      if (vendor && ioVendorLabel(entry) !== vendor) return false;
      if (shell && entry.shellSize !== shell) return false;
      if (text) {
        const hay = `${entry.family} ${entry.interface} ${entry.vendor} ${entry.relation}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
  }

  function buildIoCard(entry) {
    const card = document.createElement("div");
    card.className = "catalog-card catalog-card-rugged-io";
    const svgContent = entry.svg
      ? `<img src="assets/svg/${entry.svg}" alt="${escapeHtml(entry.family)} face" class="catalog-face-img"/>`
      : `<div class="catalog-face-placeholder"><span>${escapeHtml(entry.family)}</span></div>`;
    const vendorLabel = ioVendorLabel(entry);
    const examples = ioExamplePns(entry);
    const exampleHtml = examples.length
      ? `<div class="io-example-row">${examples
          .map((ex) => `<button type="button" class="io-pn-chip" data-io-pn="${escapeHtml(ex.pn)}"${ex.description ? ` title="${escapeHtml(ex.description)}"` : ""}>${ioGenderGlyph(ex.gender)}${escapeHtml(ex.pn)}</button>`)
          .join("")}</div>`
      : "";
    const rich = ioRichFor(entry);
    const genderRule = rich && rich.interface_gender ? rich.interface_gender : "";
    const genderSummary = ioGenderSummary(genderRule, entry.gender);
    const genderHtml = genderSummary
      ? `<div class="io-gender-rule"${genderRule ? ` title="${escapeHtml(genderRule)}"` : ""}>${escapeHtml(genderSummary)}</div>`
      : "";
    const viewKeys = ruggedAvailableViewKeys(entry.family);
    const hasViewer = viewKeys.length > 0 || Boolean(entry.svg);
    const viewsHtml = viewKeys.length > 1
      ? `<div class="io-views-row"><span class="io-views-label">${escapeHtml(T("io.views"))}</span>${viewKeys
          .map((k) => `<button type="button" class="io-view-tag" data-io-view="${escapeHtml(k)}" title="${escapeHtml(Tf("io.viewOpen", { view: ruggedViewLabel(k) }))}">${escapeHtml(ruggedViewLabel(k))}</button>`)
          .join("")}</div>`
      : "";
    card.innerHTML = `
      <div class="catalog-card-svg catalog-card-svg-face${hasViewer ? " io-face-clickable" : ""}"${hasViewer ? ` title="${escapeHtml(T("io.viewOpenDefault", "View drawings"))}"` : ""}>
        ${svgContent}
      </div>
      <div class="catalog-card-body">
        <div class="catalog-card-id">${escapeHtml(entry.family)}</div>
        <div class="catalog-card-meta">
          <span>${escapeHtml(entry.interface)}</span>
          <span>${escapeHtml(T("card.shell"))} ${escapeHtml(entry.shellSize)}</span>
        </div>
        <div class="catalog-card-meta" style="margin-top:2px">
          <span class="rugged-io-badge${vendorLabel === "Glenair" ? " glenair-badge" : ""}">${escapeHtml(vendorLabel)}</span>
        </div>
        ${genderHtml}
        ${exampleHtml}
        ${viewsHtml}
        <div class="catalog-card-footer">
          <span class="catalog-service">${escapeHtml(entry.vendor)}</span>
        </div>
      </div>
    `;
    card.addEventListener("click", (event) => {
      const viewBtn = event.target.closest("[data-io-view]");
      if (viewBtn) {
        openIoLightbox(entry, viewBtn.dataset.ioView);
        return;
      }
      if (hasViewer && event.target.closest(".catalog-card-svg-face")) {
        openIoLightbox(entry);
        return;
      }
      const chip = event.target.closest("[data-io-pn]");
      const pn = chip ? chip.dataset.ioPn : entry.prefix;
      els.partNumberInput.value = pn;
      els.decodeButton.click();
      selectTab("decoder");
    });
    return card;
  }

  // ---- I/O connector view lightbox (face / side / mount variants) ----

  function openIoLightbox(entry, initialView) {
    closeLightbox();
    const family = entry.family;
    const views = ruggedAvailableViewKeys(family);
    const fallbackImg = entry.svg || "";
    let current = views.includes(initialView)
      ? initialView
      : (views.includes("face") ? "face" : views[0] || "");

    const examples = ioExamplePns(entry);
    const rich = ioRichFor(entry);
    const genderRule = rich && rich.interface_gender ? rich.interface_gender : (entry.gender || "");
    const vendorLabel = ioVendorLabel(entry);

    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay io-lightbox-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${family} views`);

    function stageHtml() {
      if (views.length) return ruggedViewStageHtml(family, current, family);
      if (fallbackImg) {
        return `<div class="rugged-face-stage"><figure class="rugged-view-figure rugged-view-main"><img class="rugged-face-img" src="assets/svg/${escapeHtml(fallbackImg)}" alt="${escapeHtml(family)}"/></figure></div>`;
      }
      return `<div class="rugged-face-placeholder">${escapeHtml(Tf("rugged.faceUnavailable", { family }))}</div>`;
    }

    function render() {
      overlay.innerHTML = `
        <div class="lightbox-card io-lightbox-card" role="document">
          <div class="lightbox-svg-pane io-lightbox-stage-pane">
            ${ruggedViewSwitcherHtml(views, current)}
            ${stageHtml()}
          </div>
          <div class="lightbox-info-pane io-lightbox-info">
            <div class="lightbox-header">
              <div class="lightbox-id">${escapeHtml(family)}</div>
              <button type="button" class="lightbox-close" aria-label="${escapeHtml(T("common.close"))}">✕</button>
            </div>
            <div class="io-lightbox-meta">
              <div><span class="io-lb-label">${escapeHtml(T("rugged.vendor"))}</span> <span>${escapeHtml(vendorLabel)}</span></div>
              <div><span class="io-lb-label">${escapeHtml(T("rugged.interface"))}</span> <span>${escapeHtml(entry.interface)}</span></div>
              <div><span class="io-lb-label">${escapeHtml(T("card.shell"))}</span> <span>${escapeHtml(entry.shellSize)}</span></div>
              ${genderRule ? `<div><span class="io-lb-label">${escapeHtml(T("rugged.interfaceGender"))}</span> <span>${escapeHtml(genderRule)}</span></div>` : ""}
            </div>
            ${examples.length ? `<div class="io-example-row">${examples
              .map((ex) => `<button type="button" class="io-pn-chip" data-io-pn="${escapeHtml(ex.pn)}"${ex.description ? ` title="${escapeHtml(ex.description)}"` : ""}>${ioGenderGlyph(ex.gender)}${escapeHtml(ex.pn)}</button>`)
              .join("")}</div>` : ""}
            <div class="lightbox-actions">
              <button type="button" class="lightbox-primary-btn" data-io-open-decoder>${escapeHtml(T("lightbox.openDecoder"))}</button>
            </div>
          </div>
        </div>
      `;
      overlay.querySelectorAll("[data-rugged-view]").forEach((btn) => {
        btn.addEventListener("click", () => { current = btn.dataset.ruggedView; render(); });
      });
    }
    render();

    function decodeAndClose(pn) {
      closeLightbox();
      els.partNumberInput.value = pn;
      els.decodeButton.click();
      selectTab("decoder");
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest(".lightbox-close")) {
        closeLightbox();
        return;
      }
      const pnChip = event.target.closest("[data-io-pn]");
      if (pnChip) { decodeAndClose(pnChip.dataset.ioPn); return; }
      if (event.target.closest("[data-io-open-decoder]")) { decodeAndClose(entry.prefix); }
    });
    overlay._escHandler = (event) => { if (event.key === "Escape") closeLightbox(); };
    document.addEventListener("keydown", overlay._escHandler);

    document.body.appendChild(overlay);
    state.lightboxOpen = true;
  }

  let _ioFiltersPopulated = false;
  function populateIoFilters() {
    if (_ioFiltersPopulated) return;
    const entries = ruggedIoCatalogEntries();
    if (!entries.length) return;
    if (els.ioCategoryFilter) {
      const cats = IO_CATEGORY_ORDER.filter((c) => entries.some((e) => ioCategoryFor(e) === c));
      fillSelect(els.ioCategoryFilter, [["", T("io.allInterfaces")], ...cats.map((c) => [c, c])]);
    }
    if (els.ioVendorFilter) {
      const vendors = Array.from(new Set(entries.map(ioVendorLabel))).sort();
      fillSelect(els.ioVendorFilter, [["", T("io.allVendors")], ...vendors.map((v) => [v, v])]);
    }
    if (els.ioShellFilter) {
      const shells = Array.from(new Set(entries.map((e) => e.shellSize))).sort((a, b) => Number(a) - Number(b));
      fillSelect(els.ioShellFilter, [["", T("common.any")], ...shells.map((s) => [s, Tf("rugged.shellCaption", { size: s })])]);
    }
    _ioFiltersPopulated = true;
  }

  function clearIoFilters() {
    if (els.ioCategoryFilter) els.ioCategoryFilter.value = "";
    if (els.ioVendorFilter) els.ioVendorFilter.value = "";
    if (els.ioShellFilter) els.ioShellFilter.value = "";
    if (els.ioSearch) els.ioSearch.value = "";
    renderIoCatalog();
  }

  function renderIoCatalog() {
    populateIoFilters();
    if (!els.ioGrid) return;
    const entries = filteredIoConnectors();
    const totalAll = ruggedIoCatalogEntries().length;
    if (els.ioCount) {
      els.ioCount.textContent = entries.length === totalAll
        ? Tf("io.countAll", { total: totalAll })
        : Tf("io.countFiltered", { shown: entries.length, total: totalAll });
    }
    els.ioGrid.innerHTML = "";
    if (!entries.length) {
      els.ioGrid.innerHTML = `<div class="catalog-empty">${escapeHtml(T("io.empty"))}<button type="button" class="io-clear-inline-btn">${escapeHtml(T("common.clearFilters"))}</button></div>`;
      return;
    }
    // Group cards by interface category with section headings.
    const byCategory = new Map();
    for (const entry of entries) {
      const cat = ioCategoryFor(entry);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(entry);
    }
    for (const cat of IO_CATEGORY_ORDER) {
      const group = byCategory.get(cat);
      if (!group || !group.length) continue;
      const heading = document.createElement("div");
      heading.className = "catalog-section-heading";
      heading.textContent = cat;
      els.ioGrid.appendChild(heading);
      for (const entry of group) {
        els.ioGrid.appendChild(buildIoCard(entry));
      }
    }
  }

  function renderCatalog() {
    const filtered = filteredArrangements();
    const sorted = sortedCatalog(filtered);

    // Update count badge
    const totalCount = filtered.length;
    const totalAll = arrangements.length;
    if (els.catalogCount) {
      els.catalogCount.textContent = totalCount === totalAll
        ? Tf("catalog.countAll", { total: totalAll })
        : Tf("catalog.countFiltered", { shown: totalCount, total: totalAll });
    }

    if (!els.catalogGrid) return;
    els.catalogGrid.innerHTML = "";

    if (!sorted.length) {
      // Use event delegation on the grid to avoid accumulating listeners on re-render
      els.catalogGrid.innerHTML = `<div class="catalog-empty">${escapeHtml(T("catalog.empty"))}<button type="button" class="clear-filters-inline-btn">${escapeHtml(T("common.clearFilters"))}</button></div>`;
      return;
    }

    // Standard insert arrangement cards
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
      <div class="catalog-card-svg" title="${escapeHtml(T("card.enlarge"))}">
        <svg class="mini-connector-svg catalog-mini-svg" viewBox="${viewBox.join(" ")}" xmlns="http://www.w3.org/2000/svg" aria-label="Arrangement ${escapeHtml(arr.id)}">${svgMarkup}</svg>
      </div>
      <div class="catalog-card-body">
        <div class="catalog-card-id mono">${escapeHtml(arr.id)}</div>
        <div class="catalog-card-meta">
          <span>${escapeHtml(Tf("card.contacts", { count: arr.contact_count }))}</span>
          <span>${escapeHtml(T("card.shell"))} ${escapeHtml(arr.shell_size)}</span>
        </div>
        <div class="catalog-size-pills">${sizePills}</div>
        <div class="catalog-card-footer">
          <span class="catalog-service">${escapeHtml(T("card.svc"))} ${escapeHtml(arr.service_rating || "?")}</span>
          <button type="button" class="catalog-open-btn">${escapeHtml(T("card.openDecoder"))}</button>
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
            <button type="button" class="lightbox-close" aria-label="${escapeHtml(T("common.close"))}">✕</button>
          </div>
          <div class="lightbox-stat-grid">
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">${escapeHtml(T("common.contacts"))}</div>
              <div class="lightbox-stat-value">${arr.contact_count}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">${escapeHtml(T("card.shell"))}</div>
              <div class="lightbox-stat-value">${escapeHtml(arr.shell_size)}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">${escapeHtml(T("lightbox.service"))}</div>
              <div class="lightbox-stat-value">${escapeHtml(arr.service_rating || "—")}</div>
            </div>
            <div class="lightbox-stat">
              <div class="lightbox-stat-label">${escapeHtml(T("lightbox.sourcePage"))}</div>
              <div class="lightbox-stat-value">${arr.source_page || "—"}</div>
            </div>
          </div>
          <div class="lightbox-pills">${sizePills}</div>
          <div class="lightbox-actions">
            <button type="button" class="lightbox-primary-btn">${escapeHtml(T("lightbox.openDecoder"))}</button>
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
    return (arr.contact_size_notes || []).map((note) => `${note.count}x #${note.size}`).join(", ") || T("size.unknown");
  }

  function contactCurrentForSize(sizeToken) {
    if (!sizeToken) return null;
    const key = String(sizeToken).trim();
    let entry = contactCurrentBySize.get(key);
    if (!entry) {
      const base = key.split(/\s+/)[0];
      if (/coax|twinax/i.test(key)) return null;
      entry = contactCurrentBySize.get(base);
    }
    return entry && typeof entry.current_amps === "number" ? entry.current_amps : null;
  }

  function arrangementMaxCurrent(arr) {
    let best = 0;
    (arr.contact_size_notes || []).forEach((note) => {
      const amps = contactCurrentForSize(note.size);
      if (typeof amps === "number" && amps > best) best = amps;
    });
    return best;
  }

  function arrangementMeetsCurrent(arr, threshold) {
    if (!threshold) return true;
    return arrangementMaxCurrent(arr) >= threshold;
  }

  function buildCurrentThresholds() {
    const amps = new Set();
    arrangements.forEach((arr) => {
      (arr.contact_size_notes || []).forEach((note) => {
        const value = contactCurrentForSize(note.size);
        if (typeof value === "number" && value > 0) amps.add(value);
      });
    });
    return [...amps].sort((a, b) => a - b);
  }

  function currentFilterLabel(amps) {
    if (!amps) return "Any";
    return `≥ ${formatCurrentAmps(amps)} A`;
  }

  function formatCurrentAmps(amps) {
    return Number.isInteger(amps) ? String(amps) : String(amps);
  }

  function currentCapacitySummary(arr) {
    if (!arr) return "";
    const rated = (arr.contact_size_notes || [])
      .map((note) => ({ note, amps: contactCurrentForSize(note.size) }))
      .filter((item) => typeof item.amps === "number" && item.amps > 0);
    if (!rated.length) return "RF / data contacts only (no power rating)";
    const max = Math.max(...rated.map((item) => item.amps));
    const parts = rated
      .sort((a, b) => b.amps - a.amps)
      .map((item) => `#${item.note.size} = ${formatCurrentAmps(item.amps)} A`);
    return `up to ${formatCurrentAmps(max)} A/contact (${parts.join(", ")})`;
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
    els.selectedStatus.textContent = Tf("status.selected", { id: arrangement.id, count: arrangement.contact_count });
    els.selectedStatus.hidden = false;
    // Update active highlight in catalog grid without full re-render
    document.querySelectorAll(".catalog-card").forEach((card) => {
      const idEl = card.querySelector(".catalog-card-id");
      const isActive = idEl && idEl.textContent === arrangement.id;
      card.classList.toggle("active", isActive);
    });
    syncRouteHash();
  }

  function renderSourceInfo() {
    const arr = state.selectedArrangement;
    if (!arr) return;
    els.viewerTitle.textContent = Tf("viewer.insertArrangementTitle", { id: arr.id });
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

  // Fit a viewBox to the *rendered* connector content (geometry bounds via
  // getBBox), independent of the current pan/zoom. Used for export/report so
  // wide mount hardware that overflows the fixed base viewBox is never clipped.
  function connectorContentViewBox(liveSvg, fallback) {
    if (!liveSvg) return fallback;
    let box;
    try {
      box = liveSvg.getBBox();
    } catch (e) {
      return fallback;
    }
    if (!box || !(box.width > 0) || !(box.height > 0)) return fallback;
    const margin = Math.max(Math.max(box.width, box.height) * 0.05, 4);
    return [box.x - margin, box.y - margin, box.width + margin * 2, box.height + margin * 2];
  }

  // Maps a MIL-DTL-38999 class/finish letter to a shell-color key consumed by
  // [data-finish] in styles.css. Defaults to olive drab (the signature finish).
  const FINISH_KEY_BY_CLASS = {
    W: "od", B: "od", J: "od",
    Z: "gun",
    T: "grey",
    C: "anod",
    A: "cad", U: "cad",
    F: "nik", G: "nik", N: "nik", S: "nik", L: "nik", R: "nik", M: "nik",
    H: "nik", K: "nik", Y: "nik", E: "nik", P: "nik", D: "nik", V: "nik",
    AA: "nik", AB: "nik",
  };

  function finishKeyFromClass(classField) {
    if (!classField) return "od";
    const code = String(classField).replace(/-$/, "").toUpperCase();
    return FINISH_KEY_BY_CLASS[code] || "od";
  }

  function renderViewer() {
    const arr = state.selectedArrangement;
    if (!arr) return;
    clearRuggedIoViewer();
    const svg = els.connectorSvg;
    svg.innerHTML = "";
    svg.setAttribute("class", "connector-svg");
    const decodedFinish = state.decoded?.ok && state.decoded.arrangement_id === arr.id
      ? state.decoded.class_field
      : null;
    svg.dataset.finish = finishKeyFromClass(decodedFinish);
    svg.dataset.view = state.viewMode;
    svg.setAttribute("viewBox", (state.viewBox || connectorBaseViewBox(arr)).join(" "));

    // Sprint B: subtle radial gradient for the shell fill. Inlined as <defs>
    // so it survives cloning into the printable report popup. The real-view
    // gold-contact and metal-sheen gradients live here too.
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <radialGradient id="sbShellGradient" cx="50%" cy="38%" r="65%">
        <stop class="sb-shell-stop-0" offset="0%" stop-color="rgba(255,255,255,0.85)"/>
        <stop class="sb-shell-stop-1" offset="60%" stop-color="rgba(241,245,249,1)"/>
        <stop class="sb-shell-stop-2" offset="100%" stop-color="rgba(214,222,233,1)"/>
      </radialGradient>
      <radialGradient id="contactGoldGrad" cx="38%" cy="32%" r="72%">
        <stop offset="0%" stop-color="#E8CE86"/>
        <stop offset="58%" stop-color="#C19A3F"/>
        <stop offset="100%" stop-color="#7C611F"/>
      </radialGradient>
      <radialGradient id="shellSheenGrad" cx="40%" cy="28%" r="78%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.55)"/>
        <stop offset="45%" stop-color="rgba(255,255,255,0.10)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.24)"/>
      </radialGradient>`;
    svg.appendChild(defs);

    const realView = state.viewMode === "real";

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
      shell.appendChild(connectorFaceHardware(arr));
      shell.appendChild(
        svgEl("circle", {
          class: "shell-fill",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 1.04,
        })
      );
      if (realView) {
        shell.appendChild(couplingKnurl(arr));
        shell.appendChild(
          svgEl("circle", {
            class: "shell-sheen",
            cx: arr.outline.center_x,
            cy: arr.outline.center_y,
            r: arr.outline.radius * 1.04,
          })
        );
      }
      shell.appendChild(
        svgEl("circle", {
          class: "insert-face",
          cx: arr.outline.center_x,
          cy: arr.outline.center_y,
          r: arr.outline.radius * 0.9,
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

  function currentShellFaceType(arr) {
    const decoded = state.decoded;
    if (!decoded?.ok || decoded.arrangement_id !== arr.id) return "";
    return SHELL_PROFILE_TYPE[decoded.slash_sheet] || "";
  }

  function shellFaceGeometry(profileType, cx, cy, radius) {
    if (!profileType) return [];

    if (profileType === "wall_receptacle" || profileType === "box_receptacle") {
      const plateWidth = radius * (profileType === "wall_receptacle" ? 2.8 : 2.55);
      const plateHeight = radius * (profileType === "wall_receptacle" ? 2.25 : 2.45);
      const x = cx - plateWidth / 2;
      const y = cy - plateHeight / 2;
      const holeOffsetX = plateWidth * 0.38;
      const holeOffsetY = plateHeight * 0.36;
      const shapes = [
        {
          tag: "rect",
          attrs: {
            class: "mount-flange",
            x,
            y,
            width: plateWidth,
            height: plateHeight,
            rx: radius * (profileType === "wall_receptacle" ? 0.2 : 0.14),
          },
        },
        {
          tag: "rect",
          attrs: {
            class: "mount-flange-inner",
            x: cx - plateWidth * 0.38,
            y: cy - plateHeight * 0.34,
            width: plateWidth * 0.76,
            height: plateHeight * 0.68,
            rx: radius * 0.12,
          },
        },
      ];
      [
        [cx - holeOffsetX, cy - holeOffsetY],
        [cx + holeOffsetX, cy - holeOffsetY],
        [cx - holeOffsetX, cy + holeOffsetY],
        [cx + holeOffsetX, cy + holeOffsetY],
      ].forEach(([hx, hy]) => {
        shapes.push({
          tag: "circle",
          attrs: {
            class: "mount-hole",
            cx: hx,
            cy: hy,
            r: radius * 0.11,
          },
        });
      });
      return shapes;
    }

    if (profileType === "jamnut_receptacle") {
      const outerRadius = radius * 1.34;
      const innerRadius = radius * 1.16;
      const points = [];
      for (let i = 0; i < 12; i += 1) {
        const angle = (-90 + i * 30) * Math.PI / 180;
        const pointRadius = i % 2 === 0 ? outerRadius : outerRadius * 0.92;
        points.push(`${cx + Math.cos(angle) * pointRadius},${cy + Math.sin(angle) * pointRadius}`);
      }
      return [
        {
          tag: "polygon",
          attrs: {
            class: "jamnut-ring",
            points: points.join(" "),
          },
        },
        {
          tag: "circle",
          attrs: {
            class: "jamnut-inner-ring",
            cx,
            cy,
            r: innerRadius,
          },
        },
      ];
    }

    if (profileType === "inline_receptacle") {
      return [
        {
          tag: "circle",
          attrs: {
            class: "inline-face-ring",
            cx,
            cy,
            r: radius * 1.18,
          },
        },
      ];
    }

    return [];
  }

  function appendShellFaceGeometry(group, shapes) {
    shapes.forEach((shape) => {
      group.appendChild(svgEl(shape.tag, shape.attrs));
    });
  }

  function svgAttrValue(value) {
    return typeof value === "number" ? Number(value.toFixed(3)).toString() : String(value);
  }

  function svgShapeMarkup(shape) {
    const attrs = Object.entries(shape.attrs)
      .map(([key, value]) => `${key}="${svgAttrValue(value)}"`)
      .join(" ");
    return `<${shape.tag} ${attrs}></${shape.tag}>`;
  }

  function shellFaceOrientationMarkup(cx, cy, radius) {
    const topY = cy - radius * 1.18;
    const baseY = cy - radius * 0.9;
    const halfWidth = radius * 0.17;
    return `<path class="orientation-marker" d="M ${svgAttrValue(cx)} ${svgAttrValue(topY)} L ${svgAttrValue(cx + halfWidth)} ${svgAttrValue(baseY)} L ${svgAttrValue(cx - halfWidth)} ${svgAttrValue(baseY)} Z"></path>`;
  }

  function plugFaceDetailMarkup(cx, cy, radius) {
    const marks = [];
    for (let i = 0; i < 12; i += 1) {
      const angle = i * 30 * Math.PI / 180;
      const innerRadius = radius * 1.1;
      const outerRadius = radius * 1.26;
      marks.push(`
        <line
          class="plug-coupling-mark"
          x1="${svgAttrValue(cx + Math.cos(angle) * innerRadius)}"
          y1="${svgAttrValue(cy + Math.sin(angle) * innerRadius)}"
          x2="${svgAttrValue(cx + Math.cos(angle) * outerRadius)}"
          y2="${svgAttrValue(cy + Math.sin(angle) * outerRadius)}"
        ></line>
      `);
    }
    return marks.join("");
  }

  function coverFaceDetailMarkup(cx, cy, radius) {
    return `
      <circle class="cover-face" cx="${svgAttrValue(cx)}" cy="${svgAttrValue(cy)}" r="${svgAttrValue(radius * 0.78)}"></circle>
      <circle class="cover-lip" cx="${svgAttrValue(cx)}" cy="${svgAttrValue(cy)}" r="${svgAttrValue(radius * 0.58)}"></circle>
      <path class="cover-lanyard" d="M ${svgAttrValue(cx + radius * 0.64)} ${svgAttrValue(cy - radius * 0.18)} Q ${svgAttrValue(cx + radius * 1.12)} ${svgAttrValue(cy - radius * 0.46)} ${svgAttrValue(cx + radius * 1.16)} ${svgAttrValue(cy + radius * 0.04)}"></path>
    `;
  }

  function shellFacePreviewMarkup(slashSheet) {
    const profileType = SHELL_PROFILE_TYPE[slashSheet] || "";
    if (!profileType) return "";

    const cx = 50;
    const cy = 50;
    const radius = 22;
    const hardware = shellFaceGeometry(profileType, cx, cy, radius)
      .map((shape) => svgShapeMarkup(shape))
      .join("");
    const detail = profileType === "plug"
      ? plugFaceDetailMarkup(cx, cy, radius)
      : profileType === "cover"
        ? coverFaceDetailMarkup(cx, cy, radius)
        : "";

    return `
      <div class="selector-shell-graphic" aria-hidden="true">
        <svg class="connector-svg mini-connector-svg shell-face-preview-svg" viewBox="0 0 100 100">
          <g class="shell-layer">
            <circle class="shell-shadow-ring" cx="${cx}" cy="${cy}" r="${svgAttrValue(radius * 1.08)}"></circle>
            ${hardware}
            <circle class="shell-fill" cx="${cx}" cy="${cy}" r="${svgAttrValue(radius * 1.04)}"></circle>
            <circle class="shell" cx="${cx}" cy="${cy}" r="${radius}"></circle>
            <circle class="insert-boundary" cx="${cx}" cy="${cy}" r="${svgAttrValue(radius * 0.88)}"></circle>
            <circle class="shell-face-ring" cx="${cx}" cy="${cy}" r="${svgAttrValue(radius * 0.93)}"></circle>
            ${detail}
            ${shellFaceOrientationMarkup(cx, cy, radius)}
          </g>
        </svg>
      </div>
    `;
  }

  function connectorFaceHardware(arr) {
    const outline = arr.outline;
    const profileType = currentShellFaceType(arr);
    const group = svgEl("g", { class: `mount-hardware mount-${profileType || "none"}` });
    if (!outline || !profileType) return group;

    const cx = outline.center_x;
    const cy = outline.center_y;
    const radius = outline.radius;

    appendShellFaceGeometry(group, shellFaceGeometry(profileType, cx, cy, radius));

    return group;
  }

  function shouldRenderLabel(contact) {
    if (!labelsAreOn()) return false;
    return true;
  }

  function labelsAreOn() {
    const el = els.labelsToggle;
    if (!el) return false;
    if (el.dataset && typeof el.dataset.state === "string") return el.dataset.state === "on";
    return el.value === "on" || el.value === "all";
  }

  function togglePinLabels() {
    const el = els.labelsToggle;
    if (!el) return;
    const next = labelsAreOn() ? "off" : "on";
    el.dataset.state = next;
    el.setAttribute("aria-checked", next === "on" ? "true" : "false");
    renderViewer();
  }

  function reflectViewModeButtons() {
    const isReal = state.viewMode === "real";
    if (els.viewModeEngBtn) els.viewModeEngBtn.setAttribute("aria-pressed", isReal ? "false" : "true");
    if (els.viewModeRealBtn) els.viewModeRealBtn.setAttribute("aria-pressed", isReal ? "true" : "false");
  }

  function initViewMode() {
    let saved = null;
    try { saved = localStorage.getItem("d38999.viewMode"); } catch (e) { /* ignore */ }
    state.viewMode = saved === "real" ? "real" : "engineering";
    reflectViewModeButtons();
  }

  function setViewMode(mode) {
    const next = mode === "real" ? "real" : "engineering";
    if (state.viewMode === next) return;
    state.viewMode = next;
    try { localStorage.setItem("d38999.viewMode", next); } catch (e) { /* storage unavailable */ }
    reflectViewModeButtons();
    renderViewer();
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
      "22d": 0.50,
      "20": 0.74,
      "16": 1.04,
      "12": 1.34,
      "10": 1.66,
      "8": 2.05,
      unknown: 0.92,
    }[gaugeToken(contact)] || 0.92;
    return Math.max(0.5, base * scale);
  }

  function appendContactSymbol(group, contact, radius) {
    const token = gaugeToken(contact);
    if (state.viewMode === "real") {
      // True-color contacts: gold pads (copper alloy, gold plate per M39029),
      // with a dark bore for the size-8 coax/power contacts.
      group.appendChild(svgEl("circle", { class: "pin-symbol pin-contact-real", cx: contact.x, cy: contact.y, r: radius }));
      if (token === "8") {
        group.appendChild(svgEl("circle", { class: "pin-contact-bore", cx: contact.x, cy: contact.y, r: radius * 0.42 }));
      }
      return;
    }
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

  function couplingKnurl(arr) {
    const o = arr.outline;
    const group = svgEl("g", { class: "coupling-knurl" });
    const r1 = o.radius * 1.04;
    const r2 = o.radius * 0.96;
    for (let a = 0; a < 360; a += 7.5) {
      const rad = (a * Math.PI) / 180;
      group.appendChild(svgEl("line", {
        class: "knurl-tick",
        x1: o.center_x + r1 * Math.cos(rad),
        y1: o.center_y + r1 * Math.sin(rad),
        x2: o.center_x + r2 * Math.cos(rad),
        y2: o.center_y + r2 * Math.sin(rad),
      }));
    }
    return group;
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
    if (n <= 5) factor = 0.068;
    else if (n <= 30) factor = 0.052;
    else if (n <= 80) factor = 0.040;
    else factor = 0.032;
    const radius = outlineRadius * factor;
    return Math.max(Math.max(0.6, outlineRadius * 0.023), Math.min(Math.min(3.2, outlineRadius * 0.10), radius));
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
      els.pinDetailHeader.textContent = T("decoder.selectPin");
      return;
    }
    const source = labelSource(contact);
    els.pinDetailHeader.innerHTML = `
      <div>${escapeHtml(T("common.pin"))} <strong>${escapeHtml(contact.label)}</strong></div>
      <div>${escapeHtml(T("pin.contact"))} #${escapeHtml(contact.size)} | ${escapeHtml(contact.type)} | ${escapeHtml(contact.confidence)}</div>
      <div>${escapeHtml(T("pin.labelSource"))} ${escapeHtml(source)}</div>
      ${contact.extracted_label ? `<div>${escapeHtml(T("pin.correctedLabel"))} ${escapeHtml(contact.extracted_label)}</div>` : ""}
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
      setMessage(els.searchMessage, Tf("search.matches", { count: matches.length, mode: matchMode }));
    } else {
      setMessage(els.searchMessage, T("search.notFound"), true);
      renderViewer();
    }
  }

  function decodeFromInput(options = {}) {
    if (options.automatic && state._sprintAPasteIncoming) return;
    const partNumber = normalizePartNumber(els.partNumberInput.value);
    state.currentPartNumber = partNumber;
    const decoded = decodePartNumber(partNumber);
    if (options.automatic && !decoded.ok && isIncompletePartNumber(partNumber)) {
      setMessage(els.decodeMessage, T("decode.hint"));
      return;
    }
    if (decoded.ok) {
      clearSmartSuggestion();
    } else {
      const raw = String(els.partNumberInput.value || "").trim();
      const looksLikeMfn = raw.length >= 6 && !/^D38999/i.test(raw) && !/^\//.test(raw);
      const allowSmart = !options.skipSmart && (!options.automatic || looksLikeMfn) && !isIncompletePartNumber(partNumber);
      if (allowSmart) {
        const candidates = reverseConvertSafe(raw);
        if (candidates.length) {
          renderSmartSuggestion(raw, candidates);
          setMessage(els.decodeMessage, T("decode.smartTitle"));
          return;
        }
      }
      clearSmartSuggestion();
    }
    state.decoded = decoded;
    renderDecoded(decoded);
    renderPartNumberGuide(decoded);
    if (state.buildRendered) renderBuildConnector();
    if (state.manualRendered) renderManual();
    if (state.activeTab === "mating") renderMatingPanel();
    if (!decoded.ok) {
      setMessage(els.decodeMessage, decoded.message, true);
      return;
    }
    pushRecentPartNumber(decoded.part_number);
    rememberLastPartNumber(decoded.part_number);
    syncRouteHash();
    if (decoded.rugged_io) {
      renderRuggedIoViewer(decoded);
      setMessage(els.decodeMessage, Tf("decode.recognizedRugged", { family: decoded.family, type: decoded.connector_type }));
      return;
    }
    if (!options.automatic && els.partNumberInput.value !== decoded.part_number) {
      els.partNumberInput.value = decoded.part_number;
    }
    const defaultNote = decoded.polarization_defaulted
      ? T("decode.defaultKeyingNote")
      : "";
    const arr = arrangementById(decoded.arrangement_id);
    if (arr) {
      selectArrangement(arr, true);
      setMessage(els.decodeMessage, Tf("decode.decoded", { pn: decoded.part_number }) + defaultNote);
    } else {
      setMessage(els.decodeMessage, Tf("decode.decodedNoArr", { pn: decoded.part_number, id: decoded.arrangement_id }) + defaultNote, "warn");
    }
  }

  function decodePartNumber(partNumber) {
    if (!partNumber) return { ok: false, message: T("decode.enterPn") };

    // Check for D38999-style rugged I/O families (RJFTV, USBFTV, USB3FTV, USB3CFTV, HDMIFTV, MDPFTV)
    const converter = globalThis.D38999Converter;
    if (converter && converter.recognizeRuggedIo) {
      const ruggedResult = converter.recognizeRuggedIo(partNumber);
      if (ruggedResult.recognized) {
        return {
          ok: true,
          rugged_io: true,
          part_number: partNumber,
          entered_part_number: partNumber,
          family: ruggedResult.family,
          vendor: ruggedResult.vendor,
          interface: ruggedResult.interface,
          interface_gender: ruggedResult.interface_gender,
          shell_size: ruggedResult.shell_size,
          d38999_relation: ruggedResult.d38999_relation,
          connector_type: ruggedResult.connector_type,
          mounting_type: ruggedResult.mounting_type,
          svg: ruggedResult.svg,
          face_svg: ruggedResult.face_svg,
          suffix: ruggedResult.suffix,
          note: ruggedResult.note,
          arrangement_exists: false,
          polarization_defaulted: false,
        };
      }
    }

    const prefix = /^D38999\/(\d{2})(.+)$/.exec(partNumber);
    if (!prefix) return { ok: false, message: T("decode.onlyShellType") };
    const slashSheet = `/${prefix[1]}`;
    const body = prefix[2];
    if (body.length < 4) return { ok: false, message: T("decode.tooShort") };

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
      return { ok: false, message: T("decode.cannotSplit") };
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
    if (!buildManualSelectorTree.cache) buildManualSelectorTree.cache = new Map();
    const cacheKey = `${state.buildEnvironmentFilter || "__all__"}|i${state.buildCurrentFilter || 0}`;
    const cached = buildManualSelectorTree.cache.get(cacheKey);
    if (cached) return cached;

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
          if (!arrangementMeetsCurrent(arr, state.buildCurrentFilter)) return;

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

                const exactPart = validPartNumberMap.get(normalizedCatalogPartNumber(candidate.part_number));
                if (!exactPart) return;
                if (!partFitsEnvironment(exactPart, state.buildEnvironmentFilter)) return;

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
              });
            });
          });
        });
      });
    });

    const tree = {
      root,
      fieldValues: Object.fromEntries(
        Object.entries(fieldValues).map(([field, values]) => [field, sortSelectorValues(field, [...values])])
      ),
    };
    buildManualSelectorTree.cache.set(cacheKey, tree);
    return tree;
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

    if (decoded.rugged_io) {
      renderRuggedMatingPanel(panel, decoded);
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
        ${matingSourceCard(decoded, selectedOpt?.candidatePartNumber || "")}
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

  // ---- Rugged I/O mating panel ----

  function matingWarnRow(text) {
    return `
      <div class="mating-warn">
        <svg class="mating-warn-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 7v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.55" fill="currentColor"/></svg>
        <span>${escapeHtml(text)}</span>
      </div>`;
  }

  function ruggedMatingCardStageHtml(family, recognized) {
    if (ruggedAvailableViewKeys(family).length) {
      return ruggedViewStageHtml(family, ruggedDefaultViewKey(recognized), family);
    }
    const svg = recognized?.svg || recognized?.face_svg;
    return svg
      ? `<div class="rugged-face-stage"><figure class="rugged-view-figure rugged-view-main"><img class="rugged-face-img" src="assets/svg/${escapeHtml(svg)}" alt="${escapeHtml(family || "")}"/></figure></div>`
      : "";
  }

  function ruggedMatingSourceCard(decoded, result) {
    const stage = ruggedMatingCardStageHtml(decoded.family, decoded);
    return `
      <div class="mating-source-card">
        <div class="mating-source-header">
          <span class="mating-source-label">Decoded Connector</span>
          <span class="mating-source-pn mono">${escapeHtml(decoded.part_number || decoded.entered_part_number || "")}</span>
        </div>
        <div class="mating-source-body">
          ${stage ? `<div class="mating-source-svg">${stage}</div>` : ""}
          <div class="mating-source-chips">
            ${optionChip(decoded.family || "—", "family", decoded.vendor || "")}
            ${optionChip(decoded.interface || "—", "interface", decoded.interface_gender || "")}
            ${decoded.shell_size ? optionChip(`size ${decoded.shell_size}`, "shell size", "") : ""}
            ${optionChip(result?.sourceRoleLabel || ruggedRoleLabel(""), "coupling", decoded.mounting_type || "")}
          </div>
          ${decoded.d38999_relation ? `<div class="detail-item"><div class="label">D38999 relation</div><div class="value">${escapeHtml(decoded.d38999_relation)}</div></div>` : ""}
        </div>
      </div>`;
  }

  function ruggedMatingMateCard(c) {
    const stage = ruggedMatingCardStageHtml(c.family, c.recognized);
    return `
      <div class="mating-source-card">
        <div class="mating-source-header">
          <span class="mating-source-label">Mating Connector</span>
          <span class="mating-source-pn mono">${escapeHtml(c.partNumber)}</span>
        </div>
        <div class="mating-source-body">
          ${stage ? `<div class="mating-source-svg">${stage}</div>` : ""}
          ${validationBadgeHtml(c.status)}
          <div class="mating-source-chips">
            ${optionChip(c.family || "—", "family", "")}
            ${optionChip(c.interface || "—", "interface", "")}
            ${c.shellSize ? optionChip(`size ${c.shellSize}`, "shell size", "") : ""}
            ${optionChip(c.roleLabel, "coupling", c.mountingType || "")}
          </div>
          ${c.description ? `<div class="detail-item"><div class="label">Description</div><div class="value">${escapeHtml(c.description)}</div></div>` : ""}
          <div class="mating-option-actions">
            <button type="button" class="mating-decode-btn" data-mating-pn="${escapeHtml(c.partNumber)}">Open in Decoder →</button>
          </div>
        </div>
      </div>`;
  }

  function renderRuggedMatingPanel(panel, decoded) {
    const result = ruggedMateCandidatesFor(decoded);
    const warningsHtml = (result?.warnings || []).map(matingWarnRow).join("");
    const intermateHtml = result?.notIntermateable
      ? matingWarnRow("This family does not intermate with standard MIL-DTL-38999 Series III connectors — its reciprocal is another connector of the same family.")
      : "";
    const sqHtml = (result?.selectionQuestions || []).length
      ? `<div class="mating-hermetic-note"><strong>Before you choose</strong><ul>${result.selectionQuestions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
      : "";

    if (!result || !result.candidates.length) {
      const wanted = result?.sourceRole === "plug" ? "panel receptacle" : "cable plug";
      panel.innerHTML = `
        ${warningsHtml}${intermateHtml}
        ${ruggedMatingSourceCard(decoded, result)}
        <div class="mating-hermetic-note">
          <strong>No catalog-backed reciprocal found</strong>
          <p>No opposite-coupling part number for the ${escapeHtml(decoded.family || "this")} family is loaded in the dataset. Check the manufacturer catalog for the mating ${escapeHtml(wanted)}.</p>
        </div>
        ${sqHtml}
      `;
      return;
    }

    if (!state.selectedMateSheet || !result.candidates.some((c) => c.partNumber === state.selectedMateSheet)) {
      state.selectedMateSheet = result.candidates[0].partNumber;
    }
    const selected = result.candidates.find((c) => c.partNumber === state.selectedMateSheet) || result.candidates[0];

    const selectorHtml = result.candidates.length > 1 ? `
      <div class="mating-selector">
        ${result.candidates.map((c) => `
          <button type="button" class="mating-sel-btn${c.partNumber === selected.partNumber ? " active" : ""}" data-rugged-mate="${escapeHtml(c.partNumber)}">
            <span class="mating-sel-code mono">${escapeHtml(c.partNumber)}</span>
            <span class="mating-sel-desc">${escapeHtml(`${c.roleLabel} | ${validationLabel(c.status)}`)}</span>
          </button>
        `).join("")}
      </div>
    ` : "";

    panel.innerHTML = `
      ${warningsHtml}${intermateHtml}
      ${selectorHtml}
      <div class="mating-pair">
        ${ruggedMatingSourceCard(decoded, result)}
        <div class="mating-pair-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M14 7l5 5-5 5"/></svg>
        </div>
        ${ruggedMatingMateCard(selected)}
      </div>
      ${sqHtml}
    `;

    panel.querySelectorAll("[data-rugged-mate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedMateSheet = btn.dataset.ruggedMate;
        renderMatingPanel();
      });
    });
    panel.querySelectorAll("[data-mating-pn]").forEach((btn) => {
      btn.addEventListener("click", () => {
        els.partNumberInput.value = btn.dataset.matingPn;
        decodeFromInput();
        selectTab("decoder");
      });
    });
  }

  function shellProfileHtml(slashSheet) {
    const profileType = SHELL_PROFILE_TYPE[slashSheet];
    const assetPath = SHELL_PROFILE_ASSET[profileType];
    if (assetPath) {
      const alt = `${getShellStyleLabel(slashSheet) || slashSheet} schematic`;
      return `<div class="shell-profile-frame shell-profile-asset-frame"><img class="shell-profile-asset" src="${escapeHtml(assetPath)}" alt="${escapeHtml(alt)}"></div>`;
    }
    const svg = SHELL_PROFILES[profileType];
    return svg ? `<div class="shell-profile-frame">${svg}</div>` : "";
  }

  function matingSourceCard(decoded, matePartNumber = "") {
    const validation = catalogValidationForDecoded(decoded);
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
          ${connectorSummaryDetailHtml(decoded, { matePartNumber })}
          ${svgHtml}
          ${shellProfileHtml(decoded.slash_sheet)}
          ${validationSummaryHtml(validation, { partNumber: decoded.part_number })}
          <div class="mating-source-chips">
            ${optionChip(decoded.slash_sheet, "shell type", getShellStyleLabel(decoded))}
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
    const exactValidation = targetDecoded ? catalogValidationForDecoded(targetDecoded) : null;
    const candidateValidation = exactValidation
      ? { ...exactValidation, status: opt.status || exactValidation.status }
      : { status: opt.status, reasons: [...(opt.conflictingFields || []), ...(opt.missingFields || [])], sources: opt.sources || [] };
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
    const validationEvidence = buildValidationEvidenceText(candidateValidation);
    const matchedText = joinDisplayItems(opt.matchedFields || [], ", ", "none");
    const oppositeText = joinDisplayItems(opt.oppositeFields || [], ", ", "none");
    const conflictText = joinDisplayItems(opt.conflictingFields || [], ", ", "");
    const missingText = joinDisplayItems(opt.missingFields || [], ", ", "");
    const warningText = joinDisplayItems(opt.warnings || [], " | ", "");
    return `
      <div class="mating-source-card">
        <div class="mating-source-header">
          <span class="mating-source-label">Mating Connector</span>
          <span class="mating-source-pn mono">${escapeHtml(opt.candidatePartNumber || `D38999${opt.mateSheet}`)}</span>
        </div>
        <div class="mating-source-body">
          ${connectorSummaryDetailHtml(targetDecoded, { validation: candidateValidation, matePartNumber: decoded.part_number, emptyText: "Catalog-backed mating details are incomplete for this candidate." })}
          ${svgHtml}
          ${shellHtml}
          ${validationSummaryHtml(candidateValidation, { partNumber: opt.candidatePartNumber, confidence: opt.confidence })}
          <div class="mating-source-chips">
            ${optionChip(opt.mateSheet, "shell type", getShellStyleLabel(targetDecoded || { slash_sheet: opt.mateSheet }))}
            ${optionChip(decoded.class_field, "class / finish", decoded.class_definition?.description || "")}
            ${optionChip(decoded.shell_code, "shell size", decoded.shell_size ? `size ${decoded.shell_size}` : "")}
            ${optionChip(decoded.insert_arrangement, "insert", decoded.arrangement_id || "")}
            ${optionChip(targetDecoded?.contact_style || "?", "contacts", targetDecoded?.contact_definition?.description || "opposite contact family")}
            ${optionChip(decoded.polarization, "polarization", decoded.polarization_definition?.description || "")}
          </div>
          ${pnBlock}
          <div class="detail-item"><div class="label">Validation evidence</div><div class="value">${escapeHtml(validationEvidence)}</div></div>
          <div class="detail-item"><div class="label">Matched fields</div><div class="value">${escapeHtml(matchedText)}</div></div>
          <div class="detail-item"><div class="label">Opposite fields</div><div class="value">${escapeHtml(oppositeText)}</div></div>
          ${conflictText ? `<div class="detail-item"><div class="label">Conflicts</div><div class="value">${escapeHtml(conflictText)}</div></div>` : ""}
          ${missingText ? `<div class="detail-item"><div class="label">Missing data</div><div class="value">${escapeHtml(missingText)}</div></div>` : ""}
          ${warningText ? `<div class="detail-item"><div class="label">Warnings</div><div class="value">${escapeHtml(warningText)}</div></div>` : ""}
          <div class="mating-option-actions">${decodeBtn}</div>
        </div>
      </div>
    `;
  }

  function renderDecoded(decoded) {
    if (!decoded) {
      els.decodedPanel.innerHTML = `
        <div class="empty-state decoded-empty">
          <svg class="decoded-empty-art" viewBox="0 0 120 80" aria-hidden="true">
            <defs>
              <radialGradient id="decEmptyShell" cx="50%" cy="38%" r="55%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.95)"/>
                <stop offset="100%" stop-color="rgba(214,222,233,0.9)"/>
              </radialGradient>
            </defs>
            <circle cx="60" cy="40" r="28" fill="url(#decEmptyShell)" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
            <circle cx="60" cy="40" r="20" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="2 3"/>
            <g fill="currentColor" fill-opacity="0.35">
              <circle cx="52" cy="34" r="2.2"/><circle cx="60" cy="32" r="2.2"/><circle cx="68" cy="34" r="2.2"/>
              <circle cx="50" cy="42" r="2.2"/><circle cx="60" cy="40" r="2.2"/><circle cx="70" cy="42" r="2.2"/>
              <circle cx="52" cy="48" r="2.2"/><circle cx="60" cy="48" r="2.2"/><circle cx="68" cy="48" r="2.2"/>
            </g>
          </svg>
          <div class="decoded-empty-text">${escapeHtml(T("decoded.empty"))}</div>
        </div>`;
      updateViewerExportState();
      return;
    }
    if (!decoded.ok) {
      els.decodedPanel.innerHTML = `<div class="detail-item"><div class="value">${escapeHtml(decoded.message)}</div></div>`;
      updateViewerExportState();
      return;
    }
    if (decoded.rugged_io) {
      els.decodedPanel.innerHTML = ruggedIoSummaryCard(decoded);
      updateViewerExportState();
      return;
    }
    els.decodedPanel.innerHTML = decodedSummaryCard(decoded);
    updateViewerExportState();
  }

  function clearRuggedIoViewer() {
    const layer = document.getElementById("ruggedFaceLayer");
    if (layer) layer.remove();
    if (els.connectorSvg) els.connectorSvg.style.display = "";
  }

  function renderRuggedIoViewer(decoded) {
    const frame = els.viewerFrame;
    if (!frame) return;
    if (els.connectorSvg) els.connectorSvg.style.display = "none";
    let layer = document.getElementById("ruggedFaceLayer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "ruggedFaceLayer";
      layer.className = "rugged-face-layer";
      frame.appendChild(layer);
    }

    const views = ruggedAvailableViewKeys(decoded.family);
    if (state.ruggedViewFamily !== decoded.family || !views.includes(state.ruggedView)) {
      state.ruggedView = ruggedDefaultViewKey(decoded);
      state.ruggedViewFamily = decoded.family;
    }
    const selectedView = views.includes(state.ruggedView) ? state.ruggedView : (views[0] || "face");

    let stageHtml;
    if (views.length) {
      stageHtml = ruggedViewStageHtml(decoded.family, selectedView, decoded.family);
    } else {
      // Families without a registered FAMILY_SVG_MAP entry fall back to the
      // single auto-picked drawing from recognizeRuggedIo().
      const faceSvg = decoded.face_svg || decoded.svg;
      const mountSvg = decoded.svg && decoded.svg !== faceSvg ? decoded.svg : "";
      stageHtml = `
        <div class="rugged-face-stage">
          ${faceSvg
            ? `<img class="rugged-face-img" src="assets/svg/${escapeHtml(faceSvg)}" alt="${escapeHtml(decoded.family)} front face"/>`
            : `<div class="rugged-face-placeholder">${escapeHtml(Tf("rugged.faceUnavailable", { family: decoded.family }))}</div>`}
          ${mountSvg
            ? `<img class="rugged-mount-img" src="assets/svg/${escapeHtml(mountSvg)}" alt="${escapeHtml(decoded.family)} ${escapeHtml(decoded.mounting_type || "profile")}"/>`
            : ""}
        </div>`;
    }

    const viewNote = views.length ? ruggedViewLabel(selectedView) : (decoded.mounting_type || "");
    const captionBits = [decoded.interface, decoded.shell_size ? Tf("rugged.shellCaption", { size: decoded.shell_size }) : "", viewNote].filter(Boolean);
    layer.innerHTML = `
      ${ruggedViewSwitcherHtml(views, selectedView)}
      ${stageHtml}
      <div class="rugged-face-caption">
        <span class="rugged-face-pn mono">${escapeHtml(decoded.part_number || "")}</span>
        ${captionBits.length ? `<span class="rugged-face-meta">${escapeHtml(captionBits.join(" • "))}</span>` : ""}
      </div>
    `;
    layer.querySelectorAll("[data-rugged-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.ruggedView = btn.dataset.ruggedView;
        renderRuggedIoViewer(decoded);
      });
    });
    els.viewerTitle.textContent = Tf("rugged.frontFace", { family: decoded.family });
    if (els.sourceInfo) {
      els.sourceInfo.textContent = `${decoded.vendor || ""}${decoded.vendor ? " • " : ""}${decoded.d38999_relation || ""}`.trim();
    }
  }

  function ruggedIoSummaryCard(decoded) {
    const faceSvg = decoded.face_svg || decoded.svg;
    const mountSvg = decoded.svg !== faceSvg ? decoded.svg : "";
    const faceHtml = faceSvg
      ? `<img src="assets/svg/${faceSvg}" alt="${decoded.family} face" style="max-width:100px;max-height:100px;opacity:0.8"/>`
      : "";
    const mountHtml = mountSvg
      ? `<img src="assets/svg/${mountSvg}" alt="${decoded.family} ${decoded.mounting_type || 'profile'}" style="max-width:160px;max-height:70px;opacity:0.75"/>`
      : "";
    const svgHtml = (faceHtml || mountHtml)
      ? `<div class="rugged-io-svg-inline">${faceHtml}${mountHtml ? `<span style="display:inline-block;width:12px"></span>${mountHtml}` : ""}</div>`
      : "";
    return `
      <div class="detail-item detail-summary rugged-io-decoded">
        <div class="name">${escapeHtml(T("rugged.name"))}</div>
        <div class="value mono">${escapeHtml(decoded.part_number)}</div>
        <div class="rugged-io-info-grid">
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.family"))}</span> <span class="rugged-value">${escapeHtml(decoded.family)}</span></div>
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.vendor"))}</span> <span class="rugged-value">${escapeHtml(decoded.vendor)}</span></div>
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.interface"))}</span> <span class="rugged-value">${escapeHtml(decoded.interface)}</span></div>
          ${decoded.interface_gender ? `<div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.interfaceGender"))}</span> <span class="rugged-value">${escapeHtml(decoded.interface_gender)}</span></div>` : ""}
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.shellSize"))}</span> <span class="rugged-value">${escapeHtml(decoded.shell_size)}</span></div>
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.type"))}</span> <span class="rugged-value">${escapeHtml(decoded.connector_type)}</span></div>
          <div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.relation"))}</span> <span class="rugged-value">${escapeHtml(decoded.d38999_relation)}</span></div>
          ${decoded.mounting_type ? `<div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.mounting"))}</span> <span class="rugged-value">${escapeHtml(decoded.mounting_type)}</span></div>` : ""}
          ${decoded.suffix ? `<div class="rugged-field"><span class="rugged-label">${escapeHtml(T("rugged.config"))}</span> <span class="rugged-value">${escapeHtml(decoded.suffix)}</span></div>` : ""}
        </div>
        ${svgHtml}
        <div class="rugged-io-note">${escapeHtml(decoded.note)}</div>
      </div>
    `;
  }

  function keyingChipStrip(decoded) {
    if (!decoded?.ok) return "";
    const current = String(decoded.polarization || "N").toUpperCase();
    const letters = ["N", "A", "B", "C", "D"];
    const chips = letters.map((l) => {
      const active = (l === current) ? " active" : "";
      const title = (l === "N") ? T("decoded.keying.normal") : "";
      return `<button type="button" class="keying-chip${active}" data-keying-letter="${l}" title="${escapeHtml(title)}">${l}</button>`;
    }).join("");
    const note = decoded.polarization_defaulted
      ? `<span class="keying-chip-note">${escapeHtml(T("decoded.keying.defaultNote"))}</span>`
      : "";
    return `<div class="keying-chip-strip" role="group" aria-label="${escapeHtml(T("decoded.keying.aria"))}">
      <span class="keying-chip-label">${escapeHtml(T("decoded.keying.label"))}</span>
      ${chips}
      ${note}
    </div>`;
  }

  function onKeyingChipClick(event) {
    const chip = event.target.closest("[data-keying-letter]");
    if (!chip) return;
    if (!state.decoded?.ok || !state.decoded.part_number) return;
    const letter = chip.dataset.keyingLetter;
    if (!letter) return;
    const cur = String(state.decoded.polarization || "N").toUpperCase();
    if (cur === letter) return;
    // The polarization letter is the final character of the canonical D38999 P/N.
    const pn = state.decoded.part_number;
    if (!/[A-Z]$/i.test(pn)) return;
    const nextPn = pn.slice(0, -1) + letter;
    els.partNumberInput.value = nextPn;
    decodeFromInput();
  }

  function decodedSummaryCard(decoded) {
    const items = manualFieldItems(decoded);
    const validation = catalogValidationForDecoded(decoded);
    const arrangement = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const sources = items.map((item) => item.source).filter(Boolean);
    const uniqueSources = dedupeDisplayItems(sources, { mapOutput: (item, label) => label });
    const validationEvidence = buildValidationEvidenceText(validation);
    return `
      <div class="detail-item detail-summary">
        <div class="name">${escapeHtml(T("decoder.partNumberLabel"))}</div>
        <button type="button" class="value mono pn-copy-target" data-copy-pn="${escapeHtml(decoded.part_number)}" title="${escapeHtml(T("common.copy"))}">${escapeHtml(items.map((item) => item.token).join(""))}</button>
        ${connectorSummaryDetailHtml(decoded, { validation })}
        ${validationSummaryHtml(validation, { partNumber: decoded.part_number })}
        <div class="decoded-status-note">${escapeHtml(validationEvidence || T("decoded.fallbackEvidence"))}</div>
        ${keyingChipStrip(decoded)}
        <div class="decoded-action-row">
          <button type="button" class="primary-action decoded-action-btn" data-decoded-action="mating">${escapeHtml(T("decoded.action.mate"))}</button>
          <button type="button" class="decoded-action-btn" data-decoded-action="build">${escapeHtml(T("decoded.action.build"))}</button>
          <details class="decoded-more">
            <summary class="decoded-action-btn decoded-more-summary" aria-label="${escapeHtml(T("decoded.action.more"))}">
              ${escapeHtml(T("decoded.action.more"))} <span aria-hidden="true">▾</span>
            </summary>
            <div class="decoded-more-menu" role="menu">
              <button type="button" class="decoded-action-btn" role="menuitem" data-decoded-action="catalog">${escapeHtml(T("decoded.action.browse"))}</button>
              <button type="button" class="decoded-action-btn" role="menuitem" data-decoded-action="converter">${escapeHtml(T("converter.convert"))}</button>
              <button type="button" class="decoded-action-btn" role="menuitem" data-decoded-action="csv" title="${escapeHtml(T("decoded.action.csvTitle"))}">${escapeHtml(T("decoded.action.csv"))}</button>
              <button type="button" class="decoded-action-btn" role="menuitem" data-decoded-action="print" title="${escapeHtml(T("decoded.action.printTitle"))}">${escapeHtml(T("decoded.action.print"))}</button>
            </div>
          </details>
        </div>
        <div class="manual-stat-grid">
          ${items.map((item) => decodedFieldChip(item)).join("")}
        </div>
        <div class="detail-item"><div class="label">${escapeHtml(T("decoded.insertDrawing"))}</div><div class="value">${escapeHtml(arrangement ? Tf("decoded.insertSummary", { id: decoded.arrangement_id, count: arrangement.contact_count, sizes: sizeSummary(arrangement) }) : Tf("decoded.insertNeedsVerify", { id: decoded.arrangement_id || T("common.unknownLc") }))}</div></div>
        ${uniqueSources.length ? `<div class="summary-source-note">${escapeHtml(Tf("decoded.sources", { list: uniqueSources.join(" | ") }))}</div>` : ""}
      </div>
    `;
  }

  function renderPartNumberGuide(decoded) {
    const pattern = (partRules.part_number_patterns || [])[0];
    if (!els.partNumberGuidePanel || !pattern) return;
    if (decoded?.rugged_io) {
      els.partNumberGuidePanel.innerHTML = "";
      return;
    }
    els.partNumberGuidePanel.innerHTML = interactivePnGuide(decoded, "compact");
  }

  function renderBuildConnector() {
    if (!els.buildContent) return;
    const selector = manualSelectorContext(state.decoded);
    const sections = [
      ["Build", connectorSelector(selector)],
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
      ["Quick Reference", manualQuickReference()],
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
        title: getShellStyleLabel({ slash_sheet: value, slash_sheet_definition: slashDef }),
        detail: getShellStyleDescription({ slash_sheet: value, slash_sheet_definition: slashDef }),
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
    const shellPreview = field === "slash_sheet" ? shellFacePreviewMarkup(value) : "";
    const metaLine = disabled ? "Unavailable" : `${optionCount} match${optionCount === 1 ? "" : "es"}`;
    return `
      <button
        type="button"
        class="option-chip selector-chip ${field === "slash_sheet" ? "selector-shell-chip" : ""} ${active ? "active" : ""}"
        data-selector-field="${escapeHtml(field)}"
        data-selector-value="${escapeHtml(value)}"
        ${disabled ? "disabled" : ""}
      >
        ${shellPreview}
        <strong class="mono">${escapeHtml(meta.code)}</strong>
        <span>${escapeHtml(meta.title || "")}</span>
        <em>${escapeHtml(metaLine)}</em>
      </button>
    `;
  }

  function connectorSelector(context) {
    const pnValue = context.exact?.part_number || "Choose options to build a connector.";
    const activeEnvironment = state.buildEnvironmentFilter;
    const activeCurrent = state.buildCurrentFilter || 0;
    const currentThresholds = buildCurrentThresholds();
    const filterNote = [
      activeEnvironment ? environmentFilterLabel(activeEnvironment, true) : "",
      activeCurrent ? currentFilterLabel(activeCurrent) : "",
    ].filter(Boolean).join(", ");
    const filterSuffix = filterNote ? ` for ${filterNote}` : "";
    const summary = context.totalCount === 0
      ? filterNote
        ? `No matches for ${filterNote}.`
        : "No valid connectors match."
      : context.exact
        ? "Exact match in the valid-part-number set."
        : context.matchCount === context.totalCount
          ? `${context.totalCount} valid connector${context.totalCount === 1 ? "" : "s"}${filterSuffix}.`
          : `${context.matchCount} match${context.matchCount === 1 ? "" : "es"}${filterSuffix}.`;
    const fields = [
      ["slash_sheet", "Shell"],
      ["class_field", "Class"],
      ["shell_code", "Size"],
      ["insert_arrangement", "Insert"],
      ["contact_style", "Contacts"],
      ["polarization", "Keying"],
    ];
    const stepHelp = {
      slash_sheet: "Pick the shell family.",
      class_field: "Pick class and finish.",
      shell_code: "Pick the shell size code.",
      insert_arrangement: "Pick the insert pattern.",
      contact_style: "Pick the contact option.",
      polarization: "Pick the keying.",
    };
    const activeStep = context.activeStep;
    const activeField = fields[activeStep]?.[0] || fields[0][0];
    const activeTitle = fields[activeStep]?.[1] || fields[0][1];
    const optionGridClass = ["option-grid"];
    if (activeField === "insert_arrangement") optionGridClass.push("compact-options");
    if (activeField === "slash_sheet") optionGridClass.push("selector-shell-options");

    return `
      <div class="selector-shell">
        <div class="selector-hero">
          <div class="selector-pn mono">${escapeHtml(pnValue)}</div>
          <p>${escapeHtml(summary)}</p>
          <div class="selector-actions">
            <button type="button" class="selector-action secondary" data-selector-action="prev-step" ${activeStep === 0 ? "disabled" : ""}>Back</button>
            <button type="button" class="selector-action" data-selector-action="apply" ${context.exact ? "" : "disabled"}>Open in decoder</button>
            <button type="button" class="selector-action secondary" data-selector-action="reset">Clear</button>
          </div>
        </div>
        <section class="build-environment-filter">
          <div class="build-environment-filter-head">
            <strong>Environment</strong>
            <span>${escapeHtml(activeEnvironment ? environmentFilterLabel(activeEnvironment, true) : "Any")}</span>
          </div>
          <div class="build-environment-filter-buttons">
            <button type="button" class="build-environment-btn${activeEnvironment ? "" : " active"}" data-build-environment="">Any</button>
            ${environmentFilterDefinitions.map((item) => `
              <button type="button" class="build-environment-btn${activeEnvironment === item.filter_key ? " active" : ""}" data-build-environment="${escapeHtml(item.filter_key)}">${escapeHtml(environmentFilterLabel(item.filter_key, true))}</button>
            `).join("")}
          </div>
        </section>
        <section class="build-environment-filter build-current-filter">
          <div class="build-environment-filter-head">
            <strong>Current load</strong>
            <span>${escapeHtml(currentFilterLabel(activeCurrent))}</span>
          </div>
          <div class="build-environment-filter-buttons">
            <button type="button" class="build-environment-btn${activeCurrent ? "" : " active"}" data-build-current="0">Any</button>
            ${currentThresholds.map((amps) => `
              <button type="button" class="build-environment-btn${activeCurrent === amps ? " active" : ""}" data-build-current="${escapeHtml(String(amps))}" title="Only arrangements with a contact rated at least ${escapeHtml(formatCurrentAmps(amps))} A per pin">${escapeHtml(currentFilterLabel(amps))}</button>
            `).join("")}
          </div>
        </section>
        <div class="build-stepper">
          ${fields.map(([field, title], index) => {
            const status = index < activeStep
              ? "done"
              : index === activeStep
                ? "active"
                : context.selection[field]
                  ? "done"
                  : "pending";
            const label = context.selection[field] || "Choose";
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
            <strong>${escapeHtml(activeTitle)}</strong>
            <p>${escapeHtml(stepHelp[activeField] || "")}</p>
          </div>
          <div class="${optionGridClass.join(" ")}">
            ${selectorOptionUniverse(activeField).map((value) => selectorOptionButton(activeField, value, context)).join("")}
          </div>
        </section>
        ${context.exact ? buildConnectorResult(context.exact) : ""}
      </div>
    `;
  }

  function buildConnectorResult(decoded) {
    const arrangement = decoded?.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const validation = catalogValidationForDecoded(decoded);
    const validationEvidence = buildValidationEvidenceText(validation);
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
              ${arrangement ? `<span class="selector-preview-current">${escapeHtml(currentCapacitySummary(arrangement))}</span>` : ""}
            </div>
          </div>
          ${connectorSummaryDetailHtml(decoded, { validation })}
          <div class="manual-stat-grid">
            ${optionChip(decoded.slash_sheet || "", "shell type", getShellStyleLabel(decoded))}
            ${optionChip(decoded.class_field || "", "class / finish", decoded.class_definition?.description || "")}
            ${optionChip(decoded.shell_code || "", "shell size", decoded.shell_size ? `size ${decoded.shell_size}` : "")}
            ${optionChip(decoded.insert_arrangement || "", "insert arrangement", decoded.arrangement_id || "")}
            ${optionChip(decoded.contact_style || "", "contact style", decoded.contact_definition?.contact_gender || decoded.contact_definition?.description || "")}
            ${optionChip(decoded.polarization || "", "polarization", decoded.polarization_definition?.description || "")}
          </div>
          ${validationSummaryHtml(validation, { partNumber: decoded.part_number })}
          <div class="detail-item"><div class="label">Validation evidence</div><div class="value">${escapeHtml(validationEvidence || "No validation detail available.")}</div></div>
        </div>
      </section>
    `;
  }

  function manualFieldItems(decoded) {
    const active = activeDecodedOrExample(decoded);
    const arr = active.ok ? arrangementById(active.arrangement_id) : null;
    const slashMeaning = active.ok ? getShellStyleLabel(active) : "Connector shell type from the DLA source data.";
    const slashDescription = active.ok ? getShellStyleDescription(active) : "This selects the connector body style.";
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
        use: `${slashDescription} Not the shell size — it sets the body style: plug, wall-mount or jam-nut receptacle, hermetic, or Series IV. It answers: which connector body am I ordering?`,
        source: active.ok ? sourceRef(active.slash_sheet_definition || active.source_pattern?.fields?.[1]) : ""
      },
      {
        key: "class",
        token: active.ok ? active.class_field : "W",
        label: "Class / finish",
        icon: "FINISH",
        summary: classMeaning,
        use: "Material and plating/finish. Use it to match the environment: corrosion resistance, conductivity, composite, stainless, or hermetic.",
        source: active.ok ? sourceRef(active.class_definition) : ""
      },
      {
        key: "shell_size",
        token: active.ok ? active.shell_code : "E",
        label: "Shell code",
        icon: "SIZE",
        summary: active.ok ? `Code ${active.shell_code} maps to physical shell size ${active.shell_size}.` : "The letter maps to a numeric physical shell size.",
        use: "The shell-size field — a letter here, not the shell type. Combine the numeric shell size with the insert number to find the exact pinout.",
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
        use: "Whether the connector ships with pins, sockets, no contacts, or a special termination. The mate normally uses the opposite contact gender.",
        source: active.ok ? sourceRef(active.contact_definition) : ""
      },
      {
        key: "polarization",
        token: active.ok ? active.polarization : "N",
        label: "Keying",
        icon: "KEY",
        summary: keyingMeaning,
        use: "The angular key position. Match polarization only on connectors meant to mate; use alternate keying to prevent wrong mating.",
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
    const body = active.ok ? getShellStyleLabel(active) : "connector shell type";
    const shell = active.ok ? `shell size ${active.shell_size}` : "numeric shell size";
    const insert = active.ok ? `${active.arrangement_id}` : "shell-insert arrangement";
    const contacts = arr ? `${arr.contact_count} contacts` : "contact count from insert drawing";
    const steps = [
      ["1", "Body", body, "The shell type is the mechanical connector body to buy."],
      ["2", "Finish", active.ok ? active.class_field : "class", "The class sets material and finish for the operating environment."],
      ["3", "Shell", shell, "The shell-size code is the physical circular shell size."],
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

  function decodedFieldChip(item) {
    const why = item.use ? `<p class="field-why-text">${escapeHtml(item.use)}</p>` : "";
    const source = item.source
      ? `<p class="field-source-badge"><span>${escapeHtml(T("common.source"))}</span> ${escapeHtml(item.source)}</p>`
      : "";
    const hasDisclosure = Boolean(why || source);
    return `
      <div class="option-chip decoded-field-chip active">
        <div class="decoded-field-head">
          <strong class="mono">${escapeHtml(item.token)}</strong>
          <span>${escapeHtml(item.label || "")}</span>
          ${hasDisclosure ? `<button type="button" class="field-why-toggle" data-why-toggle aria-expanded="false" aria-label="${escapeHtml(Tf("decoded.whyAria", { label: item.label }))}">${escapeHtml(T("decoded.why"))}</button>` : ""}
        </div>
        ${item.summary ? `<em>${escapeHtml(item.summary)}</em>` : ""}
        ${hasDisclosure ? `<div class="field-why" hidden>${why}${source}</div>` : ""}
      </div>
    `;
  }

  function csvEscape(value) {
    const text = String(value == null ? "" : value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  // ---------------------------------------------------------------------------
  // Smart input: accept a manufacturer P/N in the decoder
  // ---------------------------------------------------------------------------

  function getSmartSuggestionEl() {
    if (!els.decodeMessage) return null;
    let el = document.getElementById("decodeSmartSuggestion");
    if (!el) {
      el = document.createElement("div");
      el.id = "decodeSmartSuggestion";
      el.className = "smart-suggestion";
      el.hidden = true;
      els.decodeMessage.parentNode.insertBefore(el, els.decodeMessage.nextSibling);
    }
    return el;
  }

  function clearSmartSuggestion() {
    const el = document.getElementById("decodeSmartSuggestion");
    if (el) {
      el.hidden = true;
      el.innerHTML = "";
    }
    state.reportCandidate = null;
    updateViewerExportState();
  }

  function reverseConvertSafe(value) {
    const conv = globalThis.D38999Converter;
    if (!conv || typeof conv.reverseConvert !== "function") return [];
    try { return conv.reverseConvert(value) || []; } catch { return []; }
  }

  function renderSmartSuggestion(rawInput, candidates) {
    const el = getSmartSuggestionEl();
    if (!el || !candidates.length) return;
    const top = candidates[0];
    const more = candidates.slice(1, 6);
    const oneLine = candidates.length === 1
      ? Tf("decode.smartOne", { pn: top.d38999PartNumber, vendor: top.vendor })
      : Tf("decode.smartMany", { count: candidates.length });
    const useBtn = (cand) =>
      `<button type="button" class="smart-suggestion-pick" data-suggest-pn="${escapeHtml(cand.d38999PartNumber)}" title="${escapeHtml(cand.source)}">`
      + escapeHtml(Tf("decode.smartUse", { pn: cand.d38999PartNumber }))
      + ` <span class="smart-suggestion-vendor">(${escapeHtml(cand.vendor)})</span></button>`;
    el.innerHTML = `
      <div class="smart-suggestion-head">
        <strong>${escapeHtml(T("decode.smartTitle"))}</strong>
        <span class="smart-suggestion-msg">${escapeHtml(oneLine)}</span>
        <button type="button" class="smart-suggestion-dismiss" data-suggest-dismiss>${escapeHtml(T("decode.smartDismiss"))}</button>
      </div>
      <div class="smart-suggestion-body">
        ${useBtn(top)}
        ${more.map(useBtn).join("")}
      </div>
    `;
    el.hidden = false;
    // Stash a ready-to-export candidate so the viewer's "Print / Export report"
    // button can be used directly from a manufacturer P/N without first
    // accepting the smart suggestion.
    const decoded = top?.d38999PartNumber ? decodePartNumber(top.d38999PartNumber) : null;
    state.reportCandidate = decoded?.ok
      ? { decoded, vendor: top.vendor, source: top.source, originalInput: rawInput }
      : null;
    updateViewerExportState();
  }

  function bindSmartSuggestionHandlers() {
    const el = getSmartSuggestionEl();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", (event) => {
      const dismiss = event.target.closest("[data-suggest-dismiss]");
      if (dismiss) { clearSmartSuggestion(); return; }
      const pick = event.target.closest("[data-suggest-pn]");
      if (!pick) return;
      const pn = pick.dataset.suggestPn;
      if (!pn) return;
      clearSmartSuggestion();
      els.partNumberInput.value = pn;
      decodeFromInput();
    });
  }

  // ---------------------------------------------------------------------------
  // Cross-reference + mate report
  // ---------------------------------------------------------------------------

  function describeDecodedConnector(decoded) {
    if (!decoded?.ok) return { shellTypeLabel: "", mountingStyle: "", matingRole: "", summary: "" };
    const style = styleEntryForSlashSheet(decoded.slash_sheet) || {};
    const shellTypeLabel = getShellStyleLabel(decoded) || decoded.slash_sheet || "";
    const summary = (getShellStyleDescription(decoded) || "").trim();
    const matingRole = (style.matingRole || "").toString();
    let mountingStyle = "";
    const lc = `${shellTypeLabel} ${summary}`.toLowerCase();
    if (/jam[- ]?nut/.test(lc)) mountingStyle = "jam-nut";
    else if (/wall[- ]?mount/.test(lc)) mountingStyle = "wall mount";
    else if (/square[- ]?flange/.test(lc)) mountingStyle = "square flange";
    else if (/panel/.test(lc)) mountingStyle = "panel mount";
    else if (/in[- ]?line/.test(lc)) mountingStyle = "in-line";
    else if (/cap|dummy|protective/.test(lc)) mountingStyle = "accessory";
    else if (/straight|cable/.test(lc) || matingRole === "plug") mountingStyle = "cable";
    return { shellTypeLabel, mountingStyle, matingRole, summary };
  }

  function vendorRowsForParsed(parsed) {
    const conv = globalThis.D38999Converter;
    if (!conv || !parsed || typeof conv.convertParsed !== "function") return [];
    try {
      return (conv.convertParsed(parsed) || []).map((c) => ({
        vendor: String(c.manufacturer || "").split(" / ")[0].trim() || "—",
        productLine: c.product_line || "",
        partNumber: c.manufacturer_part_number || "",
        confidence: c.confidence,
        notes: c.notes || "",
      }));
    } catch { return []; }
  }

  function parsedFromDecoded(decoded) {
    const conv = globalThis.D38999Converter;
    if (!conv || !decoded?.ok) return null;
    try { return conv.parseD38999Pin(decoded.part_number); } catch { return null; }
  }

  function buildConnectorBlock(decoded, mateIndex) {
    if (!decoded?.ok) return null;
    const parsed = parsedFromDecoded(decoded);
    return {
      mateIndex,
      d38999: decoded.part_number,
      decoded: {
        slashSheet: decoded.slash_sheet,
        classField: decoded.class_field,
        shellCode: decoded.shell_code,
        shellSize: decoded.shell_size,
        insertArrangement: decoded.insert_arrangement,
        arrangementId: decoded.arrangement_id,
        contactStyle: decoded.contact_style,
        polarization: decoded.polarization,
      },
      description: describeDecodedConnector(decoded),
      vendors: parsed ? vendorRowsForParsed(parsed) : [],
    };
  }

  function buildCrossRefReport(decoded) {
    if (!decoded?.ok) return null;
    const generatedAt = new Date().toISOString();
    const self = buildConnectorBlock(decoded, 0);

    const candidates = mateCandidatesForDecoded(decoded) || [];
    let mate = candidates
      .map((c, i) => {
        if (!c.targetDecoded?.ok) {
          return {
            mateIndex: i + 1,
            d38999: c.candidatePartNumber || "",
            description: { shellTypeLabel: "", mountingStyle: "", matingRole: "", summary: "" },
            vendors: [],
            status: c.status || "MISSING_DATA",
            isValidMate: false,
            reasons: [...(c.conflictingFields || []), ...(c.warnings || [])],
            confidence: c.confidence || 0,
          };
        }
        const block = buildConnectorBlock(c.targetDecoded, i + 1);
        block.status = c.status;
        block.isValidMate = !!c.isValidMate;
        block.reasons = [...(c.conflictingFields || []), ...(c.warnings || [])];
        block.confidence = c.confidence || 0;
        return block;
      })
      .sort((a, b) =>
        (Number(b.isValidMate) - Number(a.isValidMate)) ||
        (b.confidence - a.confidence) ||
        String(a.d38999).localeCompare(String(b.d38999))
      )
      .map((m, i) => ({ ...m, mateIndex: i + 1 }));

    if (!mate.length) {
      mate = [{
        mateIndex: 1,
        d38999: "",
        description: { shellTypeLabel: "", mountingStyle: "", matingRole: "", summary: T("report.noMate") },
        vendors: [],
        status: "NO_MATE",
        isValidMate: false,
        reasons: [T("report.noMate")],
        confidence: 0,
      }];
    }

    return {
      meta: {
        generatedAt,
        sourcePartNumber: decoded.part_number,
        appName: "D38999 Toolbox",
        disclaimer: T("report.disclaimer"),
      },
      self,
      mate,
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename(stem, ext) {
    const safe = String(stem || "d38999_report").replace(/[^A-Za-z0-9]+/g, "_");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `d38999_xref_${safe}_${date}.${ext}`;
  }

  function cloneLiveConnectorSvg() {
    const live = els.connectorSvg;
    if (!live) return "";
    const clone = live.cloneNode(true);
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((node) => {
      // Keep paint-server ids (gradients in <defs>) so CSS url(#…) fills like
      // the real-view gold contacts and shell gradients still resolve in the
      // cloned/exported SVG. Strip every other stray id to avoid collisions.
      if (node.closest("defs")) return;
      node.removeAttribute("id");
    });
    clone.querySelectorAll(".pin.selected, .pin.match").forEach((node) =>
      node.classList.remove("selected", "match")
    );
    // Drop the floating per-pin label box that tracks the hovered/selected
    // contact. The report shows the static front face, not a transient tooltip.
    clone.querySelectorAll(".hover-pin-label").forEach((node) => node.remove());
    // Reset viewBox to the full connector so user pan/zoom doesn't crop the
    // report face. Fit to the *rendered* content bounds (via getBBox on the
    // live SVG) so wide mount hardware — wall/box flanges, jamnut rings,
    // plug coupling marks — isn't clipped outside the frame the way the fixed
    // base viewBox can clip it. Fall back to the base outline viewBox.
    const arr = state.selectedArrangement;
    const fitViewBox = connectorContentViewBox(live, arr ? connectorBaseViewBox(arr) : null);
    if (fitViewBox) {
      clone.setAttribute("viewBox", fitViewBox.map((value) => Number(value).toFixed(3)).join(" "));
    }
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    // Let CSS size it; remove any inline width/height that could fight max-*.
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return clone.outerHTML;
  }

  function profileAssetForSlashSheet(slashSheet) {
    const type = SHELL_PROFILE_TYPE[slashSheet];
    return type ? SHELL_PROFILE_ASSET[type] : "";
  }

  function reportFaceFigure(svg, caption, mode, arrId) {
    if (!svg) return "";
    return `<figure class="report-art-face" data-view="${escapeHtml(mode)}" data-arr="${escapeHtml(arrId || "")}">
      ${svg}
      <figcaption class="report-art-face-cap">${escapeHtml(caption)}</figcaption>
    </figure>`;
  }

  function reportConnectorArtwork(block, faceVariants) {
    const slashSheet = block?.decoded?.slashSheet;
    const arrId = block?.decoded?.arrangementId;
    const bodyPath = profileAssetForSlashSheet(slashSheet);
    const variants = faceVariants || {};
    const faces = [
      reportFaceFigure(variants.engineering, T("viewer.viewMode.eng"), "engineering", arrId),
      reportFaceFigure(variants.real, T("viewer.viewMode.real"), "real", arrId),
    ].filter(Boolean);
    const parts = [];
    if (bodyPath) {
      const absBody = new URL(bodyPath, document.baseURI).href;
      parts.push(`<img class="report-art-body" src="${escapeHtml(absBody)}" alt="connector body"/>`);
    }
    if (faces.length) {
      parts.push(`<div class="report-art-faces">${faces.join("")}</div>`);
    }
    if (!parts.length) return "";
    return `<div class="report-art">${parts.join("")}</div>`;
  }

  function reportBodyFragment(report, faceVariants, options = {}) {
    const sourceHeading = options.sourceHeading || T("report.sourceConnector");
    const matesHeading = options.matesHeading || T("report.matesHeading");
    const itemTitle = options.itemTitle;
    const rowsHtml = (block) => {
      const vendors = block.vendors || [];
      const lines = [
        `<tr><td>MIL-DTL-38999</td><td>D38999</td><td class="mono">${escapeHtml(block.d38999 || "—")}</td><td></td></tr>`,
        ...vendors.map((v) =>
          `<tr><td>${escapeHtml(v.vendor)}</td><td>${escapeHtml(v.productLine)}</td><td class="mono">${escapeHtml(v.partNumber)}</td><td>${escapeHtml(v.notes || "")}</td></tr>`
        ),
      ];
      return lines.join("");
    };
    const blockSection = (block, heading, role) => {
      const desc = block.description || {};
      const subtitle = [desc.shellTypeLabel, desc.mountingStyle, desc.matingRole].filter(Boolean).join(" — ");
      const reasons = block.reasons && block.reasons.length
        ? `<p class="report-reasons">${escapeHtml(block.reasons.join(" | "))}</p>` : "";
      const decoded = block.decoded || {};
      const decodedLine = decoded.slashSheet
        ? `<p class="report-decoded">${escapeHtml(`${decoded.slashSheet} · class ${decoded.classField || "?"} · shell ${decoded.shellCode || "?"} (${decoded.shellSize || "?"}) · arr ${decoded.arrangementId || "?"} · contact ${decoded.contactStyle || "?"} · keying ${decoded.polarization || "?"}`)}</p>`
        : "";
      const artwork = reportConnectorArtwork(block, faceVariants);
      return `
        <section class="report-block report-block-${role}">
          <h3>${escapeHtml(heading)}</h3>
          <p class="report-subtitle">${escapeHtml(subtitle || (block.d38999 || ""))}</p>
          ${block.d38999 ? `<p class="report-pn mono">${escapeHtml(block.d38999)}</p>` : ""}
          ${desc.summary ? `<p class="report-summary">${escapeHtml(desc.summary)}</p>` : ""}
          ${decodedLine}
          ${artwork}
          ${reasons}
          <table>
            <thead><tr><th>Vendor</th><th>Product line</th><th>Part number</th><th>Notes</th></tr></thead>
            <tbody>${rowsHtml(block)}</tbody>
          </table>
        </section>`;
    };
    const mateSections = report.mate.map((m) =>
      blockSection(m, Tf("report.mateOption", { k: m.mateIndex, n: report.mate.length }), "mate")
    ).join("");
    const matesGroup = report.mate.length
      ? `<div class="report-group report-group-mates">
           <div class="report-group-heading">
             <span class="report-group-tag">${escapeHtml(matesHeading)}</span>
             <span class="report-group-meta">${escapeHtml(Tf("report.mateCount", { count: report.mate.length }))}</span>
           </div>
           ${mateSections}
         </div>`
      : `<div class="report-group report-group-mates report-group-empty">
           <div class="report-group-heading">
             <span class="report-group-tag">${escapeHtml(matesHeading)}</span>
           </div>
           <p class="report-empty">${escapeHtml(T("report.noMate"))}</p>
         </div>`;
    const itemHeader = itemTitle
      ? `<div class="report-item-header"><span class="report-item-index">${escapeHtml(options.itemIndex || "")}</span><span class="report-item-title mono">${escapeHtml(itemTitle)}</span></div>`
      : "";
    return `
      <article class="report-item">
        ${itemHeader}
        <div class="report-group report-group-source">
          <div class="report-group-heading">
            <span class="report-group-tag">${escapeHtml(sourceHeading)}</span>
            <span class="report-group-meta mono">${escapeHtml(report.meta.sourcePartNumber)}</span>
          </div>
          ${blockSection(report.self, T("report.sourceConnector"), "source")}
        </div>
        ${matesGroup}
      </article>`;
  }

  function reportShellMarkup(titleText, metaText, fragmentsHtml) {
    const dir = (document.documentElement.getAttribute("dir") === "rtl") ? "rtl" : "ltr";
    const baseHref = document.baseURI || (location.href.replace(/[^/]*$/, ""));
    const stylesHref = new URL("styles.css", baseHref).href;
    return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8">
      <base href="${escapeHtml(baseHref)}">
      <title>${escapeHtml(titleText)}</title>
      <link rel="stylesheet" href="${escapeHtml(stylesHref)}">
      <style>
        @page { size: A4; margin: 14mm; }
        body { font-family: Inter, Arial, sans-serif; color: #0b2545; padding: 24px; max-width: 960px; margin: auto; background: #fff; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        h3 { font-size: 14px; margin: 14px 0 4px; }
        .report-meta { color: #475569; font-size: 12px; margin-bottom: 18px; }
        .report-disclaimer { background: #fef3c7; border: 1px solid #d97706; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 18px; }
        .report-item { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; margin-bottom: 22px; background: #fff; }
        .report-item-header { display: flex; gap: 10px; align-items: baseline; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px dashed #cbd5e1; }
        .report-item-index { display: inline-block; min-width: 28px; padding: 2px 8px; background: #1d4ed8; color: #fff; border-radius: 999px; font-size: 12px; font-weight: 700; text-align: center; }
        .report-item-title { font-size: 15px; font-weight: 700; }
        .report-group { margin: 10px 0 18px; padding: 0; border-radius: 6px; overflow: hidden; }
        .report-group-source { border: 2px solid #1d4ed8; background: #eff6ff; }
        .report-group-mates { border: 2px solid #047857; background: #ecfdf5; }
        .report-group-empty { background: #f1f5f9; border-color: #94a3b8; }
        .report-group-heading {
          display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
          gap: 12px; padding: 8px 14px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase; font-size: 12px;
        }
        .report-group-source .report-group-heading { background: #1d4ed8; color: #fff; }
        .report-group-mates  .report-group-heading { background: #047857; color: #fff; }
        .report-group-empty  .report-group-heading { background: #475569; color: #fff; }
        .report-group-meta { font-weight: 600; font-size: 12px; opacity: 0.95; text-transform: none; letter-spacing: 0; }
        .report-empty { padding: 12px 16px; color: #475569; font-style: italic; margin: 0; }
        .report-block { padding: 10px 16px 16px; background: #fff; }
        .report-block + .report-block { border-top: 1px dashed #cbd5e1; }
        .report-subtitle { font-weight: 600; margin: 0 0 4px; color: #1d4ed8; }
        .report-block-mate .report-subtitle { color: #047857; }
        .report-pn { margin: 0 0 6px; font-size: 14px; }
        .report-decoded { margin: 0 0 8px; color: #475569; font-size: 11px; }
        .report-summary { margin: 0 0 8px; color: #1f3a64; font-size: 13px; }
        .report-reasons { margin: 8px 0; color: #b45309; font-size: 12px; font-style: italic; }
        .report-art {
          display: flex; flex-wrap: wrap; align-items: center; gap: 18px;
          margin: 8px 0 12px; padding: 10px; background: #f8fafc;
          border: 1px solid #e2e8f0; border-radius: 6px;
        }
        .report-art-body { max-width: 240px; max-height: 130px; height: auto; }
        .report-art-faces { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; }
        .report-art-face { margin: 0; width: 200px; max-width: 200px; text-align: center; }
        .report-art-face svg { width: 100%; height: auto; max-width: 200px; max-height: 200px; display: block; background: #fff; }
        .report-art-face-cap {
          margin-top: 4px; font-size: 11px; font-weight: 600; color: #475569;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .report-art-face .pin-state-ring,
        .report-art-face .pin-hit-area { display: none !important; }
        .report-art-face .pin { cursor: default; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: ${dir === "rtl" ? "right" : "left"}; }
        th { background: #f1f5f9; }
        .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
        .report-print-bar { position: fixed; top: 12px; right: 12px; z-index: 9999; }
        .report-print-bar button { padding: 8px 14px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; border-radius: 6px; cursor: pointer; font: inherit; }
        @media print {
          body { padding: 0; }
          h3 { break-after: avoid; }
          .report-item { break-inside: avoid-page; page-break-inside: avoid; border-color: #000; }
          .report-group { break-inside: avoid; page-break-inside: avoid; }
          .report-group-heading { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .report-print-bar { display: none; }
        }
      </style></head><body>
      <div class="report-print-bar"><button type="button" onclick="window.print()">${escapeHtml(T("decoded.action.report"))}</button></div>
      <h1>${escapeHtml(titleText)}</h1>
      <div class="report-meta">${escapeHtml(metaText)}</div>
      <div class="report-disclaimer">${escapeHtml(T("report.disclaimer"))}</div>
      ${fragmentsHtml}
      </body></html>`;
  }

  function reportHtmlMarkup(report) {
    const arr = report?.self?.decoded?.arrangementId
      ? arrangementById(report.self.decoded.arrangementId)
      : state.selectedArrangement;
    const faceVariants = renderFaceVariants(arr);
    const fragment = reportBodyFragment(report, faceVariants, {});
    const title = `${T("report.title")} — ${report.meta.sourcePartNumber}`;
    const meta = `${report.meta.sourcePartNumber} · ${report.meta.generatedAt}`;
    return reportShellMarkup(title, meta, fragment);
  }

  function exportReportHtml(decoded, options = {}) {
    if (!decoded?.ok) return;
    const report = buildCrossRefReport(decoded);
    if (!report) return;
    const arr = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    const faceVariants = renderFaceVariants(arr);
    const fragment = reportBodyFragment(report, faceVariants, {});
    const titleText = `${T("report.title")} — ${report.meta.sourcePartNumber}`;
    const metaParts = [report.meta.sourcePartNumber, report.meta.generatedAt];
    if (options.viaInput && options.viaInput !== report.meta.sourcePartNumber) {
      metaParts.unshift(Tf("report.viaInput", { input: options.viaInput, vendor: options.vendor || "?" }));
    }
    const html = reportShellMarkup(titleText, metaParts.join(" · "), fragment);
    const w = window.open("", "_blank");
    if (!w) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      downloadBlob(blob, safeFilename(decoded.part_number, "html"));
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function renderArrangementToSvgString(arr) {
    if (!arr) return "";
    const liveSvg = els.connectorSvg;
    const prevArr = state.selectedArrangement;
    const prevViewBox = state.viewBox;
    const prevBaseViewBox = state.baseViewBox;
    try {
      state.selectedArrangement = arr;
      state.baseViewBox = connectorBaseViewBox(arr);
      state.viewBox = state.baseViewBox.slice();
      renderViewer();
      return cloneLiveConnectorSvg();
    } catch (err) {
      console.error("renderArrangementToSvgString failed", err);
      return "";
    } finally {
      state.selectedArrangement = prevArr;
      state.viewBox = prevViewBox;
      state.baseViewBox = prevBaseViewBox;
      if (prevArr) {
        try { renderViewer(); } catch (err) { /* ignore */ }
      } else {
        liveSvg.innerHTML = "";
      }
    }
  }

  // Renders the arrangement face in BOTH view modes so a report can embed the
  // engineering schematic and the true-colour ("real") face side by side. The
  // user's current view mode and live viewer are restored afterwards.
  function renderFaceVariants(arr) {
    const variants = { engineering: "", real: "" };
    if (!arr) return variants;
    const prevMode = state.viewMode;
    try {
      state.viewMode = "engineering";
      variants.engineering = renderArrangementToSvgString(arr);
      state.viewMode = "real";
      variants.real = renderArrangementToSvgString(arr);
    } catch (err) {
      console.error("renderFaceVariants failed", err);
    } finally {
      state.viewMode = prevMode;
      if (state.selectedArrangement) {
        try { renderViewer(); } catch (err) { /* ignore */ }
      }
    }
    return variants;
  }

  function decodeBatchEntry(rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) return { ok: false, raw: trimmed, reason: "empty" };
    let decoded = decodePartNumber(trimmed);
    if (decoded?.ok) return { ok: true, raw: trimmed, decoded };
    const reverse = reverseConvertSafe(trimmed);
    if (reverse && reverse.d38999) {
      decoded = decodePartNumber(reverse.d38999);
      if (decoded?.ok) {
        return { ok: true, raw: trimmed, decoded, reverseSource: reverse.source };
      }
    }
    return { ok: false, raw: trimmed, reason: "unrecognized" };
  }

  function buildBatchReportHtml(entries) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const items = [];
    const failures = [];
    entries.forEach((entry, index) => {
      const idx = index + 1;
      if (!entry.ok) {
        failures.push({ index: idx, raw: entry.raw, reason: entry.reason });
        return;
      }
      const report = buildCrossRefReport(entry.decoded);
      if (!report) {
        failures.push({ index: idx, raw: entry.raw, reason: "no-report" });
        return;
      }
      const arr = entry.decoded.arrangement_id ? arrangementById(entry.decoded.arrangement_id) : null;
      const faceVariants = renderFaceVariants(arr);
      const fragment = reportBodyFragment(report, faceVariants, {
        itemTitle: report.meta.sourcePartNumber,
        itemIndex: String(idx),
      });
      items.push(fragment);
    });
    const failuresFragment = failures.length
      ? `<article class="report-item report-item-failures">
           <div class="report-item-header">
             <span class="report-item-index" style="background:#b91c1c">!</span>
             <span class="report-item-title">${escapeHtml(T("report.batchUnrecognized"))}</span>
           </div>
           <ul class="report-failure-list">
             ${failures.map((f) => `<li class="mono">${escapeHtml(f.raw || "(empty)")} — ${escapeHtml(T("report.batchSkipped"))}</li>`).join("")}
           </ul>
         </article>`
      : "";
    const title = T("report.batchTitle");
    const meta = Tf("report.batchMeta", { ok: items.length, total: entries.length, generated: now });
    return reportShellMarkup(title, meta, items.join("") + failuresFragment);
  }

  function openBatchReportDialog() {
    const dlg = els.batchReportDialog;
    if (!dlg) return;
    if (els.batchReportStatus) els.batchReportStatus.textContent = "";
    if (typeof dlg.showModal === "function") {
      try { dlg.showModal(); }
      catch (err) { dlg.setAttribute("open", ""); }
    } else {
      dlg.setAttribute("open", "");
    }
    if (els.batchReportInput) {
      setTimeout(() => els.batchReportInput.focus(), 30);
    }
  }

  function closeBatchReportDialog() {
    const dlg = els.batchReportDialog;
    if (!dlg) return;
    if (typeof dlg.close === "function" && dlg.open) {
      try { dlg.close(); return; } catch (err) { /* fall through */ }
    }
    dlg.removeAttribute("open");
  }

  function runBatchReport() {
    const text = els.batchReportInput ? els.batchReportInput.value : "";
    const lines = String(text || "")
      .split(/\r?\n|;|\t/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      if (els.batchReportStatus) els.batchReportStatus.textContent = T("report.batchNeedInput");
      return;
    }
    const entries = lines.map((line) => decodeBatchEntry(line));
    const okCount = entries.filter((e) => e.ok).length;
    if (!okCount) {
      if (els.batchReportStatus) {
        const failed = entries.filter((e) => !e.ok).map((e) => e.raw).slice(0, 5).join(", ");
        els.batchReportStatus.textContent = `${T("report.batchAllFailed")} (${failed}${entries.length > 5 ? "…" : ""})`;
      }
      return;
    }
    if (els.batchReportStatus) {
      els.batchReportStatus.textContent = Tf("report.batchProgress", { ok: okCount, total: entries.length });
    }
    const html = buildBatchReportHtml(entries);
    const w = window.open("", "_blank");
    if (!w) {
      // Popup blocked — fall back to a download and keep dialog open with notice.
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      downloadBlob(blob, safeFilename(`d38999_batch_${entries.length}`, "html"));
      if (els.batchReportStatus) {
        els.batchReportStatus.textContent = T("report.batchPopupBlocked");
      }
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    closeBatchReportDialog();
  }

  function getReportTarget() {
    if (state.decoded?.ok) {
      return { decoded: state.decoded };
    }
    if (state.reportCandidate?.decoded?.ok) {
      return {
        decoded: state.reportCandidate.decoded,
        viaInput: state.reportCandidate.originalInput,
        vendor: state.reportCandidate.vendor,
      };
    }
    return null;
  }

  function updateViewerExportState() {
    const target = getReportTarget();
    const ok = Boolean(target);
    if (els.viewerReportButton) els.viewerReportButton.disabled = !ok;
    if (els.viewerExportHint) {
      if (ok && target.viaInput) {
        els.viewerExportHint.hidden = false;
        els.viewerExportHint.textContent = Tf("report.viaInputHint", {
          input: target.viaInput,
          pn: target.decoded.part_number,
          vendor: target.vendor || "?",
        });
        els.viewerExportHint.classList.add("via-mfn");
      } else {
        els.viewerExportHint.hidden = ok;
        els.viewerExportHint.textContent = T("report.exportHint");
        els.viewerExportHint.classList.remove("via-mfn");
      }
    }
    if (els.viewerReportBadge) {
      const text = ok ? mateBadgeText(target.decoded) : "";
      els.viewerReportBadge.textContent = text;
      els.viewerReportBadge.hidden = !text;
    }
  }

  function bindViewerExportControls() {
    if (els.viewerReportButton) {
      els.viewerReportButton.addEventListener("click", () => {
        const target = getReportTarget();
        if (!target) return;
        exportReportHtml(target.decoded, {
          viaInput: target.viaInput,
          vendor: target.vendor,
        });
      });
    }
    if (els.viewerBatchButton) {
      els.viewerBatchButton.addEventListener("click", openBatchReportDialog);
    }
    if (els.batchReportRun) {
      els.batchReportRun.addEventListener("click", runBatchReport);
    }
    if (els.batchReportCancel) {
      els.batchReportCancel.addEventListener("click", closeBatchReportDialog);
    }
    if (els.batchReportDialog) {
      els.batchReportDialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        closeBatchReportDialog();
      });
    }
    document.addEventListener("d38999:export-report", (event) => {
      const detail = event.detail || {};
      const pn = String(detail.partNumber || "").trim();
      if (!pn) return;
      const decoded = decodePartNumber(pn);
      if (!decoded?.ok) {
        if (typeof setMessage === "function" && els.decodeMessage) {
          setMessage(els.decodeMessage, decoded?.message || T("decode.enterPn"), true);
        } else if (typeof window !== "undefined" && window.alert) {
          window.alert(decoded?.message || "Could not decode part number for report.");
        }
        return;
      }
      exportReportHtml(decoded, {
        viaInput: detail.viaInput || null,
        vendor: detail.vendor || null,
      });
    });
    updateViewerExportState();
  }

  function mateBadgeText(decoded) {
    if (!decoded?.ok) return "";
    const candidates = mateCandidatesForDecoded(decoded) || [];
    if (!candidates.length) return T("report.mateBadgeNone");
    if (candidates.length === 1) return T("report.mateBadgeOne");
    return Tf("report.mateBadge", { count: candidates.length });
  }

  function exportDecodedCsv(decoded) {
    if (!decoded?.ok) return;
    const items = manualFieldItems(decoded);
    const rows = [[T("csv.field"), T("csv.code"), T("csv.meaning"), T("csv.why"), T("common.source")]];
    items.forEach((item) => rows.push([item.label, item.token, item.summary, item.use, item.source || ""]));
    const arrangement = decoded.arrangement_id ? arrangementById(decoded.arrangement_id) : null;
    if (arrangement) {
      rows.push([T("csv.insertArrangement"), decoded.arrangement_id, Tf("card.contacts", { count: arrangement.contact_count }), sizeSummary(arrangement), ""]);
    }
    rows.unshift([T("csv.partNumber"), decoded.part_number, "", "", ""]);
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${String(decoded.part_number || "d38999").replace(/[^A-Za-z0-9]+/g, "_")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      const shellStyle = { slash_sheet: doc.slash_sheet, slash_sheet_definition: dlaSlashSheetDefinition(doc.slash_sheet) };
      const title = getShellStyleLabel(shellStyle) || ([doc.component, doc.mount].filter(Boolean).join(", ") || doc.description);
      const text = getShellStyleDescription(shellStyle);
      return optionChip(doc.slash_sheet || "", title, text, active.ok && active.slash_sheet === doc.slash_sheet);
    }).join("");
    const activeProfile = active.ok ? (SHELL_PROFILE_TYPE[active.slash_sheet] || "plug") : "plug";
    const profileKeys = ["plug", "wall_receptacle", "jamnut_receptacle", "box_receptacle", "inline_receptacle", "cover"];
    const profileGrid = profileKeys.map((key) => `
      <div class="shell-profile-item${key === activeProfile ? " active" : ""}">
        ${SHELL_PROFILES[key]}
      </div>
    `).join("");
    return `
      <div class="field-graphic shell-type-graphic shell-profiles-grid" aria-hidden="true">
        ${profileGrid}
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

  function manualQuickReference() {
    return `
      <div class="manual-note"><strong>View orientation:</strong> Drawings show the insert's front (mating) face — the view looking into the connector from the mating side.</div>
      <div class="manual-note"><strong>Wire-side view:</strong> Wiring from behind mirrors the view left-to-right: labels stay the same but their left/right positions swap. The Layout Designer has a mating-face vs. wire-side toggle.</div>
      <div class="manual-note"><strong>Mating rule:</strong> A plug (P contacts) mates with a receptacle (S contacts) of the same shell size, insert arrangement, and keying. The mating tool finds the reciprocal connector for you.</div>
      <div class="manual-note"><strong>Shell type ≠ shell size:</strong> The slash sheet (e.g. /26) sets the body style (plug, jam-nut, wall-mount). The shell size comes from the later letter code (e.g. E = shell 17).</div>
      <div class="manual-note"><strong>Keying positions:</strong> N (normal) is the standard key angle. Alternate keying (A–E) rotates the key/keyway to prevent wrong mating on the same panel.</div>
    `;
  }

  function manualCoverage() {
    return `
      <div class="manual-note">Strong coverage: Series III/IV part-number field order, shell-size codes, contact styles, class/finish text, and Series III polarization table.</div>
      <div class="manual-note">The manual answers three practical questions: the shell style, the physical shell size, and the insert/pin arrangement inside the shell.</div>
      <div class="manual-note">DLA document pass: ${escapeHtml(dlaDocs.downloaded_count || 0)} official PDFs parsed from the MIL-DTL-38999 list, including approved shell-type source documents and initial drafts.</div>
      <div class="manual-note">Limited coverage: Series IV polarization isn't tabulated yet in this data set.</div>
    `;
  }

  function partNumberFieldCards() {
    const pattern = (partRules.part_number_patterns || [])[0] || {};
    const example = pattern.example || defs.part_number_examples?.series_iii_iv?.example || "D38999/26WE35PN";
    const fieldHelp = {
      family: "Connector family. D38999 = a MIL-DTL-38999 circular connector, not a commercial series.",
      slash_sheet: "Shell type (the /20, /24, /26, /46 field). Sets the body type — not the shell size.",
      class: "Material and finish class — the plating/material/environment code (e.g. cadmium, nickel, stainless, composite, hermetic).",
      shell_size_code: "Physical shell-size code. Series III/IV use letters A–J, mapping to numeric sizes 9–25.",
      insert_arrangement: "Insert layout number. Combine the numeric shell size with it to get the pin arrangement (e.g. shell E + insert 35 = 17-35).",
      contact_style: "Contact option: pin, socket, less contacts, PC-tail, eyelet, or high-cycle.",
      polarization: "Keying position. Rotating the key/keyway prevents mismating between connectors with the same shell and insert."
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
      <div class="manual-note">Read left to right: family, shell type, class, shell-size letter, insert arrangement, contact style, keying.</div>
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
      ["/26", "Shell type", `${getShellStyleLabel(decoded)}. ${getShellStyleDescription(decoded)}`],
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
      .map(([code, value]) => `<tr><td class="mono">${escapeHtml(code)}</td><td>${escapeHtml(value.shell_size)}</td><td>Combine with the insert number to select the pinout.</td></tr>`)
      .join("");
    return `
      <div class="manual-note">The shell-size letter is the physical shell. Larger sizes allow larger or denser inserts.</div>
      <div class="manual-note">The insert arrangement is the pin layout inside the shell, named as numeric-shell-size plus insert number, such as <span class="mono">17-35</span> or <span class="mono">25-35</span>.</div>
      <div class="manual-note">The pin table and drawing show contact labels, contact size, and any separation lines for the layout zones.</div>
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
    const sizeDiff = sizeSummary(a) === sizeSummary(b) ? T("compare.sameSize") : `${sizeSummary(a)} vs ${sizeSummary(b)}`;
    els.comparisonPanel.innerHTML = `
      ${compareCard(a)}
      ${compareCard(b)}
      <div class="compare-card">
        <strong>${escapeHtml(T("compare.difference"))}</strong>
        <div>${escapeHtml(Tf("compare.contactDelta", { delta: Math.abs(a.contact_count - b.contact_count) }))}</div>
        <div>${escapeHtml(sizeDiff)}</div>
      </div>
    `;
  }

  function compareCard(arr) {
    const viewBox = connectorBaseViewBox(arr);
    return `
      <div class="compare-card">
        <strong class="mono">${escapeHtml(arr.id)}</strong>
        <div>${escapeHtml(Tf("compare.cardMeta", { count: arr.contact_count, sizes: sizeSummary(arr) }))}</div>
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

  // =========================================================================
  // AI Chat Panel
  // =========================================================================

  function initChat() {
    const toggle = document.getElementById("chatToggle");
    const panel = document.getElementById("chatPanel");
    const closeBtn = document.getElementById("chatClose");
    const clearBtn = document.getElementById("chatClear");
    const settingsBtn = document.getElementById("chatSettings");
    const settingsPanel = document.getElementById("chatSettings-panel");
    const form = document.getElementById("chatForm");
    const input = document.getElementById("chatInput");
    const messagesEl = document.getElementById("chatMessages");
    const providerSel = document.getElementById("chatProvider");
    const modelSel = document.getElementById("chatModel");
    const apiKeyInput = document.getElementById("chatApiKey");
    const baseUrlInput = document.getElementById("chatBaseUrl");
    const proxyUrlInput = document.getElementById("chatProxyUrl");
    const ollamaUrlInput = document.getElementById("chatOllamaUrl");

    if (!toggle || !panel) return;

    let messages = [];
    let sending = false;

    // --- Persistence ---
    const STORAGE_KEY = "d38999_chat";
    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          messages,
          provider: providerSel.value,
          model: modelSel.value,
          apiKey: apiKeyInput.value,
          baseUrl: baseUrlInput.value,
          proxyUrl: proxyUrlInput.value,
          ollamaUrl: ollamaUrlInput ? ollamaUrlInput.value : "",
        }));
      } catch (_) {}
    }
    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        messages = s.messages || [];
        if (s.provider) providerSel.value = s.provider;
        if (s.model) modelSel.value = s.model;
        if (s.apiKey) apiKeyInput.value = s.apiKey;
        if (s.baseUrl) baseUrlInput.value = s.baseUrl;
        if (s.proxyUrl) proxyUrlInput.value = s.proxyUrl;
        if (s.ollamaUrl && ollamaUrlInput) ollamaUrlInput.value = s.ollamaUrl;
        renderMessages();
      } catch (_) {}
    }

    // --- Models list ---
    const STATIC_MODELS = {
      ollama_direct: ["gemma4", "llama3.1", "qwen2.5", "mistral", "gemma2"],
      ollama: ["gemma4", "llama3.1", "qwen2.5", "mistral", "gemma2"],
      openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano"],
      github: [
        // OpenAI
        "openai/gpt-4o", "openai/gpt-4o-mini",
        "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano",
        "openai/gpt-5", "openai/gpt-5-chat", "openai/gpt-5-mini", "openai/gpt-5-nano",
        "openai/o1", "openai/o1-mini", "openai/o1-preview",
        "openai/o3", "openai/o3-mini", "openai/o4-mini",
        // xAI
        "xai/grok-3", "xai/grok-3-mini",
        // DeepSeek
        "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528", "deepseek/deepseek-v3-0324",
        // Microsoft
        "microsoft/mai-ds-r1",
        "microsoft/phi-4", "microsoft/phi-4-mini-instruct", "microsoft/phi-4-mini-reasoning",
        "microsoft/phi-4-multimodal-instruct", "microsoft/phi-4-reasoning",
        // Meta
        "meta/meta-llama-3.1-405b-instruct", "meta/meta-llama-3.1-8b-instruct",
        "meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct",
        "meta/llama-3.3-70b-instruct",
        "meta/llama-4-maverick-17b-128e-instruct-fp8", "meta/llama-4-scout-17b-16e-instruct",
        // Mistral AI
        "mistral-ai/mistral-medium-2505", "mistral-ai/mistral-small-2503",
        "mistral-ai/codestral-2501", "mistral-ai/ministral-3b",
        // Cohere
        "cohere/cohere-command-a",
        "cohere/cohere-command-r-plus-08-2024", "cohere/cohere-command-r-08-2024",
        // AI21 Labs
        "ai21-labs/ai21-jamba-1.5-large",
      ],
      gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
      anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
    };

    // GitHub Models tier info (from catalog API rate_limit_tier field)
    // "custom" = requires paid billing / special access
    // "high"   = Pro/Team plan
    // "low"    = free for all
    const GITHUB_TIERS = {
      custom: new Set([
        "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528", "microsoft/mai-ds-r1",
        "openai/gpt-5", "openai/gpt-5-chat", "openai/gpt-5-mini", "openai/gpt-5-nano",
        "openai/o1", "openai/o1-mini", "openai/o1-preview",
        "openai/o3", "openai/o3-mini", "openai/o4-mini",
        "xai/grok-3", "xai/grok-3-mini",
      ]),
      high: new Set([
        "ai21-labs/ai21-jamba-1.5-large", "cohere/cohere-command-r-plus-08-2024",
        "deepseek/deepseek-v3-0324",
        "meta/llama-3.2-90b-vision-instruct", "meta/llama-3.3-70b-instruct",
        "meta/llama-4-maverick-17b-128e-instruct-fp8", "meta/llama-4-scout-17b-16e-instruct",
        "meta/meta-llama-3.1-405b-instruct",
        "openai/gpt-4.1", "openai/gpt-4o",
      ]),
    };

    function githubModelLabel(id) {
      if (GITHUB_TIERS.custom.has(id)) return `${id}  [paid]`;
      if (GITHUB_TIERS.high.has(id)) return `${id}  [pro]`;
      return id;
    }

    function populateModels() {
      const provider = providerSel.value;
      const list = STATIC_MODELS[provider] || [];
      if (provider === "github") {
        // Group into optgroups by tier
        const groups = { low: [], high: [], custom: [] };
        list.forEach(m => {
          if (GITHUB_TIERS.custom.has(m)) groups.custom.push(m);
          else if (GITHUB_TIERS.high.has(m)) groups.high.push(m);
          else groups.low.push(m);
        });
        const makeGroup = (label, models) => models.length
          ? `<optgroup label="${label}">${models.map(m => `<option value="${m}">${m}</option>`).join("")}</optgroup>`
          : "";
        modelSel.innerHTML =
          makeGroup("Free tier", groups.low) +
          makeGroup("Pro / Team tier", groups.high) +
          makeGroup("Paid (billing required)", groups.custom);
      } else {
        modelSel.innerHTML = list.map(m => `<option value="${m}">${m}</option>`).join("");
      }
      if (provider === "ollama_direct") {
        fetchModelsOllama();
      } else {
        fetchModels(provider);
      }
    }

    async function fetchModelsOllama() {
      try {
        const base = ollamaUrlInput ? ollamaUrlInput.value.replace(/\/$/, "") : "http://localhost:11434";
        const resp = await fetch(`${base}/api/tags`);
        if (!resp.ok) return;
        const data = await resp.json();
        const names = (data.models || []).map(m => m.name);
        if (names.length) {
          const prev = modelSel.value;
          modelSel.innerHTML = names.map(m => `<option value="${m}">${m}</option>`).join("");
          if (names.includes(prev)) modelSel.value = prev;
        }
      } catch (_) {}
    }

    async function fetchModels(provider) {
      try {
        const proxy = proxyUrlInput.value.replace(/\/$/, "");
        const resp = await fetch(`${proxy}/api/models`);
        if (!resp.ok) return;
        const data = await resp.json();
        const list = data[provider];
        if (list && list.length) {
          const prev = modelSel.value;
          modelSel.innerHTML = list.map(m => `<option value="${m}">${m}</option>`).join("");
          if (list.includes(prev)) modelSel.value = prev;
        }
      } catch (_) {}
    }

    providerSel.addEventListener("change", () => { populateModels(); saveState(); });

    // --- Settings panel toggle (CSS-class based, not hidden attribute) ---
    function openSettings() {
      settingsPanel.classList.remove("chat-settings-panel--closed");
      settingsBtn.classList.add("active");
    }
    function closeSettings() {
      settingsPanel.classList.add("chat-settings-panel--closed");
      settingsBtn.classList.remove("active");
    }

    // --- Save button ---
    const saveBtn = document.getElementById("chatSaveSettings");
    const savedMsg = document.getElementById("chatSavedMsg");
    let savedTimer = null;
    function doSave() {
      saveState();
      if (savedMsg) {
        savedMsg.textContent = "Saved!";
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => { savedMsg.textContent = ""; }, 2000);
      }
    }
    if (saveBtn) saveBtn.addEventListener("click", doSave);

    // Auto-save on every settings field change
    [apiKeyInput, baseUrlInput, proxyUrlInput, modelSel, ollamaUrlInput].forEach(el => {
      if (el) el.addEventListener("change", saveState);
    });

    // --- Open / close / minimize ---
    const minimizeBtn = document.getElementById("chatMinimize");
    function openChat() {
      panel.classList.remove("chat-panel--closed");
      panel.classList.remove("minimized");
      toggle.setAttribute("aria-label", "Close AI Chat");
      toggle.setAttribute("title", "Close AI Chat");
      toggle.classList.add("open");
      input.focus();
    }
    function closeChat() {
      panel.classList.add("chat-panel--closed");
      toggle.setAttribute("aria-label", "Open AI Chat");
      toggle.setAttribute("title", "AI Chat");
      toggle.classList.remove("open");
    }
    toggle.addEventListener("click", () => {
      const isOpen = !panel.classList.contains("chat-panel--closed") && !panel.classList.contains("minimized");
      if (isOpen) { closeChat(); } else { openChat(); }
    });
    closeBtn.addEventListener("click", closeChat);
    minimizeBtn.addEventListener("click", () => {
      panel.classList.toggle("minimized");
    });
    clearBtn.addEventListener("click", () => {
      messages = [];
      renderMessages();
      saveState();
    });
    settingsBtn.addEventListener("click", () => {
      const isOpen = !settingsPanel.classList.contains("chat-settings-panel--closed");
      if (isOpen) { closeSettings(); } else { openSettings(); }
    });

    // --- Render messages ---
    function renderMessages() {
      messagesEl.innerHTML = messages.map(m => {
        const cls = m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant";
        const content = formatMessage(m.content || "");
        return `<div class="chat-msg ${cls}">${content}</div>`;
      }).join("");
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function formatMessage(text) {
      // Escape HTML first
      let safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // Inline code
      safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
      // Detect D38999 part numbers and make clickable
      safe = safe.replace(/\b(D38999\/\w+)\b/g, '<span class="chat-pn-link" data-pn="$1">$1</span>');
      return safe;
    }

    // --- Click on part numbers in chat ---
    messagesEl.addEventListener("click", (e) => {
      const link = e.target.closest(".chat-pn-link");
      if (!link) return;
      const pn = link.dataset.pn;
      if (!pn) return;
      // Navigate to decoder tab and decode
      const partInput = document.getElementById("partNumberInput");
      if (partInput) {
        partInput.value = pn;
        // Click decode button
        const decBtn = document.getElementById("decodeButton");
        if (decBtn) decBtn.click();
        // Switch to decoder tab
        const tabBtn = document.querySelector('[data-tab="decoder"]');
        if (tabBtn) tabBtn.click();
      }
    });

    // --- Auto-resize textarea ---
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });

    // --- Submit ---
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || sending) return;

      // Inject context about current decoded part number if available
      let contextPrefix = "";
      const decoded = state && state.decoded;
      if (decoded && decoded.raw) {
        contextPrefix = `[Context: user is viewing decoded part number ${decoded.raw}] `;
      }

      messages.push({ role: "user", content: text });
      input.value = "";
      input.style.height = "auto";
      renderMessages();
      saveState();

      sending = true;
      const typingEl = document.createElement("div");
      typingEl.className = "chat-typing";
      typingEl.textContent = "Thinking…";
      messagesEl.appendChild(typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const provider = providerSel.value;
        const model = modelSel.value;
        const historyMessages = messages
          .map(m => m.role === "error" ? null : { role: m.role, content: m.role === "user" && m === messages[messages.length - 1] ? contextPrefix + m.content : m.content })
          .filter(Boolean);

        let data;

        if (provider === "ollama_direct") {
          // Call Ollama REST API directly from the browser — no proxy needed
          const ollamaBase = (ollamaUrlInput ? ollamaUrlInput.value : "http://localhost:11434").replace(/\/$/, "");
          const resp = await fetch(`${ollamaBase}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: historyMessages, stream: false }),
          });
          if (!resp.ok) {
            const txt = await resp.text();
            data = { error: `Ollama error ${resp.status}: ${txt}` };
          } else {
            const raw = await resp.json();
            const content = raw.message?.content || raw.response || "(empty response)";
            data = { content };
          }
        } else {
          // Route through the Python proxy
          const proxy = proxyUrlInput.value.replace(/\/$/, "");
          const payload = { messages: historyMessages, provider, model };
          const key = apiKeyInput.value.trim();
          if (key) payload.apiKey = key;
          const base = baseUrlInput.value.trim();
          if (base) payload.baseUrl = base;
          const resp = await fetch(`${proxy}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          data = await resp.json();
          if (!resp.ok) data = { error: data.error || `Error ${resp.status}` };
        }

        if (data.error) {
          messages.push({ role: "error", content: data.error });
        } else {
          messages.push({ role: "assistant", content: data.content || "(no response)" });
        }
      } catch (err) {
        messages.push({ role: "error", content: `Connection failed: ${err.message}. Is the proxy running?` });
      } finally {
        sending = false;
        typingEl.remove();
        renderMessages();
        saveState();
      }
    });

    // Enter to send, Shift+Enter for newline
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });

    // Init
    populateModels();
    loadState();

    // --- Drag to move ---
    const header = panel.querySelector(".chat-header");
    let dragOffset = { x: 0, y: 0 };
    let dragging = false;

    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      panel.style.left = Math.max(0, x) + "px";
      panel.style.top = Math.max(0, y) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => { dragging = false; });

    // --- Resize from top-left corner handle ---
    const resizeHandle = document.getElementById("chatResizeHandle");
    if (resizeHandle) {
      let resizing = false;
      let startX, startY, startW, startH, startLeft, startTop;

      resizeHandle.addEventListener("mousedown", (e) => {
        resizing = true;
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
        e.stopPropagation();
      });
      document.addEventListener("mousemove", (e) => {
        if (!resizing) return;
        const dx = startX - e.clientX;
        const dy = startY - e.clientY;
        const newW = Math.max(300, startW + dx);
        const newH = Math.max(200, startH + dy);
        panel.style.width = newW + "px";
        panel.style.height = newH + "px";
        panel.style.left = (startLeft - (newW - startW)) + "px";
        panel.style.top = (startTop - (newH - startH)) + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      });
      document.addEventListener("mouseup", () => { resizing = false; });
    }
  }

  init();
})();
