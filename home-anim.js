/* Vizéa — home-anim.js
   Home hero story (GSAP, self-hosted), plays on its own at load, ~5 s:
     1. neurons converge and draw the Vizéa mark (navy tile + brain outline), bigger than life;
     2. a small neural network lights up inside the brain and "fires" for a moment;
     3. the tile melts into the chart's plot area, the outline dissipates, and each neuron
        flies on a curved path to become a point of a profile grouped by function.
   The static markup is the final state, so without JS / with reduced motion the
   finished profile simply shows (theme-init.js only adds .hero-anim when motion is OK). */
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
  var stage = document.querySelector("#page-home .stage");
  if (!stage) return;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !window.gsap) { root.classList.remove("hero-anim"); return; }
  root.classList.add("anim-live");

  var gsap = window.gsap;
  var SVGNS = "http://www.w3.org/2000/svg";
  var $ = function (s) { return stage.querySelector(s); };
  var $$ = function (s) { return gsap.utils.toArray(stage.querySelectorAll(s)); };
  var mk = function (tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    parent.appendChild(el); return el;
  };

  // Logo units → stage coordinates (must match the outline's transform attribute).
  var C = { x: 248, y: 166 }, S = 5.6;
  var toStage = function (x, y) { return { x: C.x + (x - 24) * S, y: C.y + (y - 22.5) * S }; };

  var brain = $(".st-brain"), tile = $(".sb-tile"), outline = $(".sb-outline");
  var bg = $$(".pf-bands, .pf-grid, .pf-yt, .pf-sep");
  var titles = $$(".pf-titles text");
  var lines = $$(".pf-lines polyline");
  var pts = $$(".pf-pts circle");

  // --- Neurons that draw the outline ------------------------------------------
  var N = 48, len = outline.getTotalLength(), dust = [];
  for (var i = 0; i < N; i++) {
    var p = outline.getPointAtLength(len * i / N), q = toStage(p.x, p.y);
    dust.push(mk("circle", { cx: q.x, cy: q.y, r: (1.3 + Math.random() * 1.5).toFixed(2) }, $(".st-dust")));
  }

  // --- Neural network inside the brain: one neuron per data point --------------
  // Hand-placed in logo units so they sit comfortably inside the outline.
  var inner = [[17, 13], [25, 11.5], [32, 15], [12.5, 19.5], [20.5, 18.5], [28, 20], [35.5, 22],
    [15.5, 25.5], [23.5, 24.5], [31, 27], [11.5, 30.5], [19.5, 30.5], [27, 32], [34.5, 31],
    [18, 36.5], [26, 38]].map(function (a) { return toStage(a[0], a[1]); });
  // Left neurons fly to left points: pair both sets by x so the paths don't tangle.
  inner.sort(function (a, b) { return a.x - b.x; });
  var order = pts.map(function (el, k) { return k; })
    .sort(function (a, b) { return pts[a].cx.baseVal.value - pts[b].cx.baseVal.value; });

  // Synapses: each neuron to its 2 nearest neighbours.
  var linkG = $(".sb-links"), seen = {}, links = [];
  inner.forEach(function (a, ia) {
    inner.map(function (b, ib) { return { ib: ib, d: Math.hypot(a.x - b.x, a.y - b.y) }; })
      .filter(function (o) { return o.ib !== ia; })
      .sort(function (u, v) { return u.d - v.d; })
      .slice(0, 2)
      .forEach(function (o) {
        var key = Math.min(ia, o.ib) + "-" + Math.max(ia, o.ib);
        if (seen[key]) return; seen[key] = 1;
        var b = inner[o.ib];
        links.push(mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, pathLength: 1 }, linkG));
      });
  });

  // --- Initial state ---------------------------------------------------------
  gsap.set(bg.concat(titles), { opacity: 0 });
  gsap.set(titles, { y: 6 });
  gsap.set(lines, { strokeDashoffset: 1 });
  gsap.set(brain, { opacity: 1 });
  gsap.set(tile, { opacity: 0, scale: 0.7, rotation: -8, svgOrigin: C.x + " " + C.y });
  gsap.set(outline, { strokeDashoffset: 1, opacity: 0 }); // opacity: hides the round-cap dot before the draw starts
  gsap.set(links, { strokeDasharray: 1, strokeDashoffset: 1 });
  var finals = pts.map(function (el) {
    var cs = getComputedStyle(el);
    return { fill: cs.fill, stroke: cs.stroke };
  });
  order.forEach(function (ptIndex, k) {
    var el = pts[ptIndex], t = inner[k];
    gsap.set(el, {
      x: t.x - el.cx.baseVal.value, y: t.y - el.cy.baseVal.value,
      scale: 0, fill: "#2fd0e0", stroke: "#0d3b66", transformOrigin: "50% 50%"
    });
  });

  // Synaptic firing while the logo holds (killed at release).
  var firing = gsap.timeline({ repeat: -1, paused: true });
  links.forEach(function (l) {
    firing.to(l, { opacity: 1, stroke: "#eaf6ff", duration: 0.18, yoyo: true, repeat: 1, ease: "sine.inOut" }, Math.random() * 1.2);
  });

  // --- The story --------------------------------------------------------------
  var tl = gsap.timeline({ defaults: { ease: "power3.out" }, delay: 0.2 });
  tl
    // 1. the mark assembles
    .from(dust, {
      attr: { cx: function () { return gsap.utils.random(-80, 540); }, cy: function () { return gsap.utils.random(-60, 380); } },
      opacity: 0, duration: 1.5, ease: "expo.out", stagger: { each: 0.01, from: "random" }
    }, 0)
    .from("#page-home .hero-content > *", { y: 26, opacity: 0, duration: 1, stagger: 0.08 }, 0.1)
    .to(tile, { opacity: 1, scale: 1, rotation: 0, duration: 1.3, ease: "expo.out" }, 0.45)
    .set(outline, { opacity: 1 }, 0.75)
    .to(outline, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut" }, 0.7)
    .to(dust, { opacity: 0, duration: 0.5, stagger: { each: 0.008, from: "start" } }, 1.55)
    // 2. the network lights up and fires
    .to(pts, { scale: 1, duration: 0.55, ease: "back.out(3)", stagger: { each: 0.035, from: "center" } }, 1.4)
    .to(links, { strokeDashoffset: 0, duration: 0.6, ease: "power2.out", stagger: { each: 0.02, from: "random" } }, 1.6)
    .add(function () { firing.play(0); }, 2.1)
    .to(tile, { scale: 1.025, duration: 0.45, yoyo: true, repeat: 1, ease: "sine.inOut" }, 2.2)
    // 3. release: the tile melts into the plot area, neurons fly to their scores
    .add(function () { firing.pause(); }, 3.1)
    .to(links, { opacity: 0, duration: 0.35, ease: "power1.out" }, 3.1)
    .to(".st-brain .sb-outline-wrap", { opacity: 0, scale: 1.18, svgOrigin: C.x + " " + C.y, duration: 0.7, ease: "power2.out" }, 3.1)
    .to(tile, { attr: { x: 44, y: 46, width: 408, height: 254, rx: 4 }, duration: 1.1, ease: "power3.inOut" }, 3.15)
    .to(tile, { opacity: 0, duration: 0.7, ease: "power1.inOut" }, 3.65)
    .to(bg, { opacity: 1, duration: 0.8, stagger: 0.08, ease: "power1.out" }, 3.55)
    // curved flights: x and y on different easings
    .to(pts, { x: 0, duration: 1.25, ease: "power2.inOut", stagger: { each: 0.03, from: "center" } }, 3.2)
    .to(pts, { y: 0, duration: 1.25, ease: "power3.in", stagger: { each: 0.03, from: "center" } }, 3.2)
    .to(pts, {
      fill: function (k) { return finals[k].fill; }, stroke: function (k) { return finals[k].stroke; },
      duration: 0.9, ease: "power1.inOut", stagger: { each: 0.03, from: "center" }
    }, 3.35)
    .fromTo(pts, { scale: 1.6 }, { scale: 1, duration: 0.5, ease: "back.out(4)", stagger: { each: 0.03, from: "center" }, immediateRender: false }, 4.25)
    .to(lines, { strokeDashoffset: 0, duration: 0.45, ease: "power2.out", stagger: 0.05 }, 4.55)
    .to(titles, { opacity: 1, y: 0, duration: 0.6, stagger: 0.05 }, 4.5)
    .set(brain, { display: "none" });
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
