/* ============================================================
   Vizéa — chart.js
   Builds the visualization from a project's scores.

   Layout (line mode, the default):
   - X axis: tests/subtests, GROUPED by cognitive function in the
     canonical order. Within a group, points are connected by a line
     (same-function trend). Groups are separated by vertical dotted
     lines, with the function name as a section title above each group.
   - Y axis: the active display scale (percentile / standard / scale /
     Z / T), chosen by the user. Background shows the 7 classification
     band stripes (from the AQNP table) recomputed for that scale.

   Radar mode (optional toggle):
   - One axis per cognitive function; each function's value is the mean
     percentile of its points (radar needs one value per spoke).
     Band rings drawn as concentric reference circles.

   Depends on: ScoringEngine (scoring.js), VizeaConstants (constants.js),
   VizeaDataModel (datamodel.js), and Plotly (global).
   ============================================================ */

(function () {
  const FN_ORDER = (window.VizeaConstants && window.VizeaConstants.COGNITIVE_FUNCTIONS) || [];
  const DEFAULT_COLORS = (window.VizeaConstants && window.VizeaConstants.DEFAULT_FUNCTION_COLORS) || {};
  const EXTENDED_PALETTE = (window.VizeaConstants && window.VizeaConstants.EXTENDED_PALETTE) ||
    ["#3D7EA6","#D0604F","#4E9E79","#E0A94E","#9A78C7","#4FB0AE","#CF6FA6"];

  // Escape user/imported text before it is placed into any Plotly text field
  // (titles, labels, hover, annotations). Plotly only renders a whitelist of
  // formatting tags so scripts can't run, but escaping also stops a stray "<"
  // in a name from breaking the intended <b>…</b> formatting — defence in depth.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Display-name overrides: rename a function/scale for the chart only, without
  // changing its identity (grouping, colour, score links stay keyed by the real name).
  function displayFunc(func, settings) {
    const m = settings && settings.functionLabels;
    const v = m && m[func];
    return (typeof v === "string" && v.trim()) ? v.trim() : func;
  }
  function displayScaleName(name, settings) {
    const m = settings && settings.scaleLabels;
    const v = m && m[name];
    return (typeof v === "string" && v.trim()) ? v.trim() : name;
  }
  // loaded by the page). Centralized so all three charts stay consistent.
  const FONT_BODY = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const FONT_TITLE = "Fraunces, Georgia, serif";
  const BAND_OPACITY = 0.13;
  // Drawing height of the plot area, used to tell whether a band is tall enough
  // to fit its name without colliding with its neighbours.
  const PLOT_AREA_PX = 520;

  // Blend a hex colour toward `target` ([r,g,b]) by `amount` (0-1).
  function mixHex(hex, target, amount) {
    const h = String(hex).replace("#", "");
    if (h.length !== 6) return hex;
    const c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    const to2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return "#" + c.map((v, i) => to2(v + (target[i] - v) * amount)).join("");
  }
  // Band name colour: the band's own hue, pushed dark (light theme) or light
  // (dark theme) so it stays legible while still tying the name to its stripe.
  function bandTextColor(hex, dark) {
    return dark ? mixHex(hex, [255, 255, 255], 0.62) : mixHex(hex, [0, 0, 0], 0.55);
  }

  // --- Key lane -------------------------------------------------------------
  // The band tints continue into the RIGHT margin as one uninterrupted colour
  // column, with each band's name set inside its own segment. Shapes that mix
  // paper/axis references get clipped at the plot edge, so the lane is built in
  // pure "paper" coordinates (0-1 across the plot area; >1 reaches the margin).
  const LANE_GAP = 10;    // px between the plot edge and the lane
  const LANE_PAD = 12;    // px of breathing room inside the lane, left and right

  function laneWidthFor(labels, size) {
    const widest = labels.reduce((m, t) => Math.max(m, textWidthPx(t, size)), 0);
    return widest ? Math.round(widest + LANE_PAD * 2) : 0;
  }
  // Convert a data-space y to a paper fraction of the plot area.
  function toPaperY(y, range) {
    return (y - range[0]) / (range[1] - range[0]);
  }
  // Build the lane rectangles. `segments` = [{y0,y1,color}] in data space.
  function buildLaneShapes(segments, range, plotWidth, leftMargin, rightMargin, laneW, alpha) {
    const plotAreaW = Math.max(120, plotWidth - leftMargin - rightMargin);
    const x0 = 1 + LANE_GAP / plotAreaW;
    const x1 = x0 + laneW / plotAreaW;
    return segments.map((s) => ({
      type: "rect", xref: "paper", yref: "paper",
      x0, x1,
      y0: toPaperY(s.y0, range), y1: toPaperY(s.y1, range),
      fillcolor: s.color, opacity: alpha, line: { width: 0 }, layer: "below"
    }));
  }

  // When true, charts render with the light theme regardless of the page theme.
  // Used so PNG exports are always on a white background with dark, legible text.
  let _forceLight = false;
  // Annotation index -> conditionId for the comment chips/pinned labels.
  let _commentAnnIndex = {};

  // Assign a colour to every function in display order: named/override colours
  // first, then the extended cycle (skipping colours already taken) so a profile
  // with many functions stays distinguishable.
  function assignColors(funcs, settings) {
    const overrides = (settings && settings.functionColors) || {};
    const map = {}; const used = new Set();
    funcs.forEach(f => {
      const c = overrides[f] || DEFAULT_COLORS[f];
      if (c) { map[f] = c; used.add(c.toLowerCase()); }
    });
    let i = 0;
    funcs.forEach(f => {
      if (map[f]) return;
      let guard = 0;
      while (used.has(EXTENDED_PALETTE[i % EXTENDED_PALETTE.length].toLowerCase()) && guard < EXTENDED_PALETTE.length) { i++; guard++; }
      const c = EXTENDED_PALETTE[i % EXTENDED_PALETTE.length];
      map[f] = c; used.add(c.toLowerCase()); i++;
    });
    return map;
  }

  // Meaningful data bounds per scale. Point Y positions are clamped to these
  // so an impossible/extreme entry (e.g. a Z of 9) is plotted at the edge of
  // the valid range instead of flying off the chart. Percentiles are naturally
  // 0–100; the others use conventional clinical display bounds.
  const DATA_RANGE = {
    "Percentile":      [0, 100],
    "Standard score":  [40, 160],
    "Scale score":     [1, 19],
    "Z-Score":         [-4, 4],
    "T-Score":         [10, 90]
  };

  // The drawn axis range adds padding around the data range, so markers and
  // their value labels near the extremes are never clipped by the plot edge.
  // Band stripes fill this full padded range (their outer edges are ±Infinity,
  // clamped to the axis range), so no white space appears.
  const AXIS_RANGE = {
    "Percentile":      [-3, 103],
    "Standard score":  [54, 146],
    "Scale score":     [1, 19],
    "Z-Score":         [-3.1, 3.1],
    "T-Score":         [19, 81]
  };

  // Explicit tick values keep the axis clean despite the padded range
  // (so a percentile axis doesn't show -5 / 105, etc.).
  const AXIS_TICKS = {
    "Percentile":      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    "Standard score":  [40, 55, 70, 85, 100, 115, 130, 145, 160],
    "Scale score":     [1, 3, 5, 7, 9, 11, 13, 15, 17, 19],
    "Z-Score":         [-4, -3, -2, -1, 0, 1, 2, 3, 4],
    "T-Score":         [10, 20, 30, 40, 50, 60, 70, 80, 90]
  };

  // On a proportional (percentile-positioned) axis, evenly-spaced score values
  // bunch up at the rare extremes and their labels collide. These spaced sets
  // sit at roughly the 2/16/50/84/98 percentiles — comfortably separated.
  const PROPORTIONAL_TICKS = {
    "Standard score":  [70, 85, 100, 115, 130],
    "Scale score":     [4, 7, 10, 13, 16],
    "Z-Score":         [-2, -1, 0, 1, 2],
    "T-Score":         [30, 40, 50, 60, 70]
  };

  // Pick the right tick score-values for the current axis mode.
  function tickValuesFor(displayScale, proportional) {
    if (proportional && displayScale !== "Percentile") {
      return PROPORTIONAL_TICKS[displayScale] || AXIS_TICKS[displayScale] || [];
    }
    return AXIS_TICKS[displayScale] || [];
  }

  // Theme-aware colours so chart text/gridlines stay legible in dark mode.
  function isDarkTheme() {
    return !_forceLight && typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "dark";
  }

  function themeColors() {
    const dark = isDarkTheme();
    return dark
      ? { text: "#e8eef4", textSoft: "#9db2c6", grid: "rgba(157,178,198,0.18)",
          gridSoft: "rgba(157,178,198,0.12)", compare: "#aebccb", labelBg: "rgba(20,34,47,0.82)",
          sep: "rgba(157,178,198,0.28)", markerFill: "#16242f", bandLabel: "#9db2c6" }
      : { text: "#2b3a4a", textSoft: "#5d6b7a", grid: "rgba(20,50,90,0.16)",
          gridSoft: "rgba(20,50,90,0.09)", compare: "#4a5a6a", labelBg: "rgba(255,255,255,0.8)",
          sep: "rgba(20,50,90,0.22)", markerFill: "#ffffff", bandLabel: "#5d6b7a" };
  }

  // Band display helpers ------------------------------------------------------
  // Colour intensity of the interpretation stripes, user-adjustable in the panel.
  // Clamped to a sane range so bands can never hide the data or vanish entirely.
  function bandOpacityOf(settings) {
    const v = settings && settings.bandOpacity;
    if (v === null || v === undefined || isNaN(v)) return BAND_OPACITY;
    return Math.max(0.03, Math.min(0.45, Number(v)));
  }
  // Band name shown on the chart: a user override, else the short classification
  // name ("Basse moyenne") rather than the full sentence used in the table.
  // Overrides are display-only and never change classification.
  function bandLabelOf(settings, band) {
    const over = settings && settings.bandLabels && settings.bandLabels[band.key];
    if (over !== undefined && over !== null && String(over).trim() !== "") return String(over).trim();
    return band.short || band.label;
  }

  // User-adjustable text size for the chart, as a multiplier of the base sizes.
  // Clamped so labels can't vanish or swamp the plot.
  function fontScaleOf(settings) {
    const v = settings && settings.fontScale;
    if (v === null || v === undefined || isNaN(v)) return 1;
    return Math.max(0.75, Math.min(1.6, Number(v)));
  }
  // Scale a base size and round to a crisp integer.
  function fs(base, scale) { return Math.round(base * scale); }
  // Rough pixel width of a string at a given font size (Inter ≈ 0.55em/char).
  function textWidthPx(str, size) { return String(str).length * size * 0.55; }

  // Wrap free text into short lines for a hover/pinned box (Plotly uses <br>).
  // Escapes each line, so it is safe to feed user-typed comments straight in.
  function wrapForBox(str, maxChars, maxLines) {
    const words = String(str || "").trim().split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? cur + " " + w : w;
      if (cand.length <= maxChars) { cur = cand; continue; }
      if (cur) lines.push(cur);
      if (w.length > maxChars) {
        let rest = w;
        while (rest.length > maxChars) { lines.push(rest.slice(0, maxChars)); rest = rest.slice(maxChars); }
        cur = rest;
      } else cur = w;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + "…";
    }
    return lines.map(esc).join("<br>");
  }

  // Tick labels are ALWAYS a single line (multi-line rotated labels are
  // confusing and collide). When a name is too long, the ellipsis goes at the
  // START: the end of the name (subtest, condition) carries the information,
  // while the leading test name is the part that can be dropped.
  //   "D-KEFS / DKEFS – Color-word interference – Inhibition (temps)"
  //   → "…word interference – Inhibition (temps)"
  // The full name always remains in the hover tooltip.
  function fitOneLine(str, maxChars) {
    const s = String(str || "").trim();
    if (s.length <= maxChars) return s;
    return "…" + s.slice(-(maxChars - 1));
  }

  function colorForFunction(func, chartSettings) {
    const overrides = (chartSettings && chartSettings.functionColors) || {};
    return overrides[func] || DEFAULT_COLORS[func] || "#176bb5";
  }

  // Convert "#rrggbb" to an rgba() string at the given alpha.
  function hexToRgba(hex, alpha) {
    let h = (hex || "#176bb5").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Convert a percentile to the active display scale value, clamped to the
  // valid data range so the point always lands on-chart.
  function percentileToDisplay(percentile, displayScale) {
    const raw = displayScale === "Percentile"
      ? percentile
      : window.ScoringEngine.fromPercentile(percentile, displayScale);
    const dr = DATA_RANGE[displayScale] || [0, 100];
    return window.ScoringEngine.clamp(raw, dr[0], dr[1]);
  }

  // Compute the y-position of the comparison guide line in the active display
  // scale, or null if no valid comparison value is set. Converts via percentile
  // (the comparison value has its own score type) and clamps to the data range.
  function comparisonDisplayValue(settings, displayScale) {
    const v = settings.compareValue;
    if (v === "" || v === null || v === undefined || isNaN(Number(v))) return null;
    const pct = window.ScoringEngine.toPercentile(Number(v), settings.compareType || "Standard score");
    if (pct === null) return null;
    return percentileToDisplay(pct, displayScale);
  }

  /**
   * Group flattened points by cognitive function, in canonical order.
   * Returns ordered array: [{ func, points: [...] }], only for functions
   * that actually have points (and pass the visibleFunctions filter).
   */
  function groupPointsByFunction(points, chartSettings) {
    const visible = chartSettings && chartSettings.visibleFunctions; // null = all
    const overrides = (chartSettings && chartSettings.pointOverrides) || {};
    const pointOrder = (chartSettings && Array.isArray(chartSettings.pointOrder)) ? chartSettings.pointOrder : [];
    const orderIndex = {};
    pointOrder.forEach((pid, i) => { orderIndex[pid] = i; });

    const byFunc = {};
    points.forEach(p => {
      if (visible && !visible.includes(p.func)) return;
      const ov = overrides[p.pid];
      if (ov && ov.hidden) return;                      // view-only hide
      // view-only rename (does not touch the underlying project data)
      const display = (ov && typeof ov.label === "string" && ov.label.trim()) ? ov.label.trim() : p.label;
      const pp = Object.assign({}, p, { displayLabel: display });
      if (!byFunc[p.func]) byFunc[p.func] = [];
      byFunc[p.func].push(pp);
    });

    // Within each function group, honour the user's per-point order (drag); any
    // point without a saved position keeps its natural order, appended after.
    Object.keys(byFunc).forEach(func => {
      byFunc[func].sort((a, b) => {
        const ia = (a.pid in orderIndex) ? orderIndex[a.pid] : Infinity;
        const ib = (b.pid in orderIndex) ? orderIndex[b.pid] : Infinity;
        return ia - ib;
      });
    });

    // Preferred display order: the user's custom order first (drag-to-reorder),
    // then the canonical order, then anything else — each only if it has points.
    const customOrder = (chartSettings && Array.isArray(chartSettings.functionOrder))
      ? chartSettings.functionOrder : [];
    const seen = new Set();
    const ordered = [];
    const pushFunc = (func) => {
      if (!seen.has(func) && byFunc[func] && byFunc[func].length) {
        ordered.push({ func, points: byFunc[func] });
        seen.add(func);
      }
    };
    customOrder.forEach(pushFunc);
    FN_ORDER.forEach(pushFunc);
    Object.keys(byFunc).forEach(pushFunc);
    return ordered;
  }

  /**
   * Build the LINE chart figure (traces + layout) for Plotly.
   */
  function buildLineFigure(project, opts) {
    const settings = project.chartSettings || {};
    const plotWidth = (opts && opts.plotWidth) || 900;
    const displayScale = settings.displayScale || "Percentile";
    // When the proportional axis is on, points are positioned by percentile
    // (so band heights reflect rarity on every scale); the axis is then
    // RE-LABELLED in the chosen display scale. Otherwise we position linearly
    // in the display scale's own units.
    const proportional = settings.proportionalAxis !== false;
    const plotScale = proportional ? "Percentile" : displayScale;
    const points = window.VizeaDataModel.flattenScores(project);
    const groups = groupPointsByFunction(points, settings);

    if (groups.length === 0) {
      return { empty: true };
    }

    // Assign each point an x-axis index, grouped by function, in entry order
    // within each group. Build x tick labels and remember group boundaries.
    const xLabels = [];
    const groupBoundaries = []; // x index where each new group starts
    const groupCenters = [];    // for section titles
    const traces = [];

    const TC = themeColors();
    const fontScale = fontScaleOf(settings);
    const colorMap = assignColors(groups.map(g => g.func), settings);

    let xIndex = 0;
    const commentMarks = [];               // mini speech-bubble above commented points
    groups.forEach((group, gi) => {
      const startIndex = xIndex;
      const xs = [];
      const ys = [];
      const texts = [];
      const keys = [];                    // conditionId per point (for click-to-edit)

      const color = colorMap[group.func];

      const labelVals = [];
      group.points.forEach(p => {
        const lbl = p.displayLabel || p.label;
        xLabels.push(lbl);
        xs.push(xIndex);
        const yVal = percentileToDisplay(p.percentile, plotScale);
        ys.push(yVal);
        labelVals.push(percentileToDisplay(p.percentile, displayScale));
        const hasComment = !!(p.comment && p.comment.trim());
        // The data hover stays clean: the comment gets its OWN hover box, shown
        // from the little bubble icon beside the point.
        texts.push(`${esc(lbl)}<br>${esc(p.func)}<br>${esc(p.rawValue)} (${esc(p.type)})<br>Percentile: ${p.percentile.toFixed(1)}`);
        keys.push(p.conditionId || "");
        if (hasComment) commentMarks.push({
          x: xIndex, y: yVal, color,
          comment: p.comment.trim(),
          pinned: !!p.commentPinned,
          id: p.conditionId || "",
          ax: p.commentAx, ay: p.commentAy
        });
        xIndex++;
      });

      traces.push({
        x: xs,
        y: ys,
        customdata: xs.map((_, i) => [texts[i], keys[i]]),
        hovertemplate: "%{customdata[0]}<extra></extra>",
        mode: settings.showDataLabels ? "lines+markers+text" : "lines+markers",
        text: settings.showDataLabels ? labelVals.map(v => (typeof v === "number" ? v.toFixed(0) : v)) : undefined,
        textposition: "top center",
        textfont: { size: fs(11, fontScale), color: TC.text, family: FONT_BODY },
        name: group.func,
        line: { color, width: 2.6 },
        marker: { color: TC.markerFill, size: 8, line: { color, width: 2.2 } },
        showlegend: false // legend removed: function names shown as colored section titles
      });

      if (gi > 0) groupBoundaries.push(startIndex - 0.5);
      groupCenters.push({ center: (startIndex + xIndex - 1) / 2, func: group.func, color, display: displayFunc(group.func, settings) });
    });

    const totalPoints = xIndex;
    let range = (AXIS_RANGE[plotScale] || [0, 100]).slice();

    // Optional user-defined axis limits, entered in the DISPLAY scale. They trim
    // the axis (e.g. Z from -3 to 3) so the extreme bands don't dominate.
    const aMin = settings.axisMin, aMax = settings.axisMax;
    const hasLimits = aMin !== undefined && aMin !== null && aMin !== "" &&
                      aMax !== undefined && aMax !== null && aMax !== "" &&
                      Number(aMin) < Number(aMax);
    if (hasLimits) {
      const lo = Number(aMin), hi = Number(aMax);
      if (proportional) {
        // Convert display-scale bounds to percentile positions.
        const pLo = displayScale === "Percentile" ? lo : window.ScoringEngine.toPercentile(lo, displayScale);
        const pHi = displayScale === "Percentile" ? hi : window.ScoringEngine.toPercentile(hi, displayScale);
        range = [Math.max(0, Math.min(pLo, pHi)), Math.min(100, Math.max(pLo, pHi))];
      } else {
        range = [lo, hi];
      }
    } else if (!proportional) {
      // Keep the ±3 SD default, but never clip a real data point.
      const dr = DATA_RANGE[plotScale] || range;
      let lo = range[0], hi = range[1];
      traces.forEach(t => (t.y || []).forEach(v => { if (typeof v === "number") { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
      range = [Math.max(dr[0], lo), Math.min(dr[1], hi)];
    }

    // Band stripes as background shapes (full width, spanning y band edges).
    // Bands use the PLOT scale, so on a proportional axis they're percentile
    // bands — always sized by how common each band is.
    const shapes = [];
    const bandLabelAnnotations = [];
    const laneSegments = [];
    if (settings.showBands !== false) {
      const bands = window.ScoringEngine.getBandsForDisplayType(plotScale);
      const bandAlpha = bandOpacityOf(settings);
      bands.forEach((b, bi) => {
        let y0 = b.min === -Infinity ? range[0] : b.min;
        let y1 = b.max === Infinity ? range[1] : b.max;
        y0 = window.ScoringEngine.clamp(y0, range[0], range[1]);
        y1 = window.ScoringEngine.clamp(y1, range[0], range[1]);
        if (bi === 0) y0 = range[0];                  // fill to the very bottom
        if (bi === bands.length - 1) y1 = range[1];   // and the very top
        if (y1 <= y0) return;
        shapes.push({
          type: "rect", xref: "paper", yref: "y",
          x0: 0, x1: 1, y0, y1,
          fillcolor: b.color, opacity: bandAlpha, line: { width: 0 }, layer: "below"
        });
        // Optional band name, set inside the tinted key lane that continues in
        // the right margin. Skipped when the stripe is shorter than the text, so
        // names can never overlap each other.
        if (settings.showBandLabels) {
          const txt = bandLabelOf(settings, b);
          const size = fs(10, fontScale);
          const bandPx = ((y1 - y0) / (range[1] - range[0])) * PLOT_AREA_PX;
          laneSegments.push({ y0, y1, color: b.color });
          if (txt && bandPx >= size * 1.35) bandLabelAnnotations.push({
            xref: "paper", yref: "y", x: 1, y: (y0 + y1) / 2,
            text: txt, showarrow: false,
            xanchor: "left", yanchor: "middle", xshift: LANE_GAP + LANE_PAD,
            font: { size, color: bandTextColor(b.color, isDarkTheme()), family: FONT_BODY }
          });
        }
      });
    }

    // Vertical dotted separators between function groups
    groupBoundaries.forEach(xb => {
      shapes.push({
        type: "line", xref: "x", yref: "paper",
        x0: xb, x1: xb, y0: 0, y1: 1,
        line: { color: TC.sep, width: 1, dash: "dot" }, layer: "above"
      });
    });

    // Optional comparison guide line (e.g. estimated FSIQ), positioned on the
    // plot scale so it lands at the right height whatever the axis mode.
    const compareY = comparisonDisplayValue(settings, plotScale);
    const compareAnnotations = [];
    if (compareY !== null) {
      shapes.push({
        type: "line", xref: "paper", yref: "y",
        x0: 0, x1: 1, y0: compareY, y1: compareY,
        line: { color: TC.compare, width: 1.6, dash: "dash" }, layer: "above"
      });
      // Label is optional: only annotate when the user typed one.
      const lbl = (settings.compareLabel || "").trim();
      if (lbl) {
        compareAnnotations.push({
          xref: "paper", yref: "y", x: 1, y: compareY,
          xanchor: "right", yanchor: "bottom",
          text: `<b>${esc(lbl)}</b>`,
          showarrow: false, font: { size: fs(11, fontScale), color: TC.text },
          bgcolor: TC.labelBg, borderpad: 2
        });
      }
    }

    // Section titles (function name) above each group, colored to match the
    // group's line (this replaces the legend). To avoid horizontal overlap when
    // groups are narrow, titles are staggered across two stacked rows just above
    // the plot area.
    // --- Section titles (function names) without overlap ---------------------
    // Estimate each title's horizontal half-width in x-axis data units, then
    // greedily pack titles into stacked rows so none overlap, however narrow a
    // group is. Uses the real plot width so the estimate is accurate.
    const usableW = Math.max(200, plotWidth - 90);          // minus axis/margins
    const pxPerXUnit = usableW / Math.max(1, totalPoints);  // px per x data unit
    const TITLE_SIZE = fs(11, fontScale);                   // function titles (bold)
    const CHAR_PX = TITLE_SIZE * 0.66;                      // bold Inter ≈ 0.66em/char
    const GAP_X = 0.6;                                      // min gap between titles (x units)
    const rowRights = [];                                   // last right edge per row
    const titleRows = groupCenters.map((gc) => {
      const halfW = (gc.display.length * CHAR_PX) / 2 / pxPerXUnit;
      const left = gc.center - halfW;
      const right = gc.center + halfW;
      let row = 0;
      while (row < rowRights.length && left < rowRights[row] + GAP_X) row++;
      rowRights[row] = right;
      return row;
    });
    const rowsUsed = Math.max(1, rowRights.length);
    // Row spacing must grow with the text, or stacked titles collide vertically.
    const ROW_DY = Math.max(0.052, (TITLE_SIZE * 2.4) / PLOT_AREA_PX);
    const annotations = groupCenters.map((gc, i) => ({
      x: gc.center, y: 1.012 + titleRows[i] * ROW_DY, xref: "x", yref: "paper",
      text: `<b>${esc(gc.display)}</b>`, showarrow: false,
      font: { size: fs(11, fontScale), color: gc.color }, textangle: 0,
      yanchor: "bottom", xanchor: "center"
    })).concat(compareAnnotations).concat(bandLabelAnnotations);

    // Commented points get a small WHITE bubble with "…" beside them. Hovering
    // that bubble shows the note in its OWN box, separate from the data hover.
    // "Pinned" notes are additionally drawn as a permanent label joined to the
    // point, so they appear in the exported image.
    const chipSize = fs(10, fontScale);
    // Map annotation index -> conditionId, so click/drag events on the chart can
    // be traced back to the score they belong to.
    _commentAnnIndex = {};
    commentMarks.forEach((m) => {
      // Unpinned note -> just the little bubble (hover to read, click to edit).
      // Pinned note -> the permanent label instead; showing both would duplicate
      // the same comment twice on the same point.
      if (!m.pinned) {
      _commentAnnIndex[annotations.length] = m.id;
      annotations.push({
        x: m.x, y: m.y, xref: "x", yref: "y",
        text: "···",
        // A tail (rather than a fixed shift) makes the bubble draggable too, and
        // keeps it tied to its point. The connector is faint and, at the default
        // offset, essentially hidden behind the bubble.
        showarrow: true, arrowhead: 0, arrowsize: 1, arrowwidth: 1,
        arrowcolor: mixHex(m.color, isDarkTheme() ? [0, 0, 0] : [255, 255, 255], 0.45),
        ax: (typeof m.ax === "number" ? m.ax : 11),
        ay: (typeof m.ay === "number" ? m.ay : -11),
        axref: "pixel", ayref: "pixel",
        font: { size: chipSize, color: m.color, family: FONT_BODY },
        bgcolor: "#ffffff", bordercolor: m.color, borderwidth: 1, borderpad: 2,
        opacity: 1,
        captureevents: true,
        hovertext: wrapForBox(m.comment, 46, 8),
        hoverlabel: {
          bgcolor: "#ffffff", bordercolor: m.color,
          font: { color: TC.text, size: fs(11, fontScale), family: FONT_BODY },
          align: "left"
        }
      });
      }

      if (m.pinned) {
        _commentAnnIndex[annotations.length] = m.id;
        annotations.push({
          x: m.x, y: m.y, xref: "x", yref: "y",
          text: wrapForBox(m.comment, 30, 6),
          showarrow: true, arrowhead: 0, arrowsize: 1, arrowwidth: 1.1,
          arrowcolor: mixHex(m.color, isDarkTheme() ? [0, 0, 0] : [255, 255, 255], 0.35),
          ax: (typeof m.ax === "number" ? m.ax : 30),
          ay: (typeof m.ay === "number" ? m.ay : -40),
          axref: "pixel", ayref: "pixel", captureevents: true,
          // No explicit anchors: Plotly then centres the box on its tail and
          // clips the connector at the box edge FACING the point. Drag the note
          // below-left and the line meets its top-right corner — always coherent.
          align: "left",
          bgcolor: isDarkTheme() ? "rgba(22,36,47,0.94)" : "rgba(255,255,255,0.94)",
          bordercolor: m.color, borderwidth: 1, borderpad: 6,
          font: { size: fs(10, fontScale), color: TC.text, family: FONT_BODY }
        });
      }
    });

    const showTestLabels = settings.showTestLabels !== false;
    const titleText = (settings.title || "").trim();
    const hasTitle = titleText.length > 0;

    // Top margin must clear the title (at container top) AND the two annotation
    // rows just above the plot. When there's no title we only need room for the
    // annotation rows.
    const topMargin = (hasTitle ? 84 : 16) + rowsUsed * Math.max(30, Math.round(TITLE_SIZE * 2.7));

    // Bottom margin sized to the longest label (drawn at -45°), so long test
    // names get the room they need BELOW the plot rather than overflowing the
    // container (and landing on the export buttons). Height of a label rotated
    // 45° ≈ its width × sin(45°); width ≈ chars × 0.55em. Both track the text
    // size, so this stays correct at every zoom level.
    const CHAR_EM = 0.60;                       // ≈ Inter average char width
    const ROT = 0.72;                           // ≈ sin/cos(45°), with slack
    // Neighbouring 45° labels are parallel lines separated by
    // (tick spacing × sin 45°). A single-line label is LINE_H thick, so if the
    // gap is smaller than the line height the labels would touch — shrink the
    // tick font just enough to keep them apart. In normal use (≤ ~30 tests) this
    // never triggers and the size is exactly what the user asked for.
    const perpGap = pxPerXUnit * 0.707;
    const TICK_SIZE = Math.max(7, Math.min(fs(12, fontScale), Math.floor(perpGap / 1.25)));
    const LINE_H = TICK_SIZE * 1.25;
    // Always one line; ellipsis at the START (keeps the informative end).
    const MAX_TICK_CHARS = 40;
    const fittedRaw = xLabels.map((s) => fitOneLine(s, MAX_TICK_CHARS));
    const xLabelsFit = fittedRaw.map(esc);      // escape AFTER measuring lengths
    const widestLen = showTestLabels
      ? fittedRaw.reduce((m, s) => Math.max(m, s.length), 0) : 0;
    // A -45° label hangs DOWN-LEFT from its tick, so it needs room below…
    const bottomMargin = showTestLabels
      ? Math.max(70, Math.round(widestLen * CHAR_EM * TICK_SIZE * ROT + LINE_H) + 24)
      : 46;
    // …and to the LEFT. The first labels overhang the y-axis and were being
    // clipped away entirely (the "missing" labels). Measure the worst overhang.
    let leftOverflow = 0;
    if (showTestLabels) {
      fittedRaw.forEach((s, i) => {
        const reach = s.length * CHAR_EM * TICK_SIZE * ROT;   // horizontal extent
        leftOverflow = Math.max(leftOverflow, reach - i * pxPerXUnit);
      });
    }
    // Keep the actual plot drawing area constant; total height grows to fit
    // labels + title rows. (renderChart applies this to the container.)
    const figHeight = topMargin + PLOT_AREA_PX + bottomMargin;

    // Y-axis ticks: always show the chosen display scale's values. On a
    // proportional axis they're placed at their percentile positions (so the
    // spacing is non-linear but the bands reflect rarity); otherwise linearly.
    const tickScoreValues = tickValuesFor(displayScale, proportional);
    const yTickVals = proportional
      ? tickScoreValues.map(v => percentileToDisplay(
          displayScale === "Percentile" ? v : window.ScoringEngine.toPercentile(v, displayScale),
          plotScale))
      : tickScoreValues;
    const yTickText = tickScoreValues.map(v => String(v));

    // Right margin: the band names live here. Widen it to the longest name so
    // nothing is clipped; leave the default when they're off.
    // The key lane lives in the right margin: gap + lane + a little air.
    const laneW = laneWidthFor(bandLabelAnnotations.map((a) => a.text), fs(10, fontScale));
    const rightMargin = laneW ? LANE_GAP + laneW + 8 : 30;
    // Left margin must clear the axis title + widest y tick AND the first tick
    // labels, which hang left past the axis (that overhang was silently eating
    // the leftmost labels).
    const maxTickW = yTickText.reduce((m, t) => Math.max(m, textWidthPx(t, fs(12, fontScale))), 0);
    const leftMargin = Math.max(
      80,
      Math.round(fs(13, fontScale) * 1.7 + maxTickW + 18),
      Math.round(leftOverflow) + 10
    );

    // Lane rectangles need the final margins to convert px → paper fractions.
    if (laneW && laneSegments.length) {
      buildLaneShapes(laneSegments, range, plotWidth, leftMargin, rightMargin, laneW,
                      Math.min(0.5, bandOpacityOf(settings) * 1.5)).forEach((s) => shapes.push(s));
    }

    const layout = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: TC.text, family: FONT_BODY },
      xaxis: {
        tickmode: "array",
        tickvals: xLabels.map((_, i) => i),
        ticktext: showTestLabels ? xLabelsFit : xLabelsFit.map(() => ""),
        tickangle: -45,
        range: [-0.5, totalPoints - 0.5],
        showticklabels: showTestLabels,
        ticks: showTestLabels ? "outside" : "",
        tickfont: { color: TC.textSoft, size: TICK_SIZE },
        zeroline: false,        // <- removes the stray vertical line at x=0
        showgrid: false,
        // Let Plotly measure the REAL rendered labels and expand the bottom
        // margin if our estimate below is short: without this it silently clips
        // long test names at the figure edge. Our estimate still drives the
        // container height, so the two agree in practice.
        automargin: true
      },
      yaxis: {
        title: { text: displayScale, font: { color: TC.textSoft, size: fs(13, fontScale) } },
        range: range,
        tickmode: "array",
        tickvals: yTickVals,
        ticktext: yTickText,
        tickfont: { color: TC.textSoft, size: fs(12, fontScale) },
        gridcolor: TC.gridSoft,
        zeroline: false
      },
      shapes,
      annotations,
      showlegend: false,
      margin: { t: topMargin, b: bottomMargin, l: leftMargin, r: rightMargin },
      hovermode: "closest"
    };

    // Only attach a title when the user actually wants one (empty = no title).
    if (hasTitle) {
      layout.title = {
        text: esc(titleText),
        x: 0.5, xanchor: "center",
        y: 0.97, yanchor: "top", yref: "container",
        font: { family: FONT_TITLE, size: 20, color: TC.text }
      };
    }

    return { empty: false, traces, layout, height: figHeight };
  }

  /**
   * Build the RADAR chart figure. One spoke per function; value = mean
   * percentile across that function's points, converted to display scale.
   */
  function buildRadarFigure(project) {
    const settings = project.chartSettings || {};
    const displayScale = settings.displayScale || "Percentile";
    const proportional = settings.proportionalAxis !== false;
    const plotScale = proportional ? "Percentile" : displayScale;
    const points = window.VizeaDataModel.flattenScores(project);
    const groups = groupPointsByFunction(points, settings);

    if (groups.length === 0) return { empty: true };

    const theta = [];
    const r = [];
    const hover = [];
    const labels = [];
    groups.forEach(group => {
      const meanPct = group.points.reduce((s, p) => s + p.percentile, 0) / group.points.length;
      const pos = percentileToDisplay(meanPct, plotScale);     // radius position
      const shown = percentileToDisplay(meanPct, displayScale); // label value
      theta.push(esc(displayFunc(group.func, settings)));
      r.push(pos);
      labels.push(typeof shown === "number" ? shown.toFixed(0) : shown);
      hover.push(`${esc(group.func)}<br>Moyenne percentile: ${meanPct.toFixed(1)}<br>(${group.points.length} score(s))`);
    });
    // Close the loop for a filled polygon
    if (theta.length > 2) {
      theta.push(theta[0]); r.push(r[0]); hover.push(hover[0]); labels.push(labels[0]);
    }

    // Radial axis spans the plot scale's data range (center = min, edge = max).
    const dr = DATA_RANGE[plotScale] || [0, 100];
    const rMin = dr[0], rMax = dr[1];

    const traces = [];

    // Interpretation bands are intentionally NOT drawn on the radar: as filled
    // rings they sit over the centre and obscure the profile. The banded
    // reading lives on the line chart; the radar is the clean global shape.

    const TC = themeColors();
    const fontScale = fontScaleOf(settings);
    // Optional comparison guide as a dashed reference ring at the comparison
    // radius. It must use the SAME categorical spokes (function names) as the
    // profile — using numeric degrees would redefine the angular axis and
    // disrupt the profile's positions and value labels.
    const compareR = comparisonDisplayValue(settings, plotScale);
    if (compareR !== null && theta.length) {
      const ringTheta = theta.slice();          // same categories, already closed
      const ringR = ringTheta.map(() => compareR);
      traces.push({
        type: "scatterpolar", mode: "lines",
        theta: ringTheta, r: ringR,
        line: { color: TC.compare, width: 1.6, dash: "dash", shape: "spline", smoothing: 1 },
        hoverinfo: "skip", showlegend: false, fill: "none"
      });
    }

    // --- The cognitive profile polygon (always the TOP layer) ---
    const radarColor = settings.radarColor || "#2E8FB5";
    const haloColor = TC.markerFill;
    traces.push({
      type: "scatterpolar",
      mode: settings.showDataLabels ? "lines+markers+text" : "lines+markers",
      r, theta,
      text: settings.showDataLabels ? labels : undefined,
      textposition: "top center",
      textfont: { size: fs(11, fontScale), color: TC.text },
      customdata: hover,
      hovertemplate: "%{customdata}<extra></extra>",
      fill: settings.radarFill !== false ? "toself" : "none",
      fillcolor: hexToRgba(radarColor, 0.16),
      line: { color: radarColor, width: 2.8 },
      // halo around each marker (matches surface) so points stay crisp
      marker: { color: haloColor, size: 9, line: { color: radarColor, width: 2.2 } },
      name: "Profil"
    });

    const radarTickScores = tickValuesFor(displayScale, proportional);
    const radarTickVals = proportional
      ? radarTickScores.map(v => percentileToDisplay(
          displayScale === "Percentile" ? v : window.ScoringEngine.toPercentile(v, displayScale),
          plotScale))
      : radarTickScores;
    const radarTickText = radarTickScores.map(v => String(v));

    const titleText = (settings.title || "").trim();
    const layout = {
      paper_bgcolor: "rgba(0,0,0,0)",
      font: { color: TC.text, family: FONT_BODY },
      polar: {
        bgcolor: "rgba(0,0,0,0)",
        radialaxis: {
          range: [rMin, rMax], visible: true, angle: (90 - 180 / Math.max(1, groups.length)),
          tickmode: "array",
          tickvals: radarTickVals,
          ticktext: radarTickText,
          gridcolor: TC.gridSoft, linecolor: TC.gridSoft,
          tickfont: { size: fs(9, fontScale), color: TC.textSoft }
        },
        angularaxis: {
          direction: "clockwise",
          tickfont: { size: fs(11, fontScale), color: TC.text },
          gridcolor: TC.gridSoft, linecolor: TC.grid
        }
      },
      showlegend: false,
      margin: { t: titleText ? 70 : 44, b: 44, l: 70, r: 70 }
    };
    if (titleText) {
      layout.title = {
        text: esc(titleText), x: 0.5, xanchor: "center",
        font: { family: FONT_TITLE, size: 20, color: TC.text }
      };
    }

    return { empty: false, traces, layout, height: 600 };
  }

  /**
   * Build the ÉCHELLES (composite/IQ scales) figure: one connected line over
   * the ACTIVE battery's entered scales. The axis works like the profile —
   * proportional (percentile-positioned) or linear (standard-score units) — with
   * optional Y-axis limits, interpretation bands, per-scale show/hide, a custom
   * line colour and title. No comparison line here.
   */
  function buildScalesFigure(project, opts) {
    const plotWidth = (opts && opts.plotWidth) || 900;
    const settings = project.chartSettings || {};
    const DM = window.VizeaDataModel;
    let rows = DM ? DM.flattenScales(project) : [];
    const hidden = Array.isArray(settings.hiddenScales) ? settings.hiddenScales : [];
    rows = rows.filter(r => !hidden.includes(r.name));
    // Apply the user-defined display order (drag-to-reorder); scales not in the
    // order list keep their entry order, after the ordered ones.
    const ord = Array.isArray(settings.scaleOrder) ? settings.scaleOrder : [];
    if (ord.length) {
      rows = rows.map((r, i) => ({ r, i }))
        .sort((a, b) => {
          const ia = ord.indexOf(a.r.name), ib = ord.indexOf(b.r.name);
          return (ia < 0 ? 1e9 + a.i : ia) - (ib < 0 ? 1e9 + b.i : ib);
        })
        .map(x => x.r);
    }
    if (!rows.length) return { empty: true };

    const displayScale = settings.scalesDisplay === "Percentile" ? "Percentile" : "Standard score";
    const proportional = displayScale === "Percentile" ? true : (settings.proportionalAxis !== false);
    const plotScale = proportional ? "Percentile" : displayScale;
    const TC = themeColors();
    const fontScale = fontScaleOf(settings);

    const labels = rows.map(r => esc(displayScaleName(r.name, settings)));
    // Each row's value -> percentile (universal), then to the plot position.
    const percentiles = rows.map(r => r.scale === "Percentile"
      ? window.ScoringEngine.clamp(Number(r.value), 0, 100)
      : window.ScoringEngine.toPercentile(Number(r.value), "Standard score"));
    const yvals = percentiles.map(p => percentileToDisplay(p, plotScale));
    // On-point text = the value as entered (centile marked with "e").
    const text = rows.map(r => r.scale === "Percentile" ? (r.value + "e") : String(r.value));

    // Axis range: default (±3 SD via AXIS_RANGE) unless the user set limits.
    let range = (AXIS_RANGE[plotScale] || [0, 100]).slice();
    const aMin = settings.scalesAxisMin, aMax = settings.scalesAxisMax;
    const hasLimits = aMin !== undefined && aMin !== null && aMin !== "" &&
                      aMax !== undefined && aMax !== null && aMax !== "" &&
                      Number(aMin) < Number(aMax);
    if (hasLimits) {
      const lo = Number(aMin), hi = Number(aMax);
      if (proportional) {
        const pLo = window.ScoringEngine.toPercentile(lo, displayScale);
        const pHi = window.ScoringEngine.toPercentile(hi, displayScale);
        range = [Math.max(0, Math.min(pLo, pHi)), Math.min(100, Math.max(pLo, pHi))];
      } else {
        range = [lo, hi];
      }
    } else if (!proportional) {
      // Keep the ±3 default but never clip a real value.
      const dr = DATA_RANGE[displayScale] || range;
      let lo = range[0], hi = range[1];
      yvals.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      range = [Math.max(dr[0], lo), Math.min(dr[1], hi)];
    }

    const shapes = [];
    const sBandLabels = [];
    const sNoteAnns = [];
    const sLaneSegments = [];
    _commentAnnIndex = {};
    if (settings.showBands !== false) {
      const sbands = window.ScoringEngine.getBandsForDisplayType(plotScale);
      const sAlpha = bandOpacityOf(settings);
      sbands.forEach((b, bi) => {
        let y0 = b.min === -Infinity ? range[0] : b.min;
        let y1 = b.max === Infinity ? range[1] : b.max;
        y0 = window.ScoringEngine.clamp(y0, range[0], range[1]);
        y1 = window.ScoringEngine.clamp(y1, range[0], range[1]);
        if (bi === 0) y0 = range[0];
        if (bi === sbands.length - 1) y1 = range[1];
        if (y1 <= y0) return;
        shapes.push({ type: "rect", xref: "paper", yref: "y", x0: 0, x1: 1, y0, y1,
          fillcolor: b.color, opacity: sAlpha, line: { width: 0 }, layer: "below" });
        if (settings.showBandLabels) {
          const txt = bandLabelOf(settings, b);
          const size = fs(10, fontScale);
          const bandPx = ((y1 - y0) / (range[1] - range[0])) * PLOT_AREA_PX;
          sLaneSegments.push({ y0, y1, color: b.color });
          if (txt && bandPx >= size * 1.35) sBandLabels.push({
            xref: "paper", yref: "y", x: 1, y: (y0 + y1) / 2,
            text: txt, showarrow: false, xanchor: "left", yanchor: "middle",
            xshift: LANE_GAP + LANE_PAD,
            font: { size, color: bandTextColor(b.color, isDarkTheme()), family: FONT_BODY }
          });
        }
      });
    }

    const lineColor = settings.scalesColor || "#1b7fb5";
    const showLabels = settings.showDataLabels !== false;
    const traces = [{
      type: "scatter", mode: showLabels ? "lines+markers+text" : "lines+markers",
      x: labels, y: yvals, text, textposition: "top center",
      textfont: { color: TC.text, size: fs(12, fontScale) },
      line: { color: lineColor, width: 2.6 },
      marker: { color: TC.markerFill, size: 9, line: { color: lineColor, width: 2.2 } },
      customdata: rows.map((r) => [r.id || ""]),
      hovertemplate: "%{x}: %{text}<extra></extra>",
      cliponaxis: false
    }];

    // Notes on scales, shown exactly like the ones on scores: a small bubble to
    // hover/click, or a permanent draggable label once pinned.
    const sChipSize = fs(10, fontScale);
    rows.forEach((r, i) => {
      const note = (r.comment || "").trim();
      if (!note) return;
      const yv = yvals[i];
      if (yv === null || yv === undefined) return;
      if (!r.commentPinned) {
        _commentAnnIndex[sBandLabels.length + sNoteAnns.length] = r.id;
        sNoteAnns.push({
          x: labels[i], y: yv, xref: "x", yref: "y", text: "···",
          showarrow: true, arrowhead: 0, arrowsize: 1, arrowwidth: 1,
          arrowcolor: mixHex(lineColor, isDarkTheme() ? [0, 0, 0] : [255, 255, 255], 0.45),
          ax: (typeof r.commentAx === "number" ? r.commentAx : 11),
          ay: (typeof r.commentAy === "number" ? r.commentAy : -11),
          axref: "pixel", ayref: "pixel",
          font: { size: sChipSize, color: lineColor, family: FONT_BODY },
          bgcolor: "#ffffff", bordercolor: lineColor, borderwidth: 1, borderpad: 2,
          captureevents: true, hovertext: wrapForBox(note, 46, 8),
          hoverlabel: { bgcolor: "#ffffff", bordercolor: lineColor,
                        font: { color: TC.text, size: fs(11, fontScale), family: FONT_BODY }, align: "left" }
        });
      } else {
        _commentAnnIndex[sBandLabels.length + sNoteAnns.length] = r.id;
        sNoteAnns.push({
          x: labels[i], y: yv, xref: "x", yref: "y",
          text: wrapForBox(note, 30, 6),
          showarrow: true, arrowhead: 0, arrowsize: 1, arrowwidth: 1.1,
          arrowcolor: mixHex(lineColor, isDarkTheme() ? [0, 0, 0] : [255, 255, 255], 0.35),
          ax: (typeof r.commentAx === "number" ? r.commentAx : 30),
          ay: (typeof r.commentAy === "number" ? r.commentAy : -40),
          axref: "pixel", ayref: "pixel", captureevents: true, align: "left",
          bgcolor: isDarkTheme() ? "rgba(22,36,47,0.94)" : "rgba(255,255,255,0.94)",
          bordercolor: lineColor, borderwidth: 1, borderpad: 6,
          font: { size: fs(10, fontScale), color: TC.text, family: FONT_BODY }
        });
      }
    });

    // Y ticks: standard-score values, placed by percentile when proportional.
    const tickScoreValues = tickValuesFor(displayScale, proportional);
    const yTickVals = proportional
      ? tickScoreValues.map(v => percentileToDisplay(
          window.ScoringEngine.toPercentile(v, displayScale), plotScale))
      : tickScoreValues;
    const yTickText = tickScoreValues.map(v => String(v));

    const titleText = (settings.scalesTitle || "").trim();
    // Band names sit inside the tinted key lane in the right margin.
    const sLaneW = laneWidthFor(sBandLabels.map((a) => a.text), fs(10, fontScale));
    const sRightMargin = sLaneW ? LANE_GAP + sLaneW + 8 : 30;
    const sLeftMargin = 60;
    if (sLaneW && sLaneSegments.length) {
      buildLaneShapes(sLaneSegments, range, plotWidth, sLeftMargin, sRightMargin, sLaneW,
                      Math.min(0.5, bandOpacityOf(settings) * 1.5)).forEach((sh) => shapes.push(sh));
    }
    const layout = {
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: TC.text, family: FONT_BODY },
      xaxis: { type: "category", tickfont: { color: TC.textSoft, size: fs(12, fontScale) }, zeroline: false, showgrid: false, automargin: true },
      yaxis: { title: { text: displayScale, font: { color: TC.textSoft, size: fs(13, fontScale) } }, range,
        tickmode: "array", tickvals: yTickVals, ticktext: yTickText,
        tickfont: { color: TC.textSoft, size: fs(12, fontScale) }, gridcolor: TC.gridSoft, zeroline: false },
      shapes, annotations: sBandLabels.concat(sNoteAnns), showlegend: false,
      margin: { t: titleText ? 60 : 30, b: 60, l: sLeftMargin, r: sRightMargin }, hovermode: "closest"
    };
    if (titleText) layout.title = { text: esc(titleText), x: 0.5, xanchor: "center",
      y: 0.97, yanchor: "top", yref: "container",
      font: { family: FONT_TITLE, size: 20, color: TC.text } };
    return { empty: false, traces, layout, height: 560 };
  }

  function renderChart(project, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const settings = project.chartSettings || {};
    const plotWidth = el.clientWidth || 900;
    const fig = settings.chartType === "radar"
      ? buildRadarFigure(project)
      : settings.chartType === "scales"
        ? buildScalesFigure(project, { plotWidth })
        : buildLineFigure(project, { plotWidth });

    if (fig.empty) {
      // If a real plot was here, purge it cleanly before showing the message,
      // so a later re-render starts fresh instead of reacting onto dead internals.
      if (el.classList.contains("js-plotly-plot") && window.Plotly.purge) {
        try { window.Plotly.purge(el); } catch (e) { /* noop */ }
      }
      const TC = themeColors();
      el.innerHTML = "<p style='text-align:center;color:" + TC.textSoft + ";padding:40px'>Aucun score à afficher. Entrez des scores et associez-leur au moins une fonction cognitive.</p>";
      return;
    }
    // First render builds the plot (newPlot); subsequent renders reuse it via
    // react(), which diffs the figure instead of rebuilding from scratch — much
    // faster for panel/colour/view changes, with an identical visual result.
    const hadPlot = el.classList.contains("js-plotly-plot");
    if (!hadPlot) el.innerHTML = "";
    // Grow the container's total height to fit x-axis labels below, so the plot
    // drawing area stays constant instead of being compressed.
    if (fig.height) el.style.height = fig.height + "px";
    else el.style.height = "";
    const config = {
      responsive: true,
      // Pinned comment labels can be dragged to a better spot. We enable the
      // TAIL edit (the label's offset from its point), not annotationPosition —
      // the latter moves the anchor itself, which would detach a note from its
      // score and leaves the label box immovable.
      edits: { annotationTail: true },
      toImageButtonOptions: { format: "png", filename: "vizea_profil", scale: 2 },
      displaylogo: false
    };
    const draw = hadPlot && window.Plotly.react ? window.Plotly.react : window.Plotly.newPlot;
    const plotPromise = draw(el, fig.traces, fig.layout, config);
    plotPromise.then(() => {
      // The container can change width (e.g. entering step 3 full-width, or the
      // drawer opening/closing). Force a resize so the plot always fits.
      if (window.Plotly.Plots && window.Plotly.Plots.resize) {
        try { window.Plotly.Plots.resize(el); } catch (e) { /* noop */ }
      }
    });
    return plotPromise;
  }

  const VizeaChart = {
    buildLineFigure,
    buildRadarFigure,
    buildScalesFigure,
    groupPointsByFunction,
    renderChart,
    setForceLight: (v) => { _forceLight = !!v; },
    commentAnnotationId: (i) => _commentAnnIndex[i] || null,
    AXIS_RANGE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = VizeaChart;
  } else {
    window.VizeaChart = VizeaChart;
  }
})();
