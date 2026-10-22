/* Vizéa — home-anim.js
   Home page motion: the hero (the logo, in particles, becomes the profile; WebGL),
   the live bank count, the scroll-driven "how it works" demo and the counters (GSAP).
   The hero's static markup is the final state, so without JS / WebGL / with reduced
   motion the finished profile simply shows (theme-init.js only adds .hero-anim when motion is OK). */
(function () {
  "use strict";
  // Site-wide: the header gains a soft shadow once the page scrolls.
  var hdr = document.querySelector("body > header");
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // Bank size, read live from tests_bank.json (so it follows every addition):
  // big number = every measure (standalone tests + battery subtests), label spells it out.
  var bankCounts = { tests: 47, subtests: 543, batteries: 43 }; // fallback until the bank loads
  function renderBankLabel() {
    var l = document.getElementById("statTestsLabel");
    if (!l || !bankCounts || !window.VizeaI18n) return;
    l.textContent = window.VizeaI18n.t("home.stat2")
      .replace("{tests}", bankCounts.tests).replace("{subtests}", bankCounts.subtests).replace("{batteries}", bankCounts.batteries);
  }
  fetch("tests_bank.json").then(function (r) { return r.json(); }).then(function (bank) {
    var c = { tests: 0, subtests: 0, batteries: 0 };
    Object.keys(bank).forEach(function (k) {
      var n = Object.keys((bank[k] && bank[k].subtests) || {}).length;
      if (n) { c.subtests += n; c.batteries++; } else { c.tests++; }
    });
    bankCounts = c;
    var el = document.getElementById("statTests");
    if (el) { el.setAttribute("data-count", c.tests + c.subtests); el.textContent = c.tests + c.subtests; }
    renderBankLabel();
  }).catch(function () { /* offline without cache: keep the static text */ });
  document.addEventListener("vizea:langchange", renderBankLabel);
  renderBankLabel();

  // Demo window: cognitive-function names in the current language, and the REAL profile
  // chart drawn by chart.js (same engine as the tool), scaled down to fit the window.
  function renderStoryLabels() {
    var C = window.VizeaConstants;
    document.querySelectorAll("#page-home [data-fn]").forEach(function (el) {
      el.textContent = (C && C.displayFunctionName) ? C.displayFunctionName(el.getAttribute("data-fn")) : el.getAttribute("data-fn");
    });
  }
  function renderStoryChart() {
    var el = document.getElementById("storyPlot");
    var DM = window.VizeaDataModel, VC = window.VizeaChart;
    if (!el || !DM || !VC || !window.Plotly) return;
    var proj = DM.createEmptyProject("Démo");
    var c = function (v, f) { var x = DM.createEmptyCondition([f]); x.value = v; return [x]; };
    proj.scores = { "WISC-V": {
      "Similitudes": c(13, "Langage oral"),
      "Vocabulaire": c(14, "Langage oral"),
      "Compréhension": c(12, "Langage oral"),
      "Matrices": c(10, "Raisonnement fluide"),
      "Balances": c(9, "Raisonnement fluide"),
      "Concepts en images": c(11, "Raisonnement fluide"),
      "Blocs": c(8, "Visuospatial"),
      "Casse-têtes visuels": c(9, "Visuospatial"),
      "Séquences de chiffres": c(6, "Mémoire de travail"),
      "Séquences d'images": c(7, "Mémoire de travail"),
      "Code": c(4, "Vitesse de traitement"),
      "Repérage de symboles": c(5, "Vitesse de traitement")
    } };
    // Fill the card: render once, then widen the drawing so that, scaled to the card's
    // height, it also spans the card's width; render again at that width.
    var wrap = el.parentNode, card = wrap.parentNode;
    var avail = function () { return { w: wrap.clientWidth, h: card.clientHeight - wrap.offsetTop - 14 }; };
    var fit = function () {
      var a = avail(), h = el.offsetHeight || 700, w = el.offsetWidth || 900;
      var k = Math.min(a.w / w, a.h / h);
      el.style.setProperty("--k", k.toFixed(4));
      wrap.style.height = Math.ceil(h * k) + "px";
    };
    // Demo-friendly settings (all real options of the tool): band names on the right,
    // no title and no test names under the axis, bigger text since the window is scaled down.
    Object.assign(proj.chartSettings, { fontScale: 1.45, showBandLabels: true, bandOpacity: 0.2, showTestLabels: false, title: "",
      functionOrder: ["Langage oral", "Raisonnement fluide", "Visuospatial", "Mémoire de travail", "Vitesse de traitement"] });
    el.style.width = "900px";
    var pass = function (n) {
      return Promise.resolve(VC.renderChart(proj, "storyPlot")).then(function () {
        var a = avail(), h = el.offsetHeight || 700, w = el.offsetWidth || 900;
        var target = Math.max(700, Math.min(1500, Math.round(a.w * h / a.h)));
        if (n > 0 && Math.abs(target - w) > 12) { el.style.width = target + "px"; return pass(n - 1); }
      });
    };
    pass(3).then(fit);
  }
  function renderStory() { renderStoryLabels(); try { renderStoryChart(); } catch (e) { /* chart is decorative */ } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderStory); else renderStory();
  document.addEventListener("vizea:langchange", renderStory);
  new MutationObserver(function () { try { renderStoryChart(); } catch (e) {} })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // --- Hero: the Vizéa mark, in particles, becomes the profile (WebGL, no library) ---
  // ~5 s: particles spiral in and draw the logo (tile, brain outline, neurons, synapses);
  // it leans toward the pointer while signals run along the synapses; the network charges,
  // the tile melts into the plot area and every particle flies to its place in the profile
  // (outline → lines, neurons → points, the rest → a dot screen over the bands). The SVG
  // profile is revealed as they land, then the canvas hides until the next visit to the
  // home page, which plays it again. Returns false when
  // WebGL is unavailable (the static profile then shows).
  function heroFx() {
    const svg = document.querySelector("#page-home .stage"), canvas = document.querySelector("#page-home .hero-fx");
    if (!svg || !canvas) return false;
    const viz = canvas.parentNode;
    let gl = null;
    try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true }); } catch (e) { gl = null; }
    if (!gl) { canvas.remove(); return false; }   // the static profile stays

    // ---------- helpers ----------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const outQuart = (t) => 1 - Math.pow(1 - t, 4);
    const outBack = (t) => { const c = 2.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
    const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";

    // ---------- geometry: SVG units, world = SVG centred, y up ----------
    const VB = { w: 460, h: 312 }, EW = 600, EH = 432;           // the canvas overhangs the SVG by 70 / 60 units
    const FOV = 30 * Math.PI / 180, D = (EH / 2) / Math.tan(FOV / 2);
    const wx = (x) => x - VB.w / 2, wy = (y) => VB.h / 2 - y;
    const S = 5.6, toStage = (x, y) => ({ x: 248 + (x - 24) * S, y: 166 + (y - 22.5) * S });   // logo units → SVG (as on the site)
    const TILE = { x: 248, y: 166, hw: 134.4, hh: 134.4, r: 61.6 };
    const PLOT = { x: 248, y: 173, hw: 204, hh: 127, r: 4 };

    const ptEls = [...svg.querySelectorAll(".pf-pts circle")];
    const lineEls = [...svg.querySelectorAll(".pf-lines polyline")];
    const titleEls = [...svg.querySelectorAll(".pf-titles text")];
    const bgEls = [...svg.querySelectorAll(".pf-bands, .pf-grid, .pf-yt, .pf-sep")];
    const PTS = ptEls.map((el) => ({ x: +el.getAttribute("cx"), y: +el.getAttribute("cy"), col: hex(el.style.getPropertyValue("--fc").trim()) }));
    const BANDS = [...svg.querySelectorAll(".pf-bands rect")].map((r) => ({ y0: +r.getAttribute("y"), y1: +r.getAttribute("y") + +r.getAttribute("height"), col: hex(r.getAttribute("fill")) }));
    const SEGS = lineEls.map((el, i) => ({ a: PTS[2 * i], b: PTS[2 * i + 1], col: PTS[2 * i].col }));

    // ---------- particles ----------
    // kind 0: outline of the brain → the profile lines
    // kind 1: neurons → the points
    // kind 2: synapses (firing) → a dot screen over the interpretation bands
    // kind 3: brain volume (soft glow) → same dot screen
    const P = [];
    const DEEP = hex("#1b6fb2"), CYAN = hex("#2fd0e0"), PALE = hex("#eaf6ff"), SYN = hex("#7fd9e8"), VOL = hex("#4fa9e6");

    const path = svg.querySelector(".pf-ref path"), len = path.getTotalLength();
    const N_OUT = 760;
    const segLen = SEGS.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)), totLen = segLen.reduce((a, b) => a + b, 0);
    for (let i = 0; i < N_OUT; i++) {
      const p = path.getPointAtLength(len * (i + rand() * 0.6) / N_OUT), q = toStage(p.x, p.y);
      let d = (i + 0.5) / N_OUT * totLen, si = 0;
      while (d > segLen[si] && si < SEGS.length - 1) { d -= segLen[si]; si++; }
      const s = SEGS[si], u = clamp(d / segLen[si], 0, 1);
      P.push({ k: 0, lx: q.x + (rand() - 0.5) * 1.6, ly: q.y + (rand() - 0.5) * 1.6, lz: 14 + rand() * 5,
        tx: lerp(s.a.x, s.b.x, u) + (rand() - 0.5) * 1.2, ty: lerp(s.a.y, s.b.y, u) + (rand() - 0.5) * 1.2, tz: 0,
        cA: PALE, cB: s.col, aA: 0.95, aB: 0.95, sA: 4.2 + rand() * 1.6, sB: 4.6, seg: si });
    }

    // neurons: the site's hand-placed network, paired with the points from left to right
    const inner = [[17, 13], [25, 11.5], [32, 15], [12.5, 19.5], [20.5, 18.5], [28, 20], [35.5, 22], [15.5, 25.5], [23.5, 24.5], [31, 27],
      [11.5, 30.5], [19.5, 30.5], [27, 32], [34.5, 31], [18, 36.5], [26, 38]].map((a) => toStage(a[0], a[1])).sort((a, b) => a.x - b.x);
    const order = PTS.map((_, k) => k).sort((a, b) => PTS[a].x - PTS[b].x);
    const neuronOf = [];
    inner.forEach((n, k) => {
      const pi = order[k], t = PTS[pi];
      neuronOf[pi] = P.length;
      P.push({ k: 1, lx: n.x, ly: n.y, lz: 24, tx: t.x, ty: t.y, tz: 0, cA: CYAN, cB: t.col, aA: 1, aB: 1, sA: 13, sB: 14, pt: pi });
    });

    // synapses: each neuron to its 2 nearest neighbours, particles strung along them
    const links = [], seen = {};
    inner.forEach((a, ia) => {
      inner.map((b, ib) => ({ ib, d: Math.hypot(a.x - b.x, a.y - b.y) })).filter((o) => o.ib !== ia).sort((u, v) => u.d - v.d).slice(0, 2).forEach((o) => {
        const key = Math.min(ia, o.ib) + "-" + Math.max(ia, o.ib);
        if (!seen[key]) { seen[key] = 1; links.push({ a, b: inner[o.ib], ph: rand(), per: 1.1 + rand() * 0.9 }); }
      });
    });

    // the dot screen over the bands (targets for kinds 2 and 3), shuffled
    const grid = [];
    for (let y = 50; y <= 297; y += 7.5) for (let x = 48; x <= 448; x += 7.5) {
      const b = BANDS.find((bd) => y >= bd.y0 && y < bd.y1) || BANDS[0];
      grid.push({ x, y, col: b.col });
    }
    for (let i = grid.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = grid[i]; grid[i] = grid[j]; grid[j] = t; }
    let gi = 0;
    const dot = () => grid[gi++ % grid.length];

    links.forEach((L, li) => {
      const n = Math.max(6, Math.round(Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y) / 1.7));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, g = dot();
        P.push({ k: 2, lx: lerp(L.a.x, L.b.x, u) + (rand() - 0.5), ly: lerp(L.a.y, L.b.y, u) + (rand() - 0.5), lz: 20 + rand() * 2,
          tx: g.x, ty: g.y, tz: 0, cA: SYN, cB: g.col, aA: 0.5, aB: 0.85, sA: 3.2, sB: 3.6, li, u });
      }
    });

    // brain volume: soft points inside the outline, at depth, so the logo has body when it turns
    const inside = (x, y) => { try { return path.isPointInFill(new DOMPoint(x, y)); } catch (e) { return Math.hypot(x - 24, y - 22.5) < 13; } };
    for (let n = 0; n < 520;) {
      const x = 7 + rand() * 34, y = 6 + rand() * 34;
      if (!inside(x, y)) continue;
      const q = toStage(x, y), g = dot();
      P.push({ k: 3, lx: q.x, ly: q.y, lz: 2 + rand() * 34, tx: g.x, ty: g.y, tz: 0, cA: VOL, cB: g.col, aA: 0.32 + rand() * 0.2, aB: 0.85, sA: 2.6 + rand() * 1.4, sB: 3.6 });
      n++;
    }

    // per particle: where it comes from, timings, its arc
    const R = 3.15;                       // release: the logo lets go of its particles
    const FLY = 1.15;
    const cx = wx(TILE.x), cy = wy(TILE.y);
    P.forEach((p) => {
      const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), r = 300 + rand() * 180;
      p.sx = cx + Math.sin(ph) * Math.cos(th) * r; p.sy = cy + Math.sin(ph) * Math.sin(th) * r * 0.75; p.sz = Math.cos(ph) * r * 0.9;
      p.spin = (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.9);
      p.d0 = 0.05 + rand() * 0.55 + (p.k === 1 ? 0.35 : 0);
      p.d1 = R + 0.06 + 0.5 * (p.tx - 44) / 408 + rand() * 0.1;
      p.lift = 40 + rand() * 120;
      p.burst = 0.25 + rand() * 0.45;
      p.ox = 0; p.oy = 0;
    });
    // the profile is drawn as its particles land
    const arrive = PTS.map((_, i) => P[neuronOf[i]].d1 + FLY);
    const lineAt = SEGS.map((_, i) => Math.max(arrive[2 * i], arrive[2 * i + 1]) + 0.04);
    const END = Math.max.apply(null, lineAt) + 0.9;

    // ---------- WebGL ----------
    const N = P.length, STRIDE = 8, data = new Float32Array(N * STRIDE);
    function program(vs, fs) {
      const pr = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, src]) => {
        const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(pr, sh);
      });
      gl.linkProgram(pr);
      return pr;
    }
    const pProg = program(`
      attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
      uniform mat4 uMVP; uniform float uPx;
      varying vec4 vCol;
      void main() { vec4 p = uMVP * vec4(aPos, 1.0); gl_Position = p; gl_PointSize = max(1.0, aSize * uPx / p.w); vCol = aCol; }`, `
      precision mediump float; varying vec4 vCol; uniform float uGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
        float core = 1.0 - smoothstep(0.42, 0.7, d), halo = pow(1.0 - d, 2.2) * uGlow;
        float a = vCol.a * clamp(core + halo, 0.0, 1.0);
        gl_FragColor = vec4(vCol.rgb * a, a);
      }`);
    const tProg = program(`
      attribute vec3 aPos; attribute vec2 aLoc; uniform mat4 uMVP; varying vec2 vLoc;
      void main() { gl_Position = uMVP * vec4(aPos, 1.0); vLoc = aLoc; }`, `
      precision mediump float; varying vec2 vLoc;
      uniform vec2 uHalf; uniform float uRad, uAlpha, uShade, uMelt; uniform vec2 uSheen; uniform vec3 uBg;
      float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
      void main() {
        float d = box(vLoc, uHalf, uRad), inside = 1.0 - smoothstep(-0.7, 0.7, d);
        vec2 uv = vec2(vLoc.x / uHalf.x + 1.0, 1.0 - vLoc.y / uHalf.y) * 0.5;
        float t = clamp((uv.x + uv.y) * 0.5, 0.0, 1.0);
        vec3 c0 = vec3(0.039, 0.145, 0.251), c1 = vec3(0.051, 0.231, 0.400), c2 = vec3(0.090, 0.420, 0.710);
        vec3 col = t < 0.6 ? mix(c0, c1, t / 0.6) : mix(c1, c2, (t - 0.6) / 0.4);
        vec2 s = uv - uSheen; col += exp(-dot(s, s) * 6.0) * 0.13;           // light that follows the tilt
        col += (1.0 - smoothstep(0.0, 2.4, -d)) * 0.18;                      // a thin lit rim
        col = mix(col, uBg, uMelt);                                          // melts into the page, not into grey
        float ds = box(vLoc - vec2(0.0, -24.0), uHalf * 0.9, uRad);
        float sa = (1.0 - smoothstep(-12.0, 40.0, ds)) * uShade;
        vec4 tile = vec4(col, 1.0) * inside, shadow = vec4(0.04, 0.145, 0.25, 1.0) * sa * (1.0 - uMelt);
        gl_FragColor = (tile + shadow * (1.0 - tile.a)) * uAlpha;
      }`);
    const pBuf = gl.createBuffer(), tBuf = gl.createBuffer();
    const tData = new Float32Array(4 * 5);
    const loc = (pr, n) => gl.getAttribLocation(pr, n), uni = (pr, n) => gl.getUniformLocation(pr, n);
    const PA = { pos: loc(pProg, "aPos"), col: loc(pProg, "aCol"), size: loc(pProg, "aSize"), mvp: uni(pProg, "uMVP"), px: uni(pProg, "uPx"), glow: uni(pProg, "uGlow") };
    const TA = { pos: loc(tProg, "aPos"), loc: loc(tProg, "aLoc"), mvp: uni(tProg, "uMVP"), half: uni(tProg, "uHalf"), rad: uni(tProg, "uRad"), alpha: uni(tProg, "uAlpha"), shade: uni(tProg, "uShade"), sheen: uni(tProg, "uSheen"), melt: uni(tProg, "uMelt"), bg: uni(tProg, "uBg") };

    // camera: looking down -z from D, the z = 0 plane fills the canvas exactly
    const f = 1 / Math.tan(FOV / 2), near = 10, far = 4000;
    const A = (far + near) / (near - far), B = (2 * far * near) / (near - far);
    const MVP = new Float32Array([f / (EW / EH), 0, 0, 0, 0, f, 0, 0, 0, 0, A, -1, 0, 0, -A * D + B, D]);   // projection × translate(0, 0, -D)

    function resize() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);
    resize();

    // ---------- pointer: the logo leans toward it; particles step aside ----------
    const m = { x: 0, y: 0, tx: 0, ty: 0, wx: 9999, wy: 9999, on: false };
    window.addEventListener("pointermove", (e) => {
      const v = viz.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      m.tx = clamp((e.clientX - (v.left + v.width / 2)) / (v.width / 2), -1, 1);
      m.ty = clamp(-(e.clientY - (v.top + v.height / 2)) / (v.height / 2), -1, 1);
      m.wx = ((e.clientX - c.left) / c.width - 0.5) * EW; m.wy = (0.5 - (e.clientY - c.top) / c.height) * EH;
      m.on = true;
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => { m.on = false; m.tx = m.ty = 0; });

    // ---------- the SVG profile, revealed by the same clock ----------
    function paintSVG(T) {
      bgEls.forEach((g, i) => { g.style.opacity = smooth(R + 0.7 + i * 0.06, R + 1.55 + i * 0.06, T); });
      ptEls.forEach((el, i) => {
        const a = arrive[i], k = clamp((T - a) / 0.45, 0, 1);
        el.style.opacity = smooth(a - 0.04, a + 0.06, T);
        el.style.transform = "scale(" + (T < a ? 1.45 : lerp(1.45, 1, outBack(k))).toFixed(3) + ")";
      });
      lineEls.forEach((el, i) => { el.style.strokeDashoffset = (1 - outQuart(clamp((T - lineAt[i]) / 0.42, 0, 1))).toFixed(3); });
      titleEls.forEach((el, i) => {
        const k = clamp((T - lineAt[i] - 0.08) / 0.5, 0, 1);
        el.style.opacity = k; el.style.transform = "translateY(" + (6 * (1 - outQuart(k))).toFixed(2) + "px)";
      });
    }

    // ---------- frame ----------
    let t0 = 0, running = false, last = 0;
    const tilt = { x: 0, y: 0 };
    let bgDark = null, bgCol = [0.96, 0.98, 0.99];
    const sheen = [0.3, 0.25];
    function place(p, ax, ay, rz, sc, c) {   // logo point, turned with the tile about its centre
      let x = (wx(p.lx) - c.x) * sc, y = (wy(p.ly) - c.y) * sc, z = p.lz * sc;
      const cz = Math.cos(rz), sz = Math.sin(rz); let t = x * cz - y * sz; y = x * sz + y * cz; x = t;
      const ca = Math.cos(ax), sa = Math.sin(ax); t = y * ca - z * sa; z = y * sa + z * ca; y = t;
      const cb = Math.cos(ay), sb = Math.sin(ay); t = x * cb + z * sb; z = -x * sb + z * cb; x = t;
      return [c.x + x, c.y + y, z];
    }
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const T = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      const time = now / 1000, dark = isDark();
      if (dark !== bgDark) { bgDark = dark; bgCol = hex(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f6fafd"); }

      // the tile: arrives (scale, small turn), leans toward the pointer, then melts into the plot area
      m.x += (m.tx - m.x) * Math.min(1, dt * 5); m.y += (m.ty - m.y) * Math.min(1, dt * 5);
      const free = 1 - smooth(R, R + 0.5, T);
      tilt.x = (-m.y * 0.32 + 0.05 * Math.sin(time * 0.9)) * free;
      tilt.y = (m.x * 0.42 + 0.08 * Math.sin(time * 0.7)) * free;
      const inA = outQuart(clamp((T - 0.35) / 1.3, 0, 1));
      // just before letting go, the whole network charges up
      const charge = smooth(R - 0.6, R - 0.05, T) * (1 - smooth(R, R + 0.3, T));
      const sc = lerp(0.8, 1, inA) * (1 + 0.03 * charge), rz = lerp(0.14, 0, inA);
      const mk = inOut(clamp((T - R - 0.05) / 1.1, 0, 1));
      const rect = { x: lerp(TILE.x, PLOT.x, mk), y: lerp(TILE.y, PLOT.y, mk), hw: lerp(TILE.hw, PLOT.hw, mk), hh: lerp(TILE.hh, PLOT.hh, mk), r: lerp(TILE.r, PLOT.r, mk) };
      const tileA = smooth(0.3, 1.2, T) * (1 - smooth(R + 0.4, R + 1.05, T));
      const c = { x: wx(rect.x), y: wy(rect.y) };
      const cLogo = { x: cx, y: cy };

      // tile quad (the shadow spills past the rounded square)
      const pad = 70, hw = (rect.hw + pad), hh = (rect.hh + pad);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sxn, syn], i) => {
        const lxv = sxn * hw, lyv = syn * hh;
        let x = lxv * sc, y = lyv * sc, z = 0;
        const cz = Math.cos(rz), sz = Math.sin(rz); let t = x * cz - y * sz; y = x * sz + y * cz; x = t;
        const ca = Math.cos(tilt.x), sa = Math.sin(tilt.x); t = y * ca - z * sa; z = y * sa + z * ca; y = t;
        const cb = Math.cos(tilt.y), sb = Math.sin(tilt.y); t = x * cb + z * sb; z = -x * sb + z * cb; x = t;
        tData.set([c.x + x, c.y + y, z, lxv, lyv], i * 5);
      });
      sheen[0] = 0.3 - tilt.y * 0.7; sheen[1] = 0.22 - tilt.x * 0.7;

      // particles
      const melt = smooth(R + 0.1, R + 0.9, T);
      const near = m.on && T < R ? 1 : 0;
      for (let i = 0; i < N; i++) {
        const p = P[i], o = i * STRIDE;
        const a0 = clamp((T - p.d0) / 1.35, 0, 1), e0 = outQuart(a0);
        // on the logo (turned with it)
        const L = place(p, tilt.x, tilt.y, rz, sc, cLogo);
        let x, y, z, col = p.cA, alpha = p.aA, size = p.sA;
        // ripple around the pointer while the logo holds
        let px = 0, py = 0;
        if (near) {
          const dx = L[0] - m.wx, dy = L[1] - m.wy, d = Math.hypot(dx, dy);
          if (d < 48 && d > 0.01) { const k = 11 * Math.pow(1 - d / 48, 2); px = dx / d * k; py = dy / d * k; }
        }
        p.ox += (px - p.ox) * Math.min(1, dt * 8); p.oy += (py - p.oy) * Math.min(1, dt * 8);
        if (T < p.d1) {
          // spiralling in from the cloud
          const ang = (1 - e0) * p.spin * 1.4, ca = Math.cos(ang), sa = Math.sin(ang);
          const ix = lerp(p.sx, L[0], e0) - cLogo.x, iy = lerp(p.sy, L[1], e0) - cLogo.y;
          x = cLogo.x + ix * ca - iy * sa + p.ox; y = cLogo.y + ix * sa + iy * ca + p.oy; z = lerp(p.sz, L[2], e0);
          alpha = p.aA * smooth(0, 0.45, a0);
          if (p.k === 2) {   // signals running along the synapses
            const lk = links[p.li], h = ((time / lk.per + lk.ph) % 1) * 2.2 - 0.1;
            const s = Math.max(Math.exp(-Math.pow((p.u - h) * 6, 2)) * (h < 1.1 ? 1 : 0) * smooth(1.2, 1.8, T), charge * 0.85);
            col = [lerp(SYN[0], 1, s), lerp(SYN[1], 1, s), lerp(SYN[2], 1, s)];
            alpha = alpha * (1 + s * 1.2); size = p.sA + s * 2.4;
          }
          if (p.k === 1) size = p.sA * (1 + 0.12 * Math.sin(time * 3 + p.lx) + 0.3 * charge);
          if (p.k === 0) size = p.sA + charge * 1.4;
        } else {
          // release: thrown outward and toward the viewer, then down onto the profile
          const k = clamp((T - p.d1) / FLY, 0, 1), e = inOut(k), u = 1 - e;
          const tx = wx(p.tx), ty = wy(p.ty);
          const bx = (L[0] - cLogo.x) * p.burst, by = (L[1] - cLogo.y) * p.burst;
          const mx = (L[0] + tx) / 2 + bx, my = (L[1] + ty) / 2 + by, mz = (L[2] + p.tz) / 2 + p.lift;
          x = u * u * L[0] + 2 * u * e * mx + e * e * tx;
          y = u * u * L[1] + 2 * u * e * my + e * e * ty;
          z = u * u * L[2] + 2 * u * e * mz + e * e * p.tz;
          // on a light page, the pale logo colours deepen as the tile melts away, so the shape stays visible
          const w0 = dark ? 0 : melt * 0.75, a0c = [lerp(p.cA[0], DEEP[0], w0), lerp(p.cA[1], DEEP[1], w0), lerp(p.cA[2], DEEP[2], w0)];
          col = [lerp(a0c[0], p.cB[0], e), lerp(a0c[1], p.cB[1], e), lerp(a0c[2], p.cB[2], e)];
          alpha = lerp(p.aA, p.aB, e); size = lerp(p.sA, p.sB, e);
          if (dark && p.k === 0) alpha *= lerp(1, 0.38, e);   // dense lines would saturate to white when added up
          // hand over to the crisp SVG as it appears
          if (p.k === 0) alpha *= 1 - smooth(lineAt[p.seg] + 0.05, lineAt[p.seg] + 0.4, T);
          else if (p.k === 1) alpha *= 1 - smooth(arrive[p.pt], arrive[p.pt] + 0.12, T);
          else alpha *= 1 - smooth(p.d1 + FLY - 0.05, p.d1 + FLY + 0.5, T);
        }
        data[o] = x; data[o + 1] = y; data[o + 2] = z;
        data[o + 3] = col[0]; data[o + 4] = col[1]; data[o + 5] = col[2]; data[o + 6] = clamp(alpha, 0, 1); data[o + 7] = size;
      }

      paintSVG(T);

      // draw
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      if (tileA > 0.001) {
        gl.useProgram(tProg);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ARRAY_BUFFER, tBuf); gl.bufferData(gl.ARRAY_BUFFER, tData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(TA.pos); gl.vertexAttribPointer(TA.pos, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(TA.loc); gl.vertexAttribPointer(TA.loc, 2, gl.FLOAT, false, 20, 12);
        gl.uniformMatrix4fv(TA.mvp, false, MVP);
        gl.uniform2f(TA.half, rect.hw, rect.hh); gl.uniform1f(TA.rad, rect.r);
        gl.uniform1f(TA.alpha, tileA); gl.uniform1f(TA.shade, dark ? 0.55 : 0.34); gl.uniform2f(TA.sheen, sheen[0], sheen[1]);
        gl.uniform1f(TA.melt, melt); gl.uniform3fv(TA.bg, bgCol);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(TA.loc);
      }
      gl.useProgram(pProg);
      // additive glow on the navy tile and in dark mode; plain "over" once the particles land on a light page
      const additive = dark || T < R + 0.45;
      gl.blendFunc(gl.ONE, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(PA.pos); gl.vertexAttribPointer(PA.pos, 3, gl.FLOAT, false, STRIDE * 4, 0);
      gl.enableVertexAttribArray(PA.col); gl.vertexAttribPointer(PA.col, 4, gl.FLOAT, false, STRIDE * 4, 12);
      gl.enableVertexAttribArray(PA.size); gl.vertexAttribPointer(PA.size, 1, gl.FLOAT, false, STRIDE * 4, 28);
      gl.uniformMatrix4fv(PA.mvp, false, MVP);
      gl.uniform1f(PA.px, canvas.height / EH * D);
      gl.uniform1f(PA.glow, additive ? 0.55 : 0.25);
      gl.drawArrays(gl.POINTS, 0, N);

      if (T > END) finish();   // done: the SVG is the profile

    }

    // hide the final state now, play once the hero is on screen
    paintSVG(-1);
    document.documentElement.classList.add("anim-live");
    let dead = false;
    function finish() {
      running = false; paintSVG(1e9);
      if (!dead) { gl.clear(gl.COLOR_BUFFER_BIT); canvas.style.visibility = "hidden"; }
    }
    function play() {
      if (dead) return;
      paintSVG(-1); resize();
      P.forEach((p) => { p.ox = p.oy = 0; });
      canvas.style.visibility = "";
      t0 = last = performance.now() + 120;
      if (!running) { running = true; requestAnimationFrame(frame); }
    }
    // the browser may reclaim the GPU: the static profile then simply stays
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); dead = true; finish(); });
    const start = () => { resize(); const go = () => requestAnimationFrame(play); if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go(); };
    if (!window.IntersectionObserver) start();
    else {
      const io = new IntersectionObserver((en) => { if (en[0].isIntersecting && canvas.clientWidth) { io.disconnect(); start(); } });
      io.observe(svg);
    }
    // played again every time the home page is opened (logo, menu, back button)
    const home = document.getElementById("page-home");
    if (home && window.MutationObserver) {
      new MutationObserver((recs) => {
        const on = home.classList.contains("active");
        // (re)opened: "active" was added, even if the page was already showing (logo clicked on the home page)
        const opened = recs.some((r) => !/(^|\s)active(\s|$)/.test(r.oldValue || ""));
        if (on && opened) requestAnimationFrame(play);
        else if (!on && running) finish();
      }).observe(home, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    }
    return true;
  }
  if (reduced || !heroFx()) {
    root.classList.remove("hero-anim");
    var fx = document.querySelector("#page-home .hero-fx"); if (fx) fx.remove();
  }
  if (reduced || !window.gsap) return;
  var gsap = window.gsap;
  if (root.classList.contains("hero-anim")) gsap.from("#page-home .hero-content > *", { y: 26, opacity: 0, duration: 1, stagger: 0.08, delay: 0.3, ease: "power3.out" });
  // --- Faits en bref : nombre réel de tests + compteurs qui défilent à l'apparition ---

  // --- « Comment ça marche » : démonstration pilotée par le défilement (ordinateur seulement) ---
  var story = document.querySelector("#page-home .story");
  if (story && window.ScrollTrigger) {
    var ST = window.ScrollTrigger;
    gsap.registerPlugin(ST);
    gsap.matchMedia().add("(min-width: 941px)", function () {
      var q = function (s) { return gsap.utils.toArray(story.querySelectorAll(s)); };
      var screens = q(".mock-screen"), steps = q(".story-step"), pills = q(".mock-step");
      var box1 = q(".ms-1 .mock-cb"), box2 = q(".ms-2 .mock-cb");
      var fillOf = function (b) { return b.querySelector(".ms-fill"); }, tickOf = function (b) { return b.querySelector("svg"); };
      var scroller = story.querySelector(".mock-scroller"), scrollBox = story.querySelector(".mock-scroll");
      story.classList.add("is-live");
      story.style.setProperty("--p", 0);
      gsap.set(screens, { autoAlpha: 0, y: 14 });
      gsap.set(screens[0], { autoAlpha: 1, y: 0 });
      gsap.set(box1.concat(box2).map(fillOf), { scale: 0, transformOrigin: "50% 50%" });
      gsap.set(box1.concat(box2).map(tickOf), { opacity: 0 });
      gsap.set(story.querySelector(".ms-typed"), { clipPath: "inset(0 100% 0 0)" });
      var tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      var swap = function (from, to, at) {
        tl.to(screens[from], { autoAlpha: 0, y: -14, duration: 0.2, ease: "power2.in" }, at)
          .to(screens[to], { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.15);
      };
      var tick = function (box, at) {
        tl.to(fillOf(box), { scale: 1, duration: 0.1 }, at).to(tickOf(box), { opacity: 1, duration: 0.08 }, at + 0.04);
      };
      // 1. Nouveau projet : le nom s'écrit, on confirme, on crée
      tl.to(story.querySelector(".ms-typed"), { clipPath: "inset(0 0% 0 0)", duration: 0.5, ease: "steps(19)" }, 0.08);
      box1.forEach(function (b) { tick(b, 0.68); });
      tl.to(story.querySelector(".mock-create"), { scale: 0.97, duration: 0.06, yoyo: true, repeat: 1 }, 0.84);
      swap(0, 1, 0.95);
      // 2. Sélection des tests : WISC-V, puis ses sous-tests
      box2.forEach(function (b, k) { tick(b, 1.2 + k * 0.075); });
      swap(1, 2, 1.95);
      // 3. Entrée des scores : les valeurs tombent, la liste défile
      tl.from(q(".ms-3 .mock-val b"), { opacity: 0, y: -8, duration: 0.08, stagger: 0.085 }, 2.15)
        .to(scroller, { y: function () { return -Math.max(0, scroller.scrollHeight - scrollBox.clientHeight); }, duration: 0.6, ease: "none" }, 2.25);
      swap(2, 3, 2.95);
      // 4. Graphique : le vrai profil se dévoile de gauche à droite
      tl.fromTo(story.querySelector(".mock-plotwrap"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.6, ease: "power1.inOut" }, 3.15)
        .to({}, { duration: 0.25 }, 3.75);
      var cuts = [0.235, 0.485, 0.735], cur = 0;
      steps[0].classList.add("on");
      ST.create({
        trigger: story.closest(".home-section") || story, start: "top 92px", end: "+=2200", pin: true, anticipatePin: 1, scrub: 0.6, animation: tl,
        invalidateOnRefresh: true,
        onUpdate: function (self) {
          var p = self.progress, i = p < cuts[0] ? 0 : p < cuts[1] ? 1 : p < cuts[2] ? 2 : 3;
          story.style.setProperty("--p", p.toFixed(3));
          if (i === cur) return; cur = i;
          steps.forEach(function (s, k) { s.classList.toggle("on", k === i); });
          pills.forEach(function (s, k) { s.classList.toggle("on", k === i); });
        }
      });
      return function () { story.classList.remove("is-live"); story.style.removeProperty("--p"); };
    });
    var home = document.getElementById("page-home");
    if (home && window.MutationObserver) {
      new MutationObserver(function () {
        if (home.classList.contains("active")) requestAnimationFrame(function () { ST.refresh(); });
      }).observe(home, { attributes: true, attributeFilter: ["class"] });
    }
  }
  var strip = document.querySelector("#page-home .home-stats");
  if (strip && window.IntersectionObserver) {
    new IntersectionObserver(function (entries, io) {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      strip.querySelectorAll("[data-count]").forEach(function (el) {
        var o = { v: 0 }, end = +el.getAttribute("data-count");
        gsap.to(o, { v: end, duration: 1.4, ease: "power2.out", onUpdate: function () { el.textContent = Math.round(o.v); } });
      });
    }, { threshold: 0.4 }).observe(strip);
  }
})();
