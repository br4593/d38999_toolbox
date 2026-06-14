const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

if (typeof WebSocket === "undefined") {
  try {
    global.WebSocket = require("ws");
  } catch {
    console.error(
      "WebSocket is not available in this Node runtime and the 'ws' polyfill is not installed.\n" +
        "Run 'npm install --no-save ws' (or upgrade to Node >=22) before invoking tests/validate_app.js."
    );
    process.exit(2);
  }
}

const projectRoot = path.resolve(__dirname, "..");
const appUrl = `file:///${path.join(projectRoot, "app", "index.html").replace(/\\/g, "/")}`;
const debugDir = path.join(projectRoot, "output", "debug");
const runId = Date.now();
const downloadsDir = path.join(debugDir, `validation-downloads-${runId}`);
const profileDir = path.join(debugDir, `chrome-validation-profile-${runId}`);
const port = 9333 + Math.floor(Math.random() * 1000);

const chromeCandidates = process.platform === "win32"
  ? [
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]
  : [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/msedge",
      "/snap/bin/chromium",
    ];

function chromePath() {
  const found = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  if (process.platform !== "win32") {
    const commandCandidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge"];
    for (const candidate of commandCandidates) {
      try {
        const resolved = execFileSync("which", [candidate], { encoding: "utf8" }).trim();
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch {
        // Try the next browser name.
      }
    }
  }
  throw new Error("No Chrome or Edge executable found for headless validation.");
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitFor(fn, label, timeoutMs = 15000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      }
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result ? result.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const requiredDataFiles = [
    "data/rules/d38999_extracted_rules.json",
    "data/part_numbers/d38999_part_number_examples.json",
    "data/part_numbers/d38999_catalog_supported_combinations.json",
    "data/part_numbers/d38999_verified_part_numbers.json",
    "data/connectors/d38999_visual_assets.json",
  ];
  const requiredSvgFiles = [
    "assets/svg/d38999-plug-generic.svg",
    "assets/svg/d38999-receptacle-generic.svg",
    "assets/svg/d38999-wall-mount-receptacle.svg",
    "assets/svg/d38999-jam-nut-receptacle.svg",
    "assets/svg/d38999-straight-plug.svg",
    "assets/svg/d38999-backshell-generic.svg",
    "assets/svg/d38999-keying-helper.svg",
    "assets/svg/d38999-shell-size-helper.svg",
    "assets/svg/d38999-insert-placeholder.svg",
  ];

  requiredDataFiles.forEach((relativePath) => {
    assert(fs.existsSync(path.join(projectRoot, relativePath)), `Required research data file exists: ${relativePath}`);
  });
  requiredSvgFiles.forEach((relativePath) => {
    assert(fs.existsSync(path.join(projectRoot, relativePath)), `Required SVG asset exists: ${relativePath}`);
  });

  const extractedRules = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "rules", "d38999_extracted_rules.json"), "utf8"));
  const verifiedPartNumbers = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "part_numbers", "d38999_verified_part_numbers.json"), "utf8"));
  const visualAssets = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "connectors", "d38999_visual_assets.json"), "utf8"));

  assert(Array.isArray(extractedRules.catalogGroundingPolicy.statusValues), "Catalog grounding status values are present");
  assert(extractedRules.catalogGroundingPolicy.statusValues.includes("VERIFIED_EXISTS"), "Catalog grounding includes VERIFIED_EXISTS");
  assert(extractedRules.catalogGroundingPolicy.statusValues.includes("VALID_FORMAT_BUT_NOT_CONFIRMED"), "Catalog grounding includes VALID_FORMAT_BUT_NOT_CONFIRMED");
  assert((verifiedPartNumbers.verifiedPartNumbers || []).length >= 5, "At least five exact verified part numbers are available");
  assert((visualAssets.visualAssets || []).some((item) => item.file === "assets/svg/d38999-keying-helper.svg"), "Visual asset metadata references the created keying helper SVG");

  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(profileDir, { recursive: true });
  let success = false;
  let cdp = null;

  const chrome = spawn(chromePath(), [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--allow-file-access-from-files",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,1000",
    appUrl,
  ], { stdio: "ignore" });

  try {
    const target = await waitFor(async () => {
      const targets = await getJson("/json");
      return targets.find((item) => item.type === "page" && item.url.startsWith("file:///"));
    }, "Chrome page target");

    cdp = new CdpClient(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    try {
      await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir });
    } catch {
      await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadsDir });
    }

    await waitFor(
      () => cdp.eval(`Boolean(window.D38999_TOOLBOX_DATA && window.D38999_TOOLBOX_DATA.pinout && window.D38999_TOOLBOX_DATA.converter && document.querySelectorAll(".catalog-card").length && document.querySelector("#connectorSvg .shell"))`),
      "app data and initial connector drawing"
    );

    const dataAudit = await cdp.eval(`(() => {
      const arrangements = window.D38999_TOOLBOX_DATA.pinout.insertArrangements.arrangements || [];
      const questionLabels = [];
      const duplicateLabels = [];
      for (const arr of arrangements) {
        const counts = new Map();
        for (const contact of arr.contacts || []) {
          if (!contact.label || contact.label === "?") questionLabels.push(arr.id);
          if (contact.label && contact.label !== "?") counts.set(contact.label, (counts.get(contact.label) || 0) + 1);
        }
        const duplicates = [...counts].filter(([, count]) => count > 1).map(([label]) => label);
        if (duplicates.length) duplicateLabels.push({ id: arr.id, labels: duplicates });
      }
      return {
        arrangements: arrangements.length,
        contacts: arrangements.reduce((total, arr) => total + (arr.contacts || []).length, 0),
        questionLabels: questionLabels.length,
        duplicateLabels,
        converterRules: (window.D38999_TOOLBOX_DATA.converter.rules || []).length,
      };
    })()`);
    assert(dataAudit.arrangements === 63, "Generated data contains 63 insert arrangements");
    assert(dataAudit.contacts === 1747, "Generated data contains 1747 contacts");
    assert(dataAudit.questionLabels === 0, "Generated data has no question-mark pin labels");
    assert(dataAudit.duplicateLabels.length === 0, "Pin labels are unique within each arrangement");
    assert(dataAudit.converterRules > 0, "Converter rules are embedded in the unified bundle");

    const initial = await cdp.eval(`(() => ({
      status: document.querySelector("#selectedStatus").textContent,
      pinLabels: document.querySelectorAll("#connectorSvg .pin-label").length,
      pinSymbols: document.querySelectorAll("#connectorSvg .pin-symbol").length,
      guidePaths: document.querySelectorAll("#connectorSvg .guide-path").length,
      visibleQuestionLabels: [...document.querySelectorAll("#connectorSvg .pin-label")].filter((node) => node.textContent.trim() === "?").length,
      sourceImage: Boolean(document.querySelector("#connectorSvg image")),
      shellFill: Boolean(document.querySelector("#connectorSvg .shell-fill")),
      background: getComputedStyle(document.querySelector("#viewerFrame")).backgroundColor,
      headerBackground: getComputedStyle(document.querySelector(".app-header")).backgroundColor,
      manualTab: Boolean(document.querySelector('.tab-button[data-tab="manual"]')),
      pnGuide: document.querySelector("#partNumberGuidePanel").textContent,
      pinTableRemoved: !document.querySelector("#pinTable"),
      removedAssignmentControls: [
        "#signalNameInput",
        "#exportJsonButton",
        "#signalSearchInput",
        "#importJsonFile",
        "#saveAssignmentButton"
      ].every((selector) => !document.querySelector(selector)),
    }))()`);
    assert(initial.status.includes("17-26"), "Default selected arrangement is 17-26");
    assert(initial.pinLabels === 0, "Pin labels are hidden by default to reduce drawing clutter");
    assert(initial.pinSymbols >= 26, "Gauge contact symbols are visible by default for 17-26");
    assert(initial.visibleQuestionLabels === 0, "Visible connector labels have no question marks");
    assert(!initial.sourceImage, "Raw extracted SVG image layer is not displayed");
    assert(initial.shellFill, "Connector viewer uses the dynamic redrawn shell");
    assert(initial.background === "rgb(251, 250, 246)", "Connector viewer uses the paper drawing background");
    assert(initial.headerBackground === "rgb(251, 250, 246)", "Header uses the paper surface treatment");
    assert(initial.manualTab, "D38999 manual tab is present");
    assert(initial.pnGuide.includes("Shell code"), "Part-number guide is rendered");
    assert(initial.pinTableRemoved, "Decoder-side pin catalog table is removed");
    assert(initial.removedAssignmentControls, "Signal-assignment controls are absent");

    const converterAudit = await cdp.eval(`(() => {
      document.querySelector('.tab-button[data-tab="converter"]').click();
      const input = document.querySelector("#pnInput");
      input.value = "D38999/26WD35PN";
      document.querySelector("#converterForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return {
        panelActive: document.querySelector("#converterPanel").classList.contains("active"),
        countPill: document.querySelector("#ruleCount").textContent,
        resultTitle: document.querySelector("#resultPanel .normalized")?.textContent || "",
        firstCandidate: document.querySelector("#resultPanel .candidate-pn")?.textContent || "",
      };
    })()`);
    assert(converterAudit.panelActive, "Converter tab becomes active");
    assert(/rule/i.test(converterAudit.countPill), "Converter rule count is displayed");
    assert(converterAudit.resultTitle.includes("D38999/26WD35PN"), "Converter renders decoded D38999 input");
    assert(converterAudit.firstCandidate.includes("TV06RW-15-35PN"), "Converter shows an Amphenol candidate");
    await cdp.eval(`document.querySelector('.tab-button[data-tab="decoder"]').click(); true;`);

    const launcherAudit = await cdp.eval(`(() => {
      const search = document.querySelector("#globalSearch");
      search.focus();
      search.value = "mate 26WE35PN";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const menu = document.querySelector("#launcherMenu");
      const optionTitles = [...menu.querySelectorAll(".launcher-option-title")].map((node) => node.textContent.trim());
      const menuOpenBefore = !menu.hidden;
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return {
        menuOpenBefore,
        optionTitles,
        activeTab: document.querySelector(".tab-button.active")?.dataset.tab || "",
        inputValue: document.querySelector("#partNumberInput").value,
      };
    })()`);
    assert(launcherAudit.menuOpenBefore, "Command launcher opens from the header search");
    assert(launcherAudit.optionTitles.some((text) => /find mate for d38999\/26we35pn/i.test(text)), "Command launcher suggests a mating workflow for a decoded PN query");
    assert(launcherAudit.activeTab === "mating", "Command launcher routes a 'mate ...' query to the mating tab");
    assert(launcherAudit.inputValue === "D38999/26WE35PN", "Command launcher normalizes shorthand D38999 input before routing");
    await cdp.eval(`document.querySelector('.tab-button[data-tab="decoder"]').click(); true;`);

    const pinSearch = await cdp.eval(`(() => {
      document.querySelector('.tab-button[data-tab="catalog"]').click();
      const af = document.querySelector("#arrangementFilter");
      af.value = "17-26";
      af.dispatchEvent(new Event("input", { bubbles: true }));
      [...document.querySelectorAll(".catalog-card .catalog-card-id")]
        .find((node) => node.textContent.trim() === "17-26").closest(".catalog-card").click();
      document.querySelector('.tab-button[data-tab="decoder"]').click();
      const input = document.querySelector("#pinSearchInput");
      input.value = "A";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        matches: document.querySelectorAll("#connectorSvg .pin.search-match").length,
        detail: document.querySelector("#pinDetailHeader").textContent
      };
    })()`);
    assert(pinSearch.matches === 1, "Pin search highlights exactly one pin A");
    assert(!/\\bX\\s+\\d|\\bY\\s+\\d/.test(pinSearch.detail), "Pin detail does not expose coordinates");
    assert(pinSearch.detail.includes("A"), "Pin search opens pin detail");

    const decoded = await cdp.eval(`(() => {
      document.querySelector("#partNumberInput").value = "D38999/26WE35PN";
      document.querySelector("#decodeButton").click();
      return {
        selected: document.querySelector("#selectedStatus").textContent,
        decoded: document.querySelector("#decodedPanel").textContent
      };
    })()`);
    assert(decoded.selected.includes("17-35"), "Part number D38999/26WE35PN selects 17-35");
    assert(decoded.decoded.includes("17-35"), "Decoded panel shows 17-35");

    const exactUiAudit = await cdp.eval(`(() => {
      document.querySelector("#partNumberInput").value = "D38999/20FA23SN";
      document.querySelector("#decodeButton").click();
      const panel = document.querySelector("#decodedPanel");
      return {
        exactTitles: [...panel.querySelectorAll(".exact-catalog-hit-title")].map((node) => node.textContent.trim()),
        exactBadgeTexts: [...panel.querySelectorAll(".mating-validation span")].map((node) => node.textContent.trim()),
        evidenceBadges: [...panel.querySelectorAll(".validation-pill")].map((node) => node.textContent.trim()),
        workflowButtons: [...panel.querySelectorAll(".decoded-action-grid [data-decoded-action]")].map((node) => node.textContent.trim()),
        summaries: [...panel.querySelectorAll(".connector-summary .value")].map((node) => node.textContent.trim()),
      };
    })()`);
    assert(exactUiAudit.exactTitles.filter((text) => /exact part-number match/i.test(text)).length === 1, "Decoded exact match renders one exact-match block");
    assert(exactUiAudit.exactBadgeTexts.filter((text) => /exact part-number match/i.test(text)).length === 0, "Decoded exact match does not also render a duplicate validation badge");
    assert(exactUiAudit.evidenceBadges.some((text) => /qpl qualified/i.test(text)), "Decoded exact match shows the QPL trust badge");
    assert(exactUiAudit.workflowButtons.some((text) => /find mate/i.test(text)) && exactUiAudit.workflowButtons.some((text) => /convert pn/i.test(text)) && exactUiAudit.workflowButtons.some((text) => /print \/ export report/i.test(text)), "Decoded action hub exposes the main next-step workflows");
    assert(exactUiAudit.summaries.some((text) => /wall-mount receptacle/i.test(text) && /panel|flange/i.test(text)), "Decoded summary explains the shell style in plain language");
    assert(exactUiAudit.summaries.every((text) => !/QPL-validated/i.test(text)), "Decoded summary does not repeat QPL validation wording");

    const frontFaceAudit = await cdp.eval(`(() => {
      const decode = (pn) => {
        document.querySelector("#partNumberInput").value = pn;
        document.querySelector("#decodeButton").click();
      };
      decode("D38999/26FB35PN");
      const plugViewBox = document.querySelector("#connectorSvg").getAttribute("viewBox");
      decode("D38999/20FB35PN");
      const flangeViewBox = document.querySelector("#connectorSvg").getAttribute("viewBox");
      const flangeInnerCount = document.querySelectorAll("#connectorSvg .mount-flange-inner").length;
      document.querySelector("#viewModeRealBtn").click();
      const visibleRealGuides = [...document.querySelectorAll("#connectorSvg .guide-path")]
        .filter((node) => getComputedStyle(node).display !== "none").length;
      const wallFinish = document.querySelector("#connectorSvg").dataset.finish || "";
      const decodeFinish = (pn) => {
        decode(pn);
        return document.querySelector("#connectorSvg").dataset.finish || "";
      };
      const finishMap = {
        W: decodeFinish("D38999/26WE35PN"),
        Z: decodeFinish("D38999/26ZE35PN"),
        T: decodeFinish("D38999/26TE35PN"),
        D: decodeFinish("D38999/26DE35PN"),
        V: decodeFinish("D38999/26VE35PN"),
        E: decodeFinish("D38999/26EE35PN"),
        F: decodeFinish("D38999/26FE35PN"),
        C: decodeFinish("D38999/26CE35PN"),
      };
      // Olive drab (class W/B/J -> data-finish="od") must render olive even when a
      // non-olive finish style is active. Previously "od" had no explicit
      // [data-finish] rule, so it inherited the theme's --default-shell-tint.
      const prevStyle = document.documentElement.getAttribute("data-style");
      document.documentElement.setAttribute("data-style", "nickel");
      decode("D38999/26WE35PN");
      document.querySelector("#viewModeRealBtn").click();
      const odShellFillUnderNickel = getComputedStyle(document.querySelector("#connectorSvg .shell-fill")).fill;

      // Comprehensive finish-color audit: EVERY class letter must render its true
      // finish metal in the real view, independent of the active style AND the
      // shell type (plug vs wall receptacle). data-finish drives --shell-tint, so
      // this guards every [data-finish] rule and the class -> finish-key map at
      // once. The style stays pinned to "nickel" (a deliberate mismatch) so any
      // rule that silently falls back to --default-shell-tint is caught.
      const expectedFinishRgb = {
        od:    "rgb(112, 118, 87)",
        gun:   "rgb(42, 47, 53)",
        zinc:  "rgb(71, 77, 85)",
        anod:  "rgb(42, 47, 52)",
        cad:   "rgb(221, 214, 189)",
        tin:   "rgb(208, 212, 214)",
        tinz:  "rgb(166, 174, 182)",
        nik:   "rgb(177, 184, 191)",
        steel: "rgb(146, 153, 161)",
      };
      const classToFinish = {
        W: "od", B: "od", J: "od", Z: "gun", T: "zinc", C: "anod", A: "cad", U: "cad",
        D: "tin", V: "tinz", AB: "tinz",
        F: "nik", G: "nik", N: "nik", S: "nik", L: "nik", R: "nik", M: "nik", AA: "nik",
        H: "steel", K: "steel", Y: "steel", E: "steel",
      };
      const finishColorMismatches = [];
      // [slashSheet, shellCode] pairs: a plug and a wall-mount receptacle so the
      // shell body AND the mount flange (both use --shell-tint) are checked.
      [["26", "E"], ["20", "B"]].forEach(([sheet, shellCode]) => {
        Object.keys(classToFinish).forEach((cls) => {
          const expectedKey = classToFinish[cls];
          const expectedRgb = expectedFinishRgb[expectedKey];
          decode("D38999/" + sheet + cls + shellCode + "35PN");
          const svg = document.querySelector("#connectorSvg");
          const key = svg.dataset.finish || "";
          const fillEl = svg.querySelector(".shell-fill");
          const fill = fillEl ? getComputedStyle(fillEl).fill : "(no shell-fill)";
          if (key !== expectedKey) {
            finishColorMismatches.push("class " + cls + " /" + sheet + ": data-finish=" + key + " expected " + expectedKey);
          } else if (fill !== expectedRgb) {
            finishColorMismatches.push("class " + cls + " /" + sheet + " (" + expectedKey + "): fill " + fill + " expected " + expectedRgb);
          }
        });
      });

      if (prevStyle) document.documentElement.setAttribute("data-style", prevStyle);
      else document.documentElement.removeAttribute("data-style");
      decode("D38999/26WE35PE");
      const seriesIIIKeying = {
        active: document.querySelector(".keying-chip.active")?.textContent.trim() || "",
        spokeCount: document.querySelectorAll("#connectorSvg .keying-spoke").length,
      };
      decode("D38999/46WB35PK");
      const seriesIVKeying = {
        chips: [...document.querySelectorAll(".keying-chip")].map((node) => node.textContent.trim()),
        active: document.querySelector(".keying-chip.active")?.textContent.trim() || "",
        spokeCount: document.querySelectorAll("#connectorSvg .keying-spoke").length,
      };
      document.querySelector("#viewModeEngBtn").click();
      return {
        plugViewBox,
        flangeViewBox,
        flangeInnerCount,
        visibleRealGuides,
        wallFinish,
        finishMap,
        odShellFillUnderNickel,
        finishColorMismatches,
        seriesIIIKeying,
        seriesIVKeying,
      };
    })()`);
    const plugWidth = Number((frontFaceAudit.plugViewBox || "0 0 0 0").split(/\s+/)[2] || 0);
    const flangeWidth = Number((frontFaceAudit.flangeViewBox || "0 0 0 0").split(/\s+/)[2] || 0);
    assert(flangeWidth > plugWidth, "Wall-flange front-face viewBox expands beyond the plug view to avoid clipping shell hardware");
    assert(frontFaceAudit.flangeInnerCount === 0, "Front-face flange rendering no longer draws the inner inset line between mounting holes");
    assert(frontFaceAudit.visibleRealGuides === 0, "Real view hides engineering guide paths");
    assert(frontFaceAudit.finishMap.W === "od" && frontFaceAudit.finishMap.Z === "gun" && frontFaceAudit.finishMap.T === "zinc" && frontFaceAudit.finishMap.D === "tin" && frontFaceAudit.finishMap.V === "tinz" && frontFaceAudit.finishMap.E === "steel" && frontFaceAudit.finishMap.F === "nik" && frontFaceAudit.finishMap.C === "anod", "Decoded class/finish colors map to the expected render families");
    assert(/^rgb\(\s*112\s*,\s*118\s*,\s*87\s*\)$/.test(frontFaceAudit.odShellFillUnderNickel || ""), "Olive-drab (class W) real-view body renders olive green regardless of the active finish style");
    assert((frontFaceAudit.finishColorMismatches || []).length === 0, "Every class letter renders its true finish color across shell types: " + (frontFaceAudit.finishColorMismatches || []).join(" | "));
    assert(frontFaceAudit.seriesIIIKeying.active === "E" && frontFaceAudit.seriesIIIKeying.spokeCount === 4, "Series III E keying renders the E selection and updates the four keyed minor positions");
    assert(
      frontFaceAudit.seriesIVKeying.active === "K"
      && frontFaceAudit.seriesIVKeying.spokeCount === 6
      && ["N", "A", "B", "C", "K"].every((key) => frontFaceAudit.seriesIVKeying.chips.includes(key))
      && ["L", "M", "R"].every((key) => !frontFaceAudit.seriesIVKeying.chips.includes(key)),
      "Series IV keying renders six face markers and only suggests valid-source keying letters (hides unsourced L/M/R for 46WB35)"
    );

    // ---- Keying geometry is true to life (rendered SVG vs the standard) ----
    // Recover each rendered keying marker's angle from its SVG attributes and
    // compare to the MIL-DTL-38999 Figure 6 (series III) / Figure 7 (series IV)
    // angles in standard_definitions.json. Marker attributes are computed
    // un-mirrored (the socket-face mirror is a parent <g> transform), so the
    // recovered angle equals the standard angle for both pin and socket parts.
    const standardDefs = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "reference", "standard_definitions.json"), "utf8"));
    const polz = standardDefs.definitions.polarization;
    const expectedIII = (shell, letter) => {
      const row = polz.series_iii.rotations_by_shell_size[String(shell)] && polz.series_iii.rotations_by_shell_size[String(shell)][letter];
      return row ? [row.AR_or_AP_deg, row.BR_or_BP_deg, row.CR_or_CP_deg, row.DR_or_DP_deg] : null;
    };
    const expectedIV = (shell, letter) => {
      const minor = polz.series_iv.minor_key_polarity_arrangements.arrangements[letter];
      const main = polz.series_iv.main_key_by_shell_size.shell_sizes[String(shell)];
      return minor && main ? [main.P_deg, main.Q_deg, main.R_deg, main.S_deg, minor.X_or_XX_deg, minor.Y_or_YY_deg] : null;
    };
    const angleSetMatches = (rendered, expected, tol = 1.0) => {
      if (!expected || rendered.length !== expected.length) return false;
      const r = [...rendered].sort((a, b) => a - b);
      const e = [...expected].sort((a, b) => a - b);
      return r.every((v, i) => Math.min(Math.abs(v - e[i]), 360 - Math.abs(v - e[i])) <= tol);
    };
    const fmt = (angles) => "[" + angles.map((n) => Number(n).toFixed(1)).join(", ") + "]";

    // shell-size codes: 9=A 11=B 13=C 15=D 17=E 19=F 21=G 23=H 25=J.
    const keyingCases = [
      // Series III plug (/26), pin: smallest, mid and largest shells x default + alternates.
      { pn: "D38999/26WA35PN", series: "III", shell: 9, letter: "N", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WA35PA", series: "III", shell: 9, letter: "A", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WA35PE", series: "III", shell: 9, letter: "E", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WE35PN", series: "III", shell: 17, letter: "N", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WE35PA", series: "III", shell: 17, letter: "A", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WE35PE", series: "III", shell: 17, letter: "E", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WJ35PN", series: "III", shell: 25, letter: "N", role: "plug", gender: "pin", count: 4, master: true },
      { pn: "D38999/26WJ35PE", series: "III", shell: 25, letter: "E", role: "plug", gender: "pin", count: 4, master: true },
      // Series III receptacle (/20), socket: role + face-mirror behaviour.
      { pn: "D38999/20WE35SN", series: "III", shell: 17, letter: "N", role: "receptacle", gender: "socket", count: 4, master: true },
      // Series IV plug (/46), pin: no 12-o'clock master; six markers incl. wide K.
      { pn: "D38999/46WB35PN", series: "IV", shell: 11, letter: "N", role: "plug", gender: "pin", count: 6, master: false },
      { pn: "D38999/46WB35PK", series: "IV", shell: 11, letter: "K", role: "plug", gender: "pin", count: 6, master: false },
      { pn: "D38999/46WB35PR", series: "IV", shell: 11, letter: "R", role: "plug", gender: "pin", count: 6, master: false },
      { pn: "D38999/46WE35PN", series: "IV", shell: 17, letter: "N", role: "plug", gender: "pin", count: 6, master: false },
      { pn: "D38999/46WE35PK", series: "IV", shell: 17, letter: "K", role: "plug", gender: "pin", count: 6, master: false },
      { pn: "D38999/46WJ35PR", series: "IV", shell: 25, letter: "R", role: "plug", gender: "pin", count: 6, master: false },
      // Series IV receptacle (/40), socket.
      { pn: "D38999/40WE35SN", series: "IV", shell: 17, letter: "N", role: "receptacle", gender: "socket", count: 6, master: false },
    ];
    const keyingPns = keyingCases.map((c) => c.pn);

    const keyingGeometry = await cdp.eval(`(() => {
      const $ = (s) => document.querySelector(s);
      const input = $("#partNumberInput"), btn = $("#decodeButton");
      const engBtn = $("#viewModeEngBtn"), realBtn = $("#viewModeRealBtn");
      const norm = (a) => ((a % 360) + 360) % 360;
      const ang = (cx, cy, x, y) => norm(Math.atan2(x - cx, cy - y) * 180 / Math.PI);
      const rectCenterAngle = (cx, cy, el) => ang(cx, cy, (+el.getAttribute("x")) + (+el.getAttribute("width")) / 2, (+el.getAttribute("y")) + (+el.getAttribute("height")) / 2);
      const spokeAngles = (svg, cx, cy) => [...svg.querySelectorAll(".keying-spoke")].map((l) => ang(cx, cy, +l.getAttribute("x2"), +l.getAttribute("y2")));
      const audit = (pn) => {
        input.value = pn; btn.click(); engBtn.click();
        const svg = $("#connectorSvg");
        const ring = svg.querySelector(".keying-reference-ring");
        if (!ring) return { pn: pn, ok: false };
        const cx = +ring.getAttribute("cx"), cy = +ring.getAttribute("cy");
        const spokes = spokeAngles(svg, cx, cy);
        const masters = [...svg.querySelectorAll(".keying-real-master")];
        const masterAngles = masters.map((m) => rectCenterAngle(cx, cy, m));
        const drawing = svg.querySelector(".keying-drawing");
        realBtn.click();
        const keyEl = svg.querySelector(".keying-real-key"), kwEl = svg.querySelector(".keying-real-keyway");
        const keyShown = keyEl ? getComputedStyle(keyEl).display !== "none" : false;
        const kwShown = kwEl ? getComputedStyle(kwEl).display !== "none" : false;
        const firstSpoke = svg.querySelector(".keying-spoke");
        const spokeHidden = firstSpoke ? getComputedStyle(firstSpoke).display === "none" : true;
        engBtn.click();
        return { pn: pn, ok: true, spokes: spokes, count: spokes.length,
                 role: drawing ? (drawing.dataset.role || "") : "",
                 mirrored: svg.dataset.mirrored === "true", gender: svg.dataset.gender || "",
                 masterCount: masters.length, masterAngles: masterAngles,
                 keyShown: keyShown, kwShown: kwShown, spokeHidden: spokeHidden };
      };
      const audits = {};
      ${JSON.stringify(keyingPns)}.forEach((pn) => { audits[pn] = audit(pn); });
      // Keying-chip interaction: decode letter N then click the "B" chip and re-read.
      input.value = "D38999/26WE35PN"; btn.click(); engBtn.click();
      const svg0 = $("#connectorSvg"), ring0 = svg0.querySelector(".keying-reference-ring");
      const beforeActive = (document.querySelector(".keying-chip.active") || {}).textContent;
      const beforeSpokes = spokeAngles(svg0, +ring0.getAttribute("cx"), +ring0.getAttribute("cy"));
      const chipB = [...document.querySelectorAll(".keying-chip")].find((c) => c.textContent.trim() === "B");
      if (chipB) chipB.click();
      const svg1 = $("#connectorSvg"), ring1 = svg1.querySelector(".keying-reference-ring");
      const afterActive = (document.querySelector(".keying-chip.active") || {}).textContent;
      const afterSpokes = spokeAngles(svg1, +ring1.getAttribute("cx"), +ring1.getAttribute("cy"));
      engBtn.click();
      return { audits: audits, chip: {
        beforeActive: (beforeActive || "").trim(), afterActive: (afterActive || "").trim(),
        beforeSpokes: beforeSpokes, afterSpokes: afterSpokes } };
    })()`);

    keyingCases.forEach((c) => {
      const a = keyingGeometry.audits[c.pn];
      const expected = c.series === "IV" ? expectedIV(c.shell, c.letter) : expectedIII(c.shell, c.letter);
      assert(a && a.ok, `Keying ${c.pn} renders keying geometry`);
      if (!a || !a.ok) return;
      assert(a.count === c.count, `Keying ${c.pn} draws ${c.count} polarizing markers (got ${a.count})`);
      assert(angleSetMatches(a.spokes, expected), `Keying ${c.pn} markers sit at the Figure 6/7 angles ${expected ? fmt(expected) : "?"} (rendered ${fmt(a.spokes)})`);
      assert(a.role === c.role, `Keying ${c.pn} shell group carries role "${c.role}" (got "${a.role}")`);
      if (c.master) {
        assert(a.masterCount >= 1 && a.masterAngles.every((m) => Math.min(Math.abs(m), 360 - Math.abs(m)) <= 1.0), `Keying ${c.pn} master key/keyway sits at 12 o'clock (0 deg)`);
      } else {
        assert(a.masterCount === 0, `Keying ${c.pn} (series IV) has no 12-o'clock master marker`);
      }
      if (c.role === "plug") assert(a.keyShown && !a.kwShown, `Keying ${c.pn} real view shows raised plug keys (not keyways)`);
      if (c.role === "receptacle") assert(a.kwShown && !a.keyShown, `Keying ${c.pn} real view shows recessed receptacle keyways (not keys)`);
      assert(a.spokeHidden, `Keying ${c.pn} hides engineering spokes in the real view`);
      assert(a.mirrored === (c.gender === "socket"), `Keying ${c.pn} face-mirror flag matches its ${c.gender} contacts`);
    });

    // Different keying letters must render geometrically distinct shapes (anti-mismate).
    const sameShellIII = ["N", "A", "E"].map((L) => keyingGeometry.audits["D38999/26WE35P" + L]).filter((a) => a && a.ok);
    const distinctIII = new Set(sameShellIII.map((a) => [...a.spokes].sort((x, y) => x - y).map((n) => n.toFixed(1)).join(",")));
    assert(distinctIII.size === sameShellIII.length && sameShellIII.length === 3, "Each series III keying letter renders a geometrically distinct key shape (anti-mismate)");

    // Clicking a keying chip repositions the markers to the new letter, same count.
    const chip = keyingGeometry.chip;
    assert(chip.beforeActive === "N" && chip.afterActive === "B", "Clicking the B keying chip switches the active keying from N to B");
    assert(chip.afterSpokes.length === 4 && chip.beforeSpokes.length === 4, "Keying chip switch preserves the four series III markers");
    assert(angleSetMatches(chip.afterSpokes, expectedIII(17, "B")), "Keying chip switch repositions markers to the B angles from Figure 6");
    const beforeSorted = [...chip.beforeSpokes].sort((a, b) => a - b);
    const afterSorted = [...chip.afterSpokes].sort((a, b) => a - b);
    assert(beforeSorted.some((v, i) => Math.abs(v - afterSorted[i]) > 1.0), "Keying chip switch visibly rotates at least one marker");

    // ---- Only suggest keying + connector examples backed by a valid source ----
    const validSourceAudit = await cdp.eval(`(() => {
      const $ = (s) => document.querySelector(s);
      const decode = (pn) => { $("#partNumberInput").value = pn; $("#decodeButton").click(); };
      const norm = (s) => String(s || "").toUpperCase().replace(/[\\s-]+/g, "");
      const VALID = new Set(["manufacturer_verified_exact", "qpl_and_secondary_exact", "qpl_qualified_source"]);
      const vpns = ((window.D38999_TOOLBOX_DATA.research || {}).validPartNumbers || {}).partNumbers || [];
      const level = new Map(vpns.map((r) => [norm(r.normalizedPartNumber || r.partNumber), r.evidenceLevel]));
      const exampleChips = [...document.querySelectorAll(".example-chip[data-example]")].map((c) => c.dataset.example);
      const exampleNonCompliant = exampleChips.filter((pn) => !VALID.has(level.get(norm(pn))));
      const chipLetters = () => [...document.querySelectorAll(".keying-chip")].map((c) => c.textContent.trim()).sort();
      decode("D38999/20FF11BN");
      const limitedKeying = chipLetters();
      decode("D38999/26WE35PN");
      const fullKeying = chipLetters();
      // Engineering-view body now carries a finish wash (a colour, not a url() gradient).
      $("#viewModeEngBtn").click();
      const engFill = getComputedStyle($("#connectorSvg .shell-fill")).fill;
      return { exampleCount: exampleChips.length, exampleNonCompliant, limitedKeying, fullKeying, engFill };
    })()`);
    assert(validSourceAudit.exampleCount >= 5, "Decoder still offers a set of connector example chips");
    assert(validSourceAudit.exampleNonCompliant.length === 0, `Every connector example chip is QPL/manufacturer-verified (offenders: ${validSourceAudit.exampleNonCompliant.join(", ") || "none"})`);
    assert(JSON.stringify(validSourceAudit.limitedKeying) === JSON.stringify(["N"]), "Keying suggestions for D38999/20FF11BN are limited to the valid-source letter N");
    assert(["N", "A", "B", "C", "D", "E"].every((l) => validSourceAudit.fullKeying.includes(l)), "Keying suggestions for D38999/26WE35PN expose every valid-source letter N–E");
    assert(!/^url\(/.test(validSourceAudit.engFill) && validSourceAudit.engFill !== "none", "Engineering view tints the connector body with the decoded finish (not a neutral gradient)");

    const sideViewAudit = await cdp.eval(`(() => {
      const decode = (pn) => {
        document.querySelector("#partNumberInput").value = pn;
        document.querySelector("#decodeButton").click();
      };
      const readSide = (pn) => {
        decode(pn);
        document.querySelector("#viewModeSideBtn").click();
        const fig = document.querySelector("#sideViewLayer .side-view-figure");
        const sw = fig && fig.querySelector(".side-view-finish-swatch");
        return {
          finish: fig ? (fig.dataset.finish || "") : "",
          hasSwatch: Boolean(sw),
          swatchBg: sw ? getComputedStyle(sw).backgroundColor : "",
        };
      };
      const z = readSide("D38999/26ZE35PN");
      const w = readSide("D38999/26WE35PN");
      document.querySelector("#viewModeEngBtn").click();
      return { z, w };
    })()`);
    assert(sideViewAudit.z.finish === "gun" && sideViewAudit.w.finish === "od", "Side-view profile carries the decoded class finish");
    assert(sideViewAudit.z.hasSwatch && Boolean(sideViewAudit.z.swatchBg) && sideViewAudit.z.swatchBg !== sideViewAudit.w.swatchBg, "Side-view finish swatch renders and tints per decoded finish");

    const guideAndGaugeAudit = await cdp.eval(`(() => {
      const selectByArrangement = (id) => {
        document.querySelector("#arrangementFilter").value = id;
        document.querySelector("#arrangementFilter").dispatchEvent(new Event("input", { bubbles: true }));
        [...document.querySelectorAll(".catalog-card .catalog-card-id")].find((node) => node.textContent.trim() === id).closest(".catalog-card").click();
      };
      selectByArrangement("25-46");
      const arrangementA = window.D38999_TOOLBOX_DATA.pinout.insertArrangements.arrangements.find((arr) => arr.id === "25-46");
      const sizes = (arrangementA.contacts || []).map((contact) => String(contact.size).trim());
      const has8 = Boolean(document.querySelector("#connectorSvg .gauge-8"));
      const has16 = Boolean(document.querySelector("#connectorSvg .gauge-16"));
      const has20 = Boolean(document.querySelector("#connectorSvg .gauge-20"));
      selectByArrangement("17-35");
      const guides = document.querySelectorAll("#connectorSvg .guide-path").length;
      document.querySelector('.tab-button[data-tab="manual"]').click();
      const manualText = document.querySelector("#manualContent").textContent;
      return { sizes, has8, has16, has20, guides, manualText };
    })()`);
    assert(guideAndGaugeAudit.sizes.filter((size) => size === "8 Coax").length === 2, "25-46 assigns two #8 coax contacts");
    assert(guideAndGaugeAudit.sizes.filter((size) => size === "16").length === 4, "25-46 assigns four #16 contacts");
    assert(guideAndGaugeAudit.sizes.filter((size) => size === "20").length === 40, "25-46 assigns forty #20 contacts");
    assert(guideAndGaugeAudit.has8 && guideAndGaugeAudit.has16 && guideAndGaugeAudit.has20, "25-46 renders gauge-specific symbols");
    assert(guideAndGaugeAudit.guides > 0, "17-35 renders extracted separator guide paths");
    assert(
      guideAndGaugeAudit.manualText.includes("Reference & rules") &&
      guideAndGaugeAudit.manualText.includes("Contact Styles") &&
      guideAndGaugeAudit.manualText.includes("Data sources"),
      "Manual tab renders simplified standard guide"
    );

    const glossaryAudit = await cdp.eval(`(() => {
      document.querySelector('.tab-button[data-tab="catalog"]').click();
      const af = document.querySelector("#arrangementFilter");
      if (af) { af.value = ""; af.dispatchEvent(new Event("input", { bubbles: true })); }
      const sf = document.querySelector("#shellFilter");
      if (sf) { sf.value = ""; sf.dispatchEvent(new Event("change", { bubbles: true })); }
      const card = [...document.querySelectorAll(".catalog-card")].find((el) => !el.classList.contains("active"))
        || document.querySelector(".catalog-card");
      const coaxPill = [...card.querySelectorAll(".size-pill")].find((el) => /coax/i.test(el.getAttribute("data-glossary-value") || ""))
        || card.querySelector(".size-pill");
      const wasActive = card.classList.contains("active");
      coaxPill.click();
      const afterPill = document.querySelector(".glossary-popover");
      const pillBody = afterPill ? afterPill.querySelector(".glossary-popover-body").textContent.trim() : "";
      const cardStayedUnselected = card.classList.contains("active") === wasActive;
      const svc = card.querySelector(".catalog-service[data-glossary]");
      svc.click();
      const afterSvc = document.querySelector(".glossary-popover");
      const svcBody = afterSvc ? afterSvc.querySelector(".glossary-popover-body").textContent.trim() : "";
      document.body.click();
      const closed = !document.querySelector(".glossary-popover");
      return { hasSvcAttr: Boolean(svc), pillBody, svcBody, cardStayedUnselected, closed };
    })()`);
    assert(glossaryAudit.pillBody.length > 10, "Size pill opens a glossary popover with a description");
    assert(glossaryAudit.svcBody.length > 10, "Svc chip opens a glossary popover with a description");
    assert(glossaryAudit.cardStayedUnselected, "Clicking a glossary chip does not change catalog card selection");
    assert(glossaryAudit.closed, "Clicking outside closes the glossary popover");

    const shieldedAudit = await cdp.eval(`(() => {
      document.querySelector('.tab-button[data-tab="catalog"]').click();
      const pick = (id) => {
        const af = document.querySelector("#arrangementFilter");
        af.value = id; af.dispatchEvent(new Event("input", { bubbles: true }));
        [...document.querySelectorAll(".catalog-card .catalog-card-id")]
          .find((n) => n.textContent.trim() === id).closest(".catalog-card").click();
        return document.querySelectorAll("#connectorSvg .pin-symbol-cutout").length;
      };
      const result = { coax: pick("25-46"), twinax: pick("25-90") };
      const af = document.querySelector("#arrangementFilter");
      if (af) { af.value = ""; af.dispatchEvent(new Event("input", { bubbles: true })); }
      return result;
    })()`);
    assert(shieldedAudit.coax === 2, "25-46 draws one bore per #8 coax contact (2 total)");
    assert(shieldedAudit.twinax === 4, "25-90 draws two bores per #8 twinax contact (4 total)");
    assert(shieldedAudit.twinax > shieldedAudit.coax, "Coax and twinax #8 inserts render with distinct bore patterns");


    const manualFilter = await cdp.eval(`(() => {
      const shell = document.querySelector("#shellFilter");
      shell.value = "17";
      shell.dispatchEvent(new Event("change", { bubbles: true }));
      const cards = [...document.querySelectorAll(".catalog-card .catalog-card-id")].map((node) => node.textContent.trim());
      return { count: cards.length, all17: cards.every((text) => text.startsWith("17-")) };
    })()`);
    assert(manualFilter.count > 0 && manualFilter.all17, "Manual shell-size filter returns shell 17 arrangements");

    const contextFilterAudit = await cdp.eval(`(() => {
      document.querySelector('.tab-button[data-tab="catalog"]').click();
      const setValue = (selector, value) => {
        const node = document.querySelector(selector);
        node.value = value;
        node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      };
      setValue("#arrangementFilter", "");
      setValue("#shellFilter", "");
      setValue("#countFilter", "");
      setValue("#sizeFilter", "");
      setValue("#typeFilter", "");
      setValue("#genderFilter", "");
      setValue("#keyingFilter", "");
      setValue("#shellStyleFilter", "");
      setValue("#slashSheetFilter", "");
      const total = document.querySelectorAll(".catalog-card .catalog-card-id").length;
      setValue("#slashSheetFilter", "/46");
      const afterSlash = [...document.querySelectorAll(".catalog-card .catalog-card-id")].map((node) => node.textContent.trim());
      setValue("#shellStyleFilter", "receptacle");
      const afterWrongRole = document.querySelectorAll(".catalog-card .catalog-card-id").length;
      setValue("#shellStyleFilter", "plug");
      const afterMatchingRole = document.querySelectorAll(".catalog-card .catalog-card-id").length;
      return {
        total,
        afterSlashCount: afterSlash.length,
        afterSlashHas1739: afterSlash.includes("17-39"),
        afterWrongRole,
        afterMatchingRole,
      };
    })()`);
    assert(contextFilterAudit.afterSlashCount > 0 && contextFilterAudit.afterSlashCount < contextFilterAudit.total, "Slash-sheet filter narrows arrangement results");
    assert(!contextFilterAudit.afterSlashHas1739, "Slash-sheet filter excludes arrangements without matching exact catalog context");
    assert(contextFilterAudit.afterWrongRole === 0, "Shell-style filter excludes incompatible slash-sheet contexts");
    assert(contextFilterAudit.afterMatchingRole === contextFilterAudit.afterSlashCount, "Compatible shell-style context preserves matching slash-sheet arrangements");

    // The keying filter must offer Series IV minor keys (K,L,M,R), not just the
    // Series III set — they exist in the corpus and were previously unfilterable.
    const keyingFilterOptions = await cdp.eval(`[...document.querySelectorAll("#keyingFilter option")].map((o) => o.value)`);
    assert(["N", "A", "B", "C", "D", "E", "K", "L", "M", "R"].every((k) => keyingFilterOptions.includes(k)), "Keying filter dropdown offers Series III (N-E) and Series IV (K,L,M,R) keying letters");

    const ruggedIoAudit = await cdp.eval(`(() => {
      document.querySelector("#partNumberInput").value = "TV06UCOMCF11P";
      document.querySelector("#decodeButton").click();
      return {
        ruggedCard: Boolean(document.querySelector("#decodedPanel .rugged-io-decoded")),
        decodedText: document.querySelector("#decodedPanel").textContent,
        ruggedImages: document.querySelectorAll("#ruggedFaceLayer img").length,
      };
    })()`);
    assert(ruggedIoAudit.ruggedCard, "TV µCOM rugged I/O part numbers decode into the rugged connector summary");
    assert(ruggedIoAudit.decodedText.includes("TV µCOM-10Gb+") && ruggedIoAudit.decodedText.includes("11"), "TV µCOM decode shows the family name and shell size");
    assert(ruggedIoAudit.ruggedImages >= 1, "TV µCOM decode renders rugged connector artwork");

    // Switch to the mating tab for catalog-backed reciprocal tests
    await cdp.eval(`document.querySelector('.tab-button[data-tab="mating"]').click(); true;`);

    const reciprocalAudit = await cdp.eval(`(() => {
      document.querySelector("#partNumberInput").value = "D38999/26WE35PN";
      document.querySelector("#decodeButton").click();
      document.querySelector('.tab-button[data-tab="mating"]').click();
      const panel = document.querySelector("#matingContent");
      if (!panel) return { panelExists: false };
      const pnEl = panel.querySelector(".mating-pn");
      const recipPN = pnEl ? pnEl.textContent.trim() : "";
      const sheetBtns = panel.querySelectorAll("[data-mate-sheet]");
      const activeSheet = panel.querySelector(".mating-sel-btn.active");
      const pairingArrow = Boolean(panel.querySelector(".mating-pair-arrow"));
      const openBtn = panel.querySelector(".mating-decode-btn");
      const validationBadges = panel.querySelectorAll(".mating-validation, .exact-catalog-hit");
      const sourceCards = panel.querySelectorAll(".mating-source-card");
      return {
        panelExists: true,
        hasPN: Boolean(pnEl),
        recipPN,
        segCount: sheetBtns.length,
        hasActiveSeg: Boolean(activeSheet),
        pairingArrow,
        hasOpenBtn: Boolean(openBtn),
        badgeCount: validationBadges.length,
        sourceCardCount: sourceCards.length,
      };
    })()`);
    assert(reciprocalAudit.panelExists, "Mating panel element exists in DOM");
    assert(reciprocalAudit.hasPN, "Mating panel renders a catalog-backed candidate part number");
    assert(/^D38999\/\d+/.test(reciprocalAudit.recipPN), "Mating part number is a valid D38999 PN");
    assert(reciprocalAudit.recipPN !== "D38999/26WE35PN", "Mating PN differs from source and reverses the shell role");
    assert(reciprocalAudit.sourceCardCount >= 2, "Mating view renders both source and mate connector cards");
    assert(reciprocalAudit.pairingArrow, "Pairing arrow glyph is rendered between the two connector cards");
    assert(reciprocalAudit.hasOpenBtn, "Open mating connector CTA button is present");
    assert(reciprocalAudit.badgeCount >= 1, "At least one catalog validation badge is shown");
    if (reciprocalAudit.segCount > 0) {
      assert(reciprocalAudit.hasActiveSeg, "One mating shell option button is marked active");
    }

    const segSwitchAudit = await cdp.eval(`(() => {
      const panel = document.querySelector("#matingContent");
      const btns = [...panel.querySelectorAll("[data-mate-sheet]")];
      if (btns.length < 2) return { skipped: true };
      const firstPN = panel.querySelector(".mating-pn").textContent.trim();
      const secondBtn = btns.find((button) => !button.classList.contains("active"));
      secondBtn.click();
      const newPN = panel.querySelector(".mating-pn").textContent.trim();
      return { skipped: false, firstPN, newPN, pnChanged: firstPN !== newPN };
    })()`);
    if (!segSwitchAudit.skipped) {
      assert(segSwitchAudit.pnChanged, "Clicking a different mating shell option updates the candidate part number");
    }

    const openRecipAudit = await cdp.eval(`(() => {
      const panel = document.querySelector("#matingContent");
      const openBtn = panel.querySelector(".mating-decode-btn");
      if (!openBtn) return { skipped: true };
      const recipPN = openBtn.dataset.matingPn;
      openBtn.click();
      const inputVal = document.querySelector("#partNumberInput").value;
      const decodedText = document.querySelector("#decodedPanel").textContent;
      return { skipped: false, inputVal, recipPN, inputMatchesPN: inputVal === recipPN, decodedNotEmpty: decodedText.length > 20 };
    })()`);
    if (!openRecipAudit.skipped) {
      assert(openRecipAudit.inputMatchesPN, "Open mating button sets part number input to the mating PN");
      assert(openRecipAudit.decodedNotEmpty, "Opening the mating PN decodes it successfully in the decoder panel");
    }

    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(debugDir, "app_revised.png"), Buffer.from(screenshot.data, "base64"));

    console.log(JSON.stringify({
      ok: true,
      checks: [
        "file app loaded",
        "17-26 dynamic pinout renders gauge symbols with labels hidden by default",
        "no question-mark labels in generated data, viewer, table, or CSV",
        "pin labels are unique per arrangement",
        "mixed-size arrangements assign gauges from source title counts and detected diameters",
        "extracted separator guide paths render in dense arrangements",
        "D38999 manual tab and part-number guide render",
        "redrawn dynamic shell is used and raw source SVG is not layered",
        "decoder-side pin catalog is removed",
        "pin search highlights and opens detail",
        "part number lookup selects 17-35",
        "command launcher routes query-driven workflows",
        "decoded exact-match cards render one exact-match block and one human summary",
        "decoded evidence badges show trust level",
        "decoded action hub exposes next-step workflows",
        "front-face shell hardware expands without clipping and keeps flange renderings neutral",
        "front-face finish colors map to the decoded class families",
        "side-view profile reflects the decoded class finish with a color swatch",
        "series III and IV keying geometry renders from the loaded polarization data",
        "series III/IV keying markers render at the true Figure 6/7 angles with role-correct keys/keyways, master, anti-mismate and chip switching",
        "only valid-source (QPL/manufacturer-verified) keying letters and connector example chips are suggested; engineering view tints the body with the finish",
        "keying filter dropdown offers Series IV minor keys K,L,M,R in addition to the Series III set",
        "manual shell filter works",
        "Svc rating and contact-size pills open glossary popovers",
        "coax/twinax #8 contacts render distinct bore patterns",
        "advanced catalog context filters work",
        "TV µCOM rugged I/O part numbers decode and render artwork",
        "signal-assignment controls are absent",
        "mating panel renders catalog-backed mating PN with paired connector cards",
        "mating shell option switching updates the candidate PN when multiple options exist",
        "open mating connector button decodes the mating PN",
      ],
      data: dataAudit,
      screenshot: "output/debug/app_revised.png",
    }, null, 2));
    success = true;
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    await new Promise((resolve) => {
      chrome.once("exit", resolve);
      setTimeout(resolve, 1200);
    });
    if (success && !process.env.KEEP_VALIDATION_ARTIFACTS) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
        fs.rmSync(downloadsDir, { recursive: true, force: true });
      } catch {
        // Chrome can hold profile files briefly after process exit; validation
        // success should not be converted into a failure by temp cleanup.
      }
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Validation failed: ${message}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
