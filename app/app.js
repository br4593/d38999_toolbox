(function () {
  "use strict";

  const toolboxData = window.D38999_TOOLBOX_DATA || {};
  const DATA = toolboxData.pinout || window.D38999_DATA || {};
  const converterData = toolboxData.converter || {};
  const insertData = DATA.insertArrangements || { arrangements: [] };
  const partRules = DATA.partNumberRules || {};
  const standard = DATA.standardDefinitions || { definitions: {} };
  const dlaDocs = DATA.dlaDocuments || { documents: [], summary: {} };
  const reviewData = DATA.reviewNeeded || { items: [] };
  const defs = standard.definitions || {};
  const arrangements = (insertData.arrangements || []).slice();
  const reviewById = new Map((reviewData.items || []).map((item) => [item.id, item]));

  const state = {
    selectedArrangement: null,
    selectedContactIndex: null,
    currentPartNumber: "",
    decoded: null,
    hoveredContactIndex: null,
    pinMatches: new Set(),
    sortKey: "label",
    sortDir: 1,
    viewBox: null,
    baseViewBox: null,
    isPanning: false,
    panStart: null,
    panViewBox: null,
    activeTab: "pinout",
    activeManualField: "slash_sheet",
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    dataStatus: $("dataStatus"),
    selectedStatus: $("selectedStatus"),
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
    arrangementCards: $("arrangementCards"),
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
    pinTable: $("pinTable"),
    tableMessage: $("tableMessage"),
    decodedPanel: $("decodedPanel"),
    partNumberGuidePanel: $("partNumberGuidePanel"),
    manualPanel: $("manualPanel"),
    manualContent: $("manualContent"),
    pinDetailHeader: $("pinDetailHeader"),
    exportPinCsvButton: $("exportPinCsvButton"),
    copyTableButton: $("copyTableButton"),
    printReportButton: $("printReportButton"),
  };

  function normalizeConfidence(value) {
    return String(value || "unknown").replace(/\s+/g, "_").toLowerCase();
  }

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
    renderManual();
    renderPartNumberGuide(null);
    renderCards();
    if (arrangements.length) {
      selectArrangement(arrangements.find((arr) => arr.id === "17-26") || arrangements[0], true);
    }
    renderDecoded(null);
    renderComparison();
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
      element.addEventListener("input", renderCards);
      element.addEventListener("change", renderCards);
    }
    els.compareA.addEventListener("change", renderComparison);
    els.compareB.addEventListener("change", renderComparison);
    els.labelsToggle.addEventListener("change", renderViewer);
    els.outlineToggle.addEventListener("change", renderViewer);
    els.resetViewButton.addEventListener("click", resetView);
    els.pinSearchInput.addEventListener("input", searchPin);
    els.exportPinCsvButton.addEventListener("click", exportPinCsv);
    els.copyTableButton.addEventListener("click", copyTable);
    els.printReportButton.addEventListener("click", () => window.print());
    els.pinTable.querySelector("thead").addEventListener("click", onTableSort);
    els.partNumberGuidePanel.addEventListener("click", onManualTokenClick);
    els.manualContent.addEventListener("click", onManualTokenClick);
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => selectTab(button.dataset.tab));
    });
    bindPanZoom();
  }

  function onManualTokenClick(event) {
    const button = event.target.closest("[data-manual-field]");
    if (!button) return;
    state.activeManualField = button.dataset.manualField || "slash_sheet";
    renderPartNumberGuide(state.decoded);
    renderManual();
  }

  function selectTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    const panel = $(`${tabName}Panel`);
    if (panel) panel.classList.add("active");
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

  function renderCards() {
    const filtered = filteredArrangements();
    els.arrangementCards.innerHTML = "";
    for (const arr of filtered) {
      const card = document.createElement("div");
      card.className = `arrangement-card ${state.selectedArrangement?.id === arr.id ? "active" : ""}`;
      card.innerHTML = `
        <strong>${escapeHtml(arr.id)}</strong>
        <span>${arr.contact_count} contacts | ${escapeHtml(sizeSummary(arr))}</span>
        <span>Service ${escapeHtml(arr.service_rating || "unknown")} | source page ${arr.source_page}</span>
      `;
      card.addEventListener("click", () => selectArrangement(arr, true));
      els.arrangementCards.appendChild(card);
    }
    if (!filtered.length) {
      els.arrangementCards.innerHTML = `<div class="message warn">No arrangements match the current filters.</div>`;
    }
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
    renderCards();
    renderViewer();
    renderTable();
    renderSourceInfo();
    renderPinDetail();
    els.selectedStatus.textContent = `${arrangement.id} | ${arrangement.contact_count} contacts`;
  }

  function renderSourceInfo() {
    const arr = state.selectedArrangement;
    if (!arr) return;
    els.viewerTitle.textContent = `Insert Arrangement ${arr.id}`;
    const review = reviewById.get(arr.id);
    const warning = review ? ` | review: ${review.issues.length} issue(s)` : "";
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

  function keyingDrawing(arr) {
    const group = svgEl("g", { class: "keying-drawing" });
    const decoded = state.decoded?.ok && state.decoded.arrangement_id === arr.id ? state.decoded : null;
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
    const classes = ["pin", `size-${cssToken(contact.size)}`, `type-${cssToken(contact.type)}`];
    if (state.selectedContactIndex === contact._index) classes.push("selected");
    if (state.pinMatches.has(contact._key)) classes.push("search-match");
    if (contact.confidence !== "high" || contact.label === "?") classes.push("needs-review");
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
    const width = Math.max(text.length * radius * 0.8, radius * 5.2);
    const height = radius * 2.75;
    const x = contact.x + radius * 2.3;
    const y = contact.y - height - radius * 1.2;
    const group = svgEl("g", { class: "hover-pin-label" });
    group.appendChild(svgEl("line", {
      class: "hover-pin-leader",
      x1: contact.x,
      y1: contact.y,
      x2: x,
      y2: y + height,
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
      x: x + radius * 0.65,
      y: y + radius * 1.05,
      "font-size": radius * 0.9,
    }, text));
    group.appendChild(svgEl("text", {
      class: "hover-pin-label-detail",
      x: x + radius * 0.65,
      y: y + radius * 2.05,
      "font-size": radius * 0.62,
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
    renderTable();
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
      renderTable();
      return;
    }
    const contacts = currentContacts();
    let matches = contacts.filter((contact) => contact.label === query);
    if (!matches.length) matches = contacts.filter((contact) => contact.label.toLowerCase() === query.toLowerCase());
    matches.forEach((contact) => state.pinMatches.add(contact._key));
    if (matches.length) {
      selectContact(matches[0]._index, true);
      setMessage(els.searchMessage, `${matches.length} pin match(es).`);
    } else {
      setMessage(els.searchMessage, "Pin not found in this insert arrangement.", true);
      renderViewer();
      renderTable();
    }
  }

  function renderTable() {
    const tbody = els.pinTable.querySelector("tbody");
    const contacts = currentContacts().slice();
    contacts.sort((a, b) => compareRows(a, b));
    tbody.innerHTML = "";
    for (const contact of contacts) {
      const row = document.createElement("tr");
      row.className = [
        state.selectedContactIndex === contact._index ? "active" : "",
        state.pinMatches.has(contact._key) ? "match" : "",
      ].join(" ");
      row.innerHTML = `
        <td class="mono">${escapeHtml(contact.label)}</td>
        <td class="mono">${escapeHtml(contact.size)}</td>
        <td>${escapeHtml(contact.type)}</td>
        <td>${escapeHtml(contact.confidence)}</td>
        <td>${escapeHtml(labelSource(contact))}</td>
      `;
      row.addEventListener("click", () => selectContact(contact._index, true));
      tbody.appendChild(row);
    }
  }

  function compareRows(a, b) {
    const key = state.sortKey;
    const av = tableValue(a, key);
    const bv = tableValue(b, key);
    const numeric = false;
    const result = numeric ? Number(av) - Number(bv) : naturalCompare(av, bv);
    return result * state.sortDir;
  }

  function tableValue(contact, key) {
    if (key === "label_confidence") return labelSource(contact);
    return contact[key] || "";
  }

  function onTableSort(event) {
    const th = event.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sortKey === key) state.sortDir *= -1;
    else {
      state.sortKey = key;
      state.sortDir = 1;
    }
    renderTable();
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
    renderDecoded(decoded);
    renderPartNumberGuide(decoded);
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
    setMessage(els.decodeMessage, `Decoded ${decoded.part_number}.${defaultNote}`);
    const arr = arrangementById(decoded.arrangement_id);
    if (arr) selectArrangement(arr, true);
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

  function renderDecoded(decoded) {
    if (!decoded) {
      els.decodedPanel.innerHTML = `<div class="detail-item"><div class="value">No part number decoded.</div></div>`;
      return;
    }
    if (!decoded.ok) {
      els.decodedPanel.innerHTML = `<div class="detail-item"><div class="value">${escapeHtml(decoded.message)}</div></div>`;
      return;
    }
    const rows = [
      ["Family", decoded.family, sourceRef(decoded.source_pattern?.fields?.[0])],
      ["Shell type", `${decoded.slash_sheet} - ${decoded.slash_sheet_definition?.description || "unknown"}`, sourceRef(decoded.slash_sheet_definition || decoded.source_pattern?.fields?.[1])],
      ["Class / finish", `${decoded.class_field} - ${decoded.class_definition?.description || "unknown"}`, sourceRef(decoded.class_definition)],
      ["Shell size", `${decoded.shell_size} (code ${decoded.shell_code})`, sourceRef(decoded.shell_size_definition)],
      ["Insert arrangement", decoded.arrangement_id, sourceRef(decoded.source_pattern?.fields?.[4])],
      ["Contact style", `${decoded.contact_style} - ${decoded.contact_definition?.description || "unknown"}`, sourceRef(decoded.contact_definition)],
      ["Contact gender", decoded.contact_definition?.contact_gender || "unknown", sourceRef(decoded.contact_definition)],
      ["Polarization", `${decoded.polarization} - ${decoded.polarization_definition?.description || "unknown"}`, sourceRef(decoded.polarization_definition || decoded.source_pattern?.fields?.[6])],
      ["Arrangement SVG", decoded.arrangement_exists ? "available" : "not extracted", decoded.arrangement_exists ? "d38999-contact-arrangements.pdf" : "needs manual verification"],
    ];
    els.decodedPanel.innerHTML = rows
      .map(([name, value, src]) => detailHtml(name, value, src))
      .join("");
  }

  function renderPartNumberGuide(decoded) {
    const pattern = (partRules.part_number_patterns || [])[0];
    if (!els.partNumberGuidePanel || !pattern) return;
    els.partNumberGuidePanel.innerHTML = interactivePnGuide(decoded, "compact");
  }

  function renderManual() {
    if (!els.manualContent) return;
    const sections = [
      ["Interactive PN Decoder", interactivePnGuide(state.decoded, "manual")],
      ["How To Choose The Connector", connectorDecisionGraphic(state.decoded)],
      ["Coverage", manualCoverage()],
      ["Part Number Fields", partNumberFieldCards()],
      ["Example PN Breakdown", partNumberExampleBreakdown()],
      ["Shell Size And Pins", shellAndPinArrangementHelp()],
      ["Shell Types", dlaSlashSheetSummary()],
      ["Series", definitionCards(defs.series)],
      ["Shell Size Codes", keyValueTable(defs.shell_size_codes_series_iii_iv, (key, value) => [key, value.shell_size, value.section])],
      ["Contact Styles", keyValueTable(defs.contact_styles, (key, value) => [key, value.contact_gender || "", value.description])],
      ["Classes / Finishes", keyValueTable(defs.classes, (key, value) => [key, value.confidence || "", value.description])],
      ["Polarization", polarizationSummary()],
      ["Known Limits", manualWarnings()],
    ];
    els.manualContent.innerHTML = sections.map(([title, body]) => `
      <section class="manual-section">
        <h3>${escapeHtml(title)}</h3>
        ${body}
      </section>
    `).join("");
  }

  function activeDecodedOrExample(decoded) {
    if (decoded?.ok) return decoded;
    return decodePartNumber("D38999/26WE35PN");
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

  function exportPinCsv() {
    if (!state.selectedArrangement) return;
    const rows = tableRows();
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadText(`d38999_${state.selectedArrangement.id}_pins.csv`, csv, "text/csv");
    setMessage(els.tableMessage, `Exported ${state.selectedArrangement.id} pin catalog.`);
  }

  function tableRows() {
    const header = ["pin", "contact_size", "type", "confidence", "label_source"];
    const rows = [header];
    for (const contact of currentContacts()) {
      rows.push([
        contact.label,
        contact.size,
        contact.type,
        contact.confidence,
        labelSource(contact),
      ]);
    }
    return rows;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function copyTable() {
    const csv = tableRows().map((row) => row.join("\t")).join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(csv).then(
        () => setMessage(els.tableMessage, "Copied pin table to clipboard."),
        () => fallbackCopy(csv)
      );
    } else {
      fallbackCopy(csv);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    setMessage(els.tableMessage, "Copied pin table to clipboard.");
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
