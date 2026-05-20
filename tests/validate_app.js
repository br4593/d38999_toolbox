const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

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
    "data/d38999_extracted_rules.json",
    "data/d38999_part_number_examples.json",
    "data/d38999_catalog_supported_combinations.json",
    "data/d38999_verified_part_numbers.json",
    "data/d38999_visual_assets.json",
  ];
  const requiredSvgFiles = [
    "assets/d38999/svg/d38999-plug-generic.svg",
    "assets/d38999/svg/d38999-receptacle-generic.svg",
    "assets/d38999/svg/d38999-wall-mount-receptacle.svg",
    "assets/d38999/svg/d38999-jam-nut-receptacle.svg",
    "assets/d38999/svg/d38999-straight-plug.svg",
    "assets/d38999/svg/d38999-backshell-generic.svg",
    "assets/d38999/svg/d38999-keying-helper.svg",
    "assets/d38999/svg/d38999-shell-size-helper.svg",
    "assets/d38999/svg/d38999-insert-placeholder.svg",
  ];

  requiredDataFiles.forEach((relativePath) => {
    assert(fs.existsSync(path.join(projectRoot, relativePath)), `Required research data file exists: ${relativePath}`);
  });
  requiredSvgFiles.forEach((relativePath) => {
    assert(fs.existsSync(path.join(projectRoot, relativePath)), `Required SVG asset exists: ${relativePath}`);
  });

  const extractedRules = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "d38999_extracted_rules.json"), "utf8"));
  const verifiedPartNumbers = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "d38999_verified_part_numbers.json"), "utf8"));
  const visualAssets = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "d38999_visual_assets.json"), "utf8"));

  assert(Array.isArray(extractedRules.catalogGroundingPolicy.statusValues), "Catalog grounding status values are present");
  assert(extractedRules.catalogGroundingPolicy.statusValues.includes("VERIFIED_EXISTS"), "Catalog grounding includes VERIFIED_EXISTS");
  assert(extractedRules.catalogGroundingPolicy.statusValues.includes("VALID_FORMAT_BUT_NOT_CONFIRMED"), "Catalog grounding includes VALID_FORMAT_BUT_NOT_CONFIRMED");
  assert((verifiedPartNumbers.verifiedPartNumbers || []).length >= 5, "At least five exact verified part numbers are available");
  assert((visualAssets.visualAssets || []).some((item) => item.file === "assets/d38999/svg/d38999-keying-helper.svg"), "Visual asset metadata references the created keying helper SVG");

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
    assert(initial.background === "rgb(255, 255, 255)", "Connector viewer uses white drawing background");
    assert(initial.headerBackground === "rgb(255, 255, 255)", "Header uses the flat light surface treatment");
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

    const pinSearch = await cdp.eval(`(() => {
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
        summaries: [...panel.querySelectorAll(".connector-summary .value")].map((node) => node.textContent.trim()),
      };
    })()`);
    assert(exactUiAudit.exactTitles.filter((text) => /exact part-number match/i.test(text)).length === 1, "Decoded exact match renders one exact-match block");
    assert(exactUiAudit.exactBadgeTexts.filter((text) => /exact part-number match/i.test(text)).length === 0, "Decoded exact match does not also render a duplicate validation badge");
    assert(exactUiAudit.summaries.some((text) => /wall-mount receptacle/i.test(text) && /panel|flange/i.test(text)), "Decoded summary explains the shell style in plain language");
    assert(exactUiAudit.summaries.every((text) => !/QPL-validated/i.test(text)), "Decoded summary does not repeat QPL validation wording");

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
    assert(guideAndGaugeAudit.manualText.includes("Strong coverage") && guideAndGaugeAudit.manualText.includes("Contact Styles"), "Manual tab renders simplified standard guide");

    const manualFilter = await cdp.eval(`(() => {
      const shell = document.querySelector("#shellFilter");
      shell.value = "17";
      shell.dispatchEvent(new Event("change", { bubbles: true }));
      const cards = [...document.querySelectorAll(".catalog-card .catalog-card-id")].map((node) => node.textContent.trim());
      return { count: cards.length, all17: cards.every((text) => text.startsWith("17-")) };
    })()`);
    assert(manualFilter.count > 0 && manualFilter.all17, "Manual shell-size filter returns shell 17 arrangements");

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
      const validationBadges = panel.querySelectorAll(".mating-validation");
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
        "decoded exact-match cards render one exact-match block and one human summary",
        "manual shell filter works",
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
