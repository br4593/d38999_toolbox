/* =========================================================================
   Layout Designer — D38999 Toolbox
   AI-assisted pin layout design, validation, and export.

   ⚠️  This module produces engineering suggestions only.
   Results must be reviewed by a qualified professional before
   manufacturing or field use.
   ========================================================================= */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     Constants & colour system
  ------------------------------------------------------------------ */
  const GROUP_COLORS = {
    power_pos:   "#ef4444",   // red
    power_ret:   "#1f2937",   // black
    chassis_gnd: "#374151",   // dark grey
    shield:      "#9ca3af",   // grey
    ethernet:    "#3b82f6",   // blue
    usb:         "#06b6d4",   // cyan
    can:         "#22c55e",   // green
    rs485:       "#22c55e",
    rs422:       "#22c55e",
    uart:        "#f97316",   // orange
    i2c:         "#eab308",   // yellow
    spi:         "#a855f7",   // purple
    hdmi:        "#8b5cf6",   // violet
    dvi:         "#8b5cf6",
    displayport: "#8b5cf6",
    vga:         "#ec4899",   // pink
    dpi:         "#92400e",   // brown
    spare:       "#e5e7eb",   // white/light
    sealed:      "#d1d5db",   // light grey
    other:       "#6b7280",
  };

  const STATUS_ICONS = { assigned: "●", spare: "○", sealed: "⊘", warn: "⚠", error: "✖" };

  // Contact current ratings — fallback values; overridden at runtime from pinout_rules.json
  // (MIL-DTL-38999 Table IV single-contact ratings, derated ≈ 70% for typical harness bundle)
  const CONTACT_CURRENT_RATINGS = {
    "8":  { derated: 32, max: 46 },
    "10": { derated: 16, max: 23 },
    "12": { derated: 16, max: 23 },
    "16": { derated: 9,  max: 13 },
    "20": { derated: 5,  max: 7.5 },
    "22D":{ derated: 3.5, max: 5 },
    "22d":{ derated: 3.5, max: 5 },
  };

  // Overwrite from pinout_rules at runtime (called once data is loaded)
  function loadContactRatingsFromRules() {
    const rules = getPinoutRules();
    const ratings = (rules.wire_gauge_current_capacity || {}).mil_dtl_38999_contact_single_ratings || {};
    Object.entries(ratings).forEach(([size, v]) => {
      if (v && typeof v.amps_continuous === "number") {
        // derate to 70% for bundled harness (MIL-HDBK-522 factor for typical bundle)
        const max = v.amps_continuous;
        const derated = +(max * 0.70).toFixed(1);
        CONTACT_CURRENT_RATINGS[size] = { derated, max };
        if (size === "22D") CONTACT_CURRENT_RATINGS["22d"] = { derated, max };
      }
    });
  }

  const PROTOCOL_REQUIRED_SIGNALS = {
    uart:   ["TX", "RX", "GND"],
    i2c:    ["SDA", "SCL", "GND"],
    spi:    ["SCLK", "MOSI", "MISO", "CS", "GND"],
    can:    ["CAN_H", "CAN_L"],
    rs485:  ["A", "B"],
    rs422:  ["TX+", "TX-", "RX+", "RX-"],
    usb2:   ["VBUS", "D+", "D-", "GND"],
    usb3:   ["VBUS", "D+", "D-", "TX+", "TX-", "RX+", "RX-", "GND"],
    ethernet: ["TX+", "TX-", "RX+", "RX-"],
  };

  const HIGH_SPEED_PROTOCOLS = new Set(["usb3", "usb_c", "hdmi", "dvi", "displayport", "ethernet_1g", "ethernet_10g"]);

  // Curated protocol list for the dropdown picker
  const PROTOCOL_LIST = [
    { value: "can",          label: "CAN Bus" },
    { value: "rs485",        label: "RS-485" },
    { value: "rs422",        label: "RS-422" },
    { value: "uart",         label: "UART / RS-232" },
    { value: "i2c",          label: "I\u00B2C" },
    { value: "spi",          label: "SPI" },
    { value: "ethernet",     label: "Ethernet 100M" },
    { value: "ethernet_1g",  label: "Ethernet 1G" },
    { value: "ethernet_10g", label: "Ethernet 10G" },
    { value: "usb2",         label: "USB 2.0" },
    { value: "usb3",         label: "USB 3.x" },
    { value: "usb_c",        label: "USB-C" },
    { value: "hdmi",         label: "HDMI" },
    { value: "displayport",  label: "DisplayPort" },
    { value: "mil1553",      label: "MIL-STD-1553" },
    { value: "arinc429",     label: "ARINC 429" },
    { value: "analog",       label: "Analog signal" },
    { value: "discrete",     label: "Discrete I/O" },
    { value: "audio",        label: "Audio" },
    { value: "video",        label: "Video (analog)" },
    { value: "rf",           label: "RF / Coax" },
  ];

  /* ------------------------------------------------------------------
     State
  ------------------------------------------------------------------ */
  const ld = {
    arrangement: null,      // selected insert arrangement object
    contacts: [],           // [{cavity, signal, group, protocol, dir, voltage, current, awg, size, pairId, shieldGroup, status, notes}]
    editingCavity: null,    // cavity ID string being edited
    zoom: 1.0,
    labelMode: "signal",
    validationResults: { critical: [], warnings: [], suggestions: [], passed: [] },
    rendered: false,
  };

  /* ------------------------------------------------------------------
     DOM helpers
  ------------------------------------------------------------------ */
  const $ = id => document.getElementById(id);
  const show = el => { if (el) el.hidden = false; };
  const hide = el => { if (el) el.hidden = true; };

  /* ------------------------------------------------------------------
     Populate arrangement dropdown from existing app data
  ------------------------------------------------------------------ */
  function populateArrangements() {
    const sel = $("ld-arrangement");
    if (!sel) return;
    const arrangements = getArrangements();
    sel.innerHTML = '<option value="">\u2014 auto \u2014</option>';
    arrangements.forEach(arr => {
      const opt = document.createElement("option");
      opt.value = arr.id;
      const shellSize = arr.shell_size ? ` (shell ${arr.shell_size})` : "";
      const count = arr.contact_count ? `, ${arr.contact_count} contacts` : "";
      opt.textContent = `${arr.id}${shellSize}${count}`;
      sel.appendChild(opt);
    });
  }

  /* ------------------------------------------------------------------
     Auto-select best arrangement for given requirements
  ------------------------------------------------------------------ */
  function autoSelectArrangement(powerRails, signalGroups, spareEnable, emiMode) {
    const arrangements = getArrangements();
    if (!arrangements.length) return null;

    // Count minimum pins needed
    let powerPins = powerRails.length * 2; // positive + return for each rail
    let signalPins = 0;
    let groupIdx = 0;
    const skipped = []; // groups that have a pin deficit — noted but still counted in requirement
    signalGroups.forEach(sg => {
      const proto = normalizeProto(sg.protocol);
      const count = parseInt(sg.count) || 1;
      signalPins += protocolSignalNames(proto, count).length;
    });
    if (emiMode && (powerPins + signalPins) > 0) signalPins += 1; // EMI GND

    const minPins = powerPins + signalPins;
    if (minPins === 0) return null; // nothing requested yet

    const spareTarget = spareEnable ? Math.ceil(minPins * 0.18) : 0;
    const required = minPins + spareTarget;

    // Max current for power contact sizing
    const maxAmps = powerRails.reduce((m, r) => Math.max(m, parseFloat(r.amps) || 0), 0);

    // Find candidates that fit
    const candidates = arrangements.filter(a => a.contact_count >= required);

    // If nothing fits, return largest
    if (candidates.length === 0) {
      return arrangements.slice().sort((a, b) => b.contact_count - a.contact_count)[0] || null;
    }

    // Score: minimize excess contacts; penalise if high-current and no large contacts
    candidates.sort((a, b) => {
      let sA = (a.contact_count - required) * 10;
      let sB = (b.contact_count - required) * 10;
      if (maxAmps > 7.5) {
        const hasLargeA = (a.contacts || []).some(c => ["8","10","12"].includes(c.size));
        const hasLargeB = (b.contacts || []).some(c => ["8","10","12"].includes(c.size));
        if (!hasLargeA) sA += 1000;
        if (!hasLargeB) sB += 1000;
      }
      return sA - sB;
    });
    return candidates[0];
  }

  /* Shell size → Series III letter code (TABLE I of MIL-DTL-38999) */
  const SHELL_CODES = { "9":"A","11":"B","13":"C","15":"D","17":"E","19":"F","21":"G","23":"H","25":"J" };

  function suggestPN(arr, role) {
    if (!arr) return "";
    const shellCode = SHELL_CODES[String(arr.shell_size)];
    if (!shellCode) return "";
    const arrNum = arr.arrangement_number;
    if (!arrNum) return "";
    const isPlug = role !== "receptacle";
    // /26 = Series III; W = straight plug, F = jam-nut receptacle; P = pin, S = socket; N = nickel finish
    return `D38999/26${isPlug ? "W" : "F"}${shellCode}${arrNum}${isPlug ? "P" : "S"}N`;
  }

  function renderArrangementSuggest(arr, required) {
    const el = $("ld-arr-suggest");
    if (!el) return;
    if (!arr) { el.hidden = true; return; }
    const excess = arr.contact_count - required;
    const role = ($("ld-role") || {}).value || "plug";
    const pn = suggestPN(arr, role);
    el.hidden = false;
    el.innerHTML =
      (pn ? `<div class="ld-arr-pn"><span class="ld-arr-pn-label">Suggested P/N</span>` +
             `<code class="ld-arr-badge" title="Click to copy" style="cursor:pointer" onclick="navigator.clipboard&&navigator.clipboard.writeText('${pn}')">${pn}</code></div>` : "") +
      `<div class="ld-arr-info">Insert <strong>${arr.id}</strong> &middot; shell&nbsp;${arr.shell_size || "?"} &middot; ${arr.contact_count}&nbsp;contacts` +
      (excess > 0 ? ` <span class="ld-arr-spare">(+${excess}&nbsp;spare)</span>` : "") +
      `</div>`;
  }

  function getPinoutRules() {
    const d = window.D38999_TOOLBOX_DATA || {};
    return (d.pinout || {}).pinoutRules || {};
  }

  function getArrangements() {
    const toolboxData = window.D38999_TOOLBOX_DATA || {};
    const pinoutData = toolboxData.pinout || window.D38999_DATA || {};
    const insertData = pinoutData.insertArrangements || { arrangements: [] };
    return insertData.arrangements || [];
  }

  function findArrangement(id) {
    return getArrangements().find(a => a.id === id) || null;
  }

  /* ------------------------------------------------------------------
     Dynamic power rail list
  ------------------------------------------------------------------ */
  function renderPowerList() {
    const list = $("ld-power-list");
    if (!list) return;
    list.innerHTML = "";
    (ld.powerRails || []).forEach((rail, i) => {
      const div = document.createElement("div");
      div.className = "ld-list-item ld-power-item";
      div.innerHTML = `
        <div class="ld-field-wrap">
          <span class="ld-field-label">Name</span>
          <input type="text" placeholder="+28V" value="${escHtml(rail.name || "")}" data-pi="${i}" data-field="name">
        </div>
        <div class="ld-field-wrap ld-field-wrap--sm">
          <span class="ld-field-label">Amps</span>
          <input type="number" placeholder="A" value="${escHtml(String(rail.amps || ""))}" step="0.1" min="0" data-pi="${i}" data-field="amps">
        </div>
        <div class="ld-field-wrap ld-field-wrap--sm">
          <span class="ld-field-label">Volts</span>
          <input type="number" placeholder="V" value="${escHtml(String(rail.voltage || ""))}" step="1" min="0" data-pi="${i}" data-field="voltage">
        </div>
        <button type="button" class="ld-remove-btn" data-pi="${i}" title="Remove rail">&times;</button>
      `;
      list.appendChild(div);
    });
    list.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", e => {
        const i = +e.target.dataset.pi;
        ld.powerRails[i][e.target.dataset.field] = e.target.value;
      });
    });
    list.querySelectorAll(".ld-remove-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        ld.powerRails.splice(+e.target.dataset.pi, 1);
        renderPowerList();
      });
    });
  }

  function renderSignalList() {
    const list = $("ld-signal-list");
    if (!list) return;
    list.innerHTML = "";
    (ld.signalGroups || []).forEach((sg, i) => {
      const div = document.createElement("div");
      div.className = "ld-list-item ld-sig-item";
      const protoNorm = normalizeProto(sg.protocol || "");
      const color = GROUP_COLORS[protoNorm] || GROUP_COLORS.other;
      div.style.borderLeft = `3px solid ${color}`;
      const knownMatch = PROTOCOL_LIST.find(p => p.value === protoNorm);
      const isCustom = sg.protocol && !knownMatch;
      const pinCount = protocolSignalNames(protoNorm, parseInt(sg.count) || 1).length;
      div.innerHTML = `
        <select class="ld-proto-select" data-si="${i}">
          <option value="">\u2014 pick protocol \u2014</option>
          ${PROTOCOL_LIST.map(p => `<option value="${escHtml(p.value)}"${
            protoNorm === p.value ? ' selected' : ''}>${escHtml(p.label)}</option>`).join('')}
          <option value="_custom"${isCustom ? ' selected' : ''}>Custom\u2026</option>
        </select>
        <input type="text" class="ld-custom-proto${isCustom ? '' : ' ld-hidden'}"
          placeholder="e.g. MIL-1553" value="${escHtml(isCustom ? sg.protocol : '')}" data-si="${i}">
        <span class="ld-pin-count" title="Number of signals/pins this protocol needs" style="background:${color}22;color:${color};border-color:${color}44">${pinCount}&nbsp;pins</span>
        <button type="button" class="ld-remove-btn" data-si="${i}" title="Remove group">&times;</button>
      `;
      list.appendChild(div);
    });

    list.querySelectorAll(".ld-proto-select").forEach(sel => {
      sel.addEventListener("change", e => {
        const i = +e.target.dataset.si;
        const val = e.target.value;
        const customInput = e.target.closest(".ld-sig-item").querySelector(".ld-custom-proto");
        if (val === "_custom") {
          customInput.classList.remove("ld-hidden");
          customInput.focus();
          ld.signalGroups[i].protocol = customInput.value;
        } else {
          customInput.classList.add("ld-hidden");
          ld.signalGroups[i].protocol = val;
        }
        renderSignalList();
      });
    });

    list.querySelectorAll(".ld-custom-proto").forEach(inp => {
      inp.addEventListener("input", e => {
        const i = +e.target.dataset.si;
        ld.signalGroups[i].protocol = e.target.value;
        renderSignalList();
      });
    });

    list.querySelectorAll(".ld-remove-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        ld.signalGroups.splice(+e.target.dataset.si, 1);
        renderSignalList();
      });
    });
  }

  /* ------------------------------------------------------------------
     AI Layout Generator
  ------------------------------------------------------------------ */
  function generateLayout() {
    checkAiBeforeGenerate();

    const spareEnable = $("ld-spare-enable").checked;
    const sealUnused  = $("ld-seal-unused").checked;
    const emiMode     = $("ld-emi-mode").checked;

    const powerRails   = (ld.powerRails   || []).filter(r => r.name);
    const signalGroups = (ld.signalGroups || []).filter(s => s.protocol);

    if (powerRails.length === 0 && signalGroups.length === 0) {
      alert("Add at least one power rail or signal group first.");
      return;
    }

    // Auto-select or override arrangement
    const overrideId = ($("ld-arrangement") || {}).value;
    let arr = overrideId ? findArrangement(overrideId) : null;
    if (!arr) {
      arr = autoSelectArrangement(powerRails, signalGroups, spareEnable, emiMode);
    }
    if (!arr) { alert("No suitable arrangement found in data."); return; }

    ld.arrangement = arr;
    const contacts = arr.contacts || [];

    // Count required pins for the suggest badge
    let reqSignal = 0;
    signalGroups.forEach(sg => {
      reqSignal += protocolSignalNames(normalizeProto(sg.protocol), parseInt(sg.count) || 1).length;
    });
    const reqTotal = powerRails.length * 2 + reqSignal + (emiMode ? 1 : 0) +
                     (spareEnable ? Math.ceil((powerRails.length * 2 + reqSignal) * 0.18) : 0);
    renderArrangementSuggest(arr, reqTotal);
    const totalCavities = contacts.length;
    const targetSpare = spareEnable ? Math.max(1, Math.ceil(reqTotal * 0.18)) : 0;
    const skippedProtos = [];

    // Sort contacts: largest size first so power gets large contacts
    const sortedContacts = contacts.slice().sort((a, b) => {
      const sizeOrder = { "8": 0, "10": 1, "12": 2, "16": 3, "20": 4, "22D": 5, "22d": 5 };
      const sa = sizeOrder[a.size] ?? 6;
      const sb = sizeOrder[b.size] ?? 6;
      return sa - sb;
    });

    // Build assignment plan
    const assignments = [];
    let queue = sortedContacts.slice();

    // 1. Assign power positive pins
    powerRails.forEach(rail => {
      const amps = parseFloat(rail.amps) || 0;
      const idx = findBestContact(queue, amps);
      if (idx >= 0) {
        const c = queue.splice(idx, 1)[0];
        const rating = CONTACT_CURRENT_RATINGS[c.size];
        const over = amps > 0 && rating && amps > rating.derated;
        const note = `${rail.amps}A power +${over ? ` \u26A0 #${c.size} derated to ${rating.derated}A \u2014 verify` : ''}`;
        const voltStr = rail.voltage ? String(rail.voltage) : "";
        assignments.push(makeContact(c, rail.name, "power_pos", "power", "pwr", voltStr, c.size, estimateAWG(amps), null, null, "assigned", note));
      }
    });

    // 2. Assign power returns — equal count to power positives
    powerRails.forEach(rail => {
      const amps = parseFloat(rail.amps) || 0;
      const idx = findBestContact(queue, amps);
      if (idx >= 0) {
        const c = queue.splice(idx, 1)[0];
        const rating = CONTACT_CURRENT_RATINGS[c.size];
        const over = amps > 0 && rating && amps > rating.derated;
        const note = `${rail.amps}A power RTN${over ? ` \u26A0 #${c.size} derated to ${rating.derated}A \u2014 verify` : ''}`;
        const voltStr = rail.voltage ? String(rail.voltage) : "";
        assignments.push(makeContact(c, rail.name + "_RTN", "power_ret", "power", "rtn", voltStr, c.size, estimateAWG(amps), null, null, "assigned", note));
      }
    });

    // 3. Assign signal groups
    let groupIdx = 0;
    signalGroups.forEach(sg => {
      const proto = normalizeProto(sg.protocol);
      const count = parseInt(sg.count) || 1;
      const sigNames = protocolSignalNames(proto, count);
      const pairId = sg.protocol.toUpperCase().replace(/\s+/g, "_") + "_GRP" + (++groupIdx);

      // Skip group if connector doesn't have enough remaining cavities
      if (sigNames.length > queue.length) {
        skippedProtos.push({ label: sg.protocol, needed: sigNames.length, available: queue.length });
        return;
      }

      sigNames.forEach(sigName => {
        if (queue.length === 0) return;
        const c = queue.shift();
        const isHighSpeed = HIGH_SPEED_PROTOCOLS.has(proto);
        assignments.push(makeContact(c, sigName, proto, proto, "bidir", null, c.size, "#28", pairId, isDifferential(sigName) ? "SHIELD_1" : null, "assigned",
          isHighSpeed ? "High-speed — verify controlled impedance" : ""));
      });
    });

    // 4. If EMI mode, try to ensure grounds are adjacent to high-speed pairs
    // (already handled by placement order; annotation only)
    if (emiMode) {
      // Insert a GND between each high-speed group and power if queue allows
      const highSpeedAssigned = assignments.filter(a => HIGH_SPEED_PROTOCOLS.has(a.protocol));
      if (highSpeedAssigned.length > 0 && queue.length > 0) {
        const c = queue.shift();
        assignments.push(makeContact(c, "EMI_GND", "chassis_gnd", "ground", "gnd", null, c.size, "#28", null, "SHIELD_1", "assigned", "EMI isolation ground — placed by EMI mode"));
      }
    }

    // 5. Spare pins
    const spareTarget = Math.min(targetSpare, queue.length);
    for (let i = 0; i < spareTarget; i++) {
      const c = queue.shift();
      assignments.push(makeContact(c, "", "spare", "", "", null, c.size, "", null, null, "spare", "Spare — populated, unassigned"));
    }

    // 6. Remaining: sealed or no contact
    while (queue.length > 0) {
      const c = queue.shift();
      const status = sealUnused ? "sealed" : "no_contact";
      const note = sealUnused ? "Sealed (environmental plug)" : "No contact installed";
      assignments.push(makeContact(c, "", "sealed", "", "", null, c.size, "", null, null, status, note));
    }

    // Sort back by cavity natural order
    assignments.sort((a, b) => naturalCompare(a.cavity, b.cavity));
    ld.contacts = assignments;
    ld.skippedProtos = skippedProtos;

    runValidation();
    // Inject skipped-protocol warnings into results
    skippedProtos.forEach(sp => {
      ld.validationResults.warnings.unshift(
        `"${sp.label}" requires ${sp.needed} pins but only ${sp.available} available \u2014 group was skipped. Use a larger connector or remove other groups.`
      );
    });

    renderAll();
    showPanels();
  }

  function renderAll() {
    renderSummary();
    const tab = ld.activeTab || 'visual';
    if (tab === 'visual')     renderVisual();
    if (tab === 'table')      renderPinTable(($('ld-table-search') || {}).value);
    if (tab === 'validation') renderValidationPanel();
    if (tab === 'advice')     renderAdvice();
  }

  function makeContact(c, signal, group, protocol, dir, voltage, size, awg, pairId, shieldGroup, status, notes) {
    return {
      cavity: c.label || c.id || c.cavity || "?",
      signal: signal || "",
      group: group || "other",
      protocol: protocol || "",
      dir: dir || "",
      voltage: voltage || "",
      current: "",
      awg: awg || "",
      size: size || c.size || "",
      pairId: pairId || "",
      shieldGroup: shieldGroup || "",
      status: status || "assigned",
      notes: notes || "",
      validation: "",
      _x: c.x || 0,
      _y: c.y || 0,
      _r: c.r || 0.5,
    };
  }

  /* Find the best contact in queue for a given amp requirement.
     Falls back to the largest available contact if ideal size not present. */
  function findBestContact(queue, amps) {
    const sizeNeeded = bestSizeForAmps(amps);
    let idx = queue.findIndex(c => contactSizeNum(c.size) <= sizeNeeded);
    if (idx < 0 && queue.length > 0) {
      // No ideal-size contact; pick the largest available (lowest size index)
      let bestSn = Infinity;
      queue.forEach((c, qi) => {
        const sn = contactSizeNum(c.size);
        if (sn < bestSn) { bestSn = sn; idx = qi; }
      });
    }
    return idx;
  }

  function bestSizeForAmps(amps) {
    if (amps >= 20) return 0; // size 8
    if (amps >= 13) return 1; // size 10
    if (amps >= 9)  return 2; // size 12
    if (amps >= 4)  return 3; // size 16
    if (amps >= 2)  return 4; // size 20
    return 5; // 22D
  }

  function contactSizeNum(size) {
    const map = { "8": 0, "10": 1, "12": 2, "16": 3, "20": 4, "22D": 5, "22d": 5 };
    return map[size] ?? 6;
  }

  function estimateAWG(amps) {
    if (amps >= 20) return "#8";
    if (amps >= 13) return "#10";
    if (amps >= 9)  return "#12";
    if (amps >= 4)  return "#16";
    if (amps >= 2)  return "#20";
    return "#28";
  }

  // Protocol alias map: normalize user-typed strings to canonical keys
  const PROTO_ALIASES = {
    "eth":          "ethernet",
    "ethernet100m": "ethernet",
    "ethernet100":  "ethernet",
    "eth100":       "ethernet",
    "ethernet1g":   "ethernet_1g",
    "ethernet1gbps":"ethernet_1g",
    "eth1g":        "ethernet_1g",
    "eth1gbps":     "ethernet_1g",
    "gigabit":      "ethernet_1g",
    "1gbe":         "ethernet_1g",
    "gige":         "ethernet_1g",
    "ethernet10g":  "ethernet_10g",
    "eth10g":       "ethernet_10g",
    "10gbe":        "ethernet_10g",
    "usb":          "usb2",
    "usb20":        "usb2",
    "usbss":        "usb3",
    "usb30":        "usb3",
    "usb31":        "usb3",
    "usb32":        "usb3",
    "usbc":         "usb_c",
    "usbtype_c":    "usb_c",
    "dp":           "displayport",
    "rs232":        "uart",
    "rs_485":       "rs485",
    "rs_422":       "rs422",
  };

  function normalizeProto(raw) {
    // Lowercase, collapse spaces/hyphens/dots to underscore, strip other non-alphanum
    const s = raw.toLowerCase()
      .replace(/[\s\-\.]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return PROTO_ALIASES[s] || PROTO_ALIASES[s.replace(/_/g, "")] || s;
  }

  function protocolSignalNames(proto, count) {
    const known = {
      uart:          ["TX", "RX", "GND"],
      i2c:           ["SDA", "SCL", "GND"],
      spi:           ["SCLK", "MOSI", "MISO", "CS", "GND"],
      can:           ["CAN_H", "CAN_L", "CAN_GND"],
      rs485:         ["RS485_A", "RS485_B", "RS485_GND"],
      rs422:         ["RS422_TX+", "RS422_TX-", "RS422_RX+", "RS422_RX-", "RS422_GND"],
      usb2:          ["USB_VBUS", "USB_D+", "USB_D-", "USB_GND", "USB_SHIELD"],
      usb3:          ["USB_VBUS", "USB2_D+", "USB2_D-", "USB3_TX+", "USB3_TX-", "USB3_RX+", "USB3_RX-", "USB_GND", "USB_SHIELD"],
      usb_c:         ["VBUS", "D+", "D-", "CC1", "CC2", "TX1+", "TX1-", "RX1+", "RX1-", "USB_GND"],
      ethernet:      ["ETH_TX+", "ETH_TX-", "ETH_RX+", "ETH_RX-"],
      ethernet_1g:   ["ETH_DA+", "ETH_DA-", "ETH_DB+", "ETH_DB-", "ETH_DC+", "ETH_DC-", "ETH_DD+", "ETH_DD-"],
      ethernet_10g:  ["ETH_TX+", "ETH_TX-", "ETH_RX+", "ETH_RX-"],
      hdmi:          ["TMDS0+", "TMDS0-", "TMDS1+", "TMDS1-", "TMDS2+", "TMDS2-", "TMDS_CLK+", "TMDS_CLK-", "HPD", "DDC_SDA", "DDC_SCL", "HDMI_GND"],
      displayport:   ["ML0+", "ML0-", "ML1+", "ML1-", "ML2+", "ML2-", "ML3+", "ML3-", "AUX+", "AUX-", "HPD", "DP_GND"],
      mil1553:       ["BUS_A+", "BUS_A-", "BUS_B+", "BUS_B-"],
      arinc429:      ["A429_TX+", "A429_TX-", "A429_RX+", "A429_RX-"],
      analog:        ["ANA_SIG", "ANA_GND"],
      discrete:      ["DIO", "DIO_GND"],
      audio:         ["AUD_L+", "AUD_L-", "AUD_R+", "AUD_R-", "AUD_GND"],
      video:         ["VID_SIG", "VID_GND"],
      rf:            ["RF_SIG", "RF_GND"],
    };
    if (known[proto]) return known[proto];
    // Generic fallback for custom protocols
    const names = [];
    for (let i = 1; i <= count; i++) names.push(`${proto.toUpperCase()}_${i}`);
    return names;
  }

  function isDifferential(sigName) {
    return /[+\-][_]?$/.test(sigName) || /_[+-]$/.test(sigName) || /_[HLhlab]$/.test(sigName);
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  }

  /* ------------------------------------------------------------------
     Validation Engine
  ------------------------------------------------------------------ */
  function runValidation() {
    const results = { critical: [], warnings: [], suggestions: [], passed: [] };
    const contacts = ld.contacts;

    // A. Duplicate cavity check
    const cavitySet = new Set();
    contacts.forEach(c => {
      if (cavitySet.has(c.cavity)) {
        results.critical.push(`Duplicate cavity ID: ${c.cavity}`);
      }
      cavitySet.add(c.cavity);
    });
    if (!results.critical.some(m => m.includes("Duplicate"))) {
      results.passed.push("No duplicate cavity assignments.");
    }

    // B. Power balance check
    const powerPos = contacts.filter(c => c.group === "power_pos");
    const powerRet = contacts.filter(c => c.group === "power_ret");
    if (powerPos.length > 0 && powerRet.length < powerPos.length) {
      results.critical.push(`Power return contacts (${powerRet.length}) are fewer than supply contacts (${powerPos.length}). Return current capacity may be insufficient.`);
    } else if (powerPos.length > 0) {
      results.passed.push(`Power: ${powerPos.length} supply pin(s) and ${powerRet.length} return pin(s) matched.`);
    }

    // C. Differential pair integrity
    const pairGroups = {};
    contacts.forEach(c => {
      if (c.pairId) {
        if (!pairGroups[c.pairId]) pairGroups[c.pairId] = [];
        pairGroups[c.pairId].push(c);
      }
    });
    let pairsOk = 0;
    Object.entries(pairGroups).forEach(([id, members]) => {
      if (members.length < 2) {
        results.warnings.push(`Pair group "${id}" has only 1 member. Differential pairs need both signals assigned.`);
      } else {
        pairsOk++;
      }
    });
    if (pairsOk > 0) results.passed.push(`${pairsOk} differential pair group(s) fully assigned.`);

    // D. High-speed near power
    const highSpeedContacts = contacts.filter(c => HIGH_SPEED_PROTOCOLS.has(c.protocol));
    const powerContacts = contacts.filter(c => c.group === "power_pos");
    if (highSpeedContacts.length > 0 && powerContacts.length > 0) {
      results.suggestions.push("High-speed signals present. Verify separation from high-current power contacts in the final harness. Add shield/drain where possible.");
    }

    // E. Current derating per contact
    contacts.forEach(c => {
      if (!c.current || !c.size) return;
      const amp = parseFloat(c.current);
      const rating = CONTACT_CURRENT_RATINGS[c.size];
      if (rating && amp > rating.max) {
        results.critical.push(`Cavity ${c.cavity}: ${amp}A exceeds max rating of ${rating.max}A for size #${c.size} contact.`);
      } else if (rating && amp > rating.derated) {
        results.warnings.push(`Cavity ${c.cavity}: ${amp}A exceeds derated limit (${rating.derated}A) for size #${c.size}. Verify per MIL-DTL-38999 Table V derating curves.`);
      }
    });

    // E2. Parallel pin check from pinout_rules
    const rules = getPinoutRules();
    const wcg = (rules.wire_gauge_current_capacity || {});
    const deratingTable = (wcg.derating_factors || {}).by_energized_contacts || {};
    const parallelRules = (wcg.parallel_pin_distribution || {}).parallel_contact_rules || [];
    const energizedCount = contacts.filter(c => c.group === "power_pos" || c.group === "power_ret").length;
    let deratingFactor = 0.70; // conservative default
    if (energizedCount > 0) {
      const keys = Object.keys(deratingTable).map(Number).sort((a, b) => a - b);
      const matchKey = keys.find(k => k >= energizedCount) || keys[keys.length - 1];
      deratingFactor = deratingTable[String(matchKey)] ?? 0.70;
    }
    // Check each power rail for parallel contact adequacy
    const railGroups = {};
    contacts.filter(c => c.group === "power_pos").forEach(c => {
      const railName = c.signal.replace(/_RTN$/, "");
      (railGroups[railName] = railGroups[railName] || []).push(c);
    });
    Object.entries(railGroups).forEach(([railName, pins]) => {
      // Get amps from notes field ("5A power +")
      const ampsMatch = (pins[0].notes || "").match(/^([\d.]+)A/);
      if (!ampsMatch) return;
      const railAmps = parseFloat(ampsMatch[1]);
      const contactRating = CONTACT_CURRENT_RATINGS[pins[0].size];
      if (!contactRating) return;
      const deratedPerPin = contactRating.max * deratingFactor;
      const minPinsNeeded = Math.ceil(railAmps / (deratedPerPin * 0.75)); // 25% margin
      if (pins.length < minPinsNeeded) {
        results.warnings.push(
          `Rail "${railName}" (${railAmps}A): ${pins.length} supply contact(s) assigned, but ${minPinsNeeded} recommended at ${deratingFactor.toFixed(2)} derating factor. ` +
          `Consider using larger contacts or adding parallel contacts.`
        );
      }
    });
    if (parallelRules.length > 0 && energizedCount > 0) {
      results.suggestions.push(`Parallel wiring rule: All parallel contacts for a rail must be the same gauge, same wire length, and same crimp process (MIL-HDBK-522 / pinout_rules PR-parallel).`);
    }

    // F. Spare pins
    const spares = contacts.filter(c => c.status === "spare");
    const total = contacts.length;
    const sparePct = total > 0 ? spares.length / total : 0;
    if (total > 0 && sparePct < 0.08) {
      results.suggestions.push(`Only ${spares.length} spare pin(s) (${Math.round(sparePct*100)}%). Target 10–20% spares for maintainability.`);
    } else if (spares.length > 0) {
      results.passed.push(`${spares.length} spare pin(s) assigned (${Math.round(sparePct*100)}%).`);
    }

    // G. High-speed dedicated connector recommendation
    const needsDedicated = contacts.filter(c => ["usb3", "usb_c", "hdmi", "dvi", "displayport"].includes(c.protocol));
    if (needsDedicated.length > 0) {
      results.warnings.push("USB 3.x / HDMI / DVI / DisplayPort detected. Standard D38999 contacts may not meet controlled-impedance requirements. Consider a dedicated rugged high-speed connector (e.g., USB3FTV, Quadrax, Lemo, Redel).");
    }

    // H. CAN bus topology reminder (from pinout_rules protocol data)
    if (contacts.some(c => c.protocol === "can")) {
      results.suggestions.push("CAN bus: Add 120\u2009\u03A9 termination resistors at each physical bus end. Use a stub-less bus topology.");
    }

    // I. MIL-STD-1553 rules from pinout_rules
    if (contacts.some(c => c.protocol === "mil1553")) {
      const proto1553 = ((rules.protocols || {}).mil_std_1553 || {});
      const imp = proto1553.impedance_ohm || 78;
      results.suggestions.push(`MIL-STD-1553: Use ${imp}\u2009\u03A9 shielded twinax cable. Transformer-couple stubs; max stub length 20\u2009ft. Verify with MIL-STD-1553C.`);
    }

    // J. ARINC 429 rules from pinout_rules
    if (contacts.some(c => c.protocol === "arinc429")) {
      results.suggestions.push("ARINC 429: Use 78\u2009\u03A9 shielded twisted pair. Each bus is unidirectional — one transmitter, up to 20 receivers. Verify with ARINC Spec 429.");
    }

    // K. Differential pair adjacency rule (PR-001 from pinout_rules design_rules)
    const designRules = rules.design_rules || [];
    const pr001 = designRules.find(r => r.rule_id === "PR-001");
    if (pr001) {
      const diffPairs = Object.values(
        contacts.reduce((acc, c) => {
          if (c.pairId) { (acc[c.pairId] = acc[c.pairId] || []).push(c); }
          return acc;
        }, {})
      ).filter(g => g.length >= 2);
      if (diffPairs.length > 0) {
        results.suggestions.push("Differential pairs detected (PR-001): Verify that + and \u2212 signals of each pair are assigned to physically adjacent cavities in the insert drawing. Non-adjacent pair assignment is a wiring error regardless of interface.");
      }
    }

    // Per-contact row validation summary
    contacts.forEach(c => {
      if (c.status === "assigned" && !c.signal) {
        c.validation = "⚠ No signal name";
      } else if (c.status === "assigned" && HIGH_SPEED_PROTOCOLS.has(c.protocol)) {
        c.validation = "⚠ Verify SI";
      } else {
        c.validation = "";
      }
    });

    ld.validationResults = results;
    return results;
  }

  /* ------------------------------------------------------------------
     AI Advice Text
  ------------------------------------------------------------------ */
  function renderAdvice() {
    const panel = $("ld-advice-panel");
    const body = $("ld-advice-body");
    if (!panel || !body) return;
    show(panel);

    const v = ld.validationResults;
    const arr = ld.arrangement;
    const role = $("ld-role").value;
    const view = $("ld-view").value;

    let html = "";

    // Conclusion
    const hasCritical = v.critical.length > 0;
    const hasWarnings = v.warnings.length > 0;
    if (hasCritical) {
      html += `<p><strong>This layout has critical issues that must be resolved before use.</strong></p>`;
    } else if (hasWarnings) {
      html += `<p><strong>This layout is a usable starting point, but has warnings requiring engineering review.</strong></p>`;
    } else {
      html += `<p><strong>This layout passes basic checks. It is an engineering suggestion only — professional review is still required.</strong></p>`;
    }

    // Summary
    const total = ld.contacts.length;
    const assigned = ld.contacts.filter(c => c.status === "assigned").length;
    const spare = ld.contacts.filter(c => c.status === "spare").length;
    const sealed = ld.contacts.filter(c => c.status === "sealed").length;
    html += `<p>Insert <strong>${arr ? arr.id : "—"}</strong> · <strong>${total}</strong> cavities total · ${assigned} assigned · ${spare} spare · ${sealed} sealed<br>`;
    html += `Role: <strong>${role}</strong> · View: <strong>${view === "mating" ? "Mating face" : "Wire side"}</strong></p>`;

    if (v.critical.length > 0) {
      html += `<p><strong>Critical issues:</strong></p><ul>`;
      v.critical.forEach(m => { html += `<li>🔴 ${escHtml(m)}</li>`; });
      html += `</ul>`;
    }
    if (v.warnings.length > 0) {
      html += `<p><strong>Warnings:</strong></p><ul>`;
      v.warnings.forEach(m => { html += `<li>🟡 ${escHtml(m)}</li>`; });
      html += `</ul>`;
    }
    if (v.suggestions.length > 0) {
      html += `<p><strong>Suggestions:</strong></p><ul>`;
      v.suggestions.forEach(m => { html += `<li>🔵 ${escHtml(m)}</li>`; });
      html += `</ul>`;
    }
    if (v.passed.length > 0) {
      html += `<p><strong>Passed checks:</strong></p><ul>`;
      v.passed.forEach(m => { html += `<li>✅ ${escHtml(m)}</li>`; });
      html += `</ul>`;
    }

    html += `<p class="ld-mirror-warning">⚠ View orientation: ${view === "mating" ? "Mating face" : "Wire side"}. Remember that mating-face and wire-side views are <strong>mirrored</strong>. Always verify against the official insert drawing before assembly.</p>`;

    body.innerHTML = html;
  }

  /* ------------------------------------------------------------------
     Visual Layout Renderer (SVG) — decoder-style engine
  ------------------------------------------------------------------ */
  function renderVisual() {
    const svg = $("ld-canvas");
    if (!svg || !ld.contacts.length) return;

    const NS = "http://www.w3.org/2000/svg";
    /** Create an SVG element with the given attributes and optional text content. */
    function mk(tag, attrs, text) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
      if (text != null) el.textContent = text;
      return el;
    }

    const labelMode = ($("ld-vis-labels") || {}).value || "signal";
    const contacts = ld.contacts;
    const arr = ld.arrangement;
    const outline = arr && arr.outline;

    svg.innerHTML = "";
    // Reuse decoder shell-layer CSS by adding connector-svg class
    svg.setAttribute("class", "ld-canvas connector-svg");
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    /* ── ViewBox (use arrangement outline + zoom) ───────────────── */
    let vbX, vbY, vbW, vbH;
    if (outline) {
      const pad = outline.radius * 0.3;
      vbX = outline.center_x - outline.radius - pad;
      vbY = outline.center_y - outline.radius - pad;
      vbW = (outline.radius + pad) * 2;
      vbH = (outline.radius + pad) * 2;
    } else {
      const xs = contacts.map(c => c._x).filter(v => v != null && v !== 0);
      const ys = contacts.map(c => c._y).filter(v => v != null && v !== 0);
      if (xs.length) {
        const pad = 8;
        vbX = Math.min(...xs) - pad; vbY = Math.min(...ys) - pad;
        vbW = Math.max(...xs) - vbX + pad * 2;
        vbH = Math.max(...ys) - vbY + pad * 2;
      } else { vbX = 0; vbY = 0; vbW = 60; vbH = 60; }
    }
    const zoom = ld.zoom || 1;
    const zW = vbW / zoom, zH = vbH / zoom;
    svg.setAttribute("viewBox", `${vbX + (vbW - zW) / 2} ${vbY + (vbH - zH) / 2} ${zW} ${zH}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    /* ── Shell layers (same visual quality as decoder) ──────────── */
    if (outline) {
      const { center_x: cx, center_y: cy, radius: r } = outline;
      const sl = mk("g", { class: "shell-layer" });
      sl.appendChild(mk("circle", { class: "shell-shadow-ring", cx, cy, r: r * 1.08 }));
      sl.appendChild(mk("circle", { class: "shell-fill",        cx, cy, r: r * 1.04 }));
      sl.appendChild(mk("circle", { class: "shell",             cx, cy, r }));
      sl.appendChild(mk("circle", { class: "insert-boundary",   cx, cy, r: r * 0.88 }));
      sl.appendChild(mk("circle", { class: "shell-face-ring",   cx, cy, r: r * 0.93 }));
      // Orientation tooth at top
      const mw = r * 0.18, mh = r * 0.11;
      sl.appendChild(mk("path", {
        class: "orientation-marker keying-tooth",
        d: `M ${cx - mw / 2} ${cy - r - mh * 0.55} L ${cx} ${cy - r + mh * 0.75} L ${cx + mw / 2} ${cy - r - mh * 0.55}`,
      }));
      svg.appendChild(sl);
    }

    /* ── Contact radius helpers ─────────────────────────────────── */
    function pinBaseR(contact) {
      if (contact._r && +contact._r > 0) return +contact._r;
      if (outline) {
        const n = contacts.length;
        const factor = n <= 5 ? 0.058 : n <= 30 ? 0.044 : n <= 80 ? 0.034 : 0.027;
        return Math.max(0.45, Math.min(2.8, outline.radius * factor));
      }
      return 1.5;
    }
    function pinDisplayR(contact) {
      const base = pinBaseR(contact);
      const sizeScale = {
        "8": 1.80, "10": 1.44, "12": 1.16, "16": 0.94,
        "20": 0.68, "22D": 0.46, "22d": 0.46,
      };
      return Math.max(0.45, base * (sizeScale[contact.size] || 0.85));
    }

    /* ── Gauge-specific symbol with group color ─────────────────── */
    function drawSymbol(parent, contact, x, y, r, fill) {
      const sz = (contact.size || "22d").toLowerCase();
      const stroke = isColorDark(fill) ? "rgba(255,255,255,0.55)" : "rgba(15,23,42,0.55)";
      const markStroke = isColorDark(fill) ? "rgba(255,255,255,0.70)" : "rgba(15,23,42,0.55)";
      const ba = { cx: x, cy: y, r, fill, stroke, "stroke-width": "0.9", "vector-effect": "non-scaling-stroke" };

      const cross = (mode) => {
        const a = r * 0.70;
        const pairs = mode === "x"
          ? [[x - a, y - a, x + a, y + a], [x - a, y + a, x + a, y - a]]
          : [[x - a, y, x + a, y],          [x, y - a, x, y + a]];
        pairs.forEach(([x1, y1, x2, y2]) =>
          parent.appendChild(mk("line", {
            x1, y1, x2, y2, stroke: markStroke, "stroke-width": "1.1",
            "stroke-linecap": "round", "vector-effect": "non-scaling-stroke",
          }))
        );
      };

      if (sz === "8") {
        // Annular ring (large bore)
        parent.appendChild(mk("circle", ba));
        parent.appendChild(mk("circle", { cx: x, cy: y, r: r * 0.42, fill: "#fff", stroke: "none" }));
      } else if (sz === "10") {
        // Ring + core
        parent.appendChild(mk("circle", { ...ba, fill: "none", stroke: fill, "stroke-width": "2", "vector-effect": "non-scaling-stroke" }));
        parent.appendChild(mk("circle", { cx: x, cy: y, r: r * 0.62, fill, stroke: "none" }));
      } else if (sz === "12") {
        // Filled + plus
        parent.appendChild(mk("circle", ba));
        cross("plus");
      } else if (sz === "16") {
        // Filled + X
        parent.appendChild(mk("circle", ba));
        cross("x");
      } else if (sz === "20") {
        // Half-fill circle
        parent.appendChild(mk("circle", { ...ba, fill: "#f8fafc" }));
        parent.appendChild(mk("path", { d: `M ${x} ${y - r} A ${r} ${r} 0 0 0 ${x} ${y + r} Z`, fill, stroke: "none" }));
        parent.appendChild(mk("circle", { ...ba, fill: "none" }));
      } else {
        // 22D: solid disc
        parent.appendChild(mk("circle", ba));
      }
    }

    /* ── Render each contact ────────────────────────────────────── */
    contacts.forEach(contact => {
      const x = contact._x, y = contact._y;
      if (x == null || y == null) return;

      const r = pinDisplayR(contact);
      const baseR = pinBaseR(contact);
      const fill = statusColor(contact);
      const isSelected = ld.editingCavity === contact.cavity;
      const hasCritical = ld.validationResults.critical.some(m => m.includes(contact.cavity));
      const hasWarn = (contact.validation || "").includes("⚠");

      const cls = ["ld-pin",
        isSelected ? "ld-pin--selected" : "",
        hasCritical ? "ld-pin--error" : "",
        hasWarn && !hasCritical ? "ld-pin--warn" : "",
      ].filter(Boolean).join(" ");

      const g = mk("g", { class: cls, "data-cavity": contact.cavity });
      g.style.cursor = "pointer";

      // Hit zone (transparent, larger than symbol for easy clicking)
      g.appendChild(mk("circle", { class: "pin-hit-area", cx: x, cy: y, r: Math.max(r + 2, 2.5) }));

      // Gauge-specific symbol
      drawSymbol(g, contact, x, y, r, fill);

      // Selection / validation ring
      if (isSelected || hasCritical || hasWarn) {
        const ringColor = hasCritical ? "#ef4444" : hasWarn ? "#f59e0b" : "#3b82f6";
        g.appendChild(mk("circle", {
          cx: x, cy: y, r: r + 1.4, fill: "none",
          stroke: ringColor, "stroke-width": "1.8",
          "vector-effect": "non-scaling-stroke",
        }));
      }

      /* Gauge label (#8, #16 …) — shown outside the contact circle */
      const glFs = Math.max(baseR * 0.52, 0.80);
      g.appendChild(mk("text", {
        class: "ld-gauge-lbl",
        x: x + r + glFs * 0.35,
        y: y - r * 0.55,
        "font-size": glFs,
        "text-anchor": "start",
        "dominant-baseline": "central",
        "pointer-events": "none",
        fill: "rgba(100,116,139,0.88)",
        "paint-order": "stroke",
        stroke: "rgba(255,255,255,0.9)",
        "stroke-width": "0.35px",
        "font-family": "ui-monospace,monospace",
      }, `#${contact.size || "?"}`));

      /* Signal / cavity label inside the pin */
      if (labelMode !== "none") {
        let lbl = "";
        if (labelMode === "signal")  lbl = contact.signal || (contact.status === "spare" ? "S" : contact.status === "sealed" ? "⊘" : "");
        if (labelMode === "cavity")  lbl = contact.cavity;
        if (labelMode === "both")    lbl = contact.signal ? `${contact.cavity}:${contact.signal}` : contact.cavity;

        if (lbl) {
          const maxCh = Math.max(2, Math.floor(r * 1.85));
          if (lbl.length > maxCh) lbl = lbl.slice(0, maxCh - 1) + "·";
          const fs = Math.max(0.48, r * (lbl.length > 5 ? 0.38 : lbl.length > 3 ? 0.47 : 0.58));
          const dark = isColorDark(fill);
          g.appendChild(mk("text", {
            class: "ld-pin-lbl",
            x, y, "font-size": fs,
            "text-anchor": "middle", "dominant-baseline": "central",
            fill: dark ? "#fff" : "#1e293b",
            "font-weight": "700", "pointer-events": "none",
            "paint-order": "stroke",
            stroke: dark ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.88)",
            "stroke-width": "0.35px",
            "font-family": "ui-monospace,monospace",
          }, lbl));
        }
      }

      /* SVG title tooltip (native browser hover) */
      const lines = [
        `${contact.cavity}: ${contact.signal || contact.status || "—"}`,
        `Size #${contact.size || "?"}${contact.voltage ? "  |  " + contact.voltage + " V" : ""}${contact.current ? "  |  " + contact.current + " A" : ""}${contact.awg ? "  |  " + contact.awg : ""}`,
        contact.protocol ? `Protocol: ${contact.protocol}` : "",
        contact.notes || "",
      ];
      g.appendChild(mk("title", {}, lines.filter(Boolean).join("\n")));

      g.addEventListener("click", () => openCavityEditor(contact.cavity));
      svg.appendChild(g);
    });

    renderLegend();
  }

  /** Returns true for colours that need white / light text on them. */
  function isColorDark(hex) {
    if (!hex) return false;
    const lightBgs = ["#e5e7eb", "#d1d5db", "#9ca3af", "#f3f4f6"];
    if (lightBgs.includes(hex)) return false;
    const darkBgs = [
      "#ef4444", "#1f2937", "#374151", "#3b82f6", "#a855f7",
      "#8b5cf6", "#92400e", "#22c55e", "#06b6d4", "#f97316",
      "#eab308", "#ec4899", "#6b7280",
    ];
    return darkBgs.includes(hex);
  }

  function statusColor(c) {
    if (c.status === "sealed" || c.status === "no_contact") return GROUP_COLORS.sealed;
    if (c.status === "spare") return GROUP_COLORS.spare;
    return GROUP_COLORS[c.group] || GROUP_COLORS.other;
  }

  function validationStroke(c) {
    if (ld.validationResults.critical.some(m => m.includes(c.cavity))) return "#dc2626";
    if (c.validation && c.validation.includes("⚠")) return "#d97706";
    return "#9ca3af";
  }

  function textOnColor(hex) {
    return isColorDark(hex) ? "#fff" : "#111827";
  }

  function renderLegend() {
    const leg = $("ld-legend");
    if (!leg) return;
    const usedGroups = [...new Set(ld.contacts.map(c => c.group))];
    const groupLabels = {
      power_pos: "Power +", power_ret: "Power RTN", chassis_gnd: "Chassis GND",
      shield: "Shield", ethernet: "Ethernet", usb: "USB", can: "CAN",
      rs485: "RS485", rs422: "RS422", uart: "UART", i2c: "I2C", spi: "SPI",
      hdmi: "HDMI", dvi: "DVI", displayport: "DisplayPort", vga: "VGA",
      dpi: "DPI/RGB", spare: "Spare", sealed: "Sealed", other: "Other",
    };
    leg.innerHTML = usedGroups.map(g => {
      const color = GROUP_COLORS[g] || GROUP_COLORS.other;
      return `<span class="ld-legend-item"><span class="ld-legend-swatch" style="background:${color}"></span>${escHtml(groupLabels[g] || g)}</span>`;
    }).join("");
  }

  /* ------------------------------------------------------------------
     Pin Table
  ------------------------------------------------------------------ */
  function renderPinTable(filter) {
    const tbody = $("ld-pin-tbody");
    if (!tbody) return;
    const q = (filter || "").toLowerCase();
    tbody.innerHTML = "";

    const filtered = ld.contacts.filter(c =>
      !q || c.cavity.toLowerCase().includes(q) || c.signal.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) || (c.protocol || "").toLowerCase().includes(q)
    );

    filtered.forEach(c => {
      const tr = document.createElement("tr");
      tr.dataset.cavity = c.cavity;
      const hasCritical = ld.validationResults.critical.some(m => m.includes(c.cavity));
      if (hasCritical) tr.classList.add("ld-row-error");
      else if ((c.validation || "").includes("⚠")) tr.classList.add("ld-row-warn");

      const groupColor = GROUP_COLORS[c.group] || "#6b7280";
      const statusClass = {
        assigned:   "ld-status-assigned",
        spare:      "ld-status-spare",
        sealed:     "ld-status-sealed",
        no_contact: "ld-status-sealed",
        warn:       "ld-status-warn",
        error:      "ld-status-error",
      }[c.status] || "";

      const groupLabel = ({
        power_pos: "PWR+", power_ret: "PWR−", chassis_gnd: "GND", shield: "SHLD",
        spare: "SPARE", sealed: "SEALED", other: "OTHER",
      })[c.group] || c.group.toUpperCase().replace(/_/g, "");

      const protoBadge = c.protocol
        ? `<span class="ld-proto-tag">${escHtml(c.protocol.toUpperCase().replace(/_/g, " "))}</span>` : "";

      const valIcon = c.validation
        ? `<span class="ld-val-icon warn" title="${escHtml(c.validation)}">⚠</span>`
        : `<span class="ld-val-icon ok">✓</span>`;

      tr.innerHTML = `
        <td class="ld-cell-cav mono">
          <span class="ld-cav-stripe" style="background:${groupColor}"></span>${escHtml(c.cavity)}
        </td>
        <td class="ld-cell-signal">
          <input type="text" value="${escHtml(c.signal)}" data-cav="${escHtml(c.cavity)}" data-field="signal" placeholder="signal name">
        </td>
        <td class="ld-cell-group">
          <span class="ld-group-pill" style="--pill-color:${groupColor}">${escHtml(groupLabel)}</span>
        </td>
        <td class="ld-cell-proto">${protoBadge}</td>
        <td class="ld-cell-size">#${escHtml(c.size || "—")}</td>
        <td class="ld-cell-v">${escHtml(c.voltage || "")}</td>
        <td class="ld-cell-status ${statusClass}">${escHtml(STATUS_ICONS[c.status] || c.status)}</td>
        <td class="ld-cell-notes">
          <input type="text" value="${escHtml(c.notes)}" data-cav="${escHtml(c.cavity)}" data-field="notes" placeholder="notes">
        </td>
        <td class="ld-cell-val">${valIcon}</td>
      `;
      tbody.appendChild(tr);
    });

    // Bind inline edit handlers
    tbody.querySelectorAll("input[data-cav]").forEach(inp => {
      inp.addEventListener("change", e => {
        const cav = e.target.dataset.cav;
        const field = e.target.dataset.field;
        const contact = ld.contacts.find(c => c.cavity === cav);
        if (contact) {
          contact[field] = e.target.value;
          afterUserEdit();
        }
      });
    });

    // Row click → open cavity editor
    tbody.querySelectorAll("tr").forEach((tr, i) => {
      tr.addEventListener("click", e => {
        if (e.target.tagName === "INPUT") return;
        if (filtered[i]) openCavityEditor(filtered[i].cavity);
      });
    });
  }

  /* ------------------------------------------------------------------
     Validation Panel
  ------------------------------------------------------------------ */
  function renderValidationPanel() {
    const body = $("ld-validation-body");
    if (!body) return;
    const v = ld.validationResults;

    const sections = [
      { key: "critical",    label: "Critical Issues",  cls: "ld-val-critical",    items: v.critical },
      { key: "warnings",    label: "Warnings",          cls: "ld-val-warning",     items: v.warnings },
      { key: "suggestions", label: "Suggestions",       cls: "ld-val-suggestion",  items: v.suggestions },
      { key: "passed",      label: "Passed Checks",     cls: "ld-val-pass",        items: v.passed },
    ];

    body.innerHTML = sections.map(sec => {
      if (!sec.items.length) return "";
      return `<div class="ld-val-section ${sec.cls}">
        <div class="ld-val-section-title">${sec.label} (${sec.items.length})</div>
        ${sec.items.map(m => `<div class="ld-val-item">${escHtml(m)}</div>`).join("")}
      </div>`;
    }).join("");
  }

  /* ------------------------------------------------------------------
     Connector Summary Panel
  ------------------------------------------------------------------ */
  function renderSummary() {
    const grid = $("ld-summary-grid");
    const badge = $("ld-geometry-badge");
    if (!grid || !ld.arrangement) return;

    const arr = ld.arrangement;
    const total = ld.contacts.length;
    const assigned = ld.contacts.filter(c => c.status === "assigned").length;
    const spare = ld.contacts.filter(c => c.status === "spare").length;
    const sealed = ld.contacts.filter(c => c.status === "sealed").length;

    const items = [
      ["Insert", arr.id],
      ["Shell size", arr.shell_size || "—"],
      ["Total cavities", total],
      ["Assigned", assigned],
      ["Spare", spare],
      ["Sealed", sealed],
      ["Role", ($("ld-role") || {}).value || "—"],
      ["View", ($("ld-view") || {}).value === "mating" ? "Mating face" : "Wire side"],
      ["Geometry", "Conceptual (AI placement)"],
    ];

    grid.innerHTML = items.map(([k, v]) =>
      `<div class="ld-summary-item"><span class="ld-summary-label">${escHtml(k)}</span><span class="ld-summary-value">${escHtml(String(v))}</span></div>`
    ).join("");

    if (badge) {
      badge.textContent = "Conceptual layout — not official";
      badge.classList.remove("official");
    }
  }

  /* ------------------------------------------------------------------
     Cavity Editor (right panel)
  ------------------------------------------------------------------ */
  function openCavityEditor(cavityId) {
    ld.editingCavity = cavityId;
    const c = ld.contacts.find(x => x.cavity === cavityId);
    const editor = $("ld-cavity-editor");
    if (!editor || !c) return;

    const STATUSES = ["assigned", "spare", "sealed", "no_contact"];
    const GROUPS = Object.keys(GROUP_COLORS);

    editor.innerHTML = `
      <p style="font-weight:600;font-size:0.9rem">Cavity <span class="mono">${escHtml(cavityId)}</span></p>
      ${field("Signal name", "text", "ld-ce-signal", c.signal)}
      ${fieldSelect("Group", "ld-ce-group", GROUPS, c.group)}
      ${field("Protocol", "text", "ld-ce-protocol", c.protocol)}
      ${field("Direction", "text", "ld-ce-dir", c.dir)}
      ${field("Voltage (V)", "text", "ld-ce-voltage", c.voltage)}
      ${field("Current (A)", "number", "ld-ce-current", c.current)}
      ${field("Wire gauge (AWG)", "text", "ld-ce-awg", c.awg)}
      ${field("Pair / group ID", "text", "ld-ce-pairId", c.pairId)}
      ${field("Shield group", "text", "ld-ce-shieldGroup", c.shieldGroup)}
      ${fieldSelect("Status", "ld-ce-status", STATUSES, c.status)}
      ${field("Notes", "text", "ld-ce-notes", c.notes)}
      <button type="button" class="ld-cavity-save-btn" id="ld-ce-save">Apply & Revalidate</button>
      <div class="ld-cavity-val" id="ld-ce-val">${c.validation ? `<span style="color:var(--warn)">${escHtml(c.validation)}</span>` : '<span style="color:var(--ok)">✓ No issues</span>'}</div>
    `;

    const saveBtn = $("ld-ce-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => saveCavityEdit(cavityId));
    }
  }

  function field(label, type, id, value) {
    return `<div class="ld-cavity-field"><label for="${id}">${escHtml(label)}</label>
      <input type="${type}" id="${id}" value="${escHtml(String(value || ""))}"></div>`;
  }

  function fieldSelect(label, id, options, selected) {
    const opts = options.map(o =>
      `<option value="${escHtml(o)}"${o === selected ? " selected" : ""}>${escHtml(o)}</option>`
    ).join("");
    return `<div class="ld-cavity-field"><label for="${id}">${escHtml(label)}</label>
      <select id="${id}">${opts}</select></div>`;
  }

  function saveCavityEdit(cavityId) {
    const c = ld.contacts.find(x => x.cavity === cavityId);
    if (!c) return;
    c.signal      = ($("ld-ce-signal")      || {}).value || "";
    c.group       = ($("ld-ce-group")       || {}).value || "other";
    c.protocol    = ($("ld-ce-protocol")    || {}).value || "";
    c.dir         = ($("ld-ce-dir")         || {}).value || "";
    c.voltage     = ($("ld-ce-voltage")     || {}).value || "";
    c.current     = ($("ld-ce-current")     || {}).value || "";
    c.awg         = ($("ld-ce-awg")         || {}).value || "";
    c.pairId      = ($("ld-ce-pairId")      || {}).value || "";
    c.shieldGroup = ($("ld-ce-shieldGroup") || {}).value || "";
    c.status      = ($("ld-ce-status")      || {}).value || "assigned";
    c.notes       = ($("ld-ce-notes")       || {}).value || "";
    afterUserEdit();
    openCavityEditor(cavityId); // refresh editor with new validation
  }

  function afterUserEdit() {
    runValidation();
    renderAll();
  }

  /* ------------------------------------------------------------------
     Show/hide all result panels
  ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
     Tab navigation
  ------------------------------------------------------------------ */
  function switchTab(name) {
    const tabNames = ["visual", "table", "validation", "advice", "export"];
    tabNames.forEach(t => {
      const panel = $(`ld-${t}-panel`);
      if (panel) panel.hidden = (t !== name);
      const btn = document.querySelector(`[data-ld-tab="${t}"]`);
      if (btn) btn.classList.toggle("active", t === name);
    });
    ld.activeTab = name;
    if (name === "visual")     renderVisual();
    if (name === "table")      renderPinTable(($('ld-table-search') || {}).value);
    if (name === "validation") renderValidationPanel();
    if (name === "advice")     renderAdvice();
  }

  function showPanels() {
    show($("ld-summary-panel"));
    show($("ld-result-tabs"));
    switchTab("visual");
    renderSummary();
  }

  /* ------------------------------------------------------------------
     Export
  ------------------------------------------------------------------ */
  const EXPORT_WARNING = "AI-generated suggestion only. Must be reviewed and verified by a qualified professional before use.";

  function exportJSON() {
    const payload = {
      _warning: EXPORT_WARNING,
      generated: new Date().toISOString(),
      arrangement: ld.arrangement ? ld.arrangement.id : null,
      contacts: ld.contacts,
      validation: ld.validationResults,
    };
    downloadFile("layout-designer-export.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function exportCSV() {
    const cols = ["cavity","signal","group","protocol","dir","voltage","current","awg","size","pairId","shieldGroup","status","notes","validation"];
    const rows = [
      [`# ${EXPORT_WARNING}`],
      cols,
      ...ld.contacts.map(c => cols.map(k => `"${String(c[k] || "").replace(/"/g, '""')}"`)),
    ];
    downloadFile("layout-designer-export.csv", rows.map(r => r.join(",")).join("\n"), "text/csv");
  }

  function exportSVG() {
    const svgEl = $("ld-canvas");
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(svgEl);
    // Inject warning as SVG comment
    svgStr = svgStr.replace("<svg", `<!-- ${EXPORT_WARNING} -->\n<svg`);
    downloadFile("layout-designer-export.svg", svgStr, "image/svg+xml");
  }

  function exportReport() {
    const arr = ld.arrangement;
    const v = ld.validationResults;

    const rows = ld.contacts.map(c =>
      `<tr>
        <td>${escHtml(c.cavity)}</td><td>${escHtml(c.signal)}</td>
        <td>${escHtml(c.group)}</td><td>${escHtml(c.protocol)}</td>
        <td>${escHtml(c.dir)}</td><td>${escHtml(c.voltage)}</td><td>${escHtml(c.current)}</td>
        <td>${escHtml(c.awg)}</td><td>${escHtml(c.size)}</td>
        <td>${escHtml(c.pairId)}</td><td>${escHtml(c.shieldGroup)}</td>
        <td>${escHtml(c.status)}</td><td>${escHtml(c.notes)}</td>
        <td>${escHtml(c.validation || "✓")}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>D38999 Layout Designer Report</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#111}
  .warn-box{background:#7f1d1d;color:#fff;padding:12px 18px;border-radius:6px;margin-bottom:20px;font-weight:600}
  h1{font-size:1.4rem}h2{font-size:1rem;border-bottom:1px solid #ddd;padding-bottom:4px}
  table{border-collapse:collapse;width:100%;font-size:0.8rem}
  th{background:#f3f4f6;text-align:left;padding:5px 8px;font-size:0.72rem;text-transform:uppercase}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .critical{color:#dc2626} .warn{color:#d97706} .pass{color:#047857}
</style></head><body>
<div class="warn-box">⚠ ${escHtml(EXPORT_WARNING)}</div>
<h1>D38999 Layout Designer — Engineering Suggestion</h1>
<p>Generated: ${new Date().toLocaleString()}</p>
<p>Insert arrangement: <strong>${escHtml(arr ? arr.id : "—")}</strong></p>
<h2>Validation Summary</h2>
${v.critical.map(m => `<p class="critical">🔴 ${escHtml(m)}</p>`).join("")}
${v.warnings.map(m => `<p class="warn">🟡 ${escHtml(m)}</p>`).join("")}
${v.suggestions.map(m => `<p>🔵 ${escHtml(m)}</p>`).join("")}
${v.passed.map(m => `<p class="pass">✅ ${escHtml(m)}</p>`).join("")}
<h2>Pin Assignment Table</h2>
<table><thead><tr>
  <th>Cavity</th><th>Signal</th><th>Group</th><th>Protocol</th><th>Dir</th>
  <th>V</th><th>A</th><th>AWG</th><th>Size</th><th>Pair</th>
  <th>Shield</th><th>Status</th><th>Notes</th><th>Validation</th>
</tr></thead><tbody>${rows}</tbody></table>
<h2>Manufacturing Checklist</h2>
<ul>
  <li>Verify official insert drawing and contact coordinates</li>
  <li>Verify mating-face vs. wire-side orientation (views are mirrored)</li>
  <li>Verify plug vs. receptacle orientation</li>
  <li>Verify contact gender (socket/pin)</li>
  <li>Verify connector keying (polarisation key)</li>
  <li>Verify crimp tool and crimp barrel per contact family</li>
  <li>Install sealing plugs for all unused/spare cavities in sealed applications</li>
  <li>Use appropriate backshell; define shield termination method</li>
  <li>Perform continuity test before connection</li>
  <li>Perform insulation resistance test per applicable standard</li>
  <li>Perform current and thermal test for power contacts under load</li>
  <li>Perform signal integrity test for all high-speed interfaces</li>
  <li>Review and sign off by qualified professional engineer before use</li>
</ul>
<p style="margin-top:30px;font-size:0.8rem;color:#6b7280">${escHtml(EXPORT_WARNING)}</p>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

  function downloadFile(name, content, mime) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  /* ------------------------------------------------------------------
     AI "Review" button (manual re-validation)
  ------------------------------------------------------------------ */
  function aiReview() {
    runValidation();
    switchTab("advice");
  }

  /* ------------------------------------------------------------------
     AI Model Status
  ------------------------------------------------------------------ */
  function getAiModelStatus() {
    try {
      const raw = localStorage.getItem("d38999_chat");
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s.provider || !s.model) return null;
      return { provider: s.provider, model: s.model };
    } catch (_) { return null; }
  }

  function renderAiStatus() {
    const el = $("ld-ai-status");
    if (!el) return;
    const st = getAiModelStatus();
    if (st) {
      el.innerHTML = `<span class="ld-ai-badge ld-ai-ok">\u2713 ${escHtml(st.model)}</span>`;
      el.title = `AI model: ${st.provider} / ${st.model}`;
    } else {
      el.innerHTML = `<span class="ld-ai-badge ld-ai-warn">No AI model set</span>`;
      el.title = "Open the chat (\u2699 FAB) and configure an AI model to get smarter layout suggestions";
    }
  }

  /* Notify before generating if no AI model is configured */
  function checkAiBeforeGenerate() {
    const st = getAiModelStatus();
    const notice = $("ld-ai-notice");
    if (!notice) return;
    if (!st) {
      notice.textContent = "\u26A0 No AI model configured \u2014 using rule-based layout. Configure a model in the \u2699 Chat for smarter suggestions.";
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  }

  /* ------------------------------------------------------------------
     Utility
  ------------------------------------------------------------------ */
  function escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* ------------------------------------------------------------------
     Init & event wiring
  ------------------------------------------------------------------ */
  function init() {
    // Only run when layout tab content exists
    if (!$("ld-arrangement")) return;

    // Load accurate contact ratings from pinout_rules.json (bundled in app-data.js)
    loadContactRatingsFromRules();

    ld.powerRails  = [{ name: "+28V", amps: "5", voltage: "28" }];
    ld.signalGroups = [{ protocol: "CAN", count: 3 }];

    populateArrangements();
    renderPowerList();
    renderSignalList();
    renderAiStatus();

    // Add power rail
    const addPower = $("ld-add-power");
    if (addPower) addPower.addEventListener("click", () => {
      ld.powerRails.push({ name: "", amps: "" });
      renderPowerList();
    });

    // Add signal group
    const addSig = $("ld-add-signal");
    if (addSig) addSig.addEventListener("click", () => {
      ld.signalGroups.push({ protocol: "", count: 1 });
      renderSignalList();
    });

    // Generate button
    const genBtn = $("ld-generate-btn");
    if (genBtn) genBtn.addEventListener("click", generateLayout);

    // Reset button
    const resetBtn = $("ld-reset-btn");
    if (resetBtn) resetBtn.addEventListener("click", () => {
      ld.contacts = [];
      ld.arrangement = null;
      ld.activeTab = null;
      ld.validationResults = { critical: [], warnings: [], suggestions: [], passed: [] };
      hide($("ld-arr-suggest"));
      const arrSel = $("ld-arrangement"); if (arrSel) arrSel.value = "";
      hide($("ld-summary-panel"));
      hide($("ld-result-tabs"));
      ["visual","table","validation","advice","export"].forEach(t => {
        const p = $(`ld-${t}-panel`);
        if (p) p.hidden = true;
      });
      const editor = $("ld-cavity-editor");
      if (editor) editor.innerHTML = '<p class="ld-placeholder">Click a cavity in the visual layout or pin table to edit it.</p>';
    });

    // Label mode change → re-render visual
    const labelsEl = $("ld-vis-labels");
    if (labelsEl) labelsEl.addEventListener("change", () => renderVisual());

    // Zoom controls
    const zoomIn = $("ld-zoom-in");
    const zoomOut = $("ld-zoom-out");
    const zoomFit = $("ld-zoom-fit");
    if (zoomIn)  zoomIn.addEventListener("click",  () => { ld.zoom = Math.min(3, ld.zoom * 1.2); renderVisual(); });
    if (zoomOut) zoomOut.addEventListener("click", () => { ld.zoom = Math.max(0.3, ld.zoom / 1.2); renderVisual(); });
    if (zoomFit) zoomFit.addEventListener("click", () => { ld.zoom = 1.0; renderVisual(); });

    // Table search
    const tableSearch = $("ld-table-search");
    if (tableSearch) tableSearch.addEventListener("input", e => renderPinTable(e.target.value));

    // AI review button
    const aiReviewBtn = $("ld-ai-review-btn");
    if (aiReviewBtn) aiReviewBtn.addEventListener("click", aiReview);

    // Tab navigation buttons
    document.querySelectorAll("[data-ld-tab]").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.ldTab));
    });

    // Export buttons
    const btnJSON   = $("ld-export-json");
    const btnCSV    = $("ld-export-csv");
    const btnSVG    = $("ld-export-svg");
    const btnReport = $("ld-export-report");
    if (btnJSON)   btnJSON.addEventListener("click",   exportJSON);
    if (btnCSV)    btnCSV.addEventListener("click",    exportCSV);
    if (btnSVG)    btnSVG.addEventListener("click",    exportSVG);
    if (btnReport) btnReport.addEventListener("click", exportReport);
  }

  // Run after DOM is ready; defer to ensure app-data.js has loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // Scripts load synchronously; give app.js a tick to finish first
    setTimeout(init, 0);
  }

})();
