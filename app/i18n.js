/*
 * Lightweight, dependency-free i18n layer for the D38999 Toolbox.
 *
 * Offline-first: no frameworks, no fetch, no build step. The whole dictionary
 * ships in this file and is applied by walking `data-i18n*` attributes in the
 * DOM. `app.js` / `converter.js` read translated strings through
 * `window.D38999_I18N.t(key)` and re-apply after dynamic renders.
 *
 * Loaded BEFORE app.js so `window.D38999_I18N` exists during init().
 *
 * Attribute hooks handled by applyTranslations():
 *   data-i18n        -> element.textContent
 *   data-i18n-ph     -> element.placeholder
 *   data-i18n-aria   -> element aria-label
 *   data-i18n-title  -> element title
 *   data-i18n-html   -> element.innerHTML (only for static markup; never for
 *                       elements whose children carry bound event listeners)
 */
(function () {
  "use strict";

  var STORAGE_KEY = "d38999.lang";
  var DEFAULT_LANG = "en";
  var SUPPORTED = ["en", "he"];
  var RTL_LANGS = { he: true };

  // Native name of each language, shown on the toggle button (target language).
  var LANG_NAMES = { en: "English", he: "עברית" };

  var DICT = {
    en: {
      "app.title": "D38999 Toolbox",

      "header.tagline": "Decode, match, browse, build, and convert D38999 connectors.",
      "header.searchPlaceholder": "Search part no., arrangement (17-26), or manufacturer P/N",
      "header.searchAria": "Global search",
      "header.shortcutsAria": "Keyboard shortcuts",
      "header.shortcutsTitle": "Keyboard shortcuts (press ?)",
      "header.themeAria": "Toggle dark mode",
      "header.themeTitle": "Toggle dark mode",
      "header.langAria": "Switch language",

      "nav.aria": "Application sections",
      "a11y.skip": "Skip to main content",
      "nav.home": "Home",
      "nav.decode": "Decode",
      "nav.mating": "Mating",
      "nav.arrangements": "Arrangements",
      "nav.io": "I/O Connectors",
      "nav.converter": "P/N Converter",
      "nav.build": "Build",
      "nav.manual": "Manual",

      "home.aria": "Start Here",
      "home.kicker": "Get started",
      "home.title": "What do you want to do?",
      "home.subtitle": "Pick a tool below.",
      "home.gridAria": "Home functions",
      "home.card.decode.desc": "Read a part number.",
      "home.card.mating.desc": "Find the matching connector.",
      "home.card.arrangements.desc": "Browse insert layouts.",
      "home.card.io.desc": "Browse rugged USB, RJ45, HDMI.",
      "home.card.converter.desc": "Cross-reference part numbers.",
      "home.card.build.desc": "Create a valid connector.",
      "home.card.manual.desc": "Learn the code system.",
      "home.recentTitle": "Recent & favorites",

      "decoder.heading": "Decode",
      "decoder.partNumberLabel": "Part number",
      "decoder.decodeButton": "Decode",
      "common.examples": "Examples",
      "decoder.hintPre": "Enter a D38999 P/N or ",
      "decoder.hintLink": "browse arrangements",
      "decoder.hintPost": ".",
      "common.recent": "Recent",

      "viewer.pinLabels": "Pin labels",
      "viewer.labels.smart": "Smart",
      "viewer.labels.focus": "Selected only",
      "viewer.labels.all": "Show all",
      "viewer.labels.off": "OFF",
      "viewer.labels.on": "ON",
      "viewer.outline": "Outline",
      "viewer.resetView": "Reset view",
      "viewer.pinLabel": "Pin",
      "viewer.pinPlaceholder": "A or 1",
      "legend.sizes": "Sizes",
      "legend.match": "Match",
      "viewer.svgAria": "Connector insert arrangement",
      "common.decoded": "Decoded",
      "decoder.decodedAria": "Decoded part number details",
      "common.guide": "Guide",
      "common.pin": "Pin",
      "decoder.selectPin": "Select a pin.",

      "catalog.filterTitle": "Filter arrangements",
      "common.shellSize": "Shell size",
      "common.insertArrangement": "Insert arrangement",
      "catalog.arrangementPlaceholder": "e.g. 17-26 or 35",
      "common.contacts": "Contacts",
      "common.size": "Size",
      "common.type": "Type",
      "common.pinSocket": "Pin / socket",
      "common.all": "All",
      "common.socket": "Socket",
      "common.unknown": "Unknown",
      "catalog.advanced": "Advanced filters",
      "catalog.slashSheet": "Connector series (slash sheet)",
      "catalog.shellStyle": "Shell style (plug or panel mount)",
      "common.any": "Any",
      "common.plug": "Plug",
      "common.receptacle": "Receptacle",
      "catalog.keying": "Alignment key (polarization)",
      "catalog.key.N": "N - normal",
      "catalog.key.A": "A - alternate",
      "catalog.key.B": "B - alternate",
      "catalog.key.C": "C - alternate",
      "catalog.key.D": "D - alternate",
      "catalog.key.E": "E - alternate",
      "common.clearFilters": "Clear filters",
      "catalog.compareTitle": "Compare two",
      "catalog.compareA": "Arrangement A",
      "catalog.compareB": "Arrangement B",
      "common.sort": "Sort",
      "catalog.sort.id": "Arrangement ID",
      "catalog.sort.contacts": "Contact count",
      "catalog.sort.shell": "Shell size",

      "io.filterTitle": "Filter I/O connectors",
      "io.intro": "Rugged MIL-DTL-38999 style USB, Ethernet (RJ45), HDMI and DisplayPort connectors.",
      "io.interface": "Interface",
      "io.allInterfaces": "All interfaces",
      "io.vendor": "Vendor",
      "io.allVendors": "All vendors",
      "common.search": "Search",
      "io.searchPlaceholder": "e.g. RJ45, USB-C, Glenair",

      "converter.title": "P/N Converter",
      "converter.inputLabel": "Enter a D38999 or manufacturer part number",
      "converter.convert": "Convert",
      "common.clear": "Clear",
      "converter.samplesAria": "Sample part numbers",
      "converter.catalogsLabel": "Catalogs in database:",
      "converter.copyD38999": "Copy D38999",
      "converter.openInDecoder": "Open in Decoder",
      "converter.th.manufacturer": "Manufacturer",
      "converter.th.productLine": "Product line",
      "converter.th.candidate": "Candidate PN",
      "converter.th.confidence": "Confidence",
      "converter.th.notes": "Notes",

      "build.aria": "Build Connector",
      "build.title": "Build",
      "build.subtitle": "Select valid options step by step.",

      "manual.aria": "Interactive Manual",
      "manual.title": "Interactive Manual",
      "manual.subtitle": "Learn what each part of the code means, with examples.",

      "mating.aria": "Mating Connector",
      "mating.title": "Mating connector",
      "mating.subtitle": "Find the connector that plugs into your part — same pin layout, opposite pins and sockets.",

      // --- Dynamic UI chrome rendered by app.js ---
      "status.dataBoth": "{count} arrangements loaded | {rules} converter rules loaded",
      "status.dataArrangements": "{count} arrangements loaded",
      "status.selected": "{id} | {count} contacts",

      "filter.allInsert": "All / insert arrangements",

      "catalog.countAll": "{total} items",
      "catalog.countFiltered": "{shown} of {total} items",
      "catalog.empty": "No arrangements match the current filters. ",

      "io.countAll": "{total} connectors",
      "io.countFiltered": "{shown} of {total} connectors",
      "io.empty": "No I/O connectors match the current filters. ",
      "io.views": "Views:",

      "card.enlarge": "Click to enlarge",
      "card.contacts": "{count} contacts",
      "card.shell": "Shell",
      "card.svc": "Svc",
      "card.openDecoder": "Decoder →",

      "lightbox.openDecoder": "Open in Decoder →",
      "lightbox.service": "Service",
      "lightbox.sourcePage": "Source p.",

      "viewer.insertArrangementTitle": "Insert Arrangement {id}",

      "pin.contact": "Contact",
      "pin.labelSource": "Label source",
      "pin.correctedLabel": "Corrected extracted label",

      "search.matches": "{count} pin match(es) ({mode}).",
      "search.notFound": "Pin not found in this insert arrangement.",

      "decode.hint": "Type shell type, class, shell size, insert, contacts, and keying.",
      "decode.recognizedRugged": "Recognized {family} ({type}). This is a D38999-style rugged I/O connector — not a standard insert arrangement.",
      "decode.defaultKeyingNote": " Showing keying N by default; type A, B, C, D, or E after the contact letter to choose alternate keying.",
      "decode.decoded": "Decoded {pn}.",
      "decode.decodedNoArr": "Decoded {pn}, but insert arrangement \"{id}\" was not found in the data.",
      "decode.enterPn": "Enter a D38999 part number.",
      "decode.onlyShellType": "Only D38999 shell-type part numbers are supported by this decoder.",
      "decode.tooShort": "Part number is too short for the series III/IV field order.",
      "decode.cannotSplit": "Could not split class, shell-size code, and insert arrangement using source-defined codes.",

      "sc.search": "Focus the global search box",
      "sc.toggle": "Show or hide this shortcuts panel",
      "sc.tabs": "Jump to Home, Decode, Mating, Arrangements, I/O Connectors, Converter, Build or Manual",
      "sc.step": "Step to the previous / next insert arrangement",
      "sc.close": "Close this panel or clear focus",
      "common.close": "Close",

      "recent.removeFav": "Remove favorite",
      "recent.addFav": "Add favorite",

      "decoded.empty": "No part number decoded.",
      "decoded.fallbackEvidence": "Decoded from the current D38999 rules and extracted catalog data.",
      "decoded.action.mate": "Find mate",
      "decoded.action.build": "Build connector",
      "decoded.action.browse": "Browse family",
      "decoded.action.csv": "Export CSV",
      "decoded.action.csvTitle": "Download the decoded breakdown as CSV",
      "decoded.action.print": "Print",
      "decoded.action.printTitle": "Print or save the decoded result as PDF",
      "decoded.insertDrawing": "Insert drawing",
      "decoded.insertSummary": "{id} | {count} contacts | {sizes}",
      "decoded.insertNeedsVerify": "{id} | needs manual verification",
      "decoded.sources": "Sources: {list}",
      "decoded.why": "Why?",
      "decoded.whyAria": "Why does {label} mean this?",
      "common.source": "Source",
      "common.unknownLc": "unknown",

      "csv.field": "Field",
      "csv.code": "Code",
      "csv.meaning": "Meaning",
      "csv.why": "Why it matters",
      "csv.insertArrangement": "Insert arrangement",
      "csv.partNumber": "Part number",

      "val.exact": "Exact part-number match",
      "val.formatValid": "Format valid, listing unconfirmed",
      "val.unsupported": "Unsupported combination",
      "val.needsReview": "Needs manufacturer review",
      "val.missingData": "Missing catalog data",
      "val.confidence": "confidence {pct}%",

      "env.fit": "Environment fit",
      "env.conditional": "{label} (conditional)",

      "rugged.name": "D38999-Style Rugged I/O Connector",
      "rugged.family": "Family:",
      "rugged.vendor": "Vendor:",
      "rugged.interface": "Interface:",
      "rugged.interfaceGender": "Interface gender:",
      "rugged.shellSize": "Shell Size:",
      "rugged.type": "Type:",
      "rugged.relation": "Relation:",
      "rugged.mounting": "Mounting:",
      "rugged.config": "Config:",
      "rugged.faceUnavailable": "{family} front face unavailable",
      "rugged.frontFace": "{family} — front face",
      "rugged.shellCaption": "Shell {size}",

      "compare.difference": "Difference",
      "compare.sameSize": "same size summary",
      "compare.contactDelta": "{delta} contact count delta",
      "compare.cardMeta": "{count} contacts | {sizes}",

      "size.unknown": "size unknown"
    },

    he: {
      "app.title": "ארגז כלים D38999",

      "header.tagline": "פענוח, התאמה, עיון, בנייה והמרה של מחברי D38999.",
      "header.searchPlaceholder": "חיפוש מק\"ט, מערך (17-26) או מק\"ט יצרן",
      "header.searchAria": "חיפוש כללי",
      "header.shortcutsAria": "קיצורי מקלדת",
      "header.shortcutsTitle": "קיצורי מקלדת (לחץ ?)",
      "header.themeAria": "החלפת מצב כהה",
      "header.themeTitle": "החלפת מצב כהה",
      "header.langAria": "החלפת שפה",

      "nav.aria": "מקטעי היישום",
      "a11y.skip": "דלג לתוכן הראשי",
      "nav.home": "בית",
      "nav.decode": "פענוח",
      "nav.mating": "התאמה",
      "nav.arrangements": "מערכים",
      "nav.io": "מחברי קלט/פלט",
      "nav.converter": "ממיר מק\"ט",
      "nav.build": "בנייה",
      "nav.manual": "מדריך",

      "home.aria": "התחל כאן",
      "home.kicker": "בואו נתחיל",
      "home.title": "מה תרצה לעשות?",
      "home.subtitle": "בחר כלי מהרשימה.",
      "home.gridAria": "פעולות ראשיות",
      "home.card.decode.desc": "קריאת מספר חלק.",
      "home.card.mating.desc": "מציאת המחבר המתאים.",
      "home.card.arrangements.desc": "עיון בפריסות מגעים.",
      "home.card.io.desc": "עיון במחברי USB, ‏RJ45 ו‑HDMI מוקשחים.",
      "home.card.converter.desc": "השוואת מספרי חלק.",
      "home.card.build.desc": "יצירת מחבר תקין.",
      "home.card.manual.desc": "לימוד שיטת הקוד.",
      "home.recentTitle": "אחרונים ומועדפים",

      "decoder.heading": "פענוח",
      "decoder.partNumberLabel": "מספר חלק",
      "decoder.decodeButton": "פענח",
      "common.examples": "דוגמאות",
      "decoder.hintPre": "הזן מק\"ט D38999 או ",
      "decoder.hintLink": "עיין במערכים",
      "decoder.hintPost": ".",
      "common.recent": "אחרונים",

      "viewer.pinLabels": "תוויות פינים",
      "viewer.labels.smart": "חכם",
      "viewer.labels.focus": "נבחר בלבד",
      "viewer.labels.all": "הצג הכל",
      "viewer.labels.off": "כבוי",
      "viewer.labels.on": "פעיל",
      "viewer.outline": "מתאר",
      "viewer.resetView": "אפס תצוגה",
      "viewer.pinLabel": "פין",
      "viewer.pinPlaceholder": "A או 1",
      "legend.sizes": "גדלים",
      "legend.match": "התאמה",
      "viewer.svgAria": "מערך מגעים של המחבר",
      "common.decoded": "מפוענח",
      "decoder.decodedAria": "פרטי מספר חלק מפוענח",
      "common.guide": "מדריך",
      "common.pin": "פין",
      "decoder.selectPin": "בחר פין.",

      "catalog.filterTitle": "סינון מערכים",
      "common.shellSize": "גודל מעטפת",
      "common.insertArrangement": "מערך מגעים",
      "catalog.arrangementPlaceholder": "לדוגמה 17-26 או 35",
      "common.contacts": "מגעים",
      "common.size": "גודל",
      "common.type": "סוג",
      "common.pinSocket": "פין / שקע",
      "common.all": "הכל",
      "common.socket": "שקע",
      "common.unknown": "לא ידוע",
      "catalog.advanced": "סינון מתקדם",
      "catalog.slashSheet": "סדרת מחבר (גיליון לוכסן)",
      "catalog.shellStyle": "סגנון מעטפת (תקע או התקנת פנל)",
      "common.any": "כלשהו",
      "common.plug": "תקע",
      "common.receptacle": "שקע פנל",
      "catalog.keying": "מפתח יישור (קיטוב)",
      "catalog.key.N": "N - רגיל",
      "catalog.key.A": "A - חלופי",
      "catalog.key.B": "B - חלופי",
      "catalog.key.C": "C - חלופי",
      "catalog.key.D": "D - חלופי",
      "catalog.key.E": "E - חלופי",
      "common.clearFilters": "נקה סינון",
      "catalog.compareTitle": "השוואת שניים",
      "catalog.compareA": "מערך A",
      "catalog.compareB": "מערך B",
      "common.sort": "מיון",
      "catalog.sort.id": "מזהה מערך",
      "catalog.sort.contacts": "מספר מגעים",
      "catalog.sort.shell": "גודל מעטפת",

      "io.filterTitle": "סינון מחברי קלט/פלט",
      "io.intro": "מחברי USB, ‏Ethernet ‏(RJ45)‏, HDMI ו‑DisplayPort מוקשחים בסגנון MIL-DTL-38999.",
      "io.interface": "ממשק",
      "io.allInterfaces": "כל הממשקים",
      "io.vendor": "ספק",
      "io.allVendors": "כל הספקים",
      "common.search": "חיפוש",
      "io.searchPlaceholder": "לדוגמה RJ45, ‏USB-C, ‏Glenair",

      "converter.title": "ממיר מק\"ט",
      "converter.inputLabel": "הזן מק\"ט D38999 או מק\"ט יצרן",
      "converter.convert": "המר",
      "common.clear": "נקה",
      "converter.samplesAria": "מספרי חלק לדוגמה",
      "converter.catalogsLabel": "קטלוגים במאגר:",
      "converter.copyD38999": "העתק D38999",
      "converter.openInDecoder": "פתח במפענח",
      "converter.th.manufacturer": "יצרן",
      "converter.th.productLine": "קו מוצר",
      "converter.th.candidate": "מק\"ט מועמד",
      "converter.th.confidence": "רמת ודאות",
      "converter.th.notes": "הערות",

      "build.aria": "בניית מחבר",
      "build.title": "בנייה",
      "build.subtitle": "בחר אפשרויות תקינות שלב אחר שלב.",

      "manual.aria": "מדריך אינטראקטיבי",
      "manual.title": "מדריך אינטראקטיבי",
      "manual.subtitle": "למד מה משמעות כל חלק בקוד, עם דוגמאות.",

      "mating.aria": "מחבר מתאים",
      "mating.title": "מחבר מתאים",
      "mating.subtitle": "מצא את המחבר שמתחבר לחלק שלך — אותו מערך פינים, פינים ושקעים הפוכים.",

      // --- Dynamic UI chrome rendered by app.js ---
      "status.dataBoth": "{count} מערכים נטענו | {rules} כללי המרה נטענו",
      "status.dataArrangements": "{count} מערכים נטענו",
      "status.selected": "{id} | {count} מגעים",

      "filter.allInsert": "הכל / מערכי מגעים",

      "catalog.countAll": "{total} פריטים",
      "catalog.countFiltered": "{shown} מתוך {total} פריטים",
      "catalog.empty": "אין מערכים התואמים את הסינון הנוכחי. ",

      "io.countAll": "{total} מחברים",
      "io.countFiltered": "{shown} מתוך {total} מחברים",
      "io.empty": "אין מחברי קלט/פלט התואמים את הסינון הנוכחי. ",
      "io.views": "תצוגות:",

      "card.enlarge": "לחץ להגדלה",
      "card.contacts": "{count} מגעים",
      "card.shell": "מעטפת",
      "card.svc": "שירות",
      "card.openDecoder": "מפענח →",

      "lightbox.openDecoder": "פתח במפענח →",
      "lightbox.service": "שירות",
      "lightbox.sourcePage": "מקור עמ'",

      "viewer.insertArrangementTitle": "מערך מגעים {id}",

      "pin.contact": "מגע",
      "pin.labelSource": "מקור תווית",
      "pin.correctedLabel": "תווית מחולצת מתוקנת",

      "search.matches": "{count} התאמות פין ({mode}).",
      "search.notFound": "הפין לא נמצא במערך מגעים זה.",

      "decode.hint": "הקלד סוג מעטפת, מחלקה, גודל מעטפת, מערך, מגעים וקיטוב.",
      "decode.recognizedRugged": "זוהה {family} ({type}). זהו מחבר קלט/פלט מוקשח בסגנון D38999 — לא מערך מגעים סטנדרטי.",
      "decode.defaultKeyingNote": " מוצג קיטוב N כברירת מחדל; הקלד A, B, C, D או E אחרי אות המגע לבחירת קיטוב חלופי.",
      "decode.decoded": "{pn} פוענח.",
      "decode.decodedNoArr": "{pn} פוענח, אך מערך המגעים \"{id}\" לא נמצא בנתונים.",
      "decode.enterPn": "הזן מספר חלק D38999.",
      "decode.onlyShellType": "מפענח זה תומך רק במספרי חלק מסוג מעטפת D38999.",
      "decode.tooShort": "מספר החלק קצר מדי עבור סדר השדות של סדרה III/IV.",
      "decode.cannotSplit": "לא ניתן היה להפריד מחלקה, קוד גודל מעטפת ומערך מגעים לפי הקודים שהוגדרו במקור.",

      "sc.search": "מיקוד לתיבת החיפוש הכללית",
      "sc.toggle": "הצג או הסתר את לוח הקיצורים",
      "sc.tabs": "מעבר לבית, פענוח, התאמה, מערכים, מחברי קלט/פלט, ממיר, בנייה או מדריך",
      "sc.step": "מעבר למערך המגעים הקודם / הבא",
      "sc.close": "סגור לוח זה או נקה מיקוד",
      "common.close": "סגור",

      "recent.removeFav": "הסר מהמועדפים",
      "recent.addFav": "הוסף למועדפים",

      "decoded.empty": "לא פוענח מספר חלק.",
      "decoded.fallbackEvidence": "פוענח לפי כללי D38999 הנוכחיים ונתוני הקטלוג שחולצו.",
      "decoded.action.mate": "מצא תואם",
      "decoded.action.build": "בנה מחבר",
      "decoded.action.browse": "עיין במשפחה",
      "decoded.action.csv": "ייצוא CSV",
      "decoded.action.csvTitle": "הורד את הפירוק המפוענח כקובץ CSV",
      "decoded.action.print": "הדפס",
      "decoded.action.printTitle": "הדפס או שמור את התוצאה המפוענחת כ‑PDF",
      "decoded.insertDrawing": "שרטוט מערך",
      "decoded.insertSummary": "{id} | {count} מגעים | {sizes}",
      "decoded.insertNeedsVerify": "{id} | דורש אימות ידני",
      "decoded.sources": "מקורות: {list}",
      "decoded.why": "מדוע?",
      "decoded.whyAria": "מדוע {label} משמעו כך?",
      "common.source": "מקור",
      "common.unknownLc": "לא ידוע",

      "csv.field": "שדה",
      "csv.code": "קוד",
      "csv.meaning": "משמעות",
      "csv.why": "מדוע זה חשוב",
      "csv.insertArrangement": "מערך מגעים",
      "csv.partNumber": "מספר חלק",

      "val.exact": "התאמת מספר חלק מדויקת",
      "val.formatValid": "פורמט תקין, רישום לא אומת",
      "val.unsupported": "צירוף לא נתמך",
      "val.needsReview": "דורש בדיקת יצרן",
      "val.missingData": "חסרים נתוני קטלוג",
      "val.confidence": "ודאות {pct}%",

      "env.fit": "התאמה סביבתית",
      "env.conditional": "{label} (מותנה)",

      "rugged.name": "מחבר קלט/פלט מוקשח בסגנון D38999",
      "rugged.family": "משפחה:",
      "rugged.vendor": "ספק:",
      "rugged.interface": "ממשק:",
      "rugged.interfaceGender": "מגדר ממשק:",
      "rugged.shellSize": "גודל מעטפת:",
      "rugged.type": "סוג:",
      "rugged.relation": "יחס:",
      "rugged.mounting": "התקנה:",
      "rugged.config": "תצורה:",
      "rugged.faceUnavailable": "חזית {family} אינה זמינה",
      "rugged.frontFace": "{family} — חזית",
      "rugged.shellCaption": "מעטפת {size}",

      "compare.difference": "הבדל",
      "compare.sameSize": "סיכום גודל זהה",
      "compare.contactDelta": "הפרש של {delta} מגעים",
      "compare.cardMeta": "{count} מגעים | {sizes}",

      "size.unknown": "גודל לא ידוע"
    }
  };

  function normalizeLang(value) {
    return SUPPORTED.indexOf(value) >= 0 ? value : DEFAULT_LANG;
  }

  function readStoredLang() {
    try {
      return normalizeLang(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  var current = readStoredLang();
  var listeners = [];

  function t(key, fallback) {
    var table = DICT[current] || {};
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    var en = DICT.en || {};
    if (Object.prototype.hasOwnProperty.call(en, key)) return en[key];
    return fallback != null ? fallback : key;
  }

  function setAttrFrom(el, attr, datasetKey, asProperty) {
    var key = el.getAttribute(datasetKey);
    if (!key) return;
    var value = t(key);
    if (asProperty) el[attr] = value;
    else el.setAttribute(attr, value);
  }

  function applyTranslations(root) {
    root = root || document;
    var scope = root.querySelectorAll ? root : document;

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
  }

  function applyDir() {
    var html = document.documentElement;
    html.setAttribute("lang", current);
    html.setAttribute("dir", RTL_LANGS[current] ? "rtl" : "ltr");
  }

  function updateToggleButton() {
    var btn = document.getElementById("langToggle");
    if (!btn) return;
    // Show the language you would switch TO.
    var target = current === "en" ? "he" : "en";
    btn.textContent = LANG_NAMES[target];
    btn.setAttribute("aria-label", t("header.langAria"));
    btn.setAttribute("lang", target);
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) { /* listener errors are non-fatal */ }
    }
  }

  function setLang(lang) {
    var next = normalizeLang(lang);
    if (next === current) return;
    current = next;
    try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* storage unavailable */ }
    applyDir();
    applyTranslations(document);
    updateToggleButton();
    notify();
  }

  function toggle() {
    setLang(current === "en" ? "he" : "en");
  }

  function onChange(cb) {
    if (typeof cb === "function") listeners.push(cb);
  }

  function bindToggleButton() {
    var btn = document.getElementById("langToggle");
    if (!btn || btn.dataset.i18nBound) return;
    btn.dataset.i18nBound = "1";
    btn.addEventListener("click", toggle);
  }

  function boot() {
    applyDir();
    applyTranslations(document);
    bindToggleButton();
    updateToggleButton();
  }

  window.D38999_I18N = {
    t: t,
    apply: applyTranslations,
    setLang: setLang,
    toggle: toggle,
    onChange: onChange,
    getLang: function () { return current; },
    isRTL: function () { return !!RTL_LANGS[current]; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
