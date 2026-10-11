/* ============================================================
   Vizéa — app.js
   Orchestrates the UI. Depends on constants.js, scoring.js,
   datamodel.js, chart.js (all loaded before this file).

   Clinical data policy enforced here:
   - currentProject (with scores) lives ONLY in this in-memory variable.
   - Nothing writes scores to localStorage or any network call.
   - Only TEMPLATES (no scores) touch localStorage. Suggestions are POSTed to
     a Google Apps Script endpoint that appends them to a Google Sheet — they
     contain no patient data. No Supabase, no backend.
   ============================================================ */

(function () {
  "use strict";

  const DM = window.VizeaDataModel;
  const CHART = window.VizeaChart;
  const { COGNITIVE_FUNCTIONS, SCORE_TYPE_OPTIONS, DEFAULT_FUNCTION_COLORS } = window.VizeaConstants;

  // ---- App state (memory only) --------------------------------------------
  let currentProject = null;
  let testsBank = {};
  let projectInitialized = false;
  let dirty = false; // unsaved-changes flag (scores entered)
  let openFnMenu = null; // the single currently-open function multiselect (O(1) outside-click close)

  let lossAccepted = false; // "continue without saving" was chosen; reset by the next edit
  function markDirty() { dirty = true; lossAccepted = false; }

  // Translation helper for dynamically-built strings. Falls back to the given
  // French text if i18n isn't available or the key is missing.
  function T(key, fallback) {
    return (window.VizeaI18n && window.VizeaI18n.t) ? window.VizeaI18n.t(key) : fallback;
  }
  // Translated label for a score-type value (the stored value stays unchanged).
  var SCORE_TYPE_KEYS = { "Scale score": "score.scaled", "Standard score": "score.standard", "Percentile": "score.percentile", "Z-Score": "score.z", "T-Score": "score.t" };
  function scoreTypeLabel(v) { return T(SCORE_TYPE_KEYS[v] || "", v); }
  // Display names for functions / bands in the current language (data unchanged).
  function funcDisplay(fn) { return (window.VizeaConstants && window.VizeaConstants.displayFunctionName) ? window.VizeaConstants.displayFunctionName(fn) : fn; }
  function bandFieldDisplay(key, field, fb) { return (window.VizeaConstants && window.VizeaConstants.displayBandField) ? window.VizeaConstants.displayBandField(key, field, fb) : fb; }
  // The two ready-made default titles are stored in their canonical (French)
  // form. The panel input shows a LOCALIZED VIEW of them, so the box matches the
  // translated title on the chart. Typing something else stores it verbatim.
  var DEFAULT_TITLE_FR = "Visualisation des scores par fonctions cognitives";
  var DEFAULT_SCALES_TITLE_FR = "Visualisation des échelles globales";
  var DEFAULT_TITLE_KEYS = {
    "Visualisation des scores par fonctions cognitives": "chart.defaultTitle",
    "Visualisation des échelles globales": "chart.defaultScalesTitle"
  };
  function localizedTitleView(raw) {
    if (raw && DEFAULT_TITLE_KEYS[raw] && window.VizeaI18n && window.VizeaI18n.getLang() === "en" && window.VizeaI18n.t) {
      return window.VizeaI18n.t(DEFAULT_TITLE_KEYS[raw]);
    }
    return raw;
  }

  // Shared score validation, used for both test scores and IQ scales so the
  // feedback is congruent everywhere. Two levels:
  //   • error  → value is impossible for that score type (blocks/red)
  //   • warn   → value is unusual but possible (amber, "vérifiez la saisie")
  const SCORE_RULES = {
    "Percentile":     { hard: { min: 0,  max: 100 }, step: 0.1 },
    "Scale score":    { hard: { min: 1,  max: 19  }, step: 1 },
    "Standard score": { warn: { min: 40, max: 160 }, hard: { min: 1, max: 200 }, step: 1 },
    "Z-Score":        { warn: { min: -4, max: 4   }, hard: { min: -6, max: 6 }, step: 0.01 },
    "T-Score":        { warn: { min: 10, max: 90  }, hard: { min: 0, max: 100 }, step: 1 }
  };

  function validateScore(value, type) {
    if (value === "" || value === null || value === undefined) return { level: "ok" };
    const v = Number(value);
    if (isNaN(v)) return { level: "ok" };
    const r = SCORE_RULES[type] || SCORE_RULES["Scale score"];
    const tl = scoreTypeLabel(type || "score").toLowerCase();
    if (r.hard && (v < r.hard.min || v > r.hard.max)) {
      return { level: "error", message: T("scores.errImpossible", "Valeur impossible pour un {type} (doit être entre {min} et {max}).").replace("{type}", tl).replace("{min}", r.hard.min).replace("{max}", r.hard.max) };
    }
    if (r.warn && (v < r.warn.min || v > r.warn.max)) {
      return { level: "warn", message: T("scores.warnUnusual", "Valeur inhabituelle pour un {type} (plage attendue : {min} à {max}). Vérifiez la saisie.").replace("{type}", tl).replace("{min}", r.warn.min).replace("{max}", r.warn.max) };
    }
    return { level: "ok" };
  }

  // Create a congruent inline warning element (triangle icon + message).
  function makeScoreWarnEl() {
    const el = document.createElement("div");
    el.className = "cond-warn";
    el.style.display = "none";
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l9 16H3L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span></span>';
    return el;
  }

  // Apply a validation result to an input + its warning element.
  function applyScoreValidation(inputEl, warnEl, type) {
    const res = validateScore(inputEl.value, type);
    inputEl.classList.toggle("invalid", res.level === "error");
    inputEl.classList.toggle("warned", res.level === "warn");
    warnEl.classList.toggle("is-error", res.level === "error");
    if (res.level === "ok") { warnEl.style.display = "none"; }
    else {
      const span = warnEl.querySelector("span") || warnEl;
      span.textContent = res.message;
      warnEl.style.display = "flex";
    }
    return res;
  }

  // Project-scoped cognitive functions: canonical list + this project's custom
  // additions. Not shared across projects (carried only via templates).
  function allFunctions() {
    const custom = (currentProject && Array.isArray(currentProject.customFunctions)) ? currentProject.customFunctions : [];
    return COGNITIVE_FUNCTIONS.concat(custom);
  }

  // Add a custom function to the current project. Returns "added" | "exists" | "empty".
  function addProjectFunction(name) {
    const clean = (name || "").trim();
    if (!clean || !currentProject) return "empty";
    if (!Array.isArray(currentProject.customFunctions)) currentProject.customFunctions = [];
    const lower = clean.toLowerCase();
    const exists = COGNITIVE_FUNCTIONS.some(f => f.toLowerCase() === lower) ||
      currentProject.customFunctions.some(f => f.toLowerCase() === lower);
    if (exists) return "exists";
    currentProject.customFunctions.push(clean);
    return "added";
  }

  // ---- DOM helpers ---------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function toast(msg, ms = 2600) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), ms);
  }

  document.addEventListener("DOMContentLoaded", init);

  let _initialized = false;
  function init() {
    if (_initialized) return;   // guard against any double invocation
    _initialized = true;
    setupNavigation();
    setupStepNavigation();
    setupStep0();
    loadTestsBank();
    setupStep1Handlers();
    setupStep2Handlers();
    setupStep3Panel();
    setupSuggestForm();
    setupDonate();
    setupUnloadWarning();
    setupScrollReveal();
    setupNeuralCanvas();
    setupThemeToggle();
    setupDemo();
    setupChartDirectEdit();
    setupNews();
    setupFileOpen();
    // Close the open function menu on an outside click. O(1): we only touch the
    // single open menu, instead of scanning every row's menu on every click
    // (which got slow with many scores).
    document.addEventListener("click", (e) => {
      if (openFnMenu && (!e.target.closest || !e.target.closest(".multi-select-container"))) {
        openFnMenu.style.display = "none";
        openFnMenu = null;
      }
    });
    refreshTemplateSelect();

    // When the language changes, refresh the dynamically-built pieces that carry
    // translated text (the static [data-i18n] nodes are handled by i18n itself).
    // Each refresh is isolated so a failure in one (e.g. before a project
    // exists) can't stop the others from updating.
    document.addEventListener("vizea:langchange", () => {
      const safe = (fn) => { try { fn(); } catch (e) { /* noop */ } };
      safe(() => refreshTemplateSelect());
      safe(() => { if (typeof renderSuggestFunctions === "function" && $("functions")) renderSuggestFunctions(); });
      safe(() => { if (typeof syncViewSwitch === "function") syncViewSwitch(); });
      safe(() => { if (typeof renderSelectedTests === "function" && currentProject) renderSelectedTests(); });
      safe(() => { if (typeof renderTestList === "function" && $("testSearch")) renderTestList($("testSearch").value); });
      safe(() => { if (typeof renderStep2 === "function" && currentProject && $("scoreEntryContainer") && $("scoreEntryContainer").children.length) renderStep2(); });
      safe(() => { if (typeof buildPanelDynamicControls === "function" && currentProject && $("opt-functions")) buildPanelDynamicControls(); });
      safe(() => { if (typeof buildBandLabelList === "function" && currentProject && $("bandLabelList")) buildBandLabelList(); });
      safe(() => { if (currentStep === 3 && currentProject && typeof renderChart === "function") renderChart(); });
      safe(() => { if (typeof updateAxisLimitsHint === "function" && currentProject) updateAxisLimitsHint(); });
      safe(() => { if (typeof setupNews === "function" && $("newsTimeline")) setupNews(); });
      safe(() => { if (typeof reloadPayPalForLang === "function") reloadPayPalForLang(); });
      safe(() => {
        const ti = $("opt-title");
        if (ti && currentProject) {
          const cs = currentProject.chartSettings;
          ti.value = localizedTitleView(cs.chartType === "scales" ? (cs.scalesTitle || "") : (cs.title || ""));
        }
      });
    });
  }

  // Light/dark theme: persists choice and re-renders the chart so its colours
  // adapt. The initial theme is applied by an inline script in <head>.
  function setupThemeToggle() {
    const btn = $("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        try { localStorage.setItem("vizea_theme", "light"); } catch (e) {}
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        try { localStorage.setItem("vizea_theme", "dark"); } catch (e) {}
      }
      // Re-render the chart (Plotly colours are theme-dependent) and re-fit the
      // neural background.
      if (currentProject && currentStep === 3) renderChart();
      if (window.__vizeaResizeNeural) window.__vizeaResizeNeural();
    });
  }

  // Reveal elements with .reveal as they scroll into view.
  function setupScrollReveal() {
    const els = $$(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  // =========================================================================
  // NEURAL NETWORK CANVAS — living background for the hero.
  // Floating neurons connect when near; synaptic pulses travel along the
  // connections and briefly light up the nodes they reach. Subtle mouse
  // attraction makes it feel alive. Pauses when off-screen; respects
  // prefers-reduced-motion (renders a calm static field instead).
  // =========================================================================
  function setupNeuralCanvas() {
    const canvas = $("neuralCanvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Dimmer than the hero-only version since it now sits behind text across
    // the whole site and must never hurt readability.
    const CYAN = "37,208,224";
    const BLUE = "43,138,239";
    const LINK_ALPHA = 0.18;   // max link opacity
    const NODE_ALPHA = 0.5;    // base node opacity
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let nodes = [], pulses = [], raf = null, running = false;
    const mouse = { x: -9999, y: -9999 };
    const LINK_DIST = 142;       // px distance under which two nodes connect
    const LINK_DIST2 = LINK_DIST * LINK_DIST;

    function docHeight() {
      const b = document.body, e = document.documentElement;
      return Math.max(b.scrollHeight, b.offsetHeight, e.clientHeight, e.scrollHeight, e.offsetHeight);
    }

    function resize() {
      // Span the full scrollable document so neurons exist behind every page.
      W = window.innerWidth;
      H = docHeight();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!nodes.length) buildNodes();
      // Existing nodes keep their positions (anchored) — no rescale, no
      // regeneration — so the field never jumps when the page reflows. The
      // canvas element is sized via CSS (height:100% of the document) so it
      // never pins the scroll height.
    }

    function buildNodes() {
      // Density scales with area, capped for performance.
      const count = Math.max(14, Math.min(46, Math.round((W * H) / 17000)));
      nodes = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: 1.6 + Math.random() * 2.2,
          glow: 0 // 0..1, lit briefly when a pulse arrives
        });
      }
      pulses = [];
    }

    // Spawn a pulse that travels from node a to a connected node b.
    function spawnPulse() {
      if (nodes.length < 2) return;
      const a = (Math.random() * nodes.length) | 0;
      // pick a nearby node as the target
      const candidates = [];
      for (let j = 0; j < nodes.length; j++) {
        if (j === a) continue;
        const dx = nodes[a].x - nodes[j].x, dy = nodes[a].y - nodes[j].y;
        if (dx * dx + dy * dy < LINK_DIST2) candidates.push(j);
      }
      if (!candidates.length) return;
      const b = candidates[(Math.random() * candidates.length) | 0];
      pulses.push({ a, b, t: Math.random() * 0.15 });
      nodes[a].glow = 1;
    }

    let lastSpawn = 0;
    function frame(now) {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);

      // update + draw links
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx; n.y += n.vy;
        // gentle mouse attraction
        const mdx = mouse.x - n.x, mdy = mouse.y - n.y;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < 26000) { n.vx += mdx * 0.000016; n.vy += mdy * 0.000016; }
        // damping + speed clamp
        n.vx *= 0.995; n.vy *= 0.995;
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > 0.5) { n.vx *= 0.5 / sp; n.vy *= 0.5 / sp; }
        // wrap edges softly
        if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
        n.glow *= 0.94;
      }

      // links
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST2) {
            const a = (1 - d2 / LINK_DIST2) * LINK_ALPHA;
            ctx.strokeStyle = `rgba(${BLUE},${a})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // pulses travelling along connections
      for (let p = pulses.length - 1; p >= 0; p--) {
        const pu = pulses[p];
        const a = nodes[pu.a], b = nodes[pu.b];
        if (!a || !b) { pulses.splice(p, 1); continue; }
        pu.t += 0.018;
        if (pu.t >= 1) { b.glow = 1; pulses.splice(p, 1); continue; }
        const x = a.x + (b.x - a.x) * pu.t;
        const y = a.y + (b.y - a.y) * pu.t;
        // bright travelling dot with halo
        const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, `rgba(${CYAN},0.95)`);
        g.addColorStop(1, `rgba(${CYAN},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      }

      // nodes
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.glow > 0.05) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 10 + n.glow * 8);
          g.addColorStop(0, `rgba(${CYAN},${0.5 * n.glow})`);
          g.addColorStop(1, `rgba(${CYAN},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(n.x, n.y, 10 + n.glow * 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = n.glow > 0.05
          ? `rgba(${CYAN},${0.6 + 0.4 * n.glow})`
          : `rgba(${BLUE},${NODE_ALPHA})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }

      // occasionally fire a synaptic pulse
      if (now - lastSpawn > 520 && pulses.length < 6) {
        if (Math.random() < 0.8) spawnPulse();
        lastSpawn = now;
      }

      raf = requestAnimationFrame(frame);
    }

    function drawStatic() {
      // calm one-shot render for reduced-motion users
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST2) {
            ctx.strokeStyle = `rgba(${BLUE},${(1 - d2 / LINK_DIST2) * LINK_ALPHA})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        ctx.fillStyle = `rgba(${BLUE},${NODE_ALPHA})`;
        ctx.beginPath(); ctx.arc(nodes[i].x, nodes[i].y, nodes[i].r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function start() { if (running) return; running = true; lastSpawn = performance.now(); raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

    // The canvas spans the whole document, so page coords = client + scroll.
    window.addEventListener("mousemove", (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY + window.scrollY;
    }, { passive: true });
    window.addEventListener("mouseout", () => { mouse.x = -9999; mouse.y = -9999; });

    // Re-measure when the viewport or document height changes. Different pages
    // (and Steps 2/3) have very different heights, so we re-fit the canvas.
    let rzT = null;
    function scheduleResize() {
      clearTimeout(rzT);
      rzT = setTimeout(() => { resize(); if (reduced) drawStatic(); }, 140);
    }
    window.addEventListener("resize", scheduleResize);
    // Expose so navigation can trigger a re-fit after the page changes height.
    window.__vizeaResizeNeural = scheduleResize;

    resize();
    if (reduced) { drawStatic(); return; }

    // The animation is a decorative background for the HOME page only. Running it
    // on other pages is wasteful and, on the (very tall) scores page, causes
    // serious scroll/typing lag — the full-document canvas is redrawn every frame
    // with O(nodes²) link math. So it runs only when the home page is showing and
    // the tab is visible; it's paused everywhere else.
    let onHomePage = true;
    function updateRunning() {
      if (reduced) return;
      if (onHomePage && !document.hidden) start(); else stop();
    }
    // Navigation calls this to pause/resume as the user moves between pages.
    // We also hide the canvas off-home: it spans the whole (tall) document, so
    // even a static one is needless compositing work while scrolling scores.
    window.__vizeaNeuralSetActive = function (on) {
      onHomePage = !!on;
      canvas.style.display = on ? "" : "none";
      updateRunning();
    };
    updateRunning();
    document.addEventListener("visibilitychange", updateRunning);
  }

  // =========================================================================
  // NAVIGATION
  // =========================================================================
  // True when there's an active project carrying entered (unsaved) scores.
  function hasUnsavedScores() {
    if (!projectInitialized || !currentProject) return false;
    const scores = currentProject.scores || {};
    return Object.values(scores).some(subs =>
      Object.values(subs).some(conds =>
        Array.isArray(conds) && conds.some(c => c.value !== "" && c.value != null)
      )
    );
  }

  // Show the leave-guard modal. Resolves to "export" | "discard" | "cancel".
  function askLeaveGuard() {
    return new Promise((resolve) => {
      const modal = $("leaveModal");
      if (!modal) { resolve("discard"); return; }
      modal.hidden = false;
      const cleanup = (choice) => {
        modal.hidden = true;
        $("leaveExport").onclick = null;
        $("leaveDiscard").onclick = null;
        $("leaveCancel").onclick = null;
        resolve(choice);
      };
      $("leaveExport").onclick = () => cleanup("export");
      $("leaveDiscard").onclick = () => cleanup("discard");
      $("leaveCancel").onclick = () => cleanup("cancel");
    });
  }

  // Run `proceed` after clearing the guard. If the project has unsaved scores,
  // confirm first and optionally export. Otherwise proceed immediately.
  async function guardedLeave(proceed) {
    if (!hasUnsavedScores()) { proceed(); return; }
    const choice = await askLeaveGuard();
    if (choice === "cancel") return;
    if (choice === "export") {
      const saved = await exportCurrentProject();
      if (!saved) return; // save cancelled → stay on the project
    }
    // Leaving discards the in-memory project's scores by design.
    if (choice === "discard") lossAccepted = true;
    proceed();
  }

  function setupNavigation() {
    const nav = $("topnav");
    const navToggle = $("navToggle");
    navToggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Delegated: also works for links inside translated (re-rendered) text.
    document.addEventListener("click", (e) => {
      const el = e.target && e.target.closest ? e.target.closest("[data-target]") : null;
      if (!el || el.closest(".mock")) return;
      const target = el.dataset.target;
      if (!target || !$(target)) return;
      if (el.tagName === "A") e.preventDefault();
      goToPage(target);
      nav?.classList.remove("open");
      navToggle?.setAttribute("aria-expanded", "false");
    });

    const logo = $("homeLogo");
    logo?.addEventListener("click", () => goToPage("page-home"));
    logo?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToPage("page-home"); }
    });
  }

  function goToPage(target) {
    // Only top-level routed views carry the .page class, so step-content
    // sections inside the visualization page are never touched here.
    $$(".page").forEach((s) => s.classList.remove("active"));
    $(target)?.classList.add("active");

    const nav = $("topnav");
    if (nav) {
      nav.querySelectorAll("a").forEach((a) => a.classList.remove("active"));
      nav.querySelector(`[data-target="${target}"]`)?.classList.add("active");
    }

    // Entering the visualization flow: reset to step 0 only if no project yet
    if (target === "page-new") {
      if (!projectInitialized) showStep(0);
      else showStep(currentStep);
    }
    // Lazy-init PayPal the first time the donate page is opened, so a blocked
    // or slow PayPal SDK can never affect the rest of the app.
    if (target === "page-donate") initPayPalLazy();

    // The animated background belongs to the home page only. Pause + hide it
    // elsewhere (it's a big full-document canvas — a major scroll-lag source on
    // the long scores page), and only re-fit it when it's actually showing.
    const isHome = target === "page-home";
    if (window.__vizeaNeuralSetActive) window.__vizeaNeuralSetActive(isHome);
    if (isHome && window.__vizeaResizeNeural) setTimeout(window.__vizeaResizeNeural, 60);

    window.scrollTo(0, 0);
  }

  // =========================================================================
  // STEP NAVIGATION
  // =========================================================================
  let currentStep = 0;

  function setupStepNavigation() {
    $$(".btn-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = parseInt(btn.dataset.step, 10);
        if (!projectInitialized && step > 0) return;
        if (step >= 2 && Object.keys(currentProject?.selectedTests || {}).length === 0) {
          toast(T("msg.selectTestFirst", "Sélectionnez au moins un test d'abord."));
          return;
        }
        // Going back to the Projet step (step 0) from a working step is where
        // the user might start a new project and lose unsaved scores — warn here.
        if (step === 0 && currentStep >= 1) {
          guardedLeave(() => showStep(0));
        } else {
          showStep(step);
        }
      });
    });
  }

  function showStep(stepIndex) {
    $$(".step-content").forEach((s) => s.classList.remove("active"));
    $$(".btn-step").forEach((b) => b.classList.remove("active"));
    $(`step-${stepIndex}-content`)?.classList.add("active");
    const activeStepBtn = document.querySelector(`.btn-step[data-step="${stepIndex}"]`);
    if (activeStepBtn) {
      activeStepBtn.classList.add("active");
      // Re-trigger a short pulse so the step change is visually obvious (helps
      // during the guided demo, and everyday navigation between steps).
      activeStepBtn.classList.remove("step-pulse");
      void activeStepBtn.offsetWidth; // force reflow to restart the animation
      activeStepBtn.classList.add("step-pulse");
    }

    const stepnav = $("stepnav");
    if (stepnav) stepnav.style.display = stepIndex === 0 ? "none" : "block";

    if (stepIndex === 1) {
      // Re-render so the checkboxes reflect the current selection — e.g. after a
      // test was removed via the "×" on the scores step.
      renderTestList($("testSearch") ? $("testSearch").value : "");
      renderSelectedTests();
    }
    if (stepIndex === 2) {
      DM.syncScoresWithSelectedTests(currentProject, testsBank);
      resolveActiveScaleTest();
      renderStep2();
    }
    if (stepIndex === 3) {
      DM.syncScoresWithSelectedTests(currentProject, testsBank);
      buildPanelDynamicControls();
      ensureViewSwitcher();
      resolveActiveScaleTest();
      updateScalesViewAvailability();
      syncViewSwitch();
      applyEgqiCompare();
      animateNext = true;
      renderChart();
    }
    currentStep = stepIndex;
    if (window.__vizeaResizeNeural) setTimeout(window.__vizeaResizeNeural, 60);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function enableStepNav() {
    $$(".btn-step").forEach((b) => (b.disabled = false));
  }

  // =========================================================================
  // STEP 0 — project / template / import
  // =========================================================================
  function setupStep0() {
    const confirmCb = $("confirmNoPI");
    const createBtn = $("createProjectBtn");
    const titleInput = $("projectTitle");

    confirmCb?.addEventListener("change", () => {
      createBtn.disabled = !confirmCb.checked || !titleInput.value.trim();
    });
    titleInput?.addEventListener("input", () => {
      createBtn.disabled = !confirmCb.checked || !titleInput.value.trim();
    });

    createBtn?.addEventListener("click", () => {
      const title = titleInput.value.trim();
      if (!title) { toast(T("msg.nameProject", "Donnez un nom au projet.")); return; }
      if (!okToReplace()) return;

      const tmplId = $("templateSelect") ? $("templateSelect").value : "";
      if (tmplId) {
        const templates = DM.loadAllLocalTemplates();
        const tmpl = templates[tmplId];
        if (!tmpl) { toast(T("msg.templateNotFound", "Modèle introuvable.")); return; }
        const proj = DM.createEmptyProject(title);
        DM.applyTemplateToProject(proj, tmpl);
        DM.syncScoresWithSelectedTests(proj, testsBank);
        startProject(proj);
        toast(T("msg.projectFromTemplate", "Projet « {title} » créé à partir du modèle « {tmpl} ».").replace("{title}", title).replace("{tmpl}", tmpl.name));
      } else {
        startProject(DM.createEmptyProject(title));
        toast(T("msg.projectCreated", "Projet « {title} » créé.").replace("{title}", title));
      }
    });

    // Template controls (delete only — selection feeds into "Créer le projet")
    const tmplSelect = $("templateSelect");
    const delBtn = $("deleteTemplateBtn");
    tmplSelect?.addEventListener("change", () => {
      delBtn.disabled = !tmplSelect.value;
    });
    delBtn?.addEventListener("click", () => {
      const id = tmplSelect.value;
      if (!id) return;
      if (!confirm(T("dialog.deleteTemplate", "Supprimer ce modèle ? Cette action est définitive."))) return;
      DM.deleteLocalTemplate(id);
      refreshTemplateSelect();
      toast(T("msg.templateDeleted", "Modèle supprimé."));
    });

    // Import project (.vizea or legacy .json)
    const importBtn = $("importProjectBtn");
    const importInput = $("importProjectInput");
    importBtn?.addEventListener("click", () => importInput.click());
    importInput?.addEventListener("change", (e) => {
      loadProjectFromFile(e.target.files[0]);
      importInput.value = "";
    });
  }

  // Load a project from raw JSON text (shared by: Import button, drag & drop,
  // and opening a .vizea file when installed as an app).
  function loadProjectFromText(text) {
    try {
      const proj = DM.importProjectFromJSON(text);
      if (!okToReplace()) return false;
      DM.syncScoresWithSelectedTests(proj, testsBank);
      startProject(proj);
      toast(T("msg.projectImported", "Projet « {title} » importé.").replace("{title}", proj.title));
      showStep(1);
      return true;
    } catch (err) {
      toast(T("msg.invalidFile", "Fichier invalide : ") + (err && err.message ? err.message : err));
      return false;
    }
  }
  function loadProjectFromFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast(T("msg.invalidFile", "Fichier invalide : ") + file.name); return; }
    const reader = new FileReader();
    reader.onload = () => loadProjectFromText(reader.result);
    reader.readAsText(file);
  }

  // Open .vizea files two ways: double-click (installed app, via the File
  // Handling API) and drag & drop (works in every browser).
  function setupFileOpen() {
    if ("launchQueue" in window && "LaunchParams" in window && window.LaunchParams &&
        "files" in window.LaunchParams.prototype) {
      window.launchQueue.setConsumer((launchParams) => {
        if (!launchParams || !launchParams.files || !launchParams.files.length) return;
        launchParams.files.forEach((handle) => {
          Promise.resolve(handle.getFile())
            .then((file) => file.text())
            .then((text) => loadProjectFromText(text))
            .catch(() => {});
        });
      });
    }

    const hasFiles = (e) => e.dataTransfer &&
      Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1;
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;                 // ignore internal drags (row reorder)
      e.preventDefault();
      document.body.classList.add("dragging-file");
    });
    window.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) document.body.classList.remove("dragging-file");
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      document.body.classList.remove("dragging-file");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && /\.(vizea|json)$/i.test(file.name)) loadProjectFromFile(file);
      else if (file) toast(T("msg.dropVizea", "Déposez un fichier de projet .vizea."));
    });
  }

  // Never drop unexported work silently (new project, opened file, dropped file).
  function okToReplace() {
    const pending = (projectInitialized && dirty && !lossAccepted && currentProject && !currentProject._demo) || (demoStash && demoStash.dirty);
    return !pending || confirm(T("dialog.replaceProject", "Le projet en cours contient des changements qui n'ont pas été exportés. Le remplacer quand même ?"));
  }
  function startProject(project) {
    focusFn = null;
    if (!project._demo && typeof demoReturnShow === "function") demoReturnShow(null);
    currentProject = project;
    projectInitialized = true;
    dirty = false;
    selectedTests = currentProject.selectedTests; // alias for step 1 code
    enableStepNav();
    $("stepnav").style.display = "block";
    // Reset the step-1 search + list so stale checkboxes from a previous
    // project never linger (the list is rebuilt from this project's selection).
    if ($("testSearch")) $("testSearch").value = "";
    renderTestList("");
    renderSelectedTests();
    showStep(1);
  }

  function refreshTemplateSelect() {
    const sel = $("templateSelect");
    if (!sel) return;
    const templates = DM.loadAllLocalTemplates();
    const ids = Object.keys(templates);
    const T = (k, fb) => (window.VizeaI18n ? window.VizeaI18n.t(k) : fb);
    sel.innerHTML = ids.length
      ? '<option value="">' + T("wiz.new.blankWithTemplates", "Aucun modèle — projet vierge") + '</option>'
      : '<option value="">' + T("wiz.new.blankNoTemplates", "Aucun modèle enregistré — projet vierge") + '</option>';
    ids.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = templates[id].name || T("common.template", "Modèle");
      sel.appendChild(opt);
    });
    if ($("deleteTemplateBtn")) $("deleteTemplateBtn").disabled = true;
  }

  // =========================================================================
  // STEP 1 — test selection
  // =========================================================================
  let selectedTests = {}; // alias to currentProject.selectedTests once created

  async function loadTestsBank() {
    try {
      const res = await fetch("tests_bank.json");
      testsBank = await res.json();
    } catch (e) {
      console.warn("Could not load tests_bank.json", e);
      testsBank = {};
    }
  }

  function setupStep1Handlers() {
    // Debounce: rebuilding the full results list on every keystroke is wasteful
    // with a large bank; coalesce rapid typing into one render.
    let searchTimer = null;
    $("testSearch")?.addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderTestList(v), 90);
    });

    $("addManualTestBtn")?.addEventListener("click", () => {
      const input = $("manualTestInput");
      const name = input.value.trim();
      if (!name) return;
      if (!currentProject) { toast(T("msg.createFirst", "Créez d'abord un projet.")); return; }
      if (!selectedTests[name]) selectedTests[name] = [];
      input.value = "";
      renderTestList($("testSearch").value);
      renderSelectedTests();
    });

    $("nextStepBtn")?.addEventListener("click", () => {
      if (Object.keys(selectedTests).length === 0) {
        $("step1Warning").style.display = "block";
        return;
      }
      $("step1Warning").style.display = "none";
      showStep(2);
    });
  }

  function renderTestList(filter = "") {
    const div = $("testList");
    if (!div) return;
    div.innerHTML = "";
    if (!filter.trim()) { if (window.__vizeaResizeNeural) window.__vizeaResizeNeural(); return; }
    const f = filter.toLowerCase();

    // Order results so current editions appear before older ones, and newer
    // editions of a family come first (e.g. CVLT-III before CVLT-II before CVLT).
    // Driven by optional "superseded"/"recency" fields in the bank; tests without
    // them keep their natural order.
    const ordered = Object.entries(testsBank)
      .map(([n, d], i) => ({ n, d, i }))
      .sort((a, b) => {
        const sa = a.d.superseded ? 1 : 0, sb = b.d.superseded ? 1 : 0;
        if (sa !== sb) return sa - sb;                       // current before older
        const ra = a.d.recency || 0, rb = b.d.recency || 0;
        if (ra !== rb) return rb - ra;                       // newer first
        return a.i - b.i;                                    // otherwise stable
      });

    ordered.forEach(({ n: testName, d: testData }) => {
      const matchParent = testName.toLowerCase().includes(f);
      const subtestNames = testData.subtests ? Object.keys(testData.subtests) : [];
      const matchSub = subtestNames.some((s) => s.toLowerCase().includes(f));
      if (!matchParent && !matchSub) return;

      const isBattery = testData.type === "batterie" && subtestNames.length > 0;

      const testDiv = document.createElement("div");
      testDiv.className = "test";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.name = testName;
      if (isBattery) {
        checkbox.checked = !!selectedTests[testName] &&
          selectedTests[testName].length === subtestNames.length;
      } else {
        checkbox.checked = !!selectedTests[testName];
      }
      checkbox.addEventListener("change", () => handleTestCheck(testName, testData, checkbox.checked));

      const label = document.createElement("label");
      label.textContent = testName;
      if (testData.superseded) {
        const tag = document.createElement("span");
        tag.className = "test-legacy";
        tag.textContent = T("tests.legacy", "version antérieure");
        label.appendChild(tag);
      }
      label.prepend(checkbox);
      testDiv.appendChild(label);

      if (isBattery) {
        const subDiv = document.createElement("div");
        subDiv.className = "subtests";
        subtestNames.forEach((subName) => {
          const row = document.createElement("div");
          const sc = document.createElement("input");
          sc.type = "checkbox";
          sc.checked = selectedTests[testName]?.includes(subName) || false;
          sc.addEventListener("change", () => handleSubtestCheck(testName, subName, sc.checked));
          const sl = document.createElement("label");
          sl.textContent = subName;
          sl.prepend(sc);
          row.appendChild(sl);
          subDiv.appendChild(row);
        });
        testDiv.appendChild(subDiv);
      }
      div.appendChild(testDiv);
    });
    if (window.__vizeaResizeNeural) window.__vizeaResizeNeural();
  }

  function handleTestCheck(testName, testData, checked) {
    const subtestNames = testData.subtests ? Object.keys(testData.subtests) : [];
    const isBattery = testData.type === "batterie" && subtestNames.length > 0;
    if (isBattery) {
      if (checked) selectedTests[testName] = [...subtestNames];
      else delete selectedTests[testName];
    } else {
      if (checked) selectedTests[testName] = [];
      else delete selectedTests[testName];
    }
    renderTestList($("testSearch").value);
    renderSelectedTests();
  }

  function handleSubtestCheck(testName, subName, checked) {
    if (!selectedTests[testName]) selectedTests[testName] = [];
    if (checked) {
      if (!selectedTests[testName].includes(subName)) selectedTests[testName].push(subName);
    } else {
      selectedTests[testName] = selectedTests[testName].filter((s) => s !== subName);
      if (selectedTests[testName].length === 0) delete selectedTests[testName];
    }
    renderTestList($("testSearch").value);
    renderSelectedTests();
  }

  function renderSelectedTests() {
    const div = $("selectedTestsList");
    if (!div) return;
    const entries = Object.entries(selectedTests);
    if (entries.length === 0) {
      div.innerHTML = '<p class="muted empty-hint">' + T("wiz.tests.emptyHint", "Aucun test sélectionné pour l'instant.") + '</p>';
      return;
    }
    div.innerHTML = "";
    // Reorders a test (and its scores) by moving its key up/down, so the new
    // order flows to the chart and the table. Arrows avoid long drag gestures.
    const testKeys = Object.keys(selectedTests);
    const moveTest = (test, dir) => {
      const reorder = (obj) => {
        const keys = Object.keys(obj); const i = keys.indexOf(test); const j = i + dir;
        if (i < 0 || j < 0 || j >= keys.length) return false;
        keys.splice(j, 0, keys.splice(i, 1)[0]);
        const copy = {}; keys.forEach((k) => copy[k] = obj[k]);
        Object.keys(obj).forEach((k) => delete obj[k]); keys.forEach((k) => obj[k] = copy[k]);
        return true;
      };
      if (!reorder(selectedTests)) return;
      if (currentProject && currentProject.scores) reorder(currentProject.scores);
      markDirty();
      renderSelectedTests();
      if (currentStep === 2 && typeof renderStep2 === "function") renderStep2();
    };
    entries.forEach(([test, subtests], idx) => {
      const parent = document.createElement("div");
      parent.className = "selected-test";
      const label = document.createElement("span");
      label.className = "selected-test-name"; label.textContent = test;
      parent.appendChild(label);

      // Up / down reorder arrows (disabled at the ends).
      const moveBox = document.createElement("span");
      moveBox.className = "test-move";
      const up = document.createElement("button");
      up.type = "button"; up.className = "test-move-btn"; up.innerHTML = "▲";
      up.title = T("tests.moveUp", "Monter"); up.setAttribute("aria-label", up.title);
      up.disabled = idx === 0;
      up.addEventListener("click", () => moveTest(test, -1));
      const down = document.createElement("button");
      down.type = "button"; down.className = "test-move-btn"; down.innerHTML = "▼";
      down.title = T("tests.moveDown", "Descendre"); down.setAttribute("aria-label", down.title);
      down.disabled = idx === testKeys.length - 1;
      down.addEventListener("click", () => moveTest(test, 1));
      moveBox.append(up, down);
      parent.appendChild(moveBox);

      const rm = document.createElement("button");
      rm.textContent = "×";
      rm.className = "remove-test-btn";
      rm.title = T("common.remove", "Retirer");
      rm.addEventListener("click", () => {
        delete selectedTests[test];
        renderTestList($("testSearch").value);
        renderSelectedTests();
      });
      parent.appendChild(rm);
      div.appendChild(parent);

      subtests.forEach((sub) => {
        const subDiv = document.createElement("div");
        subDiv.className = "selected-test selected-subtest";
        subDiv.textContent = sub;
        const srm = document.createElement("button");
        srm.textContent = "×";
        srm.className = "remove-test-btn";
        srm.addEventListener("click", () => {
          selectedTests[test] = selectedTests[test].filter((s) => s !== sub);
          if (selectedTests[test].length === 0) delete selectedTests[test];
          renderTestList($("testSearch").value);
          renderSelectedTests();
        });
        subDiv.appendChild(srm);
        div.appendChild(subDiv);
      });
    });
  }

  // =========================================================================
  // STEP 2 — score entry
  // =========================================================================
  function setupStep2Handlers() {
    $("backToStep1Btn")?.addEventListener("click", () => showStep(1));
    $("goToStep3Btn")?.addEventListener("click", () => showStep(3));
  }

  function renderStep2() {
    const container = $("scoreEntryContainer");
    if (!container) return;
    container.innerHTML = "";
    const frag = document.createDocumentFragment();
    const scores = currentProject.scores || {};
    if (!currentProject.iqScales) currentProject.iqScales = {};

    Object.entries(scores).forEach(([testName, subtestsMap]) => {
      const card = document.createElement("div");
      card.className = "card test-card";

      // Collapsible header (arrow hides the whole card body — handy for long lists)
      const head = document.createElement("div");
      head.className = "test-card-head";
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "test-collapse";
      arrow.setAttribute("aria-expanded", "true");
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const h = document.createElement("h3");
      h.textContent = testName;
      const count = document.createElement("span");
      count.className = "test-card-count";
      const nScores = Object.values(subtestsMap).reduce((a, arr) => a + (arr ? arr.length : 0), 0);
      count.textContent = nScores + " " + (nScores > 1 ? T("scores.enteredMany", "saisis") : T("scores.enteredOne", "saisi"));
      head.appendChild(arrow);
      head.appendChild(h);
      head.appendChild(count);
      card.appendChild(head);

      const body = document.createElement("div");
      body.className = "test-card-body";

      const keys = Object.keys(subtestsMap);
      const isStandalone = keys.length === 1 && keys[0] === DM.STANDALONE_KEY;
      if (isStandalone) {
        body.appendChild(buildConditionList(subtestsMap[DM.STANDALONE_KEY], {
          label: testName,
          remove: () => removeScoreEntry(testName, DM.STANDALONE_KEY)
        }));
      } else {
        keys.forEach((subName) => {
          const sub = document.createElement("div");
          sub.className = "subtest-card";
          const st = document.createElement("div");
          st.className = "subtest-title";
          st.textContent = subName;
          sub.appendChild(st);
          sub.appendChild(buildConditionList(subtestsMap[subName], {
            label: subName,
            remove: () => removeScoreEntry(testName, subName)
          }));
          body.appendChild(sub);
        });
      }

      // Wechsler composite scales (échelles) — only for recognised Wechsler tests
      const scaleSection = buildScalesSection(testName);
      if (scaleSection) body.appendChild(scaleSection);

      card.appendChild(body);

      const toggle = () => {
        const collapsed = card.classList.toggle("collapsed");
        arrow.setAttribute("aria-expanded", String(!collapsed));
      };
      arrow.addEventListener("click", toggle);
      head.addEventListener("click", (e) => { if (e.target === arrow || arrow.contains(e.target)) return; toggle(); });

      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  // Build the "Échelles" entry block for an IQ battery, or null if not one.
  function buildScalesSection(testName) {
    const preset = DM.defaultScaleRows(testName, testsBank);
    if (!preset) return null;
    if (!currentProject.iqScales[testName]) currentProject.iqScales[testName] = preset;
    const rows = currentProject.iqScales[testName];

    const sec = document.createElement("div");
    sec.className = "scales-section";
    sec.innerHTML =
      '<div class="scales-head"><span class="scales-title">' + T("scales.title", "Échelles globales") + '</span>' +
      '<span class="scales-hint">' + T("scales.hint", "· score standard ou rang centile") + '</span></div>';

    // When several IQ batteries are selected, only ONE feeds the échelles chart.
    const iqTests = listIqTests();
    if (iqTests.length >= 2) {
      const activeWrap = document.createElement("label");
      activeWrap.className = "panel-toggle scale-active-toggle";
      const acb = document.createElement("input");
      acb.type = "checkbox";
      acb.checked = currentProject.activeScaleTest === testName;
      const span = document.createElement("span");
      span.textContent = T("scales.useForViz", "Utiliser ces valeurs pour la visualisation des échelles");
      activeWrap.append(acb, span);
      acb.addEventListener("change", () => {
        if (acb.checked) {
          const cur = currentProject.activeScaleTest;
          if (cur && cur !== testName && DM.isIqBattery(cur, testsBank)) {
            const ok = window.confirm(
              `Les échelles du « ${cur} » sont déjà sélectionnées pour la visualisation. ` +
              `Utiliser plutôt celles du « ${testName} » ?`);
            if (!ok) { acb.checked = false; return; }
          }
          currentProject.activeScaleTest = testName;
        } else if (currentProject.activeScaleTest === testName) {
          currentProject.activeScaleTest = null;
        }
        markDirty();
        renderStep2();
        updateScalesViewAvailability();
        if (currentStep === 3) { applyEgqiCompare(); renderChart(); }
      });
      sec.appendChild(activeWrap);
    }

    const listEl = document.createElement("div");
    listEl.className = "scales-list";
    sec.appendChild(listEl);

    function renderRows() {
      listEl.innerHTML = "";
      rows.forEach((r, idx) => {
        const row = document.createElement("div");
        row.className = "scale-row";

        const nameInput = document.createElement("input");
        nameInput.type = "text"; nameInput.className = "scale-name";
        nameInput.value = r.name || ""; nameInput.placeholder = T("scales.sigle", "Sigle");
        nameInput.addEventListener("input", () => { r.name = nameInput.value; markDirty(); });

        const valInput = document.createElement("input");
        valInput.type = "number"; valInput.className = "scale-value";
        valInput.value = r.value || ""; valInput.placeholder = "—";

        const scaleSel = document.createElement("select");
        scaleSel.className = "scale-type";
        [["Standard score", "score.standard"], ["Percentile", "score.percentile"]].forEach(([v, k]) => {
          const o = document.createElement("option"); o.value = v; o.textContent = T(k, v);
          if ((r.scale || "Standard score") === v) o.selected = true;
          scaleSel.appendChild(o);
        });

        const warn = makeScoreWarnEl();

        const applyConstraints = () => {
          const rule = SCORE_RULES[r.scale || "Standard score"];
          const b = rule.hard || rule.warn;
          valInput.min = b.min; valInput.max = b.max; valInput.step = rule.step || 1;
        };
        const validate = () => applyScoreValidation(valInput, warn, r.scale || "Standard score");
        applyConstraints();

        valInput.addEventListener("input", () => { r.value = valInput.value; markDirty(); validate(); updateScalesViewAvailability(); if (currentStep === 3) renderChart(); });
        valInput.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter") return;
          ev.preventDefault();
          const all = Array.from(document.querySelectorAll("#scoreEntryContainer .condition-value, #scoreEntryContainer .scale-value"))
            .filter((el) => !el.closest(".test-card.collapsed"));
          const i = all.indexOf(valInput);
          if (i > -1 && i + 1 < all.length) all[i + 1].focus();
          else valInput.blur();
        });
        scaleSel.addEventListener("change", () => { r.scale = scaleSel.value; markDirty(); applyConstraints(); validate(); if (currentStep === 3) renderChart(); });

        const del = document.createElement("button");
        del.type = "button"; del.className = "scale-del"; del.setAttribute("aria-label", "Retirer");
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        del.addEventListener("click", () => { rows.splice(idx, 1); markDirty(); renderRows(); updateScalesViewAvailability(); });

        // Both buttons share ONE grid cell, so the row keeps its column count.
        const acts = document.createElement("div");
        acts.className = "scale-actions";
        acts.append(makeCommentButton(r, { onClose: () => { if (currentStep === 3) renderChart(); } }), del);
        row.append(nameInput, valInput, scaleSel, acts, warn);
        validate();
        listEl.appendChild(row);
      });
    }
    renderRows();

    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "scales-add";
    addBtn.textContent = T("scales.add", "+ Ajouter une échelle");
    addBtn.addEventListener("click", () => {
      rows.push({ name: "", value: "", scale: "Standard score" });
      markDirty(); renderRows();
    });
    sec.appendChild(addBtn);
    return sec;
  }

  // Small confirmation dialog (reuses the modal styling). Resolves true/false.
  // ===== Score comments =====================================================
  // A comment is a free-text note attached to one condition (one score row). The
  // same lightweight editor is reused from the score-entry step, the chart, and
  // the table — so there is a single place that reads/writes cond.comment.
  function commentIsSet(cond) { return !!(cond && cond.comment && String(cond.comment).trim()); }

  // Find a live condition object anywhere in the project by its id (used by the
  // chart click handler, which only knows the id from the point's customdata).
  function findConditionById(id) {
    if (!currentProject || !id) return null;
    // Scale notes are keyed "scale:<name>" within the battery feeding the chart.
    if (String(id).indexOf("scale:") === 0) {
      const name = String(id).slice(6);
      const t = currentProject.activeScaleTest;
      const rows = (t && currentProject.iqScales && currentProject.iqScales[t]) || [];
      return rows.find((r) => (r.name || "") === name) || null;
    }
    const scores = currentProject.scores;
    if (!scores) return null;
    for (const testName of Object.keys(scores)) {
      const subs = scores[testName] || {};
      for (const key of Object.keys(subs)) {
        const arr = subs[key];
        if (Array.isArray(arr)) {
          const hit = arr.find((c) => c && c.id === id);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  let _commentPop = null;
  function closeCommentEditor() {
    if (_commentPop) {
      const p = _commentPop; _commentPop = null;
      if (p._onClose) p._onClose();
      p.remove();
      document.removeEventListener("mousedown", p._outside, true);
      document.removeEventListener("keydown", p._onKey, true);
      window.removeEventListener("resize", p._reposition);
      window.removeEventListener("scroll", p._reposition, true);
    }
  }

  // opts: { onInput?, onClose? }. The note is saved live as you type (like the
  // rest of the form); onInput fires each keystroke (cheap UI refresh) and
  // onClose fires once when the editor closes (heavier re-render: chart/table).
  function openCommentEditor(cond, anchorEl, opts) {
    opts = opts || {};
    closeCommentEditor();
    if (!cond) return;

    const pop = document.createElement("div");
    pop.className = "comment-pop";
    const title = document.createElement("div");
    title.className = "comment-pop-title";
    title.textContent = T("comment.title", "Commentaire");
    const ta = document.createElement("textarea");
    ta.className = "comment-pop-text";
    ta.rows = 4;
    ta.value = cond.comment || "";
    ta.placeholder = T("comment.placeholder", "Observation, remarque, note personnelle…");
    const actions = document.createElement("div");
    actions.className = "comment-pop-actions";
    // Pin = show this note permanently on the chart (and in the exported image).
    const pin = document.createElement("button");
    pin.type = "button"; pin.className = "comment-pin-btn";
    const syncPin = () => {
      const on = !!cond.commentPinned;
      pin.classList.toggle("is-pinned", on);
      pin.textContent = on ? ("📌 " + T("comment.pinned", "Épinglé")) : ("📌 " + T("comment.pin", "Épingler"));
      pin.title = on
        ? T("comment.pinnedTitle", "Retirer l'étiquette du graphique")
        : T("comment.pinTitle", "Afficher ce commentaire en permanence sur le graphique (et dans l'image exportée)");
      pin.disabled = !String(ta.value || "").trim();
    };
    pin.addEventListener("click", () => {
      cond.commentPinned = !cond.commentPinned;
      // Unpinning also forgets any custom position: re-pinning then starts from
      // the default spot (a simple way out if a label was dragged out of view).
      if (!cond.commentPinned) { cond.commentAx = null; cond.commentAy = null; }
      markDirty();
      syncPin();
      if (opts.onInput) opts.onInput();
      if (opts.onPin) opts.onPin();
    });
    const done = document.createElement("button");
    done.type = "button"; done.className = "btn-primary btn-mini"; done.textContent = T("common.done", "Terminé");
    actions.append(pin, done);
    pop.append(title, ta, actions);
    document.body.appendChild(pop);

    const reposition = () => {
      const r = anchorEl.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight, pad = 8;
      let left = r.left, top = r.bottom + 6;
      left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad));
      if (top + ph > window.innerHeight - pad) top = Math.max(pad, r.top - ph - 6);
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
    };
    reposition();
    syncPin();
    setTimeout(() => { try { ta.focus(); } catch (e) {} }, 30);

    ta.addEventListener("input", () => {
      cond.comment = ta.value;
      // An empty note can't stay pinned to the chart.
      if (!ta.value.trim()) cond.commentPinned = false;
      markDirty();
      syncPin();
      if (opts.onInput) opts.onInput();
    });
    // Enter closes (saves live already); Shift+Enter inserts a line break.
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        closeCommentEditor();
      }
    });
    const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) closeCommentEditor(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeCommentEditor(); } };
    done.addEventListener("click", () => closeCommentEditor());
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    pop._onClose = opts.onClose || null;
    pop._outside = outside;
    pop._onKey = onKey;
    pop._reposition = reposition;
    _commentPop = pop;
  }

  // A small speech-bubble button that reflects whether a comment exists and
  // opens the editor. Reused in the score rows and the table.
  function makeCommentButton(cond, opts) {
    opts = opts || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "comment-btn";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
      '<path fill="currentColor" d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/></svg>';
    const refresh = () => {
      const has = commentIsSet(cond);
      btn.classList.toggle("has-comment", has);
      btn.title = has ? "Commentaire — voir ou modifier" : "Ajouter un commentaire";
      btn.setAttribute("aria-label", btn.title);
    };
    refresh();
    btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      openCommentEditor(cond, btn, {
        onInput: () => { refresh(); if (opts.onInput) opts.onInput(); },
        onPin: opts.onPin,
        onClose: opts.onClose
      });
    });
    return btn;
  }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      const card = document.createElement("div");
      card.className = "modal-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      const h = document.createElement("h3");
      h.textContent = opts.title || "Confirmer";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = opts.message || "";
      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const yes = document.createElement("button");
      yes.type = "button"; yes.className = "btn-primary"; yes.textContent = opts.confirmText || "Confirmer";
      const no = document.createElement("button");
      no.type = "button"; no.className = "btn-ghost"; no.textContent = opts.cancelText || "Annuler";
      let done = false;
      const onKey = (e) => { if (e.key === "Escape") close(false); };
      function close(v) { if (done) return; done = true; document.removeEventListener("keydown", onKey); overlay.remove(); resolve(v); }
      yes.addEventListener("click", () => close(true));
      no.addEventListener("click", () => close(false));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
      document.addEventListener("keydown", onKey);
      actions.append(yes, no);
      card.append(h, p, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      setTimeout(() => { try { no.focus(); } catch (e) {} }, 30);
    });
  }

  // Remove a whole score entry (a subtest, or a standalone test) from the
  // project, keeping the selection in sync so it doesn't reappear on re-sync.
  function removeScoreEntry(testName, subtestKey) {
    const scores = currentProject.scores || {};
    if (scores[testName]) {
      delete scores[testName][subtestKey];
      if (Object.keys(scores[testName]).length === 0) delete scores[testName];
    }
    const sel = currentProject.selectedTests || {};
    if (sel[testName]) {
      if (subtestKey === DM.STANDALONE_KEY) {
        delete sel[testName];
      } else {
        sel[testName] = sel[testName].filter((s) => s !== subtestKey);
        if (sel[testName].length === 0) delete sel[testName];
      }
    }
    markDirty();
    renderStep2();
  }

  function buildConditionList(conditionArray, entry) {
    const wrapper = document.createElement("div");
    const list = document.createElement("div");
    list.className = "conditions-container";
    wrapper.appendChild(list);

    const addBtn = document.createElement("button");
    addBtn.textContent = T("scores.addScore", "+ Ajouter un score à ce test");
    addBtn.className = "add-condition-btn";

    function render() {
      list.innerHTML = "";
      conditionArray.forEach((cond, idx) => {
        if (!cond.functions) cond.functions = [];
        list.appendChild(createConditionRow(cond, conditionArray, idx, render, entry));
      });
    }

    addBtn.addEventListener("click", () => {
      // Inherit functions from the first row as a sensible default
      const seed = conditionArray[0]?.functions ? [...conditionArray[0].functions] : [];
      conditionArray.push(DM.createEmptyCondition(seed));
      render();
      const last = list.lastElementChild?.querySelector(".condition-name");
      last?.focus();
    });

    wrapper.appendChild(addBtn);
    render();
    return wrapper;
  }

  function createConditionRow(cond, conditionArray, index, onChange, entry) {
    const row = document.createElement("div");
    row.className = "condition-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = T("scores.namePh", "Nom du score (optionnel)");
    nameInput.value = cond.name || "";
    nameInput.className = "condition-name";
    nameInput.addEventListener("input", () => { cond.name = nameInput.value; markDirty(); });
    // Enter in the name jumps to this row's value field.
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); valueInput.focus(); }
    });

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.placeholder = T("scores.fieldScore", "Score");
    valueInput.value = cond.value ?? "";
    valueInput.className = "condition-value";

    // Expected (typical) range per score type. Only the percentile is a true
    // hard 0–100 scale; the rest are "unusual outside this range" — we WARN
    // without altering the entered number, since it may be legitimately extreme.
    // Inline warning element (full-width under the row)
    const warnEl = makeScoreWarnEl();

    function checkValue() {
      const type = cond.type || "Scale score";
      const rule = SCORE_RULES[type] || SCORE_RULES["Scale score"];
      const lo = rule.hard ? rule.hard.min : (rule.warn ? rule.warn.min : 0);
      const hi = rule.hard ? rule.hard.max : (rule.warn ? rule.warn.max : 100);
      valueInput.min = lo; valueInput.max = hi; valueInput.step = rule.step || 1;
      valueInput.title = T("scores.rangeTitle", "Plage attendue : {min} à {max}").replace("{min}", (rule.warn || rule.hard).min).replace("{max}", (rule.warn || rule.hard).max);
      applyScoreValidation(valueInput, warnEl, type);
    }

    valueInput.addEventListener("input", () => { cond.value = valueInput.value; checkValue(); markDirty(); });
    // Enter = jump to the next score field (skips collapsed cards) for fast entry.
    valueInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const all = Array.from(document.querySelectorAll("#scoreEntryContainer .condition-value, #scoreEntryContainer .scale-value"))
        .filter((el) => !el.closest(".test-card.collapsed"));
      const i = all.indexOf(valueInput);
      if (i > -1 && i < all.length - 1) all[i + 1].focus();
      else valueInput.blur();
    });
    // Only the percentile is truly impossible outside 0–100, so clamp it on blur.
    valueInput.addEventListener("blur", () => {
      if ((cond.type || "Scale score") !== "Percentile" || valueInput.value === "") return;
      let v = Number(valueInput.value);
      if (isNaN(v)) return;
      const clamped = Math.max(0, Math.min(100, v));
      if (clamped !== v) {
        valueInput.value = clamped; cond.value = String(clamped);
        toast(T("scores.pctRange", "Le rang centile doit être entre 0 et 100."));
        checkValue();
      }
    });

    const typeSelect = document.createElement("select");
    typeSelect.className = "condition-type";
    SCORE_TYPE_OPTIONS.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = scoreTypeLabel(t);
      if ((cond.type || "Scale score") === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener("change", () => {
      cond.type = typeSelect.value;
      checkValue();
      markDirty();
    });
    checkValue();

    // Multi-select for cognitive functions
    const msContainer = document.createElement("div");
    msContainer.className = "multi-select-container";
    const display = document.createElement("div");
    display.className = "multi-select-display";
    const refreshDisplay = () => {
      if (cond.functions && cond.functions.length) {
        display.textContent = cond.functions.map(funcDisplay).join(", ");
        display.classList.add("has-value");
      } else {
        display.textContent = T("scores.fnPlaceholder", "Fonctions cognitives…");
        display.classList.remove("has-value");
      }
    };
    refreshDisplay();
    msContainer.appendChild(display);

    const options = document.createElement("div");
    options.className = "multi-select-options";

    function renderFnOptions() {
      options.innerHTML = "";
      allFunctions().forEach((fn) => {
        const lab = document.createElement("label");
        lab.className = "ms-opt";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = fn;
        cb.checked = cond.functions?.includes(fn) || false;
        cb.addEventListener("change", () => {
          cond.functions = Array.from(options.querySelectorAll("input.ms-cb:checked")).map((i) => i.value);
          refreshDisplay();
          markDirty();
        });
        cb.classList.add("ms-cb");
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(funcDisplay(fn)));
        options.appendChild(lab);
      });

      // Inline "add a custom function" row (scoped to this project).
      const addRow = document.createElement("div");
      addRow.className = "ms-add-row";
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = T("scores.addFn", "Ajouter une fonction…");
      addInput.className = "ms-add-input";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "ms-add-btn";
      addBtn.textContent = "+";
      const doAdd = () => {
        const name = addInput.value.trim();
        if (!name) return;
        const res = addProjectFunction(name);
        if (res === "added") {
          // auto-select the newly added function for this row, then refresh
          // every row so it appears everywhere immediately.
          if (!cond.functions) cond.functions = [];
          if (!cond.functions.includes(name)) cond.functions.push(name);
          markDirty();
          toast(T("msg.fnAdded", "Fonction « {name} » ajoutée à ce projet.").replace("{name}", name));
          renderStep2(); // rebuild all rows from currentProject (values preserved)
        } else if (res === "exists") {
          toast(T("msg.fnExists", "Cette fonction existe déjà."));
        }
        addInput.value = "";
      };
      addBtn.addEventListener("click", (e) => { e.stopPropagation(); doAdd(); });
      addInput.addEventListener("click", (e) => e.stopPropagation());
      addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
      addRow.append(addInput, addBtn);
      options.appendChild(addRow);
    }
    // Build the options list lazily — only the first time this menu is opened.
    // Eagerly building 13 checkboxes for every score row was the main source of
    // sluggishness with many tests (thousands of hidden controls in the DOM).
    msContainer.appendChild(options);
    display.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = options.style.display === "block";
      if (openFnMenu && openFnMenu !== options) openFnMenu.style.display = "none";
      if (isOpen) {
        options.style.display = "none";
        openFnMenu = null;
      } else {
        if (!options.dataset.built) { renderFnOptions(); options.dataset.built = "1"; }
        options.style.display = "block";
        openFnMenu = options;
      }
    });
    // (Outside-click closing is handled by a single delegated listener set up
    // once in init — see setupGlobalUI — so we don't leak one listener per row.)

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.className = "remove-condition-btn";
    removeBtn.title = "Supprimer ce score";
    removeBtn.addEventListener("click", () => {
      if (conditionArray.length === 1) {
        // Only score of this test/subtest: removing it removes the entry, so warn.
        if (entry && typeof entry.remove === "function") {
          confirmDialog({
            title: T("dialog.removeTest.title", "Retirer ce test ?"),
            message: T("dialog.removeTest.msg", "« {test} » n'a qu'un seul score. Le retirer enlèvera ce test du projet.").replace("{test}", (entry.label || T("dialog.removeTest.thisTest", "Ce test"))),
            confirmText: T("common.remove", "Retirer"),
            cancelText: T("common.cancel", "Annuler")
          }).then((confirmed) => { if (confirmed) entry.remove(); });
          return;
        }
        // Fallback (no context): keep one empty row.
        conditionArray[0] = DM.createEmptyCondition(cond.functions || []);
        conditionArray[0].functions = [];
      } else {
        conditionArray.splice(index, 1);
      }
      markDirty();
      onChange();
    });

    // Wrap each control in a labeled field for a clean, legible grid.
    const field = (labelText, el) => {
      const f = document.createElement("div");
      f.className = "field";
      const lab = document.createElement("span");
      lab.className = "field-label";
      lab.textContent = labelText;
      f.append(lab, el);
      return f;
    };

    // "Inverted" toggle: high = unfavourable (e.g. reaction time, error count).
    // The score is mirrored around the mean (100 − percentile) wherever it is
    // positioned or classified; the entered value itself is never changed.
    const invField = document.createElement("div");
    invField.className = "field field-invert";
    const invLab = document.createElement("span");
    invLab.className = "field-label";
    invLab.textContent = T("scores.direction", "Sens");
    const invToggle = document.createElement("label");
    invToggle.className = "invert-toggle";
    invToggle.title = T("scores.invertHelp", "Élevé = défavorable (ex. temps de réponse, nombre d'erreurs). Le score est miroité autour de la moyenne.");
    const invCb = document.createElement("input");
    invCb.type = "checkbox";
    invCb.checked = !!cond.inverted;
    invCb.addEventListener("change", () => { cond.inverted = invCb.checked; markDirty(); });
    invToggle.append(invCb, document.createTextNode(" " + T("scores.inverted", "Inversé")));
    invField.append(invLab, invToggle);

    const rowActions = document.createElement("div");
    rowActions.className = "row-actions";
    rowActions.append(makeCommentButton(cond, {}), removeBtn);

    row.append(
      field(T("scores.fieldName", "Nom du score"), nameInput),
      field(T("scores.fieldScore", "Score"), valueInput),
      field(T("common.type", "Type"), typeSelect),
      field(T("scores.fieldFunctions", "Fonctions"), msContainer),
      invField,
      rowActions,
      warnEl
    );
    return row;
  }

  // =========================================================================
  // STEP 3 — visualization + customization panel
  // =========================================================================
  // Selected tests that evaluate IQ (carry échelles), per the bank.
  function listIqTests() {
    return Object.keys((currentProject && currentProject.scores) || {})
      .filter((t) => DM.isIqBattery(t, testsBank));
  }

  // Decide which battery's échelles feed the chart. Keeps a valid user choice;
  // otherwise auto-selects (the only one, or the first with values).
  function resolveActiveScaleTest() {
    if (!currentProject) return null;
    const iq = listIqTests();
    if (iq.length === 0) { currentProject.activeScaleTest = null; return null; }
    if (currentProject.activeScaleTest && iq.includes(currentProject.activeScaleTest)) {
      return currentProject.activeScaleTest;
    }
    if (iq.length === 1) { currentProject.activeScaleTest = iq[0]; return iq[0]; }
    const hasVal = (t) => (currentProject.iqScales[t] || []).some(
      (r) => r.value !== "" && r.value !== null && !isNaN(Number(r.value)));
    currentProject.activeScaleTest = iq.find(hasVal) || iq[0];
    return currentProject.activeScaleTest;
  }

  // Find the entered EGQI (échelle globale) value, if any, for the comparison line.
  function getEgqiValue() {
    const t = currentProject && currentProject.activeScaleTest;
    const rows = (t && currentProject.iqScales && currentProject.iqScales[t]) || [];
    for (const r of rows) {
      if (/\b(EGQI|QIT)\b/i.test(r.name || "") &&
          r.value !== "" && r.value !== null && r.value !== undefined && !isNaN(Number(r.value))) {
        return { value: Number(r.value), scale: r.scale || "Standard score" };
      }
    }
    return null;
  }

  // Reflect the "use EGQI" choice: when on and an EGQI exists, drive the
  // comparison line from it and lock the manual inputs; otherwise free them.
  function applyEgqiCompare() {
    if (!currentProject) return;
    const st = currentProject.chartSettings;
    const egqi = getEgqiValue();
    const cb = $("opt-useEgqi"), cv = $("opt-compareValue"), ctp = $("opt-compareType"), hint = $("opt-useEgqiHint");
    if (cb) { cb.checked = !!st.useEgqiCompare; cb.disabled = !egqi; }
    if (hint) hint.style.display = egqi ? "none" : "";
    if (st.useEgqiCompare && egqi) {
      st.compareValue = String(egqi.value);
      st.compareType = egqi.scale;
      if (cv) { cv.value = st.compareValue; cv.disabled = true; }
      if (ctp) { ctp.value = st.compareType; ctp.disabled = true; }
    } else {
      if (st.useEgqiCompare && !egqi) st.useEgqiCompare = false; // can't use what's not there
      if (cv) cv.disabled = false;
      if (ctp) ctp.disabled = false;
    }
  }

  // Inject the view switcher (Profil · Échelles · Radar) above the chart, once.
  // Lives outside the personalization panel, as a segmented control.
  function ensureViewSwitcher() {
    if ($("viewSwitch")) return;
    const main = document.querySelector("#step-3-content .viz-main");
    const plot = $("vizPlot");
    if (!main || !plot) return;
    const seg = document.createElement("div");
    seg.id = "viewSwitch";
    seg.className = "view-switch";
    seg.setAttribute("role", "tablist");
    const defs = [["line", "Profil", "view.line"], ["scales", "Échelles", "view.scales"], ["radar", "Radar", "view.radar"], ["table", "Tableau", "view.table"]];
    defs.forEach(([type, label, key]) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.view = type;
      b.setAttribute("data-i18n", key);
      b.textContent = (window.VizeaI18n ? window.VizeaI18n.t(key) : label);
      b.addEventListener("click", () => {
        if (b.classList.contains("disabled")) return;
        currentProject.chartSettings.chartType = type;
        syncViewSwitch();
        // keep the panel's Ligne/Radar control in sync where applicable
        $$("#opt-chartType button").forEach((pb) =>
          pb.classList.toggle("active", pb.dataset.type === type));
        buildPanelDynamicControls();
        animateNext = true;
        renderChart();
      });
      seg.appendChild(b);
    });
    main.insertBefore(seg, plot);
  }

  function syncViewSwitch() {
    const cur = (currentProject && currentProject.chartSettings.chartType) || "line";
    $$("#viewSwitch button").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === cur));
  }

  // Enable the Échelles tab only when at least one scale value is entered.
  function updateScalesViewAvailability() {
    const btn = document.querySelector('#viewSwitch button[data-view="scales"]');
    if (!btn || !currentProject) return;
    const available = DM.hasAnyScale(currentProject);
    btn.classList.toggle("disabled", !available);
    btn.title = available ? "" : "Entrez une valeur d'échelle (test Wechsler) pour activer cette vue.";
    if (!available && currentProject.chartSettings.chartType === "scales") {
      currentProject.chartSettings.chartType = "line";
    }
    syncViewSwitch();
  }

  function renderChart() {
    if (!currentProject) return;
    cancelZoom();                                   // any other redraw ends a zoom in flight
    renderFocusBar();
    const plotEl = $("vizPlot");
    const tableEl = $("vizTableWrap");
    const actions = document.querySelector("#step-3-content .viz-actions");

    // Table view: a data table instead of the Plotly chart.
    if (currentProject.chartSettings.chartType === "table") {
      if (plotEl) plotEl.style.display = "none";
      if (actions) actions.style.display = "";          // keep the bottom bar for consistency
      const imgBtn = $("vaImageBtn"); if (imgBtn) imgBtn.hidden = true;
      const xlsBtn = $("vaExcelBtn"); if (xlsBtn) xlsBtn.hidden = false;
      const fab = $("panelToggle"); if (fab) fab.style.display = "none";
      // The customization panel only affects the chart — close it for the table.
      const panel = $("vizPanel"), scrim = $("panelScrim");
      if (panel) panel.classList.remove("open");
      if (scrim) scrim.hidden = true;
      document.body.classList.remove("panel-open");
      if (tableEl) { tableEl.hidden = false; renderTableView(); }
      return;
    }
    // Any chart view: restore the plot + the chart action bar.
    if (tableEl) tableEl.hidden = true;
    if (plotEl) plotEl.style.display = "";
    if (actions) actions.style.display = "";
    const imgBtn = $("vaImageBtn"); if (imgBtn) imgBtn.hidden = false;
    const xlsBtn = $("vaExcelBtn"); if (xlsBtn) xlsBtn.hidden = true;
    const _fab = $("panelToggle"); if (_fab) _fab.style.display = "";

    // Plotly is deferred; if it hasn't finished loading yet, wait for it
    // instead of failing. Poll briefly, then render.
    if (typeof window.Plotly === "undefined") {
      const el = $("vizPlot");
      if (el) el.innerHTML = '<p class="viz-empty">' + T("chart.loading", "Chargement du moteur graphique…") + '</p>';
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (typeof window.Plotly !== "undefined") {
          clearInterval(timer);
          drawChartWithComments();
        } else if (tries > 40) { // ~10s
          clearInterval(timer);
          if (el) el.innerHTML = '<p class="viz-empty">' + T("chart.loadFail", "Le moteur graphique n\'a pas pu être chargé. Vérifiez votre connexion, puis rouvrez cette étape.") + '</p>';
        }
      }, 250);
      return;
    }
    drawChartWithComments();
  }

  // Render the chart, then wire "click a point to add/edit its comment" (profile
  // view only — that's where each marker maps to exactly one score condition).
  // ---- Focus on one cognitive function (view only, never saved) ----------
  let focusFn = null;
  // Next draw is a "fresh" one (entering the chart, switching view/function):
  // play the draw-in animation instead of a smooth transition.
  let animateNext = false;
  const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Lines trace themselves, then the points appear, one function after another.
  function animatePlotIn(el) {
    if (REDUCED_MOTION || !el) return;
    const traces = Array.from(el.querySelectorAll(".scatterlayer .trace"));
    traces.forEach((tr, i) => {
      const d = i * 0.07;
      tr.querySelectorAll(".js-line").forEach((p) => {
        const L = p.getTotalLength ? p.getTotalLength() : 0;
        if (!L) return;
        p.style.strokeDasharray = L + " " + L;
        p.style.strokeDashoffset = L;
        p.getBoundingClientRect();
        p.style.transition = "stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1) " + d + "s";
        p.style.strokeDashoffset = "0";
        setTimeout(() => { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; p.style.transition = ""; }, (d + 0.8) * 1000);
      });
      tr.querySelectorAll(".js-fill, .points path, .textpoint").forEach((n, j) => {
        n.style.opacity = "0";
        n.getBoundingClientRect();
        n.style.transition = "opacity .35s ease " + (d + 0.25 + j * 0.025) + "s";
        n.style.opacity = "";
        setTimeout(() => { n.style.transition = ""; }, (d + 0.7 + j * 0.025) * 1000);
      });
    });
  }
  function chartFunctions() {
    if (!currentProject) return [];
    const groups = CHART.groupPointsByFunction(DM.flattenScores(currentProject), currentProject.chartSettings);
    return groups.map((g) => g.func);
  }
  // The project as drawn: in focus mode, a shallow copy restricted to one function,
  // with values on the points. currentProject itself is never modified.
  function chartProject() {
    const cs = currentProject.chartSettings;
    if (!focusFn || cs.chartType !== "line") return currentProject;
    if (chartFunctions().indexOf(focusFn) < 0) { focusFn = null; return currentProject; }
    return Object.assign({}, currentProject, {
      _focus: focusFn,
      chartSettings: Object.assign({}, cs, { visibleFunctions: [focusFn], showDataLabels: true, title: "" })
    });
  }
  function fnColor(f) {
    const cs = currentProject.chartSettings || {};
    return (cs.functionColors && cs.functionColors[f]) ||
      (window.VizeaConstants && window.VizeaConstants.DEFAULT_FUNCTION_COLORS[f]) || "#6b7c8f";
  }
  function fnLabel(f) {
    const m = currentProject.chartSettings && currentProject.chartSettings.functionLabels;
    return (m && typeof m[f] === "string" && m[f].trim()) ? m[f].trim() : funcDisplay(f);
  }
  document.addEventListener("click", (e) => {
    if (e.target && e.target.closest && e.target.closest("#fnFocusBack")) setFocus(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !focusFn || document.body.classList.contains("demo-on")) return;
    if ($("vizPanel")?.classList.contains("open") || document.querySelector(".comment-pop, .modal-overlay:not([hidden])")) return;
    if (!$("step-3-content")?.classList.contains("active")) return;
    setFocus(null);
  });
  // Entering / leaving a function view zooms: the profile's x axis glides onto
  // the function (or opens back up from it), then the other view takes over.
  const ZOOM_MS = 480;
  var settleNext = false, zoomSeq = 0;
  // Frame-by-frame range change (Plotly.animate could hang after an interrupted
  // transition); stops as soon as a newer focus change comes in.
  function cancelZoom() {
    zoomSeq++;
    $("vizPlot")?.classList.remove("is-zooming");
  }
  function zoomRange(el, a, b, stale) {
    return new Promise((resolve) => {
      const r0 = (el._fullLayout.xaxis.range || [a, b]).slice(), t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        if (stale()) return resolve();
        const t = Math.min(1, (now - t0) / ZOOM_MS), k = ease(t);
        try { window.Plotly.relayout(el, { "xaxis.range": [r0[0] + (a - r0[0]) * k, r0[1] + (b - r0[1]) * k] }); } catch (e) { return resolve(); }
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }
  function globalGroups() {
    return CHART.groupPointsByFunction(DM.flattenScores(currentProject), currentProject.chartSettings);
  }
  function groupSpan(f) {
    let k = 0;
    for (const g of globalGroups()) {
      if (g.func === f) return [k - 0.5, k + g.points.length - 0.5];
      k += g.points.length;
    }
    return null;
  }
  // The focus bar appears / disappears above the chart: scroll by the same
  // amount so the plot itself stays put (the bar stays in view).
  const plotTop = (el) => el.getBoundingClientRect().top + ((el._fullLayout && el._fullLayout._size.t) || 0);
  function keepPlotStill(el, before) {
    let d = plotTop(el) - before;
    const bar = $("fnFocusBar");
    if (d > 0 && bar && !bar.hidden) d = Math.min(d, bar.getBoundingClientRect().top - 84);
    if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" });
  }
  function setFocus(f) {
    const seq = ++zoomSeq, stale = () => seq !== zoomSeq;   // a newer call wins over a zoom in flight
    const el = $("vizPlot");
    if (el) {
      try { window.Plotly && window.Plotly.Fx && window.Plotly.Fx.unhover(el); } catch (e) {}
    }
    const prev = focusFn;
    const canZoom = !REDUCED_MOTION && el && el._fullLayout && window.Plotly &&
      currentProject.chartSettings.chartType === "line";
    const span = canZoom ? groupSpan(f || prev) : null;
    const done = () => {
      if (stale()) return;
      try { window.Plotly.Fx.unhover(el); } catch (e) {}
      el.classList.remove("is-zooming");
    };
    if (el) el.classList.remove("is-zooming");
    if (span && f && !prev) {                       // zoom in
      el.classList.add("is-zooming");
      zoomRange(el, span[0], span[1], stale).then(() => {
        if (stale()) return;
        const before = plotTop(el);
        focusFn = f; settleNext = true;
        return drawChartWithComments().then(() => keepPlotStill(el, before));
      }).then(done, done);
      return;
    }
    focusFn = f || null;
    if (span && !f && prev) {                       // zoom out
      const before = plotTop(el);
      const total = globalGroups().reduce((n, g) => n + g.points.length, 0);
      settleNext = true;
      drawChartWithComments(span)
        .then(() => { if (stale()) return; keepPlotStill(el, before); el.classList.add("is-zooming"); return zoomRange(el, -0.5, total - 0.5, stale); })
        .then(done, done);
      return;
    }
    animateNext = true;
    drawChartWithComments();
    if (!focusFn) $("vizPlot")?.scrollIntoView({ block: "nearest" });
  }
  function renderFocusBar() {
    const bar = $("fnFocusBar");
    if (!bar) return;
    const on = !!focusFn && currentProject && currentProject.chartSettings.chartType === "line";
    bar.hidden = !on;
    // Keep the bar right under the Profile/Scales/Radar/Table switcher.
    const vs = $("viewSwitch");
    if (vs && vs.parentNode === bar.parentNode && vs.nextElementSibling !== bar) vs.after(bar);
    document.querySelector("#step-3-content .viz-main")?.classList.toggle("is-focused", on);
    if (!on) return;
    bar.querySelector(".fn-focus-title").textContent = fnLabel(focusFn);
    bar.querySelector(".fn-focus-title").style.setProperty("--c", fnColor(focusFn));
    const pills = bar.querySelector(".fn-focus-pills");
    pills.innerHTML = "";
    chartFunctions().forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fn-pill" + (f === focusFn ? " is-on" : "");
      b.style.setProperty("--c", fnColor(f));
      b.setAttribute("aria-pressed", f === focusFn ? "true" : "false");
      b.textContent = fnLabel(f);
      b.addEventListener("click", () => setFocus(f));
      pills.appendChild(b);
    });
  }

  function drawChartWithComments(xrange) {
    const fresh = animateNext, settle = settleNext;
    animateNext = false; settleNext = false;
    const proj = Object.assign({}, chartProject(), { _smooth: !fresh && !settle && !REDUCED_MOTION, _xrange: xrange || null });
    renderFocusBar();
    const p = CHART.renderChart(proj, "vizPlot");
    const plotEl = $("vizPlot");
    if (plotEl) plotEl.classList.toggle("can-edit", ["line", "scales", "radar"].indexOf(proj.chartSettings.chartType) >= 0);
    const after = () => {
      bindChartComments();
      if (fresh) animatePlotIn($("vizPlot"));
      if (settle && plotEl) {                       // values on the points fade in after a zoom
        plotEl.classList.remove("zoom-settle"); void plotEl.offsetWidth; plotEl.classList.add("zoom-settle");
      }
    };
    if (p && p.then) return p.then(after);
    after();
    return Promise.resolve();
  }
  function bindChartComments() {
    const el = $("vizPlot");
    if (!el || typeof el.on !== "function") return;
    const ct = currentProject.chartSettings.chartType;
    el._vizeaHover = null;
    el._vizeaUnlit = null;
    if (ct !== "line" && ct !== "scales") return;
    try {
      if (el.removeAllListeners) {
        el.removeAllListeners("plotly_click");
        el.removeAllListeners("plotly_clickannotation");
        el.removeAllListeners("plotly_relayout");
      }
    } catch (e) { /* noop */ }

    const editAt = (cond, clientX, clientY) => {
      const anchor = {
        getBoundingClientRect: () => ({ left: clientX, right: clientX, top: clientY, bottom: clientY, width: 0, height: 0 }),
        contains: () => false
      };
      openCommentEditor(cond, anchor, {
        onPin: () => drawChartWithComments(),
        onClose: () => drawChartWithComments()
      });
    };

    // Hover a point: its interpretation band lights up a little.
    try { el.removeAllListeners && (el.removeAllListeners("plotly_hover"), el.removeAllListeners("plotly_unhover")); } catch (e) {}
    if (ct === "line") {
      let lit = null;
      const bandShape = (key) => {
        const b = (window.ScoringEngine.CLASSIFICATION_BANDS || []).find((x) => x.key === key);
        const shapes = (el.layout && el.layout.shapes) || [];
        if (!b) return -1;
        return shapes.findIndex((s) => s.type === "rect" && s.xref === "paper" && s.yref === "y" && s.fillcolor === b.color);
      };
      const restore = () => {
        if (!lit) return;
        const u = {}; u["shapes[" + lit.i + "].opacity"] = lit.o; lit = null;
        try { window.Plotly.relayout(el, u); } catch (e) {}
      };
      el.on("plotly_hover", (data) => {
        if (document.body.classList.contains("chart-dragging")) return;
        const pt = data && data.points && data.points[0];
        const key = pt && Array.isArray(pt.customdata) ? pt.customdata[2] : null;
        const i = key ? bandShape(key) : -1;
        if (lit && lit.i === i) return;
        restore();
        if (i < 0) return;
        const o = el.layout.shapes[i].opacity;
        lit = { i, o };
        const u = {}; u["shapes[" + i + "].opacity"] = Math.min(0.55, o * 2.4 + 0.04);
        try { window.Plotly.relayout(el, u); } catch (e) {}
      });
      el.on("plotly_unhover", restore);
      el._vizeaUnlit = restore;            // a drag starting on a point turns the band back off
    }

    // Remember the hovered data point: pressing it starts a drag (see setupChartDirectEdit).
    el.on("plotly_hover", (d) => {
      const pt = d && d.points && d.points[0], cd = pt && pt.customdata;
      el._vizeaHover = Array.isArray(cd)
        ? { idx: typeof pt.x === "number" ? Math.round(pt.x) : pt.pointNumber, id: cd.length > 1 ? cd[1] : cd[0] }
        : null;
      el.classList.toggle("on-point", !!el._vizeaHover);
    });
    el.on("plotly_unhover", () => { el._vizeaHover = null; el.classList.remove("on-point"); });

    // Click a POINT: add or edit its comment (and pin it from the editor).
    el.on("plotly_click", (data) => {
      const pt = data && data.points && data.points[0];
      if (!pt || !Array.isArray(pt.customdata)) return;
      // Profile points carry [hoverText, id]; scale points carry [id].
      const id = pt.customdata.length > 1 ? pt.customdata[1] : pt.customdata[0];
      const cond = findConditionById(id);
      if (!cond) return;
      const ev = data.event || {};
      editAt(cond, ev.clientX || 0, ev.clientY || 0);
    });

    // Click a function's title: look at that function alone. Otherwise the
    // "···" bubble or a pinned label: edit that same comment.
    el.on("plotly_clickannotation", (ev) => {
      if (chartDragEnded) return;           // that "click" was the end of a drag
      const fn = CHART.functionTitleAt(ev && ev.index);
      if (fn) { setFocus(fn); return; }
      const id = CHART.commentAnnotationId(ev && ev.index);
      if (!id) return;
      const cond = findConditionById(id);
      if (!cond) return;
      const me = (ev && ev.event) || {};
      editAt(cond, me.clientX || 0, me.clientY || 0);
    });

    // Drag a pinned label: remember its new position on the score itself, so it
    // survives redraws and is saved with the project. Labels that aren't
    // comments (section titles, band names) are snapped back to their computed
    // spot — only comments are meant to be movable.
    el.on("plotly_relayout", (ed) => {
      if (!ed || el.classList.contains("is-zooming")) return;   // the zoom animation relays out too
      const moved = {};
      let foreign = false;
      Object.keys(ed).forEach((k) => {
        const m = /^annotations\[(\d+)\]\.(ax|ay)$/.exec(k);
        if (!m) return;
        const idx = Number(m[1]);
        const id = CHART.commentAnnotationId(idx);
        if (!id) { foreign = true; return; }
        (moved[id] = moved[id] || {})[m[2]] = ed[k];
      });
      const ids = Object.keys(moved);
      if (!ids.length && !foreign) return;
      let changed = false;
      ids.forEach((id) => {
        const cond = findConditionById(id);
        if (!cond) return;
        if (typeof moved[id].ax === "number") cond.commentAx = moved[id].ax;
        if (typeof moved[id].ay === "number") cond.commentAy = moved[id].ay;
        changed = true;
      });
      if (changed) markDirty();
      if (foreign) drawChartWithComments();
    });
  }

  // ---- Edit straight from the charts and the table (view-only settings) ----
  // Drag a name to reorder it; click a name in a chart to rename it. Same
  // settings as the panel (functionOrder, pointOrder, pointOverrides,
  // scaleOrder, scaleLabels, functionLabels), so both always agree.
  let chartDragEnded = false;
  function chartEdited() {
    markDirty();
    renderChart();
    if ($("opt-functions")) buildPanelDynamicControls();
    if (typeof renderScalesVisibilityControls === "function") renderScalesVisibilityControls();
  }
  function moveItem(arr, from, slot) {
    const a = arr.slice(), [it] = a.splice(from, 1);
    a.splice(slot > from ? slot - 1 : slot, 0, it);
    return a;
  }
  // Rebuild an object with its keys in a new order (tests are ordered by key).
  function reorderKeys(obj, keys) {
    if (!obj) return;
    const all = keys.filter((k) => k in obj).concat(Object.keys(obj).filter((k) => keys.indexOf(k) < 0));
    const copy = {}; all.forEach((k) => { copy[k] = obj[k]; });
    Object.keys(obj).forEach((k) => delete obj[k]);
    all.forEach((k) => { obj[k] = copy[k]; });
  }
  // Pointer drag: a floating label follows the cursor and a line marks the
  // nearest drop slot. slots() → [{ px, py, x, y, len, angle }] in client px:
  // (px, py) is where the slot sits; the marker runs from (x, y), len long,
  // rotated by angle (deg, 0 = downward). A press without movement = click.
  function pointerDrag(e, o) {
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, line = null, slot = -1;
    const noSelect = (ev) => ev.preventDefault();      // no blue text selection while dragging
    const move = (ev) => {
      if (!ghost) {
        if (Math.abs(ev.clientX - x0) < 6 && Math.abs(ev.clientY - y0) < 6) return;
        ghost = document.createElement("div");
        ghost.className = "chart-drag-ghost";
        ghost.textContent = o.label;
        line = document.createElement("div");
        line.className = "chart-drop-line";
        [ghost, line].forEach((n) => n.style.setProperty("--c", o.color || "var(--cyan-deep)"));
        document.body.append(ghost, line);
        document.body.classList.add("chart-dragging");
        document.addEventListener("selectstart", noSelect);
        try { window.getSelection().removeAllRanges(); } catch (er) {}
        if (o.src) o.src.classList.add("is-drag-src");
        if (o.onStart) o.onStart();
      }
      ev.preventDefault();
      ghost.style.transform = "translate(" + ev.clientX + "px," + ev.clientY + "px)";
      const slots = o.slots();
      const d = (q) => o.axis === "x" ? Math.abs(q.px - ev.clientX) : o.axis === "y" ? Math.abs(q.py - ev.clientY) : Math.hypot(q.px - ev.clientX, q.py - ev.clientY);
      slot = 0;
      slots.forEach((q, i) => { if (d(q) < d(slots[slot])) slot = i; });
      const q = slots[slot];
      line.style.height = q.len + "px";
      line.style.transform = "translate(" + q.x + "px," + q.y + "px) rotate(" + (q.angle || 0) + "deg)";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!ghost) { if (o.onClick) o.onClick(); return; }
      ghost.remove(); line.remove();
      document.body.classList.remove("chart-dragging");
      document.removeEventListener("selectstart", noSelect);
      try { window.getSelection().removeAllRanges(); } catch (er) {}
      if (o.src) o.src.classList.remove("is-drag-src");
      chartDragEnded = true;                 // swallow the click that ends a drag
      setTimeout(() => { chartDragEnded = false; }, 0);
      if (slot >= 0) o.onDrop(slot);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  // Small floating field to rename a label in place. Empty or the original
  // name = back to the original.
  function renameInline(anchor, current, ariaLabel, commit) {
    const r = anchor.getBoundingClientRect();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chart-rename";
    input.maxLength = 120;
    input.value = current;
    input.setAttribute("aria-label", ariaLabel);
    input.style.left = (r.left + r.width / 2 + window.scrollX) + "px";
    input.style.top = (r.top + r.height / 2 + window.scrollY) + "px";
    document.body.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const close = (save) => {
      if (done) return; done = true;
      const v = input.value.trim();
      input.remove();
      if (save && v !== current) commit(v);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();                   // keep Escape from leaving the focus view
      if (e.key === "Enter") { e.preventDefault(); close(true); }
      else if (e.key === "Escape") { e.preventDefault(); close(false); }
    });
    input.addEventListener("blur", () => close(true));
  }
  function plotGeom(el) {
    const fl = el._fullLayout, r = el.getBoundingClientRect();
    return { x: (v) => r.left + fl._size.l + fl.xaxis.l2p(v), top: r.top + fl._size.t, h: fl._size.h };
  }
  function openCommentFor(id, x, y) {
    const cond = findConditionById(id);
    if (!cond) return;
    const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }), contains: () => false };
    openCommentEditor(cond, anchor, { onPin: () => drawChartWithComments(), onClose: () => drawChartWithComments() });
  }
  function setupChartDirectEdit() {
    const el = $("vizPlot");
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      const ed = el._vizeaEdit;
      if (e.button !== 0 || !el.classList.contains("can-edit") || !ed || !el._fullLayout || !e.target.closest) return;
      const cs = currentProject.chartSettings;
      const tick = e.target.closest(".xtick"), ann = e.target.closest(".annotation"), ang = e.target.closest(".angularaxistick");
      const node = tick || ann || ang;
      // A press on the hovered data point (profile / scales) drags that score,
      // so reordering works even when the names aren't shown under the axis.
      const hv = !node && (ed.groups || ed.names) ? el._vizeaHover : null;
      if (!node && !hv) return;
      if (hv) e.preventDefault();                 // keeps Plotly's zoom box out of it
      const src = node ? (node.querySelector("text") || node) : null;
      const idx = hv ? hv.idx : Math.round(node.__data__ && node.__data__.x);   // Plotly binds each tick's x value
      const asTick = tick || hv;
      const comment = () => openCommentFor(hv.id, e.clientX, e.clientY);
      // Vertical marker lines at x positions (line + scales views).
      const vSlots = (xs) => () => { const G = plotGeom(el); return xs.map((v) => { const X = G.x(v); return { px: X, py: 0, x: X, y: G.top, len: G.h }; }); };
      const range = (a, n) => Array.from({ length: n + 1 }, (_, k) => a + k - 0.5);

      if (ed.groups && (asTick || ann)) {                    // ---- profile
        const groups = ed.groups;
        let gi, j = -1;
        if (asTick) {
          gi = groups.findIndex((g) => idx >= g.start && idx < g.start + g.pids.length);
          if (gi < 0) return;
          j = idx - groups[gi].start;
        } else {
          const fn = CHART.functionTitleAt(Number(ann.getAttribute("data-index")));
          gi = groups.findIndex((g) => g.func === fn);
          if (!fn || gi < 0) return;
        }
        const g = groups[gi];
        pointerDrag(e, {
          label: asTick ? (((cs.pointOverrides || {})[g.pids[j]] || {}).label || g.labels[j]) : fnLabel(g.func),
          color: fnColor(g.func), src, axis: "x",
          onStart: () => { try { window.Plotly.Fx.unhover(el); } catch (er) {} if (el._vizeaUnlit) el._vizeaUnlit(); },
          slots: asTick ? vSlots(range(g.start, g.pids.length))
            : vSlots(groups.map((q) => q.start - 0.5).concat(groups[groups.length - 1].start + groups[groups.length - 1].pids.length - 0.5)),
          onClick: hv ? comment : tick ? () => {
            const pid = g.pids[j], orig = g.labels[j];
            if (!cs.pointOverrides) cs.pointOverrides = {};
            const ov = cs.pointOverrides[pid] || {};
            renameInline(src, ov.label || orig, T("chart.renameTest", "Nom du test dans le graphique"), (v) => {
              const o = cs.pointOverrides[pid] || {};
              if (!v || v === orig) delete o.label; else o.label = v;
              cs.pointOverrides[pid] = o;
              chartEdited();
            });
          } : null,                                           // a title click = focus view (Plotly event)
          onDrop: (slot) => {
            if (asTick) {
              if (slot === j || slot === j + 1) return;
              const all = groups.map((q, k) => k === gi ? moveItem(q.pids, j, slot) : q.pids).flat();
              cs.pointOrder = all.concat((cs.pointOrder || []).filter((p) => all.indexOf(p) < 0));
            } else {
              if (slot === gi || slot === gi + 1) return;
              const order = moveItem(groups.map((q) => q.func), gi, slot);
              cs.functionOrder = order.concat((cs.functionOrder || []).filter((f) => order.indexOf(f) < 0));
            }
            chartEdited();
          }
        });
      } else if (ed.names && asTick) {                        // ---- global scales
        const names = ed.names, name = names[idx];
        if (!name) return;
        pointerDrag(e, {
          label: (cs.scaleLabels && cs.scaleLabels[name]) || name, src, axis: "x",
          onStart: () => { try { window.Plotly.Fx.unhover(el); } catch (er) {} if (el._vizeaUnlit) el._vizeaUnlit(); },
          slots: vSlots(range(0, names.length)),
          onClick: hv ? comment : () => {
            if (!cs.scaleLabels) cs.scaleLabels = {};
            renameInline(src, cs.scaleLabels[name] || name, T("chart.renameScale", "Nom de l'échelle dans le graphique"), (v) => {
              if (!v || v === name) delete cs.scaleLabels[name]; else cs.scaleLabels[name] = v;
              chartEdited();
            });
          },
          onDrop: (slot) => {
            if (slot === idx || slot === idx + 1) return;
            const order = moveItem(names, idx, slot);
            cs.scaleOrder = order.concat((cs.scaleOrder || []).filter((n) => order.indexOf(n) < 0));
            chartEdited();
          }
        });
      } else if (ed.funcs && ang) {                           // ---- radar
        const funcs = ed.funcs, f = funcs[idx];
        if (!f) return;
        pointerDrag(e, {
          label: fnLabel(f), color: fnColor(f), src, axis: "xy",
          onStart: () => { try { window.Plotly.Fx.unhover(el); } catch (er) {} if (el._vizeaUnlit) el._vizeaUnlit(); },
          slots: () => {
            // The marker follows the radar's own spokes (Plotly's polar geometry).
            const sp = el._fullLayout.polar._subplot, aa = sp.angularAxis, r = el.getBoundingClientRect();
            const cx = r.left + sp.cx, cy = r.top + sp.cy, R = sp.radius;
            return funcs.map((_, i) => {
              const g = aa.c2g(i), dx = Math.cos(g), dy = -Math.sin(g);
              return { px: cx + dx * R, py: cy + dy * R, x: cx, y: cy, len: R, angle: Math.atan2(dy, dx) * 180 / Math.PI - 90 };
            });
          },
          onClick: () => {
            const def = funcDisplay(f);
            renameInline(src, fnLabel(f), T("focus.rename", "Nom de la fonction dans le graphique"), (v) => {
              if (!cs.functionLabels) cs.functionLabels = {};
              if (!v || v === def || v === f) delete cs.functionLabels[f]; else cs.functionLabels[f] = v;
              chartEdited();
            });
          },
          onDrop: (slot) => {                                 // dropped on a spoke = take its place
            if (slot === idx) return;
            const order = moveItem(funcs, idx, slot > idx ? slot + 1 : slot);
            cs.functionOrder = order.concat((cs.functionOrder || []).filter((x) => order.indexOf(x) < 0));
            chartEdited();
          }
        });
      }
    });
  }

  // Table: drag a group header (function or test) or, grouped by function, a
  // test row. The grip button also moves with the keyboard (↑ / ↓).
  function bindTableDrag(table, model) {
    const s = currentProject.chartSettings;
    const keys = model.groups.map((g) => g.key);
    const moveGroup = (from, slot) => {
      if (slot === from || slot === from + 1) return;
      const order = moveItem(keys, from, slot);
      if (model.groupBy === "function") {
        s.functionOrder = order.concat((s.functionOrder || []).filter((x) => order.indexOf(x) < 0));
      } else {
        reorderKeys(currentProject.selectedTests, order);
        reorderKeys(currentProject.scores, order);
      }
      markDirty();
      renderTableView();
    };
    const moveRow = (gi, from, slot) => {
      if (slot === from || slot === from + 1) return;
      // By function: the chart's per-function order. By test: a table-only order.
      const field = model.groupBy === "function" ? "pid" : "conditionId";
      const all = model.groups.map((g, k) => k === gi ? moveItem(g.rows.map((r) => r[field]), from, slot) : g.rows.map((r) => r[field])).flat();
      const key = model.groupBy === "function" ? "pointOrder" : "tableRowOrder";
      s[key] = all.concat((Array.isArray(s[key]) ? s[key] : []).filter((p) => all.indexOf(p) < 0));
      markDirty();
      renderTableView();
    };
    const hLine = (Y) => { const tb = table.getBoundingClientRect(); return { px: 0, py: Y, x: tb.left, y: Y, len: tb.width, angle: -90 }; };
    table.addEventListener("keydown", (e) => {
      const grip = e.target.closest && e.target.closest(".group-grip");
      if (!grip || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const gi = Number(grip.closest("tr").dataset.gi);
      moveGroup(gi, e.key === "ArrowUp" ? gi - 1 : gi + 2);
      const again = $("vizTableWrap").querySelector('tr.group-row[data-gi="' + Math.max(0, Math.min(keys.length - 1, gi + (e.key === "ArrowUp" ? -1 : 1))) + '"] .group-grip');
      if (again) again.focus();
    });
    table.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.target.closest) return;
      if (e.target.closest("button:not(.group-grip), input, a, .comment-inline")) return;
      const tr = e.target.closest("tr");
      if (!tr || !tr.dataset.gi) return;
      e.preventDefault();                    // no text selection: this press may become a drag
      const gi = Number(tr.dataset.gi), g = model.groups[gi];
      if (tr.classList.contains("group-row")) {
        if (keys.length < 2) return;
        pointerDrag(e, {
          label: g.title, color: g.color, src: tr, axis: "y",
          slots: () => {
            const heads = Array.from(table.querySelectorAll("tr.group-row"));
            return heads.map((h) => hLine(h.getBoundingClientRect().top)).concat(hLine(table.tBodies[0].getBoundingClientRect().bottom));
          },
          onDrop: (slot) => moveGroup(gi, slot)
        });
      } else if (tr.dataset.ri && g.rows.length > 1) {
        const ri = Number(tr.dataset.ri);
        pointerDrag(e, {
          label: g.rows[ri].label, color: g.color, src: tr, axis: "y",
          slots: () => {
            const rows = Array.from(table.querySelectorAll('tr[data-gi="' + gi + '"][data-ri]'));
            return rows.map((r) => hLine(r.getBoundingClientRect().top)).concat(hLine(rows[rows.length - 1].getBoundingClientRect().bottom));
          },
          onDrop: (slot) => moveRow(gi, ri, slot)
        });
      }
    });
  }

  // Rename the focused function from the focus bar title.
  document.addEventListener("click", (e) => {
    const h = e.target && e.target.closest && e.target.closest(".fn-focus-title");
    if (!h || !focusFn || h.querySelector("input")) return;
    const cs = currentProject.chartSettings, f = focusFn, def = funcDisplay(f);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "fn-focus-rename";
    input.maxLength = 80;
    input.value = fnLabel(f);
    input.setAttribute("aria-label", T("focus.rename", "Nom de la fonction dans le graphique"));
    h.textContent = "";
    h.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const close = (save) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (save && v !== fnLabel(f)) {
        if (!cs.functionLabels) cs.functionLabels = {};
        if (!v || v === def || v === f) delete cs.functionLabels[f]; else cs.functionLabels[f] = v;
        chartEdited();
      } else renderFocusBar();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); close(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); close(false); }
    });
    input.addEventListener("blur", () => close(true));
  });

  // Coalesce rapid input events (dragging a colour picker, typing in a text
  // field) into a single redraw, so the Plotly chart isn't rebuilt on every
  // keystroke/pixel — noticeably smoother with many points.
  let _chartRedrawTimer = null;
  function renderChartDebounced() {
    clearTimeout(_chartRedrawTimer);
    _chartRedrawTimer = setTimeout(() => { _chartRedrawTimer = null; renderChart(); }, 110);
  }

  // Live redraw synced to the screen's refresh, for silky slider dragging: at
  // most one redraw per frame, and never two in flight at once. Used while a
  // control is being dragged; the final settle still goes through renderChart.
  let _liveRaf = null;
  function renderChartLive() {
    if (_liveRaf) return;
    _liveRaf = requestAnimationFrame(() => { _liveRaf = null; renderChart(); });
  }

  // =========================================================================
  // TABLE VIEW (4th toggle) — a data table of the scores, grouped by test or
  // by cognitive function, with selectable columns and Word/Excel/Image export.
  // =========================================================================
  function tableHexToRgba(hex, a) {
    const h = String(hex || "#cccccc").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function tableBlendWhite(hex, weight) {
    const h = String(hex || "#cccccc").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(c * weight + 255 * (1 - weight));
    const to2 = (x) => x.toString(16).padStart(2, "0");
    return "#" + to2(mix(r)) + to2(mix(g)) + to2(mix(b));
  }
  function tableFmtPct(p) {
    if (p < 0.5) return "<1";
    if (p > 99.5) return ">99";
    return String(Math.round(p));
  }
  function tableProjBase() {
    return "vizea_" + String(currentProject.title || "tableau").replace(/[^\w\-]+/g, "_").toLowerCase().slice(0, 60);
  }

  function buildTableModel() {
    const s = currentProject.chartSettings;
    if (!s.tableColumns) s.tableColumns = { value: true, type: true, percentile: true, classification: true, color: true };
    const cols = s.tableColumns;
    const SE = window.ScoringEngine;
    const groupBy = s.tableGroupBy || "test";
    const showColor = cols.color !== false;
    const displayFunc = (f) => (s.functionLabels && s.functionLabels[f]) || funcDisplay(f);
    const pts = DM.flattenScores(currentProject);

    const colDefs = [];
    if (cols.value !== false) colDefs.push(["value", T("common.value", "Valeur")]);
    if (cols.type !== false) colDefs.push(["type", T("common.type", "Type")]);
    if (cols.percentile !== false) colDefs.push(["percentile", T("score.percentile", "Rang centile")]);
    if (cols.classification !== false) colDefs.push(["classification", T("table.classification", "Classification")]);

    const rowFromPoint = (p, stripTest) => {
      const band = SE ? SE.getBandForPercentile(p.percentile) : { label: "", color: "#cccccc" };
      let label = p.label;
      if (stripTest) {
        const prefix = p.testName + " – ";
        label = label.indexOf(prefix) === 0 ? label.slice(prefix.length) : label;
        if (!label) label = "—";
      }
      return {
        label,
        value: String(p.rawValue),
        type: scoreTypeLabel(p.type),
        percentile: tableFmtPct(p.percentile),
        classification: bandFieldDisplay(band.key, "label", band.label),
        color: band.color,
        inverted: !!p.inverted,
        comment: p.comment || "",
        conditionId: p.conditionId,
        pid: p.pid
      };
    };

    const groups = [];
    let functionKeys = null;
    if (groupBy === "function") {
      const map = {}, present = [];
      pts.forEach((p) => {
        if (!map[p.func]) { map[p.func] = []; present.push(p.func); }
        map[p.func].push(rowFromPoint(p, false));
      });
      // Tests inside a function follow the chart's order (pointOrder).
      const rank = {}; (s.pointOrder || []).forEach((pid, i) => { rank[pid] = i; });
      const rk = (r) => (r.pid in rank ? rank[r.pid] : Infinity);
      Object.keys(map).forEach((f) => { map[f].sort((a, b) => rk(a) - rk(b)); });
      // Follow the same function order as the panel / chart (drag-to-reorder),
      // then canonical order — so the table isn't in random score-entry order.
      const orderPref = (s.functionOrder || []).concat(COGNITIVE_FUNCTIONS);
      const ordered = [], seen = {};
      orderPref.forEach((f) => { if (map[f] && !seen[f]) { ordered.push(f); seen[f] = 1; } });
      present.forEach((f) => { if (!seen[f]) ordered.push(f); });
      ordered.forEach((k) => groups.push({ title: displayFunc(k), rows: map[k], key: k, color: fnColor(k) }));
      functionKeys = ordered;
    } else {
      const order = [], map = {}, seen = {};
      pts.forEach((p) => {
        if (seen[p.conditionId]) return;   // one row per condition (deduped across functions)
        seen[p.conditionId] = 1;
        if (!map[p.testName]) { map[p.testName] = []; order.push(p.testName); }
        map[p.testName].push(rowFromPoint(p, true));
      });
      // Rows inside a test: the order dragged in the table (view only).
      const trank = {}; (Array.isArray(s.tableRowOrder) ? s.tableRowOrder : []).forEach((id, i) => { trank[id] = i; });
      const tk = (r) => (r.conditionId in trank ? trank[r.conditionId] : Infinity);
      order.forEach((k) => { map[k].sort((a, b) => tk(a) - tk(b)); groups.push({ title: k, rows: map[k], key: k }); });
    }

    return {
      firstHeader: groupBy === "test" ? "Sous-test / score" : "Test / score",
      colDefs, groups, showColor, groupBy, functionKeys,
      showComments: cols.comments !== false,
      commentMode: s.tableCommentMode === "text" ? "text" : "icon",
      anyInverted: pts.some((p) => p.inverted),
      anyComment: pts.some((p) => p.comment && String(p.comment).trim())
    };
  }

  function buildTableElement(model) {
    const table = document.createElement("table");
    table.className = "score-table";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    const th0 = document.createElement("th"); th0.textContent = model.firstHeader; htr.appendChild(th0);
    model.colDefs.forEach(([, lab]) => { const th = document.createElement("th"); th.textContent = lab; htr.appendChild(th); });
    if (model.showComments) {
      const thc = document.createElement("th");
      thc.className = model.commentMode === "text" ? "th-comment-wide" : "th-comment";
      const head = document.createElement("div");
      head.className = "comment-head";
      const lab = document.createElement("span");
      lab.textContent = model.commentMode === "text" ? "Commentaire" : "Comm.";
      // Slider: left = compact icon, right = the note spelled out.
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "comment-mode-switch" + (model.commentMode === "text" ? " is-text" : "");
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-checked", model.commentMode === "text" ? "true" : "false");
      sw.title = model.commentMode === "text"
        ? "Afficher seulement une icône"
        : "Afficher les commentaires au complet";
      sw.setAttribute("aria-label", sw.title);
      sw.innerHTML = '<span class="cms-knob"></span>';
      sw.addEventListener("click", () => {
        const st = currentProject.chartSettings;
        st.tableCommentMode = (st.tableCommentMode === "text") ? "icon" : "text";
        markDirty();
        renderTableView();
      });
      head.append(lab, sw);
      thc.appendChild(head);
      htr.appendChild(thc);
    }
    thead.appendChild(htr); table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const totalCols = 1 + model.colDefs.length + (model.showComments ? 1 : 0);
    model.groups.forEach((g, gi) => {
      const gtr = document.createElement("tr"); gtr.className = "group-row";
      gtr.dataset.gi = gi;
      const gtd = document.createElement("td"); gtd.colSpan = totalCols;
      if (model.groups.length > 1) {
        // Drag the header (or use ↑ / ↓ on the grip) to move the whole group.
        const wrap = document.createElement("div"); wrap.className = "group-head";
        const grip = document.createElement("button");
        grip.type = "button"; grip.className = "group-grip"; grip.textContent = "⠿";
        grip.title = T("table.dragGroup", "Glisser pour déplacer (ou flèches ↑ ↓)");
        grip.setAttribute("aria-label", grip.title + " : " + g.title);
        const lab = document.createElement("span"); lab.textContent = g.title;
        wrap.append(grip, lab);
        gtd.appendChild(wrap);
      } else {
        gtd.textContent = g.title;
      }
      gtr.appendChild(gtd); tbody.appendChild(gtr);
      g.rows.forEach((r, ri) => {
        const tr = document.createElement("tr");
        tr.dataset.gi = gi; tr.dataset.ri = ri;
        if (model.showColor && r.color) tr.style.background = tableHexToRgba(r.color, 0.10);
        const ltd = document.createElement("td"); ltd.className = "cell-label";
        ltd.textContent = r.label;
        if (r.inverted) {
          const star = document.createElement("span");
          star.className = "inv-star"; star.textContent = " *";
          star.title = T("scores.invertedTitle", "Score inversé (élevé = défavorable)");
          ltd.appendChild(star);
        }
        tr.appendChild(ltd);
        model.colDefs.forEach(([k]) => {
          const td = document.createElement("td");
          if (k === "classification") {
            td.className = "cell-classif";
            if (model.showColor && r.color) {
              const dot = document.createElement("span"); dot.className = "band-dot"; dot.style.background = r.color; td.appendChild(dot);
            }
            td.appendChild(document.createTextNode(r.classification));
          } else {
            td.textContent = r[k];
            if (k === "value" || k === "percentile") td.className = "cell-num";
          }
          tr.appendChild(td);
        });
        // Comment cell — icon mode: a bubble to click. Text mode: no bubble at
        // all; the note is spelled out and the whole cell opens the editor.
        if (model.showComments) {
          const ctd = document.createElement("td");
          const cond = findConditionById(r.conditionId);
          if (model.commentMode === "text") {
            ctd.className = "cell-comment-wide";
            const txt = document.createElement("button");
            txt.type = "button";
            txt.className = "comment-inline" + (commentIsSet(cond) ? "" : " is-empty");
            txt.textContent = commentIsSet(cond) ? cond.comment : "Ajouter…";
            txt.title = commentIsSet(cond) ? "Modifier ce commentaire" : "Ajouter un commentaire";
            if (cond) txt.addEventListener("click", (e) => {
              e.preventDefault(); e.stopPropagation();
              openCommentEditor(cond, txt, { onClose: renderTableView });
            });
            ctd.appendChild(txt);
          } else {
            ctd.className = "cell-comment";
            if (cond) ctd.appendChild(makeCommentButton(cond, { onClose: renderTableView }));
          }
          tr.appendChild(ctd);
        }
        tbody.appendChild(tr);
      });
    });
    table.appendChild(tbody);
    return table;
  }

  function renderTableView() {
    const wrap = $("vizTableWrap");
    if (!wrap || !currentProject) return;
    const s = currentProject.chartSettings;
    if (!s.tableColumns) s.tableColumns = { value: true, type: true, percentile: true, classification: true, color: true };
    if (!s.tableGroupBy) s.tableGroupBy = "test";
    wrap.innerHTML = "";

    const bar = document.createElement("div");
    bar.className = "table-toolbar";

    const grp = document.createElement("div");
    grp.className = "table-group-switch";
    [["test", T("table.byTest", "Par test")], ["function", T("table.byFunction", "Par fonction")]].forEach(([v, lab]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = lab;
      if (s.tableGroupBy === v) b.classList.add("active");
      b.addEventListener("click", () => { s.tableGroupBy = v; markDirty(); renderTableView(); });
      grp.appendChild(b);
    });
    bar.appendChild(grp);

    const colsWrap = document.createElement("div");
    colsWrap.className = "table-col-toggles";
    [["value", T("common.value", "Valeur")], ["type", T("common.type", "Type")], ["percentile", T("score.percentile", "Rang centile")], ["classification", T("table.classification", "Classification")],
     ["color", T("table.color", "Couleur")], ["comments", T("table.comments", "Commentaires")]].forEach(([k, lab]) => {
      const l = document.createElement("label"); l.className = "table-col-toggle";
      const cb = document.createElement("input"); cb.type = "checkbox";
      // Like the other columns: unticking hides the comment column entirely
      // (no icons, no text). How it is displayed is chosen in the column header.
      cb.checked = s.tableColumns[k] !== false;
      cb.addEventListener("change", () => { s.tableColumns[k] = cb.checked; markDirty(); renderTableView(); });
      l.appendChild(cb); l.appendChild(document.createTextNode(" " + lab));
      colsWrap.appendChild(l);
    });
    bar.appendChild(colsWrap);

    wrap.appendChild(bar);

    const model = buildTableModel();
    if (!model.groups.length) {
      const empty = document.createElement("p");
      empty.className = "table-empty";
      empty.textContent = T("table.empty", "Aucun score saisi pour le moment. Revenez à l'étape « Saisie des scores » pour en ajouter.");
      wrap.appendChild(empty);
      return;
    }
    const table = buildTableElement(model);
    wrap.appendChild(table);
    bindTableDrag(table, model);
    if (model.anyInverted) {
      const note = document.createElement("p");
      note.className = "table-footnote";
      note.textContent = T("scores.invertedNote", "* Score inversé (élevé = défavorable) : positionné et classé selon son écart inverse à la moyenne.");
      wrap.appendChild(note);
    }
  }

  function tableToOfficeHTML() {
    const model = buildTableModel();
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const withComment = model.showComments && !!model.anyComment;
    const totalCols = 1 + model.colDefs.length + (withComment ? 1 : 0);
    let h = '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">';
    h += '<thead><tr style="background:#1b7fb5;color:#ffffff;font-weight:bold">';
    h += '<th align="left">' + esc(model.firstHeader) + '</th>';
    model.colDefs.forEach(([, lab]) => { h += '<th align="left">' + esc(lab) + '</th>'; });
    if (withComment) h += '<th align="left">' + esc(T("comment.title", "Commentaire")) + '</th>';
    h += '</tr></thead><tbody>';
    model.groups.forEach((g) => {
      h += '<tr style="background:#e7f3fa;font-weight:bold"><td colspan="' + totalCols + '">' + esc(g.title) + '</td></tr>';
      g.rows.forEach((r) => {
        const tint = model.showColor && r.color ? ' style="background:' + tableBlendWhite(r.color, 0.14) + '"' : '';
        const star = r.inverted ? ' *' : '';
        h += '<tr' + tint + '><td>' + esc(r.label) + star + '</td>';
        model.colDefs.forEach(([k]) => {
          if (k === "classification") {
            const dot = model.showColor && r.color ? '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + r.color + ';margin-right:6px"></span>' : '';
            h += '<td>' + dot + esc(r.classification) + '</td>';
          } else {
            h += '<td>' + esc(r[k]) + '</td>';
          }
        });
        if (withComment) h += '<td>' + esc(r.comment || "") + '</td>';
        h += '</tr>';
      });
    });
    h += '</tbody></table>';
    const title = esc(currentProject.title || "Vizéa");
    const foot = model.anyInverted
      ? '<p style="font-family:Calibri,Arial,sans-serif;font-size:9pt;color:#555">' + esc(T("scores.invertedNote", "* Score inversé (élevé = défavorable) : positionné et classé selon son écart inverse à la moyenne.")) + '</p>'
      : '';
    return '<html><head><meta charset="utf-8"></head><body>' +
      '<h3 style="font-family:Calibri,Arial,sans-serif">' + title + '</h3>' + h + foot + '</body></html>';
  }

  // Convert a data: URL (e.g. a Plotly PNG) into a Blob.
  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(",");
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || "application/octet-stream";
    const bin = atob(parts[1] || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Ask the user for a filename before downloading (fallback for browsers with
  // no native "Save As" picker — Firefox/Safari). Resolves to the chosen name,
  // or null if cancelled. Reuses the app's modal styling.
  function promptFileName(suggestedName) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      const card = document.createElement("div");
      card.className = "modal-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      const h = document.createElement("h3");
      h.textContent = T("dialog.saveAs.title", "Enregistrer sous");
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = T("dialog.saveAs.desc", "Nommez le fichier avant de le télécharger. Il ira dans le dossier de téléchargement de votre navigateur.");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "modal-input";
      input.value = suggestedName;
      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const save = document.createElement("button");
      save.type = "button"; save.className = "btn-primary"; save.textContent = T("common.save", "Enregistrer");
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "btn-ghost"; cancel.textContent = T("common.cancel", "Annuler");
      let done = false;
      const onKey = (e) => {
        if (e.key === "Escape") close(null);
        else if (e.key === "Enter" && document.activeElement === input) { e.preventDefault(); confirm(); }
      };
      function close(val) { if (done) return; done = true; document.removeEventListener("keydown", onKey); overlay.remove(); resolve(val); }
      function confirm() { const v = input.value.trim(); close(v || suggestedName); }
      save.addEventListener("click", confirm);
      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
      document.addEventListener("keydown", onKey);
      actions.append(save, cancel);
      card.append(h, p, input, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      // Focus and pre-select the name (without extension) for quick renaming.
      setTimeout(() => {
        try { input.focus(); const dot = input.value.lastIndexOf("."); input.setSelectionRange(0, dot > 0 ? dot : input.value.length); } catch (e) {}
      }, 30);
    });
  }

  // Save a Blob. On browsers with the File System Access API (Chromium-based),
  // this opens a real "Save As" dialog so the user picks the folder AND the
  // filename. Elsewhere (Firefox/Safari), it asks for a filename, then downloads
  // to the browser's download folder. Resolves true if saved, false if cancelled.
  async function saveBlob(blob, suggestedName, opts) {
    opts = opts || {};
    if (window.showSaveFilePicker) {
      try {
        const options = { suggestedName };
        if (opts.accept) options.types = [{ description: opts.description || "Fichier", accept: opts.accept }];
        const handle = await window.showSaveFilePicker(options);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (e) {
        if (e && e.name === "AbortError") return false; // user cancelled the picker
        // otherwise fall through to the download fallback
      }
    }
    const name = await promptFileName(suggestedName);
    if (name === null) return false;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  }

  function exportTableExcel() {
    const blob = new Blob(["\ufeff" + tableToOfficeHTML()], { type: "application/vnd.ms-excel" });
    saveBlob(blob, tableProjBase() + ".xls", { description: "Classeur Excel", accept: { "application/vnd.ms-excel": [".xls"] } })
      .then((saved) => { if (saved) toast(T("msg.excelExported", "Tableau exporté en Excel (.xls).")); });
  }


  // In percentile mode the axis is inherently proportional to rarity, so the
  // toggle is forced on and locked (it would have no effect either way).
  function updateAxisLimitsHint() {
    const hint = $("axisLimitsHint");
    if (!hint || !currentProject) return;
    const scale = currentProject.chartSettings.displayScale || "Percentile";
    hint.textContent = T("panel.axisHintFull", "En valeurs « {scale} ». Laissez vide pour l'étendue automatique.").replace("{scale}", scoreTypeLabel(scale));
  }

  function syncProportionalLock() {
    const cb = $("opt-proportionalAxis");
    if (!cb) return;
    const label = cb.closest(".panel-toggle");
    const isScales = currentProject.chartSettings.chartType === "scales";
    const isPercentile = isScales
      ? (currentProject.chartSettings.scalesDisplay === "Percentile")
      : ((currentProject.chartSettings.displayScale || "Percentile") === "Percentile");
    if (isPercentile) {
      cb.checked = true;
      cb.disabled = true;
      currentProject.chartSettings.proportionalAxis = true;
      label && label.classList.add("is-locked");
    } else {
      cb.disabled = false;
      label && label.classList.remove("is-locked");
    }
  }

  function setupStep3Panel() {
    const s = () => currentProject.chartSettings;

    // --- Slide-out drawer behaviour ---
    const panel = $("vizPanel");
    const scrim = $("panelScrim");

    // Drag the panel's left edge to widen it temporarily — handy for reading,
    // renaming and reordering long test/scale names. The width resets to the
    // default (thin) each time the panel is opened.
    if (panel && !panel.querySelector(".viz-panel-resizer")) {
      const grip = document.createElement("div");
      grip.className = "viz-panel-resizer";
      grip.title = T("panel.dragWiden", "Glisser pour élargir");
      panel.appendChild(grip);
      let dragging = false, startX = 0, startW = 0;
      const maxW = () => Math.min(window.innerWidth * 0.92, 760);
      grip.addEventListener("pointerdown", (e) => {
        dragging = true; startX = e.clientX; startW = panel.getBoundingClientRect().width;
        panel.classList.add("resizing");
        try { grip.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      grip.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        let w = startW + (startX - e.clientX); // dragging left widens a right-docked panel
        w = Math.max(340, Math.min(maxW(), w));
        panel.style.width = w + "px";
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false; panel.classList.remove("resizing");
        try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      grip.addEventListener("pointerup", endDrag);
      grip.addEventListener("pointercancel", endDrag);
    }

    // The line/radar toggle now lives in the view switcher above the chart,
    // and the export actions live in the always-visible bar under the chart —
    // hide their duplicates inside the panel.
    (function tidyPanel() {
      const ct = $("opt-chartType");
      if (ct) { ct.style.display = "none";
        const l = ct.previousElementSibling;
        if (l && l.classList.contains("panel-label")) l.style.display = "none"; }
      // Only hide the panel's export buttons if the always-visible export bar
      // is actually present (otherwise these stay the only way to export).
      if (document.querySelector(".viz-actions")) {
        ["exportImageBtn", "saveTemplateBtn", "exportProjectBtn"].forEach((id) => {
          const b = $(id); if (b) b.style.display = "none";
        });
        const firstExp = $("exportImageBtn");
        if (firstExp) { const prev = firstExp.previousElementSibling;
          if (prev && prev.tagName === "HR") prev.style.display = "none"; }
      }
    })();

    const openPanel = () => {
      panel.style.width = "";   // always reopen at the default (thin) width
      panel.classList.add("open");
      scrim.hidden = false;
      document.body.classList.add("panel-open");
      requestAnimationFrame(() => scrim.classList.add("show"));
      $("panelToggle")?.setAttribute("aria-expanded", "true");
    };
    const closePanel = () => {
      panel.classList.remove("open");
      scrim.classList.remove("show");
      document.body.classList.remove("panel-open");
      setTimeout(() => { scrim.hidden = true; }, 250);
      $("panelToggle")?.setAttribute("aria-expanded", "false");
    };
    $("panelToggle")?.addEventListener("click", () => {
      panel.classList.contains("open") ? closePanel() : openPanel();
    });

    // Accordion: one section open at a time. The last-opened section is
    // remembered (per browser) so the panel reopens the way it was left.
    (function setupAccordion() {
      const acc = $("panelAcc");
      if (!acc) return;
      const items = Array.from(acc.querySelectorAll(".acc-item"));
      const openItem = (item) => {
        items.forEach((it) => {
          const on = it === item;
          it.classList.toggle("open", on);
          const head = it.querySelector(".acc-head");
          if (head) head.setAttribute("aria-expanded", on ? "true" : "false");
        });
        try { localStorage.setItem("vizea_panel_section", item.getAttribute("data-acc") || ""); } catch (e) { /* noop */ }
      };
      items.forEach((it) => {
        const head = it.querySelector(".acc-head");
        head?.addEventListener("click", () => {
          // Clicking the open section collapses it; otherwise switch to it.
          if (it.classList.contains("open")) {
            it.classList.remove("open");
            head.setAttribute("aria-expanded", "false");
            try { localStorage.setItem("vizea_panel_section", ""); } catch (e) { /* noop */ }
          } else openItem(it);
        });
      });
      // Restore the remembered section (default: the first, "Affichage").
      let remembered = null;
      try { remembered = localStorage.getItem("vizea_panel_section"); } catch (e) { /* noop */ }
      const target = remembered ? items.find((it) => it.getAttribute("data-acc") === remembered) : items[0];
      if (target) openItem(target); else if (items[0]) openItem(items[0]);
    })();
    $("panelClose")?.addEventListener("click", closePanel);
    scrim?.addEventListener("click", closePanel);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
    });

    $("opt-displayScale")?.addEventListener("change", (e) => {
      s().displayScale = e.target.value;
      syncProportionalLock();
      updateAxisLimitsHint();
      renderChart();
    });

    const onAxisLimit = () => {
      const minV = $("opt-axisMin").value.trim();
      const maxV = $("opt-axisMax").value.trim();
      const scales = s().chartType === "scales";
      s()[scales ? "scalesAxisMin" : "axisMin"] = minV === "" ? null : Number(minV);
      s()[scales ? "scalesAxisMax" : "axisMax"] = maxV === "" ? null : Number(maxV);
      renderChartDebounced();
    };
    $("opt-axisMin")?.addEventListener("input", onAxisLimit);
    $("opt-axisMax")?.addEventListener("input", onAxisLimit);

    $$("#opt-chartType button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#opt-chartType button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        s().chartType = btn.dataset.type;
        updatePanelModeVisibility(btn.dataset.type);
        if (typeof syncViewSwitch === "function") syncViewSwitch();
        renderChart();
      });
    });

    $("opt-showBands")?.addEventListener("change", (e) => {
      s().showBands = e.target.checked;
      syncBandOptionsVisibility();
      renderChart();
    });
    $("opt-showBandLabels")?.addEventListener("change", (e) => { s().showBandLabels = e.target.checked; renderChart(); });
    $("opt-fontScale")?.addEventListener("input", (e) => {
      const pct = Number(e.target.value);
      s().fontScale = pct / 100;
      const out = $("fontScaleValue");
      if (out) out.textContent = pct + " %";
      renderChartLive();
    });
    $("opt-bandOpacity")?.addEventListener("input", (e) => {
      const pct = Number(e.target.value);
      s().bandOpacity = pct / 100;
      const out = $("bandOpacityValue");
      if (out) out.textContent = pct + " %";
      renderChartLive();
    });
    $("bandLabelsReset")?.addEventListener("click", () => {
      s().bandLabels = {};
      buildBandLabelList();
      markDirty();
      renderChart();
    });
    $("opt-proportionalAxis")?.addEventListener("change", (e) => { s().proportionalAxis = e.target.checked; renderChart(); });
    $("opt-showTestLabels")?.addEventListener("change", (e) => { s().showTestLabels = e.target.checked; renderChart(); });
    $("opt-showDataLabels")?.addEventListener("change", (e) => { s().showDataLabels = e.target.checked; renderChart(); });
    $("opt-radarFill")?.addEventListener("change", (e) => { s().radarFill = e.target.checked; renderChart(); });
    $("opt-radarColor")?.addEventListener("input", (e) => { s().radarColor = e.target.value; renderChartDebounced(); });

    // Comparison guide line
    const compareHandler = (e) => { s().compareValue = e.target.value; checkCompareRange(); renderChartDebounced(); };
    $("opt-compareValue")?.addEventListener("input", compareHandler);
    $("opt-compareValue")?.addEventListener("change", compareHandler);
    $("opt-compareType")?.addEventListener("change", (e) => { s().compareType = e.target.value; checkCompareRange(); renderChart(); });
    $("opt-compareLabel")?.addEventListener("input", (e) => { s().compareLabel = e.target.value; renderChartDebounced(); });

    // Inject the "Utiliser le score à l'EGQI" option at the top of the comparison block.
    (function injectEgqiOption() {
      const block = document.querySelector(".compare-block");
      if (!block || $("opt-useEgqi")) return;
      const wrap = document.createElement("label");
      wrap.className = "panel-toggle egqi-toggle";
      wrap.innerHTML = '<input type="checkbox" id="opt-useEgqi"><span data-i18n="scales.useEgqi">Utiliser le score à l\'EGQI</span>';
      const hint = document.createElement("p");
      hint.id = "opt-useEgqiHint"; hint.className = "fn-subhint";
      hint.setAttribute("data-i18n","scales.egqiHint"); hint.textContent = T("scales.egqiHint", "Entrez une valeur à l'EGQI (test Wechsler) pour l'activer.");
      // Place both at the very top of the block (the section title is now the
      // accordion header, so we no longer rely on an in-block .panel-label).
      block.insertBefore(hint, block.firstChild);
      block.insertBefore(wrap, block.firstChild);
      $("opt-useEgqi").addEventListener("change", (e) => {
        s().useEgqiCompare = e.target.checked;
        applyEgqiCompare();
        checkCompareRange();
        renderChart();
      });
    })();

    $("clearCompareBtn")?.addEventListener("click", () => {
      s().compareValue = "";
      $("opt-compareValue").value = "";
      renderChart();
    });
    $("opt-title")?.addEventListener("input", (e) => {
      const raw = e.target.value;
      const scalesMode = s().chartType === "scales";
      // If the field still shows the (localized) default, keep the canonical
      // French value stored so the title stays language-neutral.
      const canonical = scalesMode ? DEFAULT_SCALES_TITLE_FR : DEFAULT_TITLE_FR;
      const toStore = (raw === localizedTitleView(canonical)) ? canonical : raw;
      if (scalesMode) s().scalesTitle = toStore; else s().title = toStore;
      renderChartDebounced();
    });

    // Inject the échelles-only controls (line colour + which scales to show).
    // Échelles display scale — placed right after the profile's "Échelle affichée"
    // so the control order stays the same across all views.
    (function injectScalesDisplay() {
      if ($("opt-scalesDisplay")) return;
      const ds = $("opt-displayScale");
      if (!ds) return;
      const wrap = document.createElement("div");
      wrap.id = "scalesDisplayWrap";
      wrap.style.display = "none";
      wrap.innerHTML =
        '<label class="panel-label" for="opt-scalesDisplay" data-i18n="panel.displayScale">Échelle affichée</label>' +
        '<select id="opt-scalesDisplay" class="condition-type">' +
        '<option value="Standard score" data-i18n="score.standard">Score standard</option>' +
        '<option value="Percentile" data-i18n="score.percentile">Rang centile</option></select>';
      // Insert just after the profile display-scale select (and its label).
      ds.after(wrap);
      if (window.VizeaI18n) window.VizeaI18n.applyTranslations(wrap);
      $("opt-scalesDisplay").addEventListener("change", (e) => {
        s().scalesDisplay = e.target.value;
        syncProportionalLock();
        renderChart();
      });
    })();

    (function injectScalesExtras() {
      if ($("scalesExtras")) return;
      // Line colour + which-scales list belong with the other content/colour
      // controls, so they live in the "Contenu et couleurs" section (shown in
      // the scales view). The scales *display scale* stays in "Affichage".
      const host = document.querySelector('[data-acc="contenu"] .acc-panel');
      if (!host) return;
      const box = document.createElement("div");
      box.id = "scalesExtras";
      box.style.display = "none";
      box.innerHTML =
        '<label class="panel-label" for="opt-scalesColor" data-i18n="panel.scalesColor">Couleur de la ligne</label>' +
        '<input type="color" id="opt-scalesColor" class="color-input">' +
        '<label class="panel-label" style="margin-top:14px;" data-i18n="panel.scalesShown">Échelles affichées</label>' +
        '<div id="opt-scalesVisible" class="fn-list"></div>';
      host.appendChild(box);
      if (window.VizeaI18n) window.VizeaI18n.applyTranslations(box);
      $("opt-scalesColor").addEventListener("input", (e) => { s().scalesColor = e.target.value; renderChartDebounced(); });
    })();

    $("exportImageBtn")?.addEventListener("click", () => {
      const el = $("vizPlot");
      if (!el || !window.Plotly || !window.VizeaChart) return;
      // Always export light: white background + dark, legible text, even when the
      // app is in dark mode. We re-render the chart with the light theme forced
      // (page theme untouched), grab the PNG, restore the on-screen chart, then
      // let the user choose where to save it / rename it.
      const finish = () => {
        window.VizeaChart.setForceLight(false);
        drawChartWithComments();
      };
      window.VizeaChart.setForceLight(true);
      Promise.resolve(window.VizeaChart.renderChart(chartProject(), "vizPlot"))
        .then(() => window.Plotly.relayout(el, { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" }))
        .then(() => window.Plotly.toImage(el, { format: "png", scale: 2, width: 1400, height: 800 }))
        .then((dataUrl) => {
          finish(); // restore the on-screen chart right away
          return saveBlob(dataUrlToBlob(dataUrl), tableProjBase() + ".png", { description: "Image PNG", accept: { "image/png": [".png"] } });
        })
        .then((saved) => { if (saved) toast(T("msg.imageExported", "Image exportée (PNG).")); })
        .catch(() => finish());
    });

    $("saveTemplateBtn")?.addEventListener("click", () => {
      const name = prompt(T("dialog.template.prompt", "Nom du modèle (sélection de tests + préférences, sans aucun score) :"),
        currentProject.title || "Mon modèle");
      if (!name) return;
      const tmpl = DM.extractTemplateFromProject(currentProject, name);
      if (!DM.saveLocalTemplate(tmpl)) { toast(T("msg.templateFailed", "Le modèle n'a pas pu être enregistré (stockage du navigateur plein ou bloqué).")); return; }
      refreshTemplateSelect();
      toast(T("msg.templateSaved", "Modèle enregistré (sans données cliniques)."));
    });

    $("exportProjectBtn")?.addEventListener("click", () => exportCurrentProject());

    // Visible export-bar buttons under the chart proxy to the panel's export
    // actions. (Replaces the former inline onclick="" handlers so the page needs
    // no inline scripts — required for the strict Content-Security-Policy.)
    $("vaImageBtn")?.addEventListener("click", () => $("exportImageBtn")?.click());
    $("vaExcelBtn")?.addEventListener("click", () => exportTableExcel());
    $("vaTemplateBtn")?.addEventListener("click", () => $("saveTemplateBtn")?.click());
    $("vaProjectBtn")?.addEventListener("click", () => $("exportProjectBtn")?.click());
  }

  function exportCurrentProject() {
    if (!currentProject) return Promise.resolve(false);
    const json = DM.exportProjectToJSON(currentProject);
    const blob = new Blob([json], { type: "application/json" });
    return saveBlob(blob, tableProjBase() + ".vizea", { description: "Projet Vizéa", accept: { "application/vizea+json": [".vizea"] } })
      .then((saved) => {
        if (saved) { dirty = false; toast(T("msg.projectExported", "Projet exporté.")); }
        return saved;
      });
  }

  // Generic drag-to-reorder for `.fn-row` items inside a container. Calls
  // onReorder() after a drop so callers can persist the new order.
  function enableRowDrag(container, onReorder) {
    let dragEl = null;

    const getAfter = (y) => {
      const els = Array.from(container.querySelectorAll(".fn-row:not(.dragging)"));
      let closest = { offset: -Infinity, el: null };
      els.forEach((child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
      });
      return closest.el;
    };

    container.querySelectorAll(".fn-row").forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        dragEl = row; row.classList.add("dragging");
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", row.dataset.fn || ""); } catch (_) {} }
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        dragEl = null;
        onReorder();
      });
    });

    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragEl) return;
      const after = getAfter(e.clientY);
      if (after == null) container.appendChild(dragEl);
      else container.insertBefore(dragEl, after);
    });
  }

  // Build the per-project controls (function visibility + colors) each time
  // we enter step 3, since they depend on which functions are present.
  // Band options (labels + colour intensity) only make sense when the bands are
  // actually drawn — i.e. shown, and on a view that draws them (not radar/table).
  function syncBandOptionsVisibility() {
    const wrap = $("bandOptions");
    if (!wrap) return;
    const s = currentProject?.chartSettings || {};
    const type = s.chartType || "line";
    const drawsBands = type === "line" || type === "scales";
    wrap.style.display = (drawsBands && s.showBands !== false) ? "" : "none";
  }

  // Editable band display names. Renaming is display-only: classification and
  // colours stay keyed by the band's real identity.
  function buildBandLabelList() {
    const list = $("bandLabelList");
    if (!list || !window.ScoringEngine) return;
    const settings = currentProject.chartSettings;
    if (!settings.bandLabels) settings.bandLabels = {};
    list.innerHTML = "";
    // Highest band first, matching how they read on the chart (top to bottom).
    const bands = window.ScoringEngine.CLASSIFICATION_BANDS.slice().reverse();
    bands.forEach((b) => {
      const row = document.createElement("div");
      row.className = "band-row";

      const base = bandFieldDisplay(b.key, "short", b.short || b.label);   // default display name in the current language
      const fullName = bandFieldDisplay(b.key, "label", b.label);

      const swatch = document.createElement("span");
      swatch.className = "band-swatch";
      swatch.style.background = b.color;
      swatch.title = fullName;            // full classification name as tooltip

      const input = document.createElement("input");
      input.type = "text";
      input.className = "band-rename-input";
      input.value = settings.bandLabels[b.key] || base;
      input.title = fullName + " — " + T("panel.renameHint", "renommer pour l'affichage (n'affecte pas la classification)");
      input.addEventListener("focus", () => input.select());
      input.addEventListener("blur", () => {
        if (!settings.bandLabels[b.key]) input.value = base;
      });
      input.addEventListener("input", () => {
        const v = input.value.trim();
        // Empty, or equal to the default in either language = no override.
        if (!v || v === base || v === b.short || v === b.label) delete settings.bandLabels[b.key];
        else settings.bandLabels[b.key] = v;
        markDirty();
        renderChartDebounced();
      });

      row.append(swatch, input);
      list.appendChild(row);
    });
  }

  function buildPanelDynamicControls() {
    const settings = currentProject.chartSettings;
    // sync static controls to settings
    $("opt-displayScale").value = settings.displayScale;
    $("opt-showBands").checked = settings.showBands !== false;
    if ($("opt-showBandLabels")) $("opt-showBandLabels").checked = !!settings.showBandLabels;
    if ($("opt-bandOpacity")) {
      const pct = Math.round(((settings.bandOpacity ?? 0.13)) * 100);
      $("opt-bandOpacity").value = String(Math.max(3, Math.min(45, pct)));
      const out = $("bandOpacityValue");
      if (out) out.textContent = $("opt-bandOpacity").value + " %";
    }
    if ($("opt-fontScale")) {
      const fpct = Math.round((settings.fontScale ?? 1) * 100);
      $("opt-fontScale").value = String(Math.max(75, Math.min(160, fpct)));
      const fout = $("fontScaleValue");
      if (fout) fout.textContent = $("opt-fontScale").value + " %";
    }
    buildBandLabelList();
    syncBandOptionsVisibility();
    if ($("opt-proportionalAxis")) $("opt-proportionalAxis").checked = settings.proportionalAxis !== false;
    syncProportionalLock();
    $("opt-showTestLabels").checked = settings.showTestLabels !== false;
    $("opt-showDataLabels").checked = !!settings.showDataLabels;
    if ($("opt-radarFill")) $("opt-radarFill").checked = settings.radarFill !== false;
    if ($("opt-radarColor")) $("opt-radarColor").value = toHex(settings.radarColor || "#176bb5");
    if ($("opt-compareValue")) $("opt-compareValue").value = settings.compareValue ?? "";
    if ($("opt-compareType")) $("opt-compareType").value = settings.compareType || "Standard score";
    if ($("opt-compareLabel")) $("opt-compareLabel").value = settings.compareLabel ?? "";
    const isScales = (settings.chartType || "line") === "scales";
    if ($("opt-axisMin")) { const v = isScales ? settings.scalesAxisMin : settings.axisMin; $("opt-axisMin").value = (v ?? "") === null ? "" : (v ?? ""); }
    if ($("opt-axisMax")) { const v = isScales ? settings.scalesAxisMax : settings.axisMax; $("opt-axisMax").value = (v ?? "") === null ? "" : (v ?? ""); }
    if ($("opt-scalesColor")) $("opt-scalesColor").value = toHex(settings.scalesColor || "#1b7fb5");
    if ($("opt-scalesDisplay")) $("opt-scalesDisplay").value = settings.scalesDisplay || "Standard score";
    updateAxisLimitsHint();
    updatePanelModeVisibility(settings.chartType || "line");
    $("opt-title").value = localizedTitleView(isScales ? (settings.scalesTitle || "") : (settings.title || ""));
    $$("#opt-chartType button").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === (settings.chartType || "line")));

    // Determine which functions are actually present in the data
    const points = DM.flattenScores(currentProject);
    const present = [];
    allFunctions().forEach((fn) => {
      if (points.some((p) => p.func === fn)) present.push(fn);
    });

    // Order present functions by the saved display order (drag-to-reorder),
    // then canonical order — so the panel list mirrors the chart.
    const orderPref = (settings.functionOrder || []).concat(COGNITIVE_FUNCTIONS);
    const orderedPresent = [];
    const seenFn = new Set();
    orderPref.forEach((f) => { if (present.includes(f) && !seenFn.has(f)) { orderedPresent.push(f); seenFn.add(f); } });
    present.forEach((f) => { if (!seenFn.has(f)) orderedPresent.push(f); });

    // Function list: drag to reorder, checkbox to show/hide.
    const fnList = $("opt-functions");
    fnList.innerHTML = "";
    if (orderedPresent.length === 0) {
      fnList.innerHTML = '<p class="muted small">' + T("panel.noFunctions", "Aucune fonction à afficher.") + '</p>';
    }
    orderedPresent.forEach((fn) => {
      const row = document.createElement("div");
      row.className = "fn-row";
      row.draggable = true;
      row.dataset.fn = fn;

      const handle = document.createElement("span");
      handle.className = "fn-drag";
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⠿";
      handle.title = T("panel.dragReorder", "Glisser pour réordonner");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !settings.visibleFunctions || settings.visibleFunctions.includes(fn);
      cb.addEventListener("change", () => {
        const checked = Array.from(fnList.querySelectorAll('.fn-row input[type="checkbox"]:checked'))
          .map((i) => i.closest(".fn-row").dataset.fn);
        settings.visibleFunctions = checked.length === orderedPresent.length ? null : checked;
        renderChart();
      });

      // Editable display name: renames the function in the chart only. Identity
      // (grouping, colour, score links) stays keyed by the real name `fn`.
      if (!settings.functionLabels) settings.functionLabels = {};
      const fnDef = funcDisplay(fn);   // default display name in the current language
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "fn-rename";
      nameInput.value = settings.functionLabels[fn] || fnDef;
      nameInput.title = T("panel.fnRenameHint", "Renommer pour l'affichage (n'affecte pas les scores ni le regroupement)");
      nameInput.addEventListener("focus", () => { row.draggable = false; nameInput.select(); });
      nameInput.addEventListener("blur", () => {
        row.draggable = true;
        if (!settings.functionLabels[fn]) nameInput.value = fnDef;
      });
      nameInput.addEventListener("input", () => {
        const v = nameInput.value.trim();
        // Empty or equal to the language default = no override.
        if (!v || v === fnDef || v === fn) delete settings.functionLabels[fn];
        else settings.functionLabels[fn] = v;
        markDirty();
        renderChartDebounced();
      });

      row.append(handle, cb, nameInput);
      fnList.appendChild(row);
    });

    enableRowDrag(fnList, () => {
      const order = Array.from(fnList.querySelectorAll(".fn-row")).map((r) => r.dataset.fn);
      // Keep any previously-ordered functions that aren't currently present,
      // so hidden/absent functions don't lose their relative position.
      const extras = (settings.functionOrder || []).filter((f) => !order.includes(f));
      settings.functionOrder = order.concat(extras);
      renderChart();
    });

    // Color pickers
    const colorList = $("opt-colors");
    colorList.innerHTML = "";
    orderedPresent.forEach((fn) => {
      const rowEl = document.createElement("div");
      rowEl.className = "color-row";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = toHex(settings.functionColors[fn] || DEFAULT_FUNCTION_COLORS[fn] || "#176bb5");
      picker.addEventListener("input", () => {
        settings.functionColors[fn] = picker.value;
        renderChartDebounced();
      });
      const span = document.createElement("span");
      span.textContent = fn;
      rowEl.append(picker, span);
      colorList.appendChild(rowEl);
    });

    buildPointControls(settings, orderedPresent);
  }

  // View-only per-test controls: hide/show, rename, and drag-reorder. None of
  // this touches the underlying project data — only chartSettings (what's shown).
  function buildPointControls(settings, orderedPresent) {
    const list = $("opt-points");
    if (!list) return;
    list.innerHTML = "";
    if (!settings.pointOverrides) settings.pointOverrides = {};
    if (!Array.isArray(settings.pointOrder)) settings.pointOrder = [];

    const allPoints = DM.flattenScores(currentProject);
    if (!allPoints.length) {
      list.innerHTML = '<p class="muted small">' + T("panel.noTests", "Aucun test à afficher.") + '</p>';
      return;
    }

    // Order points to match the chart: by function display order, then by the
    // saved per-point order within each function.
    const orderIndex = {};
    settings.pointOrder.forEach((pid, i) => { orderIndex[pid] = i; });
    const fnRank = {};
    orderedPresent.forEach((fn, i) => { fnRank[fn] = i; });
    const sorted = allPoints.slice().sort((a, b) => {
      const fa = (a.func in fnRank) ? fnRank[a.func] : 999;
      const fb = (b.func in fnRank) ? fnRank[b.func] : 999;
      if (fa !== fb) return fa - fb;
      const ia = (a.pid in orderIndex) ? orderIndex[a.pid] : Infinity;
      const ib = (b.pid in orderIndex) ? orderIndex[b.pid] : Infinity;
      return ia - ib;
    });

    sorted.forEach((p) => {
      const ov = settings.pointOverrides[p.pid] || {};
      const row = document.createElement("div");
      row.className = "fn-row point-row";
      row.draggable = true;
      row.dataset.pid = p.pid;

      const handle = document.createElement("span");
      handle.className = "fn-drag";
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⠿";
      handle.title = T("panel.dragReorder", "Glisser pour réordonner");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !ov.hidden;
      cb.title = "Afficher / masquer";
      cb.addEventListener("change", () => {
        const o = settings.pointOverrides[p.pid] || {};
        o.hidden = !cb.checked;
        settings.pointOverrides[p.pid] = o;
        nameInput.disabled = !cb.checked;
        row.classList.toggle("is-hidden", !cb.checked);
        renderChart();
      });

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "point-rename";
      nameInput.value = ov.label || p.label;
      nameInput.title = "Renommer (affichage seulement)";
      nameInput.disabled = !!ov.hidden;
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      nameInput.addEventListener("mousedown", (e) => e.stopPropagation());
      nameInput.addEventListener("focus", () => { row.draggable = false; });
      nameInput.addEventListener("blur", () => { row.draggable = true; });
      nameInput.addEventListener("input", () => {
        const o = settings.pointOverrides[p.pid] || {};
        const v = nameInput.value.trim();
        // Empty or same-as-original => no override label (keep storage clean)
        if (!v || v === p.label) delete o.label; else o.label = v;
        settings.pointOverrides[p.pid] = o;
        renderChartDebounced();
      });

      const fnTag = document.createElement("span");
      fnTag.className = "point-fn";
      fnTag.textContent = p.func;

      row.append(handle, cb, nameInput, fnTag);
      if (ov.hidden) row.classList.add("is-hidden");
      list.appendChild(row);
    });

    enableRowDrag(list, () => {
      const order = Array.from(list.querySelectorAll(".point-row")).map((r) => r.dataset.pid);
      settings.pointOrder = order;
      renderChart();
    });
  }

  function toHex(c) {
    // color inputs require #rrggbb; pass through if already valid, else default
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    return "#176bb5";
  }

  // Show a soft warning when the comparison value is unusual for its type.
  function checkCompareRange() {
    const warn = $("compareWarn");
    const input = $("opt-compareValue");
    if (!warn || !input) return;
    const bounds = {
      "Percentile":     { min: 0,   max: 100 },
      "Scale score":    { min: 1,   max: 19 },
      "Standard score": { min: 40,  max: 160 },
      "Z-Score":        { min: -4,  max: 4 },
      "T-Score":        { min: 10,  max: 90 }
    };
    const type = currentProject.chartSettings.compareType || "Standard score";
    const b = bounds[type] || bounds["Standard score"];
    const v = input.value;
    if (v === "" || isNaN(Number(v))) { warn.style.display = "none"; input.classList.remove("invalid"); return; }
    const n = Number(v);
    if (n < b.min || n > b.max) {
      input.classList.add("invalid");
      warn.querySelector("span").textContent =
        T("scores.warnUnusualShort", "Valeur inhabituelle pour un {type} (plage attendue : {min} à {max}).").replace("{type}", scoreTypeLabel(type).toLowerCase()).replace("{min}", b.min).replace("{max}", b.max);
      warn.style.display = "flex";
    } else {
      input.classList.remove("invalid");
      warn.style.display = "none";
    }
  }

  // Show controls tagged data-only="line" only in line mode, and
  // data-only="radar" only in radar mode.
  // Populate the "Échelles affichées" list from the active battery's scales.
  function renderScalesVisibilityControls() {
    const host = $("opt-scalesVisible");
    if (!host || !currentProject) return;
    const t = currentProject.activeScaleTest;
    const allRows = (t && currentProject.iqScales && currentProject.iqScales[t]) || [];
    const settings = currentProject.chartSettings;
    if (!Array.isArray(settings.hiddenScales)) settings.hiddenScales = [];
    if (!settings.scaleLabels) settings.scaleLabels = {};
    if (!Array.isArray(settings.scaleOrder)) settings.scaleOrder = [];
    host.innerHTML = "";

    // Unique scales that actually have a value, in entry order.
    const seen = new Set();
    const names = [];
    allRows.forEach((r) => {
      const name = r.name;
      const hasVal = r.value !== "" && r.value !== null && r.value !== undefined && !isNaN(Number(r.value));
      if (!name || !hasVal || seen.has(name)) return;
      seen.add(name); names.push(name);
    });
    if (!names.length) { host.innerHTML = '<p class="fn-subhint">' + T("panel.noScales", "Aucune échelle saisie.") + '</p>'; return; }

    // Apply the saved display order (drag-to-reorder), then entry order.
    const ordered = [];
    (settings.scaleOrder || []).forEach((n) => { if (seen.has(n) && !ordered.includes(n)) ordered.push(n); });
    names.forEach((n) => { if (!ordered.includes(n)) ordered.push(n); });

    ordered.forEach((name) => {
      const row = document.createElement("div");
      row.className = "fn-row";
      row.draggable = true;
      row.dataset.scale = name;

      const handle = document.createElement("span");
      handle.className = "fn-drag";
      handle.setAttribute("aria-hidden", "true");
      handle.textContent = "⠿";
      handle.title = T("panel.dragReorder", "Glisser pour réordonner");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !settings.hiddenScales.includes(name);
      cb.addEventListener("change", () => {
        const i = settings.hiddenScales.indexOf(name);
        if (cb.checked) { if (i >= 0) settings.hiddenScales.splice(i, 1); }
        else if (i < 0) settings.hiddenScales.push(name);
        renderChart();
      });

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "fn-rename";
      nameInput.value = settings.scaleLabels[name] || name;
      nameInput.title = "Renommer pour l'affichage (n'affecte pas la valeur saisie)";
      nameInput.addEventListener("focus", () => { row.draggable = false; nameInput.select(); });
      nameInput.addEventListener("blur", () => { row.draggable = true; if (!settings.scaleLabels[name]) nameInput.value = name; });
      nameInput.addEventListener("input", () => {
        const v = nameInput.value.trim();
        if (!v || v === name) delete settings.scaleLabels[name];
        else settings.scaleLabels[name] = v;
        markDirty();
        renderChartDebounced();
      });

      row.append(handle, cb, nameInput);
      host.appendChild(row);
    });

    enableRowDrag(host, () => {
      const order = Array.from(host.querySelectorAll(".fn-row")).map((r) => r.dataset.scale);
      const extras = (settings.scaleOrder || []).filter((n) => !order.includes(n));
      settings.scaleOrder = order.concat(extras);
      markDirty();
      renderChart();
    });
  }

  function updatePanelModeVisibility(chartType) {
    const isScales = chartType === "scales";
    // data-only may list several modes ("line scales"): show if the current
    // mode is among them.
    document.querySelectorAll('[data-only]').forEach((el) => {
      const modes = el.getAttribute("data-only").split(/\s+/);
      el.style.display = modes.indexOf(chartType) !== -1 ? "" : "none";
    });
    const grp = (id) => { const e = $(id); return e ? e.closest(".panel-toggle") : null; };
    const setVis = (el, show) => { if (el) el.style.display = show ? "" : "none"; };
    const ds = $("opt-displayScale");
    const dsLabel = ds && ds.previousElementSibling && ds.previousElementSibling.classList.contains("panel-label")
      ? ds.previousElementSibling : null;
    const compareBlock = document.querySelector(".compare-block");
    const axisLimits = document.querySelector(".axis-limits");
    const scalesExtras = $("scalesExtras");
    const scalesDisplayWrap = $("scalesDisplayWrap");
    // The "Fonctions affichées" block isn't tagged data-only, so hide it manually
    // in the scales view (no cognitive functions are shown there).
    const fnList = $("opt-functions");
    const fnHint = fnList && fnList.previousElementSibling;
    const fnLabel = fnHint && fnHint.previousElementSibling;
    if (isScales) {
      // Échelles view: bands, proportional, data labels, axis limits, title — like the profile.
      setVis(grp("opt-showBands"), true);
      setVis(grp("opt-proportionalAxis"), true);
      setVis(axisLimits, true);
      // No display scale (fixed standard-score) and no comparison line here.
      setVis(ds, false); setVis(dsLabel, false);
      setVis(scalesDisplayWrap, true);
      setVis(compareBlock, false);
      setVis(fnList, false); setVis(fnHint, false);
      if (fnLabel && fnLabel.classList.contains("panel-label")) setVis(fnLabel, false);
      setVis(scalesExtras, true);
      renderScalesVisibilityControls();
    } else {
      setVis(ds, true); setVis(dsLabel, true);
      setVis(scalesDisplayWrap, false);
      setVis(grp("opt-proportionalAxis"), true);
      setVis(compareBlock, true);
      setVis(fnList, true); setVis(fnHint, true);
      if (fnLabel && fnLabel.classList.contains("panel-label")) setVis(fnLabel, true);
      setVis(scalesExtras, false);
    }
    // Band options follow the bands themselves (hidden on radar/table).
    syncBandOptionsVisibility();

    // If the currently open accordion section is hidden in this mode, open the
    // first still-visible one so the panel never looks empty.
    const acc = $("panelAcc");
    if (acc) {
      const visible = Array.from(acc.querySelectorAll(".acc-item")).filter((it) => it.style.display !== "none");
      const openVisible = visible.some((it) => it.classList.contains("open"));
      if (!openVisible && visible.length) {
        acc.querySelectorAll(".acc-item").forEach((it) => {
          it.classList.remove("open");
          it.querySelector(".acc-head")?.setAttribute("aria-expanded", "false");
        });
        visible[0].classList.add("open");
        visible[0].querySelector(".acc-head")?.setAttribute("aria-expanded", "true");
      }
    }
  }

  // =========================================================================
  // SUGGESTIONS — sent to a Google Apps Script endpoint that appends each
  // suggestion as a row in a Google Sheet. No backend, no Supabase, no emails:
  // suggestions simply accumulate in a sheet the owner consults when they wish.
  //
  // SETUP: paste google-apps-script.gs into your Sheet's Apps Script editor,
  // deploy it as a Web App ("Anyone" access), and paste the /exec URL below.
  // Until a real URL is set, the form shows a friendly "not configured" notice.
  // =========================================================================
  const SUGGESTIONS_ENDPOINT = "https://script.google.com/macros/s/AKfycbyUpNdf5yde07qLSBI6zTxQPWg6_uPl1Hmh7WWhjQGb1mo5i3_4wx4unOhlL71B8xJg_w/exec";

  // Special "battery" option (not a cognitive-function key). Kept as data in the
  // submitted suggestion; only its displayed label is translated. The 13
  // functions use funcDisplay (language-aware via the display layer).
  var SUGGEST_BATTERY = "Batterie évaluant plusieurs fonctions";
  function renderSuggestFunctions() {
    const fnDiv = $("functions");
    if (!fnDiv) return;
    // Keep any current selections across a re-render (e.g. on language change).
    const checked = new Set($$('input[name="functions"]:checked').map((cb) => cb.value));
    fnDiv.innerHTML = "";
    [SUGGEST_BATTERY, ...COGNITIVE_FUNCTIONS].forEach((fn) => {
      const lab = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "functions";
      cb.value = fn;
      if (checked.has(fn)) cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(fn === SUGGEST_BATTERY ? T("suggest.battery", fn) : funcDisplay(fn)));
      fnDiv.appendChild(lab);
    });
  }

  // Spreadsheet-safe text: a value starting with = + - @ would run as a formula
  // in Google Sheets (formula injection). The server script also guards this.
  function sheetSafe(v, max) {
    const t = String(v || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
    return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
  }
  const SUGGEST_COOLDOWN_MS = 60 * 1000;
  const SUGGEST_LAST_KEY = "vizea_suggest_last";

  function setupSuggestForm() {
    renderSuggestFunctions();
    const form = $("suggestForm");
    if (!form) return;
    const fieldErr = (inputEl, wrapEl, show) => {
      (wrapEl || inputEl.closest(".f-field")).classList.toggle("has-error", show);
      if (inputEl) inputEl.setAttribute("aria-invalid", show ? "true" : "false");
    };
    // Clear a field's error as soon as it is corrected.
    $("testName")?.addEventListener("input", (e) => fieldErr(e.target, null, false));
    $("contactEmail")?.addEventListener("input", (e) => fieldErr(e.target, null, false));
    $("functions")?.addEventListener("change", () => $("functions").closest(".f-field").classList.remove("has-error"));
    $("suggestAgain")?.addEventListener("click", () => {
      $("suggestSuccess").hidden = true; form.classList.remove("is-done"); $("testName")?.focus();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameEl = $("testName"), emailEl = $("contactEmail");
      const testName = nameEl.value.trim();
      const selected = $$('input[name="functions"]:checked').map((cb) => cb.value);
      const email = emailEl.value.trim();
      const err = $("suggestError");
      err.hidden = true;

      const badName = !testName;
      const badFn = selected.length === 0;
      const badEmail = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      fieldErr(nameEl, null, badName);
      $("functions").closest(".f-field").classList.toggle("has-error", badFn);
      fieldErr(emailEl, null, badEmail);
      if (badName || badFn || badEmail) {
        (badName ? nameEl : badFn ? $("functions").querySelector("input") : emailEl)?.focus();
        return;
      }
      // Bots fill the hidden field: pretend success, send nothing.
      if ($("website") && $("website").value) { form.classList.add("is-done"); $("suggestSuccess").hidden = false; return; }
      // Gentle rate limit: one suggestion per minute from this browser.
      let last = 0;
      try { last = +localStorage.getItem(SUGGEST_LAST_KEY) || 0; } catch (x) {}
      if (Date.now() - last < SUGGEST_COOLDOWN_MS) {
        err.textContent = T("suggest.wait", "Une suggestion vient d'être envoyée. Patientez une minute avant d'en envoyer une autre.");
        err.hidden = false;
        return;
      }

      const btn = $("suggestSend");
      const label = btn.querySelector("span");
      const payload = {
        test_name: sheetSafe(testName, 200),
        cognitive_functions: selected.map((f) => sheetSafe(f, 80)),
        description: sheetSafe($("description").value, 2000),
        contact_name: sheetSafe($("contactName").value, 120),
        contact_email: sheetSafe(email, 200),
        lang: (window.VizeaI18n && window.VizeaI18n.getLang()) || "fr"
      };
      try {
        btn.disabled = true;
        form.setAttribute("aria-busy", "true");
        if (label) label.textContent = T("suggest.sending", "Envoi…");
        // Apps Script Web Apps don't return CORS headers: "simple" request + no-cors.
        await fetch(SUGGESTIONS_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });
        try { localStorage.setItem(SUGGEST_LAST_KEY, String(Date.now())); } catch (x) {}
        form.reset();
        form.classList.add("is-done");
        $("suggestSuccess").hidden = false;
      } catch (x) {
        console.warn("suggestion send failed", x);
        err.textContent = T("suggest.error", "Erreur lors de l'envoi. Vérifiez votre connexion et réessayez.");
        err.hidden = false;
      } finally {
        btn.disabled = false;
        form.removeAttribute("aria-busy");
        if (label) label.textContent = T("suggest.send", "Envoyer la suggestion");
      }
    });
  }

  // =========================================================================
  // DONATE (PayPal) — lazy, never blocks the rest of the app
  // =========================================================================
  let paypalInitStarted = false;

  // Returns the chosen amount, or null when the custom amount is invalid
  // (never silently charge a different amount than the one typed).
  function getDonationAmount() {
    const sel = document.querySelector('input[name="donation-amount"]:checked');
    if (!sel) return 10;
    if (sel.value === "autre") {
      const v = Math.round(parseFloat($("customAmount")?.value));
      return (isFinite(v) && v >= 1 && v <= 1000) ? v : null;
    }
    return parseFloat(sel.value);
  }
  function syncDonateAmount(showError) {
    const isCustom = document.querySelector('input[name="donation-amount"]:checked')?.value === "autre";
    const row = $("customAmountRow"), pp = $("paypal-button-container");
    if (row) row.hidden = !isCustom;
    const ok = getDonationAmount() !== null;
    row?.classList.toggle("has-error", isCustom && !ok && !!showError);
    // PayPal can't be disabled from outside: hide its buttons until the amount is valid.
    if (pp) pp.classList.toggle("is-blocked", !ok);
    return ok;
  }

  function renderPayPalButtons() {
    const container = $("paypal-button-container");
    const loading = $("paypalLoading");
    const thanks = $("donate-thanks");
    if (!container || typeof window.paypal === "undefined") return;
    if (loading) loading.style.display = "none";
    container.innerHTML = "";
    try {
      window.paypal.Buttons({
        style: { shape: "pill", color: "gold", layout: "vertical", label: "donate" },
        createOrder: (data, actions) => {
          const amount = getDonationAmount();
          if (amount === null) { syncDonateAmount(true); return Promise.reject(new Error("invalid amount")); }
          return actions.order.create({ purchase_units: [{ amount: { currency_code: "CAD", value: amount.toFixed(2) } }] });
        },
        onApprove: (data, actions) =>
          actions.order.capture().then(() => { if (thanks) thanks.style.display = "flex"; })
      }).render("#paypal-button-container");
    } catch (e) {
      console.warn("PayPal render failed", e);
      if (loading) { loading.textContent = T("donate.failed", "Le module de paiement n'a pas pu se charger (bloqué ou hors-ligne)."); loading.style.display = "block"; }
    }
  }

  // Reloads the PayPal SDK in the new language so the donate button follows it.
  function reloadPayPalForLang() {
    if (!paypalInitStarted) return;                    // never loaded yet: nothing to do
    const old = document.getElementById("paypal-sdk");
    if (old) old.remove();
    try { delete window.paypal; } catch (e) { window.paypal = undefined; }
    paypalInitStarted = false;
    const container = $("paypal-button-container");
    if (container) container.innerHTML = "";
    // Reload only if the donate page is currently visible.
    const donate = $("page-donate");
    if (donate && donate.classList.contains("active")) initPayPalLazy();
  }

  // Injects the PayPal SDK on demand (first visit to the donate page).
  function initPayPalLazy() {
    if (paypalInitStarted) return;
    paypalInitStarted = true;

    if (typeof window.paypal !== "undefined") { renderPayPalButtons(); return; }

    const loading = $("paypalLoading");
    if (loading) loading.style.display = "block";

    const script = document.createElement("script");
    const ppLocale = (window.VizeaI18n && window.VizeaI18n.getLang && window.VizeaI18n.getLang() === "en") ? "en_US" : "fr_CA";
    script.id = "paypal-sdk";
    script.src = "https://www.paypal.com/sdk/js?client-id=BAAI4m0yUdkGit6WfOe6AlMmlvv3rdGM-cxcZ3-DzPT4tQNsHgvHbPVZbg-oIss6ZRmyITRrST5aavZXuk&currency=CAD&locale=" + ppLocale + "&disable-funding=card,credit,paylater";
    script.onload = renderPayPalButtons;
    script.onerror = () => {
      // Blocked (content blocker, network filter) or offline: explain, and offer a retry.
      script.remove();
      try { delete window.paypal; } catch (e) { window.paypal = undefined; }
      paypalInitStarted = false;
      if (!loading) return;
      loading.textContent = T("donate.failed", "Le module de paiement n'a pas pu se charger (bloqué ou hors-ligne).") + " ";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn-link donate-retry";
      retry.textContent = T("donate.retry", "Réessayer");
      retry.addEventListener("click", () => { loading.textContent = T("donate.loading", "Chargement du module de paiement…"); initPayPalLazy(); });
      loading.appendChild(retry);
    };
    document.body.appendChild(script);
  }

  function setupDonate() {
    $$('input[name="donation-amount"]').forEach((r) =>
      r.addEventListener("change", () => {
        syncDonateAmount(false);
        if (r.value === "autre" && r.checked) setTimeout(() => $("customAmount")?.focus(), 0);
      }));
    $("customAmount")?.addEventListener("input", () => syncDonateAmount(true));
    $("customAmount")?.addEventListener("blur", () => syncDonateAmount(true));
    syncDonateAmount(false);
  }

  // =========================================================================
  // UNSAVED CHANGES WARNING
  // =========================================================================
  function setupUnloadWarning() {
    window.addEventListener("beforeunload", (e) => {
      if (dirty || (demoStash && demoStash.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  // =========================================================================
  // GUIDED DEMO (onboarding tour)
  // A native spotlight overlay that walks a first-time visitor through the
  // whole flow with fictitious data. Lives inside the app IIFE so it can drive
  // the real navigation/render functions directly. No inline scripts (CSP-safe).
  // =========================================================================
  let _demo = null;

  function buildDemoProject() {
    const proj = DM.createEmptyProject(T("demo.projTitle", "Démonstration"));
    // WAIS-IV: the 10 core subtests so the four indices (ICV/IRP/IMT/IVT) and
    // the EGQI are credible in the Échelles view.
    proj.selectedTests = {
      "WAIS-IV": [
        "Similitudes", "Vocabulaire", "Connaissances",
        "Blocs", "Matrices", "Casse-têtes visuels",
        "Séquences des chiffres", "Arithmétique",
        "Repérage de symboles", "Code"
      ],
      "TEA": ["Elevator counting", "Telephone search"],
      "D-KEFS / DKEFS": ["Color-word interference"]
    };
    DM.syncScoresWithSelectedTests(proj, testsBank);
    const set = (t, s, v) => { const a = proj.scores[t] && proj.scores[t][s]; if (a && a[0]) a[0].value = String(v); };
    // Verbal (strong), perceptual (avg), working memory (weaker), speed (avg)
    set("WAIS-IV", "Similitudes", 12); set("WAIS-IV", "Vocabulaire", 13); set("WAIS-IV", "Connaissances", 11);
    set("WAIS-IV", "Blocs", 11); set("WAIS-IV", "Matrices", 10); set("WAIS-IV", "Casse-têtes visuels", 11);
    set("WAIS-IV", "Séquences des chiffres", 8); set("WAIS-IV", "Arithmétique", 7);
    set("WAIS-IV", "Repérage de symboles", 9); set("WAIS-IV", "Code", 9);
    set("TEA", "Elevator counting", 9); set("TEA", "Telephone search", 6);
    const mk = (name, val, fns) => {
      const c = DM.createEmptyCondition(fns); c.name = name; c.value = String(val); c.type = "Scale score"; return c;
    };
    // Five conditions pre-filled; the sixth (Flexibilité erreurs) is added AND
    // typed LIVE during the tour to demonstrate "+ Ajouter un score".
    proj.scores["D-KEFS / DKEFS"]["Color-word interference"] = [
      mk("Couleurs", 11, ["Langage oral"]),
      mk("Mots", 12, ["Langage oral"]),
      mk("Inhibition (temps)", 8, ["Fonctions exécutives"]),
      mk("Inhibition (erreurs)", 9, ["Fonctions exécutives"]),
      mk("Flexibilité (temps)", 7, ["Fonctions exécutives"])
    ];
    proj.iqScales["WAIS-IV"] = DM.defaultScaleRows("WAIS-IV", testsBank) || [];
    const sc = { ICV: 112, IRP: 104, IMT: 88, IVT: 95, EGQI: 102 };
    proj.iqScales["WAIS-IV"].forEach((r) => { if (sc[r.name] != null) r.value = String(sc[r.name]); });
    proj.activeScaleTest = "WAIS-IV";
    proj._demo = true; // never exported as a real project marker; only used to recognise the tour's project
    return proj;
  }

  function demoFindCard(testName) {
    return Array.from(document.querySelectorAll("#scoreEntryContainer .test-card"))
      .find((c) => { const h = c.querySelector(".test-card-head h3"); return h && h.textContent.trim() === testName; }) || null;
  }
  function demoStroopSub() {
    const card = demoFindCard("D-KEFS / DKEFS");
    if (!card) return null;
    return Array.from(card.querySelectorAll(".subtest-card"))
      .find((s) => { const t = s.querySelector(".subtest-title"); return t && t.textContent.trim() === "Color-word interference"; }) || null;
  }
  function demoFindStroopAdd() {
    const sub = demoStroopSub();
    return sub ? sub.querySelector(".add-condition-btn") : null;
  }
  function demoLastStroopRow() {
    const sub = demoStroopSub();
    if (!sub) return null;
    const rows = sub.querySelectorAll(".condition-row");
    return rows[rows.length - 1] || null;
  }
  function demoFindCondDisplay(condName) {
    const sub = demoStroopSub();
    if (!sub) return null;
    const row = Array.from(sub.querySelectorAll(".condition-row"))
      .find((r) => { const n = r.querySelector(".condition-name"); return n && (n.value || "").trim() === condName; });
    return row ? row.querySelector(".multi-select-display") : null;
  }

  function demoClearTyper() { if (_demo && _demo.typer) { clearTimeout(_demo.typer); _demo.typer = null; } }

  // Type text into an input one character at a time so the user SEES the demo
  // filling fields. Dispatches input events so the app's own handlers react.
  function demoType(input, text, done) {
    demoClearTyper();
    if (!input) { if (done) done(); return; }
    try { input.focus(); } catch (e) {}
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    let i = 0;
    const tick = () => {
      if (!_demo) return;
      i++;
      input.value = text.slice(0, i);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      if (i < text.length) _demo.typer = setTimeout(tick, 100);
      else { _demo.typer = null; if (done) done(); }
    };
    _demo.typer = setTimeout(tick, 320);
  }

  function demoPanel(open) {
    const panel = $("vizPanel");
    if (!panel) return;
    const isOpen = panel.classList.contains("open");
    if (open && !isOpen) $("panelToggle")?.click();
    if (!open && isOpen) $("panelClose")?.click();
  }

  // Ends the tour. If the visitor had a project of their own before starting,
  // it is put back exactly as it was (the demo never replaces real work).
  function demoCleanup(toHome, keep) {
    if (!_demo) return;
    const d = _demo;
    $("vizPlot")?.classList.remove("hint-edit");
    demoClearTyper();
    window.removeEventListener("resize", d.repos);
    window.removeEventListener("scroll", d.repos, true);
    document.removeEventListener("keydown", d.keys, true);
    if (d.spot) d.spot.remove();
    if (d.bubble) d.bubble.remove();
    document.body.classList.remove("demo-on");
    _demo = null;
    demoPanel(false);
    if (keep) { demoReturnShow(d.stash); return; }   // "Terminer": stay on the demo chart
    if (d.stash) {
      startProject(d.stash.project);
      dirty = d.stash.dirty;
      goToPage("page-new");
      showStep(d.stash.step);
      try { d.stash.focus && d.stash.focus.focus({ preventScroll: true }); } catch (e) {}
      return;
    }
    if (toHome) goToPage("page-home");
  }

  // After the tour, the visitor's own project waits aside until they ask for it
  // (or start/open another project).
  var demoStash = null;
  function demoReturnShow(stash) {
    demoStash = stash || null;
    const b = $("demoReturn");
    if (b) b.hidden = !demoStash;
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("#demoReturnBtn") || !demoStash) return;
    const st = demoStash;
    demoReturnShow(null);
    startProject(st.project);
    dirty = st.dirty;
    goToPage("page-new");
    showStep(st.step);
  });

  // Bubble placement: beside the target when there is room, else above/below,
  // else pinned to the bottom of the screen (for very large targets).
  function demoPosition(target, place) {
    if (!_demo) return;
    const spot = _demo.spot, bubble = _demo.bubble, pad = 10, gap = 16, m = 16;
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = Math.min(380, vw - m * 2);
    bubble.style.width = bw + "px";
    const bh = bubble.offsetHeight || 190;
    if (!target) {
      spot.classList.add("is-hidden");
      bubble.style.left = Math.round((vw - bw) / 2) + "px";
      bubble.style.top = Math.round((vh - bh) / 2) + "px";
      return;
    }
    const r = target.getBoundingClientRect();
    spot.classList.remove("is-hidden");
    spot.style.left = (r.left - pad) + "px";
    spot.style.top = (r.top - pad) + "px";
    spot.style.width = (r.width + pad * 2) + "px";
    spot.style.height = (r.height + pad * 2) + "px";
    const clampX = (x) => Math.min(Math.max(m, x), vw - bw - m);
    const clampY = (y) => Math.min(Math.max(m + 68, y), vh - bh - m);
    let x, y;
    if (place !== "pin" && r.bottom + pad + gap + bh < vh - m) { x = clampX(r.left); y = r.bottom + pad + gap; }
    else if (place !== "pin" && r.top - pad - gap - bh > 68 + m) { x = clampX(r.left); y = r.top - pad - gap - bh; }
    else if (place !== "pin" && r.left - pad - gap - bw > m) { x = r.left - pad - gap - bw; y = clampY(r.top + r.height / 2 - bh / 2); }
    else if (place !== "pin" && r.right + pad + gap + bw < vw - m) { x = r.right + pad + gap; y = clampY(r.top + r.height / 2 - bh / 2); }
    else { x = vw - bw - m * 2; y = vh - bh - m * 2; }
    bubble.style.left = Math.round(x) + "px";
    bubble.style.top = Math.round(y) + "px";
  }

  function demoTargetOf(step) {
    if (!step || !step.target) return null;
    return typeof step.target === "function" ? step.target() : document.querySelector(step.target);
  }

  function demoGo(delta) {
    if (!_demo) return;
    const step = _demo.steps[_demo.i];
    if (delta > 0 && step && step.onNext) { try { step.onNext(); } catch (e) {} }
    const n = _demo.i + delta;
    if (n < 0) return;
    if (n >= _demo.steps.length) { demoCleanup(false, true); return; }
    _demo.i = n;
    demoRender();
  }

  function demoRender() {
    if (!_demo) return;
    demoClearTyper();
    const steps = _demo.steps, i = _demo.i, step = steps[i];
    if (!step) { demoCleanup(false); return; }
    if (step.before) { try { step.before(); } catch (e) {} }
    const b = _demo.bubble;
    b.classList.add("is-moving");
    setTimeout(() => {
      if (!_demo) return;
      const target = demoTargetOf(step);
      b.innerHTML = "";
      const head = document.createElement("div");
      head.className = "demo-head";
      const bar = document.createElement("div");
      bar.className = "demo-progress";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.transform = "scaleX(" + ((i + 1) / steps.length).toFixed(3) + ")";
      bar.appendChild(fill);
      const count = document.createElement("span");
      count.className = "demo-step-count";
      count.textContent = (i + 1) + " / " + steps.length;
      head.append(bar, count);
      b.appendChild(head);
      const title = document.createElement("h2");
      title.className = "demo-bubble-title";
      title.id = "demoTitle";
      title.textContent = typeof step.title === "function" ? step.title() : (step.title || "");
      b.appendChild(title);
      const body = document.createElement("p");
      body.className = "demo-bubble-body";
      body.textContent = typeof step.body === "function" ? step.body() : (step.body || "");
      b.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "demo-bubble-actions";
      const quit = document.createElement("button");
      quit.type = "button";
      quit.className = "demo-btn demo-btn-ghost";
      quit.textContent = T("demo.quit", "Quitter");
      quit.addEventListener("click", () => demoCleanup(true));
      const nav = document.createElement("div");
      nav.className = "demo-nav";
      if (i > 0) {
        const prev = document.createElement("button");
        prev.type = "button";
        prev.className = "demo-btn demo-btn-prev";
        prev.setAttribute("aria-label", T("demo.prev", "Précédent"));
        prev.title = T("demo.prev", "Précédent");
        prev.textContent = "←";
        prev.addEventListener("click", () => demoGo(-1));
        nav.appendChild(prev);
      }
      const next = document.createElement("button");
      next.type = "button";
      next.className = "demo-btn demo-btn-next";
      next.textContent = (i === steps.length - 1) ? T("demo.finish", "Terminer") : T("demo.next", "Suivant");
      next.addEventListener("click", () => demoGo(1));
      nav.appendChild(next);
      actions.append(quit, nav);
      b.appendChild(actions);
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView({ block: step.block || "center", behavior: "smooth" }); } catch (e) {}
      }
      setTimeout(() => {
        demoPosition(target, step.place);
        b.classList.remove("is-moving");
        try { next.focus({ preventScroll: true }); } catch (e) {}
      }, target ? 380 : 30);
    }, step.wait || 80);
  }

  function demoSteps() {
    const onStep = (n) => { if (currentStep !== n) showStep(n); };
    const ensureStep0 = () => { demoPanel(false); goToPage("page-new"); showStep(0); };
    const setView = (v) => { const b = document.querySelector('#viewSwitch button[data-view="' + v + '"]'); if (b && !b.classList.contains("active")) b.click(); };
    const atChart = (v) => () => {
      demoPanel(false); onStep(3);
      $("vizPlot")?.classList.remove("hint-edit");
      if (focusFn) setFocus(null);
      setView(v);
    };
    const ensureDemoProject = () => {
      if (!projectInitialized || !currentProject || !currentProject._demo) startProject(buildDemoProject());
    };
    return [
      { target: null,
        title: T("demo.s1.t", "Bienvenue dans Vizéa"),
        body: T("demo.s1.b", "En deux minutes, voyez comment des scores deviennent un profil cognitif. Les données sont fictives et rien n'est enregistré. Avancez avec « Suivant » ou les flèches du clavier; Échap pour quitter."),
        before: () => goToPage("page-home") },
      { target: "#projectTitle",
        title: T("demo.s3.t", "Le projet"),
        body: T("demo.s3.b", "Chaque séance commence par un nom. N'y inscrivez jamais de renseignement nominatif : un code interne suffit."),
        before: () => {
          ensureStep0();
          const cb = $("confirmNoPI"); if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
          demoType($("projectTitle"), T("home.story.projName", "Évaluation 2026-014"));
        },
        wait: 260 },
      { target: "#templateSelect",
        title: T("demo.s5.t", "Partir d'un modèle"),
        body: T("demo.s5.b", "Vous utilisez souvent la même batterie? Enregistrez-la comme modèle : tests, fonctions et préférences du graphique sont repris, sans aucun score."),
        before: ensureStep0, wait: 160 },
      { target: "#importProjectBtn",
        title: T("demo.s4.t", "Reprendre un projet"),
        body: T("demo.s4.b", "Une deuxième rencontre? Rouvrez le fichier .vizea exporté la dernière fois et continuez exactement là où vous étiez."),
        before: ensureStep0, wait: 160 },
      { target: "#step-1-content .step1-grid > .card",
        title: T("demo.s6.t", "Choisir les tests"),
        body: T("demo.s6.b", "Cherchez une batterie ou un test (la démo tape « D-KE »), puis cochez les sous-tests administrés. Un test absent de la banque peut être ajouté à la main."),
        before: () => { demoPanel(false); ensureDemoProject(); goToPage("page-new"); onStep(1); demoType($("testSearch"), "D-KE"); },
        wait: 320 },
      { target: () => demoFindCard("WAIS-IV"), block: "start",
        title: T("demo.s7.t", "Saisir les scores"),
        body: T("demo.s7.b", "Chaque test devient une carte. Entrez la valeur et son type : pondéré, standard, T, Z ou rang centile. Vizéa ramène tout sur une même échelle."),
        before: () => { ensureDemoProject(); onStep(2); }, wait: 300 },
      { target: demoLastStroopRow,
        title: T("demo.s8.t", "Plusieurs scores par test"),
        body: T("demo.s8.b", "« + Ajouter un score » crée une condition de plus, ici « Flexibilité (erreurs) ». Un score où un résultat élevé est défavorable (temps, erreurs) peut aussi être marqué « Inversé »."),
        before: () => {
          ensureDemoProject(); onStep(2);
          const arr = currentProject.scores["D-KEFS / DKEFS"]["Color-word interference"];
          if (arr.length < 6) { const btn = demoFindStroopAdd(); if (btn) btn.click(); }
          const arr2 = currentProject.scores["D-KEFS / DKEFS"]["Color-word interference"];
          const cond = arr2[arr2.length - 1];
          if (cond) { cond.functions = ["Fonctions exécutives"]; cond.value = "8"; }
          const row = demoLastStroopRow();
          if (row) {
            const disp = row.querySelector(".multi-select-display");
            if (disp) { disp.textContent = funcDisplay("Fonctions exécutives"); disp.classList.add("has-value"); }
            const valInput = row.querySelector(".condition-value");
            if (valInput) { valInput.value = "8"; valInput.dispatchEvent(new Event("input", { bubbles: true })); }
            demoType(row.querySelector(".condition-name"), T("demo.flexErr", "Flexibilité (erreurs)"));
          }
        },
        wait: 340 },
      { target: () => demoFindCondDisplay("Couleurs"),
        title: T("demo.s9.t", "Vous décidez du regroupement"),
        body: T("demo.s9.b", "Chaque score est rattaché à une ou plusieurs fonctions cognitives, modifiables ici. « Couleurs » et « Mots » sont classés en langage oral plutôt qu'en fonctions exécutives : c'est votre lecture du profil qui compte."),
        before: () => { ensureDemoProject(); onStep(2); }, wait: 160 },
      { target: "#vizPlot", place: "pin", block: "start",
        title: T("demo.s10.t", "Le profil"),
        body: T("demo.s10.b", "Chaque point est placé selon son rang centile, sur les sept bandes d'interprétation (Guilmette et coll., 2020). Les scores sont regroupés par fonction, chacune dans sa couleur."),
        before: () => { ensureDemoProject(); atChart("line")(); }, wait: 420 },
      { target: ".viz-main", place: "pin", block: "start",
        title: T("demo.s20.t", "Zoomer sur une fonction"),
        body: T("demo.s20.b", "Cliquez sur le nom d'une fonction, au-dessus du graphique, pour la voir seule avec la valeur de chaque score. Cliquez sur son titre pour la renommer; « Profil global » ramène la vue d'ensemble."),
        before: () => {
          ensureDemoProject(); atChart("line")();
          const fs = chartFunctions();
          setFocus(fs.indexOf("Fonctions exécutives") >= 0 ? "Fonctions exécutives" : fs[0]);
        }, wait: 760 },
      { target: "#vizPlot", place: "pin", block: "start",
        title: T("demo.s21.t", "Modifier dans le graphique"),
        body: T("demo.s21.b", "Glissez un point ou le nom d'une fonction, d'un test ou d'une échelle pour le déplacer, dans chaque graphique comme dans le tableau. Cliquez sur un nom dans le graphique pour le renommer. Seul l'affichage change : les scores restent intacts."),
        before: () => { ensureDemoProject(); atChart("line")(); setTimeout(() => $("vizPlot")?.classList.add("hint-edit"), 500); }, wait: 380 },
      { target: "#vizPlot", place: "pin", block: "start",
        title: T("demo.s11.t", "Les échelles globales"),
        body: T("demo.s11.b", "Les échelles du fonctionnement intellectuel (indices composites et indice global), sur les mêmes bandes d'interprétation."),
        before: atChart("scales"), wait: 360 },
      { target: "#vizPlot", place: "pin", block: "start",
        title: T("demo.s12.t", "Vue radar"),
        body: T("demo.s12.b", "La moyenne de chaque fonction, disposée en étoile : la forme générale du profil, d'un coup d'œil."),
        before: atChart("radar"), wait: 360 },
      { target: "#vizTableWrap", place: "pin", block: "start",
        title: T("demo.s15.t", "Vue tableau"),
        body: T("demo.s15.b", "Tous les scores avec leur rang centile et leur classification, regroupés par test ou par fonction, prêts pour Excel."),
        before: atChart("table"), wait: 380 },
      { target: "#vizPanel",
        title: T("demo.s13.t", "Personnaliser"),
        body: T("demo.s13.b", "Couleurs, ordre et noms des fonctions, bandes, axes, ligne de comparaison, taille du texte : chaque réglage s'applique en direct."),
        before: () => { onStep(3); setView("line"); demoPanel(true); }, wait: 420 },
      { target: ".viz-actions",
        title: T("demo.s14.t", "Exporter"),
        body: T("demo.s14.b", "L'image PNG pour un rapport, le tableau Excel, un modèle réutilisable ou le projet complet (.vizea), que vous conservez dans votre environnement sécurisé."),
        before: atChart("line"), wait: 340 },
      { target: null,
        title: T("demo.s19.t", "À vous de jouer"),
        body: () => (_demo && _demo.stash)
          ? T("demo.s19.bRestore", "Le projet fictif reste ouvert pour que vous l'exploriez. Votre projet est mis de côté : « Retrouver mon projet » le rétablit tel que vous l'aviez laissé.")
          : T("demo.s19.b", "Le projet fictif reste ouvert : explorez-le librement, puis créez le vôtre à l'étape « Projet ». Bonne visualisation!"),
        before: () => {
          atChart("line")();
          $("vizPlot")?.scrollIntoView({ block: "start", behavior: "smooth" });
        } }
    ];
  }

  function startDemo() {
    if (_demo) demoCleanup(false);
    // Keep the visitor's own project aside: the tour works on a fictional one.
    const stash = demoStash || ((projectInitialized && currentProject && !currentProject._demo)
      ? { project: currentProject, step: currentStep, dirty: dirty, focus: document.activeElement }
      : null);
    demoReturnShow(null);
    const spot = document.createElement("div");
    spot.className = "demo-spotlight is-hidden";
    const bubble = document.createElement("div");
    bubble.className = "demo-bubble";
    bubble.setAttribute("role", "dialog");
    bubble.setAttribute("aria-modal", "false");
    bubble.setAttribute("aria-labelledby", "demoTitle");
    bubble.setAttribute("aria-live", "polite");
    document.body.appendChild(spot);
    document.body.appendChild(bubble);
    document.body.classList.add("demo-on");
    _demo = { spot, bubble, i: 0, steps: demoSteps(), repos: null, keys: null, typer: null, stash };
    _demo.repos = () => { if (_demo) { const s = _demo.steps[_demo.i]; demoPosition(demoTargetOf(s), s && s.place); } };
    _demo.keys = (e) => {
      if (!_demo) return;
      const tag = (e.target && e.target.tagName) || "";
      if (e.key === "Escape") { e.preventDefault(); demoCleanup(true); }
      else if (e.key === "ArrowRight" && !/INPUT|TEXTAREA|SELECT/.test(tag)) { e.preventDefault(); demoGo(1); }
      else if (e.key === "ArrowLeft" && !/INPUT|TEXTAREA|SELECT/.test(tag)) { e.preventDefault(); demoGo(-1); }
    };
    window.addEventListener("resize", _demo.repos);
    window.addEventListener("scroll", _demo.repos, true);
    document.addEventListener("keydown", _demo.keys, true);
    demoRender();
  }

  // =========================================================================
  // NOUVEAUTÉS (changelog) — reads an editable nouveautes.json and renders a
  // vertical timeline. To add an entry, edit the JSON file (date, titre, infos).
  // =========================================================================
  function localizedNewsDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    const lang = (window.VizeaI18n && window.VizeaI18n.getLang) ? window.VizeaI18n.getLang() : "fr";
    const d = Number(m[3]), mo = Number(m[2]) - 1, y = m[1];
    if (lang === "en") {
      const en = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return (en[mo] || "") + " " + d + ", " + y;
    }
    const fr = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
    return d + " " + (fr[mo] || "") + " " + y;
  }
  // A news field may be a plain FR value or a {fr, en} object; resolve by language.
  function pickNews(v) {
    const lang = (window.VizeaI18n && window.VizeaI18n.getLang) ? window.VizeaI18n.getLang() : "fr";
    if (v && typeof v === "object" && !Array.isArray(v)) return (lang === "en" && v.en != null) ? v.en : (v.fr != null ? v.fr : v);
    return v;
  }

  let _newsEntries = null;
  function renderNews(entries) {
    if (entries) _newsEntries = entries;
    const host = $("newsTimeline");
    if (!host) return;
    host.innerHTML = "";
    const src = _newsEntries || entries;
    const items = (Array.isArray(src) ? src.slice() : [])
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!items.length) {
      host.innerHTML = '<p class="news-empty">' + T("news.empty", "Aucune nouveauté pour le moment.") + '</p>';
      return;
    }
    items.forEach((e, idx) => {
      const item = document.createElement("article");
      item.className = "news-item" + (idx === 0 ? " is-latest" : "");
      // "V1.8 : Titre" → version tag + title
      const full = pickNews(e.titre || e.title) || "";
      const m = /^\s*(V\d+(?:\.\d+)*)\s*:\s*(.*)$/i.exec(full);
      const meta = document.createElement("div");
      meta.className = "news-meta";
      const ver = document.createElement("span");
      ver.className = "news-ver";
      ver.textContent = m ? m[1].toUpperCase() : "";
      const date = document.createElement("time");
      date.className = "news-date";
      if (e.date) date.setAttribute("datetime", String(e.date));
      date.textContent = localizedNewsDate(e.date);
      meta.append(ver, date);

      const card = document.createElement("div");
      card.className = "news-card";
      const h = document.createElement("h3");
      h.className = "news-title";
      h.textContent = m ? m[2] : full;
      card.appendChild(h);
      const infos = pickNews(e.infos || e.points) || [];
      if (Array.isArray(infos) && infos.length) {
        const ul = document.createElement("ul");
        ul.className = "news-points";
        infos.forEach((p) => { const li = document.createElement("li"); li.textContent = p; ul.appendChild(li); });
        card.appendChild(ul);
      } else if (typeof infos === "string" && infos) {
        const p = document.createElement("p"); p.className = "news-text"; p.textContent = infos; card.appendChild(p);
      }
      item.append(meta, card);
      host.appendChild(item);
    });
  }

  function setupNews() {
    const host = $("newsTimeline");
    if (!host) return;
    host.innerHTML = '<p class="news-empty">' + T("news.loading", "Chargement…") + '</p>';
    fetch("nouveautes.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => renderNews(Array.isArray(data) ? data : (data && data.entries) || []))
      .catch(() => { host.innerHTML = '<p class="news-empty">' + T("news.error", "Le journal des nouveautés est momentanément indisponible.") + '</p>'; });
  }

  function setupDemo() {
    const start = () => {
      const nav = $("topnav"); nav && nav.classList.remove("open");
      startDemo();
    };
    const btn = $("startDemoBtn");
    if (btn) btn.addEventListener("click", start);
    const navDemo = $("navDemo");
    if (navDemo) {
      navDemo.addEventListener("click", start);
      navDemo.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } });
    }
  }
})();
