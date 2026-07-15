/* ============================================================
   Vizéa — datamodel.js
   Canonical Project data shape + helpers.

   THE BUG THIS FIXES:
   Old code had Step 2 storing scores as:
     currentProject.scores[testName][subtest] = [ {name,value,type,functions}, ... ]
   (an ARRAY of condition objects, to allow multiple scores per subtest)
   ...but Step 3's renderVisualization() read it as:
     currentProject.scores[testName][subtest] = { value, functions }
   (a single OBJECT) — so .value and .functions were always undefined
   and the chart silently produced nothing.

   This module makes the array-of-conditions shape the ONE canonical
   shape everywhere, including for non-battery tests (always an array,
   even if it only ever holds one condition object).

   PROJECT SHAPE:
   {
     id: string,
     title: string,
     createdAt: ISOString,
     updatedAt: ISOString,
     selectedTests: { [testName]: string[] subtestNames }  // [] = standalone test, no subtests
     scores: {
       [testName]: {
         [subtestKey]: [ { id, name, value, type, functions: string[] }, ... ]
       }
     },
     chartSettings: { ... see getDefaultChartSettings() }
   }

   For standalone tests (no subtests), subtestKey is the literal string
   "__main__" so the shape stays uniform (always testName -> subtestKey -> array).
   ============================================================ */

const STANDALONE_KEY = "__main__";

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createEmptyProject(title) {
  const now = new Date().toISOString();
  return {
    id: uid("proj"),
    title: title || "Nouveau projet",
    createdAt: now,
    updatedAt: now,
    selectedTests: {},
    scores: {},
    iqScales: {},          // clinical: { [testName]: [ {name, value, scale} ] } — memory only
    customFunctions: [],   // project-scoped custom cognitive functions
    chartSettings: getDefaultChartSettings()
  };
}

function getDefaultChartSettings() {
  return {
    displayScale: "Percentile",       // one of SCORE_TYPE_OPTIONS
    chartType: "line",                // "line" | "radar"
    showBands: true,
    showBandLabels: false,            // draw each band's name on the chart
    bandLabels: {},                   // display-name overrides per band key (e.g. "average" -> "Moyenne")
    bandOpacity: 0.13,                // colour intensity of the interpretation bands (0.03–0.45)
    fontScale: 1,                     // text size multiplier for the chart (0.75–1.6)
    proportionalAxis: true,           // y-position by percentile (rarity) on every scale
    axisMin: null,                    // optional axis lower limit (display scale)
    axisMax: null,                    // optional axis upper limit (display scale)
    functionOrder: [],                // user-defined display order (drag to reorder)
    pointOverrides: {},               // view-only per-point { hidden, label } keyed by pid
    pointOrder: [],                   // view-only per-point display order (pids)
    showTestLabels: true,             // x-axis tick labels (test/subtest names)
    visibleFunctions: null,           // null = show all; else array of function names to include
    functionColors: {},               // overrides of DEFAULT_FUNCTION_COLORS, by function name
    functionLabels: {},               // display-name overrides per function (e.g. "Vitesse de traitement" -> "V.d.T."); does not change identity
    showDataLabels: false,
    radarColor: "#176bb5",            // radar profile line/fill colour
    radarFill: true,                  // radar polygon shading on/off
    compareValue: "",                 // optional comparison guide (e.g. estimated FSIQ)
    useEgqiCompare: false,            // tie the comparison line to the entered EGQI value
    compareType: "Standard score",    // score type of the comparison value
    compareLabel: "",                 // optional label shown on the guide line (empty = none)
    // Échelles (IQ) view — independent of the profile's own settings
    scalesTitle: "Visualisation des échelles globales",
    scalesDisplay: "Standard score", // "Standard score" | "Percentile"
    scalesColor: "#1b7fb5",           // colour of the échelles line
    scalesAxisMin: null,              // optional Y lower limit (standard score)
    scalesAxisMax: null,              // optional Y upper limit (standard score)
    hiddenScales: [],                 // sigles to hide from the échelles chart
    scaleLabels: {},                  // display-name overrides per scale (e.g. "EGQI" -> "QIT")
    scaleOrder: [],                   // user-defined display order of scales (drag to reorder)
    // Tableau (table) view
    tableGroupBy: "test",             // "test" | "function"
    tableColumns: { value: true, type: true, percentile: true, classification: true, color: true },
    title: "Visualisation des scores par fonctions cognitives"
  };
}

function createEmptyCondition(defaultFunctions = []) {
  return {
    id: uid("cond"),
    name: "",
    value: "",
    type: "Scale score",
    functions: [...defaultFunctions]
  };
}

/**
 * Build/refresh project.scores so it exactly mirrors project.selectedTests,
 * preserving any already-entered values. Always produces the canonical
 * testName -> subtestKey -> array-of-conditions shape.
 *
 * @param {object} project
 * @param {object} testsBank - loaded tests_bank.json content
 */
function syncScoresWithSelectedTests(project, testsBank) {
  if (!project.scores) project.scores = {};
  const selected = project.selectedTests || {};

  // Remove tests that are no longer selected
  Object.keys(project.scores).forEach(testName => {
    if (!selected[testName]) delete project.scores[testName];
  });

  Object.entries(selected).forEach(([testName, subtestNames]) => {
    const bankEntry = testsBank[testName]; // may be undefined for manually-added tests
    const isStandalone = !subtestNames || subtestNames.length === 0;

    if (!project.scores[testName]) project.scores[testName] = {};

    if (isStandalone) {
      // Remove any stale subtest keys other than __main__
      Object.keys(project.scores[testName]).forEach(k => {
        if (k !== STANDALONE_KEY) delete project.scores[testName][k];
      });
      if (!project.scores[testName][STANDALONE_KEY] || project.scores[testName][STANDALONE_KEY].length === 0) {
        const defaultFunctions = (bankEntry && bankEntry.default_functions) || [];
        project.scores[testName][STANDALONE_KEY] = [createEmptyCondition(defaultFunctions)];
      }
    } else {
      // Remove the standalone key if it exists (test became a battery selection)
      delete project.scores[testName][STANDALONE_KEY];

      // Remove subtests that are no longer selected
      Object.keys(project.scores[testName]).forEach(sub => {
        if (!subtestNames.includes(sub)) delete project.scores[testName][sub];
      });

      // Add missing subtests
      subtestNames.forEach(sub => {
        if (!project.scores[testName][sub] || project.scores[testName][sub].length === 0) {
          const defaultFunctions = (bankEntry && bankEntry.subtests && bankEntry.subtests[sub]) || [];
          project.scores[testName][sub] = [createEmptyCondition(defaultFunctions)];
        }
      });
    }
  });

  project.updatedAt = new Date().toISOString();
}

/**
 * Flatten project.scores into a flat array of plottable points.
 * Each point: { testName, subtestKey, conditionId, label, value, type, functions, percentile }
 * Skips entries with missing/invalid value or empty functions.
 * Requires ScoringEngine (scoring.js) to be loaded for percentile conversion.
 */
function flattenScores(project) {
  const points = [];
  const scores = project.scores || {};

  Object.entries(scores).forEach(([testName, subtestsMap]) => {
    Object.entries(subtestsMap).forEach(([subtestKey, conditions]) => {
      if (!Array.isArray(conditions)) return; // defensive: ignore legacy/bad shapes

      conditions.forEach(cond => {
        if (cond.value === "" || cond.value === null || cond.value === undefined) return;
        const numValue = Number(cond.value);
        if (isNaN(numValue)) return;
        if (!cond.functions || cond.functions.length === 0) return;

        const percentile = window.ScoringEngine
          ? window.ScoringEngine.toPercentile(numValue, cond.type || "Scale score")
          : null;
        if (percentile === null) return;

        // Inverted scores (high = unfavourable, e.g. reaction time/errors) are
        // mirrored around the mean: a 98th-percentile value behaves like a 2nd.
        // Same distance from the mean, opposite side — across every axis scale,
        // since positioning and classification are all percentile-driven.
        const inverted = !!cond.inverted;
        const effPercentile = inverted
          ? Math.max(0, Math.min(100, 100 - percentile))
          : percentile;

        const subLabel = subtestKey === STANDALONE_KEY ? null : subtestKey;
        const baseLabel = [testName, subLabel, cond.name || null].filter(Boolean).join(" – ");

        cond.functions.forEach(func => {
          points.push({
            testName,
            subtestKey,
            conditionId: cond.id,
            pid: cond.id + "::" + func,   // stable id for view-only chart overrides
            label: baseLabel,
            rawValue: numValue,
            type: cond.type || "Scale score",
            func,
            percentile: effPercentile,
            inverted
          });
        });
      });
    });
  });

  return points;
}

// ---- Export / Import of a full PROJECT (contains scores) -------------------
// IMPORTANT: a full project export contains clinical score values. This data
// is NEVER auto-persisted anywhere by Vizéa (no localStorage, no account
// sync). The only way a project (with scores) leaves the app is via this
// explicit, clinician-initiated export — at which point it becomes their
// file, on their device/storage, under their professional responsibility.

function exportProjectToJSON(project) {
  return JSON.stringify(project, null, 2);
}

function importProjectFromJSON(jsonString) {
  const parsed = JSON.parse(jsonString);
  // Minimal shape validation
  if (!parsed || typeof parsed !== "object" || !parsed.title) {
    throw new Error("Fichier de projet invalide.");
  }
  if (!parsed.scores) parsed.scores = {};
  if (!parsed.iqScales) parsed.iqScales = {};
  if (!parsed.selectedTests) parsed.selectedTests = {};
  if (!parsed.chartSettings) parsed.chartSettings = getDefaultChartSettings();
  if (!parsed.id) parsed.id = uid("proj");
  return parsed;
}

// ---- TEMPLATES: test selection + chart preferences, NO scores -------------
// Templates contain zero clinical/patient information by design (just which
// tests/subtests a clinician likes to use, and their chart styling prefs),
// so these ARE safe to persist (browser storage and/or future account sync),
// unlike full projects which always stay memory-only unless explicitly
// exported by the clinician.

/**
 * Extract a reusable, score-free Template from a live project.
 */
function extractTemplateFromProject(project, templateName) {
  // Deep-copy the score structure but BLANK every value, so the template
  // captures the full skeleton — which tests/subtests, every condition row,
  // its name, type and associated cognitive functions — without any clinical
  // score. Applying the template reproduces the project identically, ready for
  // fresh values.
  const scoresSkeleton = {};
  const scores = project.scores || {};
  Object.entries(scores).forEach(([testName, subtests]) => {
    scoresSkeleton[testName] = {};
    Object.entries(subtests).forEach(([sub, conditions]) => {
      if (!Array.isArray(conditions)) return;
      scoresSkeleton[testName][sub] = conditions.map(c => ({
        id: uid("cond"),
        name: c.name || "",
        value: "",                       // never store a value in a template
        type: c.type || "Scale score",
        functions: Array.isArray(c.functions) ? c.functions.slice() : []
      }));
    });
  });

  return {
    id: uid("tmpl"),
    name: templateName || project.title || "Modèle sans titre",
    createdAt: new Date().toISOString(),
    selectedTests: JSON.parse(JSON.stringify(project.selectedTests || {})),
    scores: scoresSkeleton,
    customFunctions: Array.isArray(project.customFunctions) ? project.customFunctions.slice() : [],
    chartSettings: JSON.parse(JSON.stringify(project.chartSettings || getDefaultChartSettings()))
  };
}

/**
 * Apply a Template onto a project: restores selectedTests, the full score
 * skeleton (with empty values), and chartSettings. The caller then runs
 * syncScoresWithSelectedTests(), which preserves the restored rows and only
 * fills in any genuinely missing subtests.
 */
function applyTemplateToProject(project, template) {
  project.selectedTests = JSON.parse(JSON.stringify(template.selectedTests || {}));
  project.chartSettings = JSON.parse(JSON.stringify(template.chartSettings || getDefaultChartSettings()));
  project.customFunctions = Array.isArray(template.customFunctions) ? template.customFunctions.slice() : [];
  // Restore the score skeleton if the template has one (older templates won't).
  if (template.scores) {
    const restored = {};
    Object.entries(template.scores).forEach(([testName, subtests]) => {
      restored[testName] = {};
      Object.entries(subtests).forEach(([sub, conditions]) => {
        restored[testName][sub] = (Array.isArray(conditions) ? conditions : []).map(c => ({
          id: uid("cond"),
          name: c.name || "",
          value: "",
          type: c.type || "Scale score",
          functions: Array.isArray(c.functions) ? c.functions.slice() : []
        }));
      });
    });
    project.scores = restored;
  }
  project.updatedAt = new Date().toISOString();
  return project;
}

// ---- LocalStorage helpers — TEMPLATES ONLY ---------------------------------
// Deliberately separate storage key/namespace from anything score-related,
// so it's structurally impossible for a future code change to accidentally
// persist clinical data under this key.

const TEMPLATES_STORAGE_KEY = "vizea_templates_v1";

function loadAllLocalTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("loadAllLocalTemplates failed", e);
    return {};
  }
}

function saveLocalTemplate(template) {
  try {
    const all = loadAllLocalTemplates();
    all[template.id] = template;
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    console.warn("saveLocalTemplate failed", e);
    return false;
  }
}

function deleteLocalTemplate(templateId) {
  try {
    const all = loadAllLocalTemplates();
    delete all[templateId];
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    console.warn("deleteLocalTemplate failed", e);
    return false;
  }
}

// ---- Custom cognitive functions (user-defined groupings) -------------------
// Stored locally so clinicians can add terms that suit their practice
// (e.g. "Lecture", "Inhibition", "Dextérité") without us shipping a huge
// default list. Contains no clinical data — just function names.

const CUSTOM_FUNCTIONS_KEY = "vizea_custom_functions_v1";

function loadCustomFunctions() {
  try {
    const raw = localStorage.getItem(CUSTOM_FUNCTIONS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch (e) {
    console.warn("loadCustomFunctions failed", e);
    return [];
  }
}

function canonicalFunctions() {
  if (typeof COGNITIVE_FUNCTIONS !== "undefined") return COGNITIVE_FUNCTIONS;
  if (typeof window !== "undefined" && window.VizeaConstants) return window.VizeaConstants.COGNITIVE_FUNCTIONS || [];
  return [];
}

function addCustomFunction(name) {
  const clean = (name || "").trim();
  if (!clean) return false;
  try {
    const list = loadCustomFunctions();
    // Avoid duplicates (case-insensitive) and clashes with built-ins.
    const lower = clean.toLowerCase();
    const builtinLower = canonicalFunctions().map(f => f.toLowerCase());
    if (builtinLower.includes(lower) || list.some(f => f.toLowerCase() === lower)) return false;
    list.push(clean);
    localStorage.setItem(CUSTOM_FUNCTIONS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn("addCustomFunction failed", e);
    return false;
  }
}

function removeCustomFunction(name) {
  try {
    const list = loadCustomFunctions().filter(f => f !== name);
    localStorage.setItem(CUSTOM_FUNCTIONS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn("removeCustomFunction failed", e);
    return false;
  }
}

// Full working list: canonical functions plus the user's custom ones.
function getAllFunctions() {
  return canonicalFunctions().concat(loadCustomFunctions());
}

// ---- WECHSLER COMPOSITE SCALES (échelles) --------------------------------
// Source of truth = the test bank: a test that evaluates IQ carries an
// "iq_scales" array (the sigles of its principal composite scales, e.g.
// ["ICV","IRP","IMT","IVT","QIT"]). This keeps every version congruent and
// lets the clinician fix names in the bank editor. A name-pattern fallback
// covers tests not yet tagged in the bank.
const WECHSLER_SCALE_PRESETS = [
  { match: /\bWPPSI\b/i,            scales: ["ICV", "IVS", "IRF", "IMT", "IVT", "EGQI"] },
  { match: /\bWISC[\s-]*(V|5)\b/i,  scales: ["ICV", "IVS", "IRF", "IMT", "IVT", "EGQI"] },
  { match: /\bWISC\b/i,            scales: ["ICV", "IRP", "IMT", "IVT", "QIT"] },
  { match: /\bWAIS\b/i,            scales: ["ICV", "IRP", "IMT", "IVT", "QIT"] },
  { match: /\bWASI\b/i,            scales: ["ICV", "IRP", "QIT"] }
];

function wechslerScalesFor(testName) {
  if (!testName) return null;
  for (const p of WECHSLER_SCALE_PRESETS) {
    if (p.match.test(testName)) return p.scales.slice();
  }
  return null;
}

// Resolve the principal scale sigles for a test: bank metadata wins, else the
// name-pattern fallback. Returns an array, or null if the test has no scales.
function iqScalesForTest(testName, bank) {
  const t = bank && bank[testName];
  if (t && Array.isArray(t.iq_scales)) {
    // Present in the bank: non-empty = these scales; empty = explicitly NOT an
    // IQ battery (e.g. supplementary-subtest variants), so don't fall back.
    return t.iq_scales.length ? t.iq_scales.slice() : null;
  }
  return wechslerScalesFor(testName);
}

function isIqBattery(testName, bank) {
  return !!iqScalesForTest(testName, bank);
}

// Editable scale rows used to seed project.iqScales[testName].
function defaultScaleRows(testName, bank) {
  const sigles = iqScalesForTest(testName, bank);
  if (!sigles) return null;
  return sigles.map((s) => ({ name: s, value: "", scale: "Standard score" }));
}

// Flatten the ACTIVE battery's échelles into chartable points. Only one battery
// feeds the échelles view at a time (project.activeScaleTest), so multiple
// Wechsler tests never produce competing values. Empty rows are dropped.
function flattenScales(project) {
  const t = project && project.activeScaleTest;
  const rows = (t && project.iqScales && project.iqScales[t]) || [];
  const out = [];
  rows.forEach((r) => {
    const v = r && r.value;
    if (v === "" || v === null || v === undefined || isNaN(Number(v))) return;
    out.push({ test: t, name: r.name, value: Number(v), scale: r.scale || "Standard score" });
  });
  return out;
}

function hasAnyScale(project) {
  return flattenScales(project).length > 0;
}

const VizeaDataModel = {
  STANDALONE_KEY,
  uid,
  createEmptyProject,
  getDefaultChartSettings,
  createEmptyCondition,
  syncScoresWithSelectedTests,
  flattenScores,
  exportProjectToJSON,
  importProjectFromJSON,
  extractTemplateFromProject,
  applyTemplateToProject,
  loadAllLocalTemplates,
  saveLocalTemplate,
  deleteLocalTemplate,
  loadCustomFunctions,
  addCustomFunction,
  removeCustomFunction,
  getAllFunctions,
  wechslerScalesFor,
  iqScalesForTest,
  isIqBattery,
  defaultScaleRows,
  flattenScales,
  hasAnyScale
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = VizeaDataModel;
} else {
  window.VizeaDataModel = VizeaDataModel;
}
