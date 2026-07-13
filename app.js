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

  function markDirty() { dirty = true; }

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
    const tl = (type || "score").toLowerCase();
    if (r.hard && (v < r.hard.min || v > r.hard.max)) {
      return { level: "error", message: `Valeur impossible pour un ${tl} (doit être entre ${r.hard.min} et ${r.hard.max}).` };
    }
    if (r.warn && (v < r.warn.min || v > r.warn.max)) {
      return { level: "warn", message: `Valeur inhabituelle pour un ${tl} (plage attendue : ${r.warn.min} à ${r.warn.max}). Vérifiez la saisie.` };
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
    proceed();
  }

  function setupNavigation() {
    const nav = $("topnav");
    const navToggle = $("navToggle");
    navToggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    $$("[data-target]").forEach((el) => {
      el.addEventListener("click", () => {
        const target = el.dataset.target;
        if (!target) return;
        goToPage(target);
        nav?.classList.remove("open");
        navToggle?.setAttribute("aria-expanded", "false");
      });
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

    window.scrollTo({ top: 0, behavior: "smooth" });
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
          toast("Sélectionnez au moins un test d'abord.");
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
      if (!title) { toast("Donnez un nom au projet."); return; }

      const tmplId = $("templateSelect") ? $("templateSelect").value : "";
      if (tmplId) {
        const templates = DM.loadAllLocalTemplates();
        const tmpl = templates[tmplId];
        if (!tmpl) { toast("Modèle introuvable."); return; }
        const proj = DM.createEmptyProject(title);
        DM.applyTemplateToProject(proj, tmpl);
        DM.syncScoresWithSelectedTests(proj, testsBank);
        startProject(proj);
        toast(`Projet « ${title} » créé à partir du modèle « ${tmpl.name} ».`);
      } else {
        startProject(DM.createEmptyProject(title));
        toast(`Projet « ${title} » créé.`);
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
      if (!confirm("Supprimer ce modèle ? Cette action est définitive.")) return;
      DM.deleteLocalTemplate(id);
      refreshTemplateSelect();
      toast("Modèle supprimé.");
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
      DM.syncScoresWithSelectedTests(proj, testsBank);
      startProject(proj);
      toast(`Projet « ${proj.title} » importé.`);
      showStep(1);
      return true;
    } catch (err) {
      toast("Fichier invalide : " + (err && err.message ? err.message : err));
      return false;
    }
  }
  function loadProjectFromFile(file) {
    if (!file) return;
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
      else if (file) toast("Déposez un fichier de projet .vizea.");
    });
  }

  function startProject(project) {
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
    sel.innerHTML = ids.length
      ? '<option value="">Aucun modèle — projet vierge</option>'
      : '<option value="">Aucun modèle enregistré — projet vierge</option>';
    ids.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = templates[id].name || "Modèle";
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
      if (!currentProject) { toast("Créez d'abord un projet."); return; }
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
        tag.textContent = "version antérieure";
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
      div.innerHTML = '<p class="muted empty-hint">Aucun test sélectionné pour l\'instant.</p>';
      return;
    }
    div.innerHTML = "";
    entries.forEach(([test, subtests]) => {
      const parent = document.createElement("div");
      parent.className = "selected-test";
      parent.textContent = test;
      const rm = document.createElement("button");
      rm.textContent = "×";
      rm.className = "remove-test-btn";
      rm.title = "Retirer";
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
      count.textContent = nScores + (nScores > 1 ? " saisis" : " saisi");
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
      '<div class="scales-head"><span class="scales-title">Échelles globales</span>' +
      '<span class="scales-hint">· score standard ou rang centile</span></div>';

    // When several IQ batteries are selected, only ONE feeds the échelles chart.
    const iqTests = listIqTests();
    if (iqTests.length >= 2) {
      const activeWrap = document.createElement("label");
      activeWrap.className = "panel-toggle scale-active-toggle";
      const acb = document.createElement("input");
      acb.type = "checkbox";
      acb.checked = currentProject.activeScaleTest === testName;
      const span = document.createElement("span");
      span.textContent = "Utiliser ces valeurs pour la visualisation des échelles";
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
        nameInput.value = r.name || ""; nameInput.placeholder = "Sigle";
        nameInput.addEventListener("input", () => { r.name = nameInput.value; markDirty(); });

        const valInput = document.createElement("input");
        valInput.type = "number"; valInput.className = "scale-value";
        valInput.value = r.value || ""; valInput.placeholder = "—";

        const scaleSel = document.createElement("select");
        scaleSel.className = "scale-type";
        [["Standard score", "Score standard"], ["Percentile", "Rang centile"]].forEach(([v, lbl]) => {
          const o = document.createElement("option"); o.value = v; o.textContent = lbl;
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
        scaleSel.addEventListener("change", () => { r.scale = scaleSel.value; markDirty(); applyConstraints(); validate(); if (currentStep === 3) renderChart(); });

        const del = document.createElement("button");
        del.type = "button"; del.className = "scale-del"; del.setAttribute("aria-label", "Retirer");
        del.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        del.addEventListener("click", () => { rows.splice(idx, 1); markDirty(); renderRows(); updateScalesViewAvailability(); });

        row.append(nameInput, valInput, scaleSel, del, warn);
        validate();
        listEl.appendChild(row);
      });
    }
    renderRows();

    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "scales-add";
    addBtn.textContent = "+ Ajouter une échelle";
    addBtn.addEventListener("click", () => {
      rows.push({ name: "", value: "", scale: "Standard score" });
      markDirty(); renderRows();
    });
    sec.appendChild(addBtn);
    return sec;
  }

  // Small confirmation dialog (reuses the modal styling). Resolves true/false.
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
    addBtn.textContent = "+ Ajouter un score à ce test";
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
    nameInput.placeholder = "Nom du score (optionnel)";
    nameInput.value = cond.name || "";
    nameInput.className = "condition-name";
    nameInput.addEventListener("input", () => { cond.name = nameInput.value; markDirty(); });
    // Enter in the name jumps to this row's value field.
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); valueInput.focus(); }
    });

    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.placeholder = "Score";
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
      valueInput.title = `Plage attendue : ${(rule.warn || rule.hard).min} à ${(rule.warn || rule.hard).max}`;
      applyScoreValidation(valueInput, warnEl, type);
    }

    valueInput.addEventListener("input", () => { cond.value = valueInput.value; checkValue(); markDirty(); });
    // Enter = jump to the next score field (skips collapsed cards) for fast entry.
    valueInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const all = Array.from(document.querySelectorAll("#scoreEntryContainer .condition-value"))
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
        toast("Le rang centile doit être entre 0 et 100.");
        checkValue();
      }
    });

    const typeSelect = document.createElement("select");
    typeSelect.className = "condition-type";
    SCORE_TYPE_OPTIONS.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
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
        display.textContent = cond.functions.join(", ");
        display.classList.add("has-value");
      } else {
        display.textContent = "Fonctions cognitives…";
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
        lab.appendChild(document.createTextNode(fn));
        options.appendChild(lab);
      });

      // Inline "add a custom function" row (scoped to this project).
      const addRow = document.createElement("div");
      addRow.className = "ms-add-row";
      const addInput = document.createElement("input");
      addInput.type = "text";
      addInput.placeholder = "Ajouter une fonction…";
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
          toast(`Fonction « ${name} » ajoutée à ce projet.`);
          renderStep2(); // rebuild all rows from currentProject (values preserved)
        } else if (res === "exists") {
          toast("Cette fonction existe déjà.");
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
            title: "Retirer ce test ?",
            message: "« " + (entry.label || "Ce test") + " » n'a qu'un seul score. Le retirer enlèvera ce test du projet.",
            confirmText: "Retirer",
            cancelText: "Annuler"
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
    invLab.textContent = "Sens";
    const invToggle = document.createElement("label");
    invToggle.className = "invert-toggle";
    invToggle.title = "Élevé = défavorable (ex. temps de réponse, nombre d'erreurs). Le score est miroité autour de la moyenne.";
    const invCb = document.createElement("input");
    invCb.type = "checkbox";
    invCb.checked = !!cond.inverted;
    invCb.addEventListener("change", () => { cond.inverted = invCb.checked; markDirty(); });
    invToggle.append(invCb, document.createTextNode(" Inversé"));
    invField.append(invLab, invToggle);

    row.append(
      field("Nom du score", nameInput),
      field("Score", valueInput),
      field("Type", typeSelect),
      field("Fonctions", msContainer),
      invField,
      removeBtn,
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
    const defs = [["line", "Profil"], ["scales", "Échelles"], ["radar", "Radar"], ["table", "Tableau"]];
    defs.forEach(([type, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.view = type; b.textContent = label;
      b.addEventListener("click", () => {
        if (b.classList.contains("disabled")) return;
        currentProject.chartSettings.chartType = type;
        syncViewSwitch();
        // keep the panel's Ligne/Radar control in sync where applicable
        $$("#opt-chartType button").forEach((pb) =>
          pb.classList.toggle("active", pb.dataset.type === type));
        buildPanelDynamicControls();
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
      if (el) el.innerHTML = '<p style="text-align:center;color:#888;padding:40px">Chargement du moteur graphique…</p>';
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (typeof window.Plotly !== "undefined") {
          clearInterval(timer);
          CHART.renderChart(currentProject, "vizPlot");
        } else if (tries > 40) { // ~10s
          clearInterval(timer);
          if (el) el.innerHTML = '<p style="text-align:center;color:#c0392b;padding:40px">Le moteur graphique (Plotly) n\'a pas pu être chargé. Vérifiez votre connexion, puis rouvrez cette étape.</p>';
        }
      }, 250);
      return;
    }
    CHART.renderChart(currentProject, "vizPlot");
  }

  // Coalesce rapid input events (dragging a colour picker, typing in a text
  // field) into a single redraw, so the Plotly chart isn't rebuilt on every
  // keystroke/pixel — noticeably smoother with many points.
  let _chartRedrawTimer = null;
  function renderChartDebounced() {
    clearTimeout(_chartRedrawTimer);
    _chartRedrawTimer = setTimeout(() => { _chartRedrawTimer = null; renderChart(); }, 110);
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
    const displayFunc = (f) => (s.functionLabels && s.functionLabels[f]) || f;
    const pts = DM.flattenScores(currentProject);

    const colDefs = [];
    if (cols.value !== false) colDefs.push(["value", "Valeur"]);
    if (cols.type !== false) colDefs.push(["type", "Type"]);
    if (cols.percentile !== false) colDefs.push(["percentile", "Rang centile"]);
    if (cols.classification !== false) colDefs.push(["classification", "Classification"]);

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
        type: p.type,
        percentile: tableFmtPct(p.percentile),
        classification: band.label,
        color: band.color,
        inverted: !!p.inverted
      };
    };

    const groups = [];
    if (groupBy === "function") {
      const order = [], map = {};
      pts.forEach((p) => {
        if (!map[p.func]) { map[p.func] = []; order.push(p.func); }
        map[p.func].push(rowFromPoint(p, false));
      });
      order.forEach((k) => groups.push({ title: displayFunc(k), rows: map[k] }));
    } else {
      const order = [], map = {}, seen = {};
      pts.forEach((p) => {
        if (seen[p.conditionId]) return;   // one row per condition (deduped across functions)
        seen[p.conditionId] = 1;
        if (!map[p.testName]) { map[p.testName] = []; order.push(p.testName); }
        map[p.testName].push(rowFromPoint(p, true));
      });
      order.forEach((k) => groups.push({ title: k, rows: map[k] }));
    }

    return {
      firstHeader: groupBy === "test" ? "Sous-test / score" : "Test / score",
      colDefs, groups, showColor,
      anyInverted: pts.some((p) => p.inverted)
    };
  }

  function buildTableElement(model) {
    const table = document.createElement("table");
    table.className = "score-table";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    const th0 = document.createElement("th"); th0.textContent = model.firstHeader; htr.appendChild(th0);
    model.colDefs.forEach(([, lab]) => { const th = document.createElement("th"); th.textContent = lab; htr.appendChild(th); });
    thead.appendChild(htr); table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const totalCols = 1 + model.colDefs.length;
    model.groups.forEach((g) => {
      const gtr = document.createElement("tr"); gtr.className = "group-row";
      const gtd = document.createElement("td"); gtd.colSpan = totalCols; gtd.textContent = g.title;
      gtr.appendChild(gtd); tbody.appendChild(gtr);
      g.rows.forEach((r) => {
        const tr = document.createElement("tr");
        if (model.showColor && r.color) tr.style.background = tableHexToRgba(r.color, 0.10);
        const ltd = document.createElement("td"); ltd.className = "cell-label";
        ltd.textContent = r.label;
        if (r.inverted) {
          const star = document.createElement("span");
          star.className = "inv-star"; star.textContent = " *";
          star.title = "Score inversé (élevé = défavorable)";
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
    [["test", "Par test"], ["function", "Par fonction"]].forEach(([v, lab]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = lab;
      if (s.tableGroupBy === v) b.classList.add("active");
      b.addEventListener("click", () => { s.tableGroupBy = v; markDirty(); renderTableView(); });
      grp.appendChild(b);
    });
    bar.appendChild(grp);

    const colsWrap = document.createElement("div");
    colsWrap.className = "table-col-toggles";
    [["value", "Valeur"], ["type", "Type"], ["percentile", "Rang centile"], ["classification", "Classification"], ["color", "Couleur"]].forEach(([k, lab]) => {
      const l = document.createElement("label"); l.className = "table-col-toggle";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = s.tableColumns[k] !== false;
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
      empty.textContent = "Aucun score saisi pour le moment. Revenez à l'étape « Saisie des scores » pour en ajouter.";
      wrap.appendChild(empty);
      return;
    }
    wrap.appendChild(buildTableElement(model));
    if (model.anyInverted) {
      const note = document.createElement("p");
      note.className = "table-footnote";
      note.textContent = "* Score inversé (élevé = défavorable) : positionné et classé selon son écart inverse à la moyenne.";
      wrap.appendChild(note);
    }
  }

  function tableToOfficeHTML() {
    const model = buildTableModel();
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const totalCols = 1 + model.colDefs.length;
    let h = '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt">';
    h += '<thead><tr style="background:#1b7fb5;color:#ffffff;font-weight:bold">';
    h += '<th align="left">' + esc(model.firstHeader) + '</th>';
    model.colDefs.forEach(([, lab]) => { h += '<th align="left">' + esc(lab) + '</th>'; });
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
        h += '</tr>';
      });
    });
    h += '</tbody></table>';
    const title = esc(currentProject.title || "Vizéa");
    const foot = model.anyInverted
      ? '<p style="font-family:Calibri,Arial,sans-serif;font-size:9pt;color:#555">* Score inversé (élevé = défavorable) : positionné et classé selon son écart inverse à la moyenne.</p>'
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
      h.textContent = "Enregistrer sous";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nommez le fichier avant de le télécharger. Il ira dans le dossier de téléchargement de votre navigateur.";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "modal-input";
      input.value = suggestedName;
      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const save = document.createElement("button");
      save.type = "button"; save.className = "btn-primary"; save.textContent = "Enregistrer";
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "btn-ghost"; cancel.textContent = "Annuler";
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

  function tableDownload(content, type, filename) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportTableExcel() {
    const blob = new Blob(["\ufeff" + tableToOfficeHTML()], { type: "application/vnd.ms-excel" });
    saveBlob(blob, tableProjBase() + ".xls", { description: "Classeur Excel", accept: { "application/vnd.ms-excel": [".xls"] } })
      .then((saved) => { if (saved) toast("Tableau exporté en Excel (.xls)."); });
  }


  // In percentile mode the axis is inherently proportional to rarity, so the
  // toggle is forced on and locked (it would have no effect either way).
  function updateAxisLimitsHint() {
    const hint = $("axisLimitsHint");
    if (!hint || !currentProject) return;
    const scale = currentProject.chartSettings.displayScale || "Percentile";
    hint.textContent = `En valeurs « ${scale} ». Laissez vide pour l'étendue automatique.`;
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
      grip.title = "Glisser pour élargir";
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

    $("opt-showBands")?.addEventListener("change", (e) => { s().showBands = e.target.checked; renderChart(); });
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
      const label = block && block.querySelector(".panel-label");
      if (!block || !label || $("opt-useEgqi")) return;
      const wrap = document.createElement("label");
      wrap.className = "panel-toggle egqi-toggle";
      wrap.innerHTML = '<input type="checkbox" id="opt-useEgqi"><span>Utiliser le score à l\'EGQI</span>';
      const hint = document.createElement("p");
      hint.id = "opt-useEgqiHint"; hint.className = "fn-subhint";
      hint.textContent = "Entrez une valeur à l'EGQI (test Wechsler) pour l'activer.";
      label.after(wrap, hint);
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
      if (s().chartType === "scales") s().scalesTitle = e.target.value;
      else s().title = e.target.value;
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
        '<label class="panel-label" for="opt-scalesDisplay">Échelle affichée</label>' +
        '<select id="opt-scalesDisplay" class="condition-type">' +
        '<option value="Standard score">Score standard</option>' +
        '<option value="Percentile">Rang centile</option></select>';
      // Insert just after the profile display-scale select (and its label).
      ds.after(wrap);
      $("opt-scalesDisplay").addEventListener("change", (e) => {
        s().scalesDisplay = e.target.value;
        syncProportionalLock();
        renderChart();
      });
    })();

    (function injectScalesExtras() {
      if ($("scalesExtras")) return;
      const compareBlock = document.querySelector(".compare-block");
      if (!compareBlock || !compareBlock.parentNode) return;
      const box = document.createElement("div");
      box.id = "scalesExtras";
      box.style.display = "none";
      box.innerHTML =
        '<label class="panel-label" for="opt-scalesColor">Couleur de la ligne</label>' +
        '<input type="color" id="opt-scalesColor" class="color-input">' +
        '<label class="panel-label" style="margin-top:14px;">Échelles affichées</label>' +
        '<div id="opt-scalesVisible" class="fn-list"></div>';
      compareBlock.after(box);
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
        window.VizeaChart.renderChart(currentProject, "vizPlot");
      };
      window.VizeaChart.setForceLight(true);
      Promise.resolve(window.VizeaChart.renderChart(currentProject, "vizPlot"))
        .then(() => window.Plotly.relayout(el, { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" }))
        .then(() => window.Plotly.toImage(el, { format: "png", scale: 2, width: 1400, height: 800 }))
        .then((dataUrl) => {
          finish(); // restore the on-screen chart right away
          return saveBlob(dataUrlToBlob(dataUrl), tableProjBase() + ".png", { description: "Image PNG", accept: { "image/png": [".png"] } });
        })
        .then((saved) => { if (saved) toast("Image exportée (PNG)."); })
        .catch(() => finish());
    });

    $("saveTemplateBtn")?.addEventListener("click", () => {
      const name = prompt("Nom du modèle (sélection de tests + préférences, sans aucun score) :",
        currentProject.title || "Mon modèle");
      if (!name) return;
      const tmpl = DM.extractTemplateFromProject(currentProject, name);
      DM.saveLocalTemplate(tmpl);
      refreshTemplateSelect();
      toast("Modèle enregistré (sans données cliniques).");
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
        if (saved) { dirty = false; toast("Projet exporté."); }
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
  function buildPanelDynamicControls() {
    const settings = currentProject.chartSettings;
    // sync static controls to settings
    $("opt-displayScale").value = settings.displayScale;
    $("opt-showBands").checked = settings.showBands !== false;
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
    $("opt-title").value = isScales ? (settings.scalesTitle || "") : (settings.title || "");
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
      fnList.innerHTML = '<p class="muted small">Aucune fonction à afficher.</p>';
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
      handle.title = "Glisser pour réordonner";

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
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "fn-rename";
      nameInput.value = settings.functionLabels[fn] || fn;
      nameInput.title = "Renommer pour l'affichage (n'affecte pas les scores ni le regroupement)";
      nameInput.addEventListener("focus", () => { row.draggable = false; nameInput.select(); });
      nameInput.addEventListener("blur", () => {
        row.draggable = true;
        if (!settings.functionLabels[fn]) nameInput.value = fn;
      });
      nameInput.addEventListener("input", () => {
        const v = nameInput.value.trim();
        if (!v || v === fn) delete settings.functionLabels[fn];
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
      list.innerHTML = '<p class="muted small">Aucun test à afficher.</p>';
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
      handle.title = "Glisser pour réordonner";

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
        `Valeur inhabituelle pour un ${type.toLowerCase()} (plage attendue : ${b.min} à ${b.max}).`;
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
    if (!names.length) { host.innerHTML = '<p class="fn-subhint">Aucune échelle saisie.</p>'; return; }

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
      handle.title = "Glisser pour réordonner";

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
    document.querySelectorAll('[data-only]').forEach((el) => {
      el.style.display = el.getAttribute("data-only") === chartType ? "" : "none";
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

  function setupSuggestForm() {
    // Build the function checkboxes from the canonical list (+ "batterie")
    const fnDiv = $("functions");
    if (fnDiv) {
      const opts = ["Batterie évaluant plusieurs fonctions", ...COGNITIVE_FUNCTIONS];
      opts.forEach((fn) => {
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "functions";
        cb.value = fn;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(fn));
        fnDiv.appendChild(lab);
      });
    }

    $("suggestSend")?.addEventListener("click", async () => {
      const testName = $("testName")?.value.trim() || "";
      const selected = $$('input[name="functions"]:checked').map((cb) => cb.value);
      const description = $("description")?.value.trim() || "";
      const contactName = $("contactName")?.value.trim() || "";
      const contactEmail = $("contactEmail")?.value.trim() || "";
      const ok = $("suggestSuccess");
      const err = $("suggestError");
      ok.style.display = "none";
      err.style.display = "none";

      if (!testName || selected.length === 0) {
        err.textContent = "Indiquez un nom de test et au moins une fonction cognitive.";
        err.style.display = "block";
        return;
      }

      if (!SUGGESTIONS_ENDPOINT) {
        err.textContent = "Le formulaire n'est pas encore connecté. (Configurez SUGGESTIONS_ENDPOINT dans app.js.)";
        err.style.display = "block";
        return;
      }

      const btn = $("suggestSend");
      const payload = {
        test_name: testName,
        cognitive_functions: selected,
        description,
        contact_name: contactName,
        contact_email: contactEmail
      };

      try {
        btn.disabled = true;
        btn.textContent = "Envoi…";
        // Apps Script Web Apps don't return CORS headers, so we use a "simple"
        // request (text/plain) and no-cors. We can't read the response, but the
        // row is written; we treat a completed request as success.
        await fetch(SUGGESTIONS_ENDPOINT, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });
        $("suggestForm").reset();
        ok.style.display = "block";
        setTimeout(() => (ok.style.display = "none"), 6000);
      } catch (e) {
        console.warn("suggestion send failed", e);
        err.textContent = "Erreur lors de l'envoi. Vérifiez votre connexion et réessayez.";
        err.style.display = "block";
      } finally {
        btn.disabled = false;
        btn.textContent = "Envoyer la suggestion";
      }
    });
  }

  // =========================================================================
  // DONATE (PayPal) — lazy, never blocks the rest of the app
  // =========================================================================
  let paypalInitStarted = false;

  function getDonationAmount() {
    const sel = document.querySelector('input[name="donation-amount"]:checked');
    if (!sel) return 10;
    if (sel.value === "autre") {
      const v = parseFloat($("customAmount")?.value);
      return isNaN(v) || v <= 0 ? 10 : v;
    }
    return parseFloat(sel.value);
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
        createOrder: (data, actions) =>
          actions.order.create({ purchase_units: [{ amount: { value: getDonationAmount().toFixed(2) } }] }),
        onApprove: (data, actions) =>
          actions.order.capture().then(() => { if (thanks) thanks.style.display = "block"; })
      }).render("#paypal-button-container");
    } catch (e) {
      console.warn("PayPal render failed", e);
      if (loading) { loading.textContent = "Le module de paiement n'a pas pu se charger."; loading.style.display = "block"; }
    }
  }

  // Injects the PayPal SDK on demand (first visit to the donate page).
  function initPayPalLazy() {
    if (paypalInitStarted) return;
    paypalInitStarted = true;

    if (typeof window.paypal !== "undefined") { renderPayPalButtons(); return; }

    const loading = $("paypalLoading");
    if (loading) loading.style.display = "block";

    const script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js?client-id=BAAI4m0yUdkGit6WfOe6AlMmlvv3rdGM-cxcZ3-DzPT4tQNsHgvHbPVZbg-oIss6ZRmyITRrST5aavZXuk&currency=CAD&disable-funding=card,credit,paylater";
    script.onload = renderPayPalButtons;
    script.onerror = () => {
      if (loading) { loading.textContent = "Le module de paiement n'a pas pu se charger (bloqué ou hors-ligne)."; }
    };
    document.body.appendChild(script);
  }

  function setupDonate() {
    // Re-render the buttons if the amount selection changes (so the order uses
    // the latest amount). PayPal reads the amount at order-create time anyway,
    // but re-rendering keeps custom-amount edits in sync.
    $$('input[name="donation-amount"]').forEach((r) =>
      r.addEventListener("change", () => { if (typeof window.paypal !== "undefined") renderPayPalButtons(); }));
  }

  // =========================================================================
  // UNSAVED CHANGES WARNING
  // =========================================================================
  function setupUnloadWarning() {
    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
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
    const proj = DM.createEmptyProject("Démonstration");
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

  function demoCleanup(toHome) {
    if (!_demo) return;
    demoClearTyper();
    window.removeEventListener("resize", _demo.repos);
    window.removeEventListener("scroll", _demo.repos, true);
    if (_demo.spot) _demo.spot.remove();
    if (_demo.bubble) _demo.bubble.remove();
    _demo = null;
    if (toHome) goToPage("page-home");
  }

  function demoPosition(target) {
    if (!_demo) return;
    const spot = _demo.spot, bubble = _demo.bubble, pad = 8;
    if (!target) {
      spot.style.display = "none";
      bubble.style.width = "";
      bubble.style.maxWidth = "380px";
      bubble.style.left = "50%"; bubble.style.top = "50%";
      bubble.style.transform = "translate(-50%,-50%)";
      return;
    }
    const r = target.getBoundingClientRect();
    spot.style.display = "block";
    spot.style.left = (r.left - pad) + "px";
    spot.style.top = (r.top - pad) + "px";
    spot.style.width = (r.width + pad * 2) + "px";
    spot.style.height = (r.height + pad * 2) + "px";
    bubble.style.transform = "none";
    bubble.style.maxWidth = "";
    const bw = Math.min(360, window.innerWidth - 24);
    bubble.style.width = bw + "px";
    const bh = bubble.offsetHeight || 170;
    const bx = Math.min(Math.max(12, r.left), window.innerWidth - bw - 12);
    let by;
    if (r.bottom + bh + 16 < window.innerHeight) by = r.bottom + 14;
    else if (r.top - bh - 14 > 8) by = r.top - bh - 14;
    else by = Math.max(12, (window.innerHeight - bh) / 2);
    bubble.style.left = bx + "px";
    bubble.style.top = by + "px";
  }

  function demoRender() {
    if (!_demo) return;
    demoClearTyper();
    const steps = _demo.steps, i = _demo.i, step = steps[i];
    if (!step) { demoCleanup(false); return; }
    if (step.before) { try { step.before(); } catch (e) {} }
    setTimeout(() => {
      if (!_demo) return;
      const target = typeof step.target === "function"
        ? step.target()
        : (step.target ? document.querySelector(step.target) : null);
      const b = _demo.bubble;
      b.innerHTML = "";
      const count = document.createElement("div");
      count.className = "demo-step-count";
      count.textContent = "Étape " + (i + 1) + " sur " + steps.length;
      b.appendChild(count);
      if (step.title) {
        const title = document.createElement("div");
        title.className = "demo-bubble-title";
        title.textContent = step.title;
        b.appendChild(title);
      }
      const body = document.createElement("div");
      body.className = "demo-bubble-body";
      body.textContent = step.body || "";
      b.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "demo-bubble-actions";
      const quit = document.createElement("button");
      quit.type = "button";
      quit.className = "demo-btn demo-btn-ghost";
      quit.textContent = "Quitter";
      quit.addEventListener("click", () => demoCleanup(true));
      const next = document.createElement("button");
      next.type = "button";
      next.className = "demo-btn demo-btn-next";
      next.textContent = (i === steps.length - 1) ? "Terminer" : "Suivant";
      next.addEventListener("click", () => {
        if (step.onNext) { try { step.onNext(); } catch (e) {} }
        if (!_demo) return;
        _demo.i++;
        demoRender();
      });
      actions.appendChild(quit);
      actions.appendChild(next);
      b.appendChild(actions);
      if (target && target.scrollIntoView) { try { target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {} }
      setTimeout(() => demoPosition(target), target ? 300 : 20);
    }, step.wait || 60);
  }

  function demoSteps() {
    const onStep = (n) => { if (currentStep !== n) showStep(n); };
    const ensureStep0 = () => { goToPage("page-new"); showStep(0); };
    const setView = (v) => { const b = document.querySelector('#viewSwitch button[data-view="' + v + '"]'); if (b) b.click(); };
    return [
      {
        target: "#homeLogo",
        title: "Bienvenue dans Vizéa",
        body: "Cette courte visite vous montre l'outil de bout en bout, avec des données fictives. Appuyez sur « Suivant » pour avancer à votre rythme — vous pouvez quitter à tout moment.",
        before: () => goToPage("page-home"),
        wait: 120
      },
      {
        target: '#topnav [data-target="page-new"]',
        title: "Tout commence ici",
        body: "L'onglet « Visualisation » ouvre le flux en quatre étapes : projet, sélection des tests, saisie des scores, puis le graphique.",
        before: () => goToPage("page-home")
      },
      {
        target: "#projectTitle",
        title: "1 · Le projet",
        body: "On donne un nom au projet — regardez, la démo le saisit.",
        before: () => {
          ensureStep0();
          const cb = $("confirmNoPI"); if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); }
          demoType($("projectTitle"), "Démonstration");
        },
        wait: 260
      },
      {
        target: "#importProjectBtn",
        title: "Reprendre un projet",
        body: "Vous terminez une deuxième rencontre et voulez compléter un profil déjà commencé ? Importez le projet enregistré pour continuer exactement là où vous étiez.",
        before: ensureStep0,
        wait: 160
      },
      {
        target: "#templateSelect",
        title: "Partir d'un modèle",
        body: "Vous utilisez souvent la même batterie ? Un modèle réutilise les mêmes tests et les mêmes préférences graphiques — pour gagner du temps à chaque évaluation.",
        before: ensureStep0,
        wait: 160
      },
      {
        target: "#step-1-content",
        title: "2 · Choisir les tests",
        body: "On cherche un test — ici la démo tape « D-KE » — puis on coche ceux qu'on veut. Quelques tests sont déjà sélectionnés pour la suite.",
        before: () => {
          if (!projectInitialized || !currentProject || currentProject.title !== "Démonstration") {
            startProject(buildDemoProject());
          } else {
            onStep(1);
          }
          demoType($("testSearch"), "D-KE");
        },
        wait: 300
      },
      {
        target: () => demoFindCard("WAIS-IV"),
        title: "3 · Saisir les scores",
        body: "Chaque test apparaît en carte. La démo a déjà rempli des scores fictifs — ici le WAIS-IV et ses sous-tests, qui alimenteront aussi les indices.",
        before: () => onStep(2),
        wait: 280
      },
      {
        target: demoLastStroopRow,
        title: "Ajouter un score",
        body: "Un même test peut recevoir plusieurs scores. La démo clique « + Ajouter un score » et saisit « Flexibilité (erreurs) » — chaque score se rattache à la fonction de votre choix.",
        before: () => {
          onStep(2);
          const arr = currentProject.scores["D-KEFS / DKEFS"]["Color-word interference"];
          if (arr.length < 6) { const btn = demoFindStroopAdd(); if (btn) btn.click(); }
          const arr2 = currentProject.scores["D-KEFS / DKEFS"]["Color-word interference"];
          const cond = arr2[arr2.length - 1];
          if (cond) cond.functions = ["Fonctions exécutives"];
          const row = demoLastStroopRow();
          if (row) {
            const disp = row.querySelector(".multi-select-display"); if (disp) disp.textContent = "Fonctions exécutives";
            const valInput = row.querySelector(".condition-value");
            if (valInput) { valInput.value = "8"; valInput.dispatchEvent(new Event("input", { bubbles: true })); }
            demoType(row.querySelector(".condition-name"), "Flexibilité (erreurs)");
          }
        },
        wait: 320
      },
      {
        target: () => demoFindCondDisplay("Couleurs"),
        title: "Réassigner la fonction",
        body: "Chaque score est rattaché à une fonction cognitive, modifiable ici. Par exemple, vous pourriez vouloir classer « Couleurs » et « Mots » sous le langage oral plutôt que les fonctions exécutives — c'est vous qui décidez.",
        before: () => onStep(2),
        wait: 140
      },
      {
        target: "#viewSwitch",
        title: "4 · Le graphique",
        body: "Voici le profil cognitif : chaque point est placé selon son rang centile, sur des bandes d'interprétation. Le sélecteur en haut bascule entre quatre visualisations — suivons-les une à une.",
        before: () => { onStep(3); setView("line"); },
        wait: 340
      },
      {
        target: "#viewSwitch",
        title: "Vue Échelles",
        body: "La vue « Échelles » présente les indices composites (ICV, IRP, IMT, IVT…) plutôt que les sous-tests individuels.",
        before: () => { onStep(3); setView("scales"); },
        wait: 300
      },
      {
        target: "#viewSwitch",
        title: "Vue Radar",
        body: "La vue « Radar » dispose les fonctions en étoile — pratique pour saisir la forme générale du profil d'un coup d'œil.",
        before: () => { onStep(3); setView("radar"); },
        wait: 300
      },
      {
        target: "#panelToggle",
        title: "Personnaliser le graphique",
        body: "Le bouton « Personnaliser » ouvre un panneau pour ajuster les couleurs, l'ordre des fonctions, les bandes d'interprétation et les axes.",
        before: () => { onStep(3); setView("line"); },
        wait: 220
      },
      {
        target: "#vaImageBtn",
        title: "Exporter — Image (PNG)",
        body: "Depuis une vue graphique, ce bouton exporte une image PNG haute résolution, prête à être utilisée.",
        before: () => { onStep(3); setView("line"); },
        wait: 200
      },
      {
        target: "#viewSwitch",
        title: "Vue Tableau",
        body: "La vue « Tableau » liste les scores — regroupés par test ou par fonction — avec, pour chacun, la valeur, le rang centile et la classification.",
        before: () => { onStep(3); setView("table"); },
        wait: 320
      },
      {
        target: "#vaExcelBtn",
        title: "Exporter — Excel",
        body: "En vue Tableau, ce bouton exporte le tableau vers Excel, prêt à intégrer dans un rapport.",
        before: () => { onStep(3); setView("table"); },
        wait: 220
      },
      {
        target: "#vaTemplateBtn",
        title: "Exporter — Modèle",
        body: "Enregistre les tests choisis et vos préférences graphiques comme modèle réutilisable, pour gagner du temps aux prochaines évaluations.",
        before: () => onStep(3),
        wait: 160
      },
      {
        target: "#vaProjectBtn",
        title: "Exporter — Projet (.vizea)",
        body: "Exporte tout le projet dans un fichier .vizea. Une fois Vizéa installée, un double-clic sur ce fichier rouvre le projet; sinon, on le glisse sur la fenêtre ou on l'importe.",
        before: () => onStep(3),
        wait: 160
      },
      {
        target: null,
        title: "À vous de jouer !",
        body: "C'est tout ! Explorez librement ce projet de démonstration, ou créez le vôtre via « Visualisation ». Bonne visualisation !",
        before: () => onStep(3)
      }
    ];
  }

  function startDemo() {
    if (_demo) demoCleanup(false);
    const spot = document.createElement("div");
    spot.className = "demo-spotlight";
    const bubble = document.createElement("div");
    bubble.className = "demo-bubble";
    document.body.appendChild(spot);
    document.body.appendChild(bubble);
    _demo = { spot, bubble, i: 0, steps: demoSteps(), repos: null, typer: null };
    _demo.repos = () => {
      if (!_demo) return;
      const s = _demo.steps[_demo.i];
      const t = s && (typeof s.target === "function" ? s.target() : (s.target ? document.querySelector(s.target) : null));
      demoPosition(t);
    };
    window.addEventListener("resize", _demo.repos);
    window.addEventListener("scroll", _demo.repos, true);
    demoRender();
  }

  // =========================================================================
  // NOUVEAUTÉS (changelog) — reads an editable nouveautes.json and renders a
  // vertical timeline. To add an entry, edit the JSON file (date, titre, infos).
  // =========================================================================
  function frenchNewsDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    const months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    return Number(m[3]) + " " + (months[Number(m[2]) - 1] || "") + " " + m[1];
  }

  function renderNews(entries) {
    const host = $("newsTimeline");
    if (!host) return;
    host.innerHTML = "";
    const items = (Array.isArray(entries) ? entries.slice() : [])
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!items.length) {
      host.innerHTML = '<p class="news-empty">Aucune nouveauté pour le moment.</p>';
      return;
    }
    items.forEach((e) => {
      const item = document.createElement("article");
      item.className = "news-item";

      const date = document.createElement("div");
      date.className = "news-date";
      date.textContent = frenchNewsDate(e.date);

      const card = document.createElement("div");
      card.className = "news-card";
      const h = document.createElement("h3");
      h.className = "news-title";
      h.textContent = e.titre || e.title || "";
      card.appendChild(h);

      const infos = e.infos || e.points || [];
      if (Array.isArray(infos) && infos.length) {
        const ul = document.createElement("ul");
        ul.className = "news-points";
        infos.forEach((p) => { const li = document.createElement("li"); li.textContent = p; ul.appendChild(li); });
        card.appendChild(ul);
      } else if (typeof infos === "string" && infos) {
        const p = document.createElement("p"); p.className = "news-text"; p.textContent = infos; card.appendChild(p);
      }

      item.append(date, card);
      host.appendChild(item);
    });
  }

  function setupNews() {
    const host = $("newsTimeline");
    if (!host) return;
    host.innerHTML = '<p class="news-empty">Chargement…</p>';
    fetch("nouveautes.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => renderNews(Array.isArray(data) ? data : (data && data.entries) || []))
      .catch(() => { host.innerHTML = '<p class="news-empty">Le journal des nouveautés est momentanément indisponible.</p>'; });
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
