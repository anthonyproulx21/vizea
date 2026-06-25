/* ============================================================
   Vizéa — scoring.js
   Score conversion math + classification bands
   Reference: Guilmette et al. (2020), adapted by l'AQNP (2022)
   ============================================================ */

// ---- Normal distribution helpers ------------------------------------------

// Standard normal CDF using Abramowitz & Stegun approximation (good to ~1e-7)
function normalCDF(z) {
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

// Inverse standard normal CDF (Acklam's algorithm), returns z for a given p (0,1)
function normalInverseCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];

  const pLow = 0.02425;
  let q, r;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ---- Score type definitions ------------------------------------------------
// mean/sd used to convert to/from Z, hence to/from percentile
const SCORE_TYPES = {
  "Standard score": { mean: 100, sd: 15 },
  "Scale score":    { mean: 10,  sd: 3 },
  "Z-Score":        { mean: 0,   sd: 1 },
  "T-Score":        { mean: 50,  sd: 10 },
  "Percentile":      null // handled specially (not normally distributed transform)
};

/**
 * Convert any supported score type to a percentile (0-100).
 * @param {number} value
 * @param {string} type - one of SCORE_TYPES keys
 * @returns {number|null} percentile or null if invalid
 */
function toPercentile(value, type) {
  if (value === null || value === undefined || value === "" || isNaN(value)) return null;
  value = Number(value);

  if (type === "Percentile") {
    return clamp(value, 0, 100);
  }

  const def = SCORE_TYPES[type];
  if (!def) return null;

  const z = (value - def.mean) / def.sd;
  return clamp(normalCDF(z) * 100, 0, 100);
}

/**
 * Convert a percentile (0-100) into any supported score type.
 * @param {number} percentile
 * @param {string} type
 * @returns {number|null}
 */
function fromPercentile(percentile, type) {
  if (percentile === null || percentile === undefined || isNaN(percentile)) return null;
  percentile = clamp(Number(percentile), 0.0001, 99.9999); // avoid +/-Infinity at extremes

  if (type === "Percentile") return percentile;

  const def = SCORE_TYPES[type];
  if (!def) return null;

  const z = normalInverseCDF(percentile / 100);
  return z * def.sd + def.mean;
}

/**
 * Convert directly between any two score types via percentile as the pivot.
 */
function convertScore(value, fromType, toType) {
  if (fromType === toType) return Number(value);
  const pct = toPercentile(value, fromType);
  if (pct === null) return null;
  return fromPercentile(pct, toType);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---- Classification bands (from Guilmette et al. 2020 / AQNP 2022) --------
// Defined in percentile space (authoritative), with equivalent boundaries
// in the other scales for reference/display purposes.
//
// The cut-points are anchored to the normal curve at the standard clinical
// cutoffs, which are the SAME point on every parametric scale:
//   z = ±2/3, ±4/3, ±2  ⟺  SS 90/110, 80/120, 70/130
//                        ⟺  scale 8/12, 6/14, 4/16  ⟺  T …/70  ⟺  z …/2.0
// Expressing them as percentiles via the same normalCDF used to score a value
// guarantees two things: (1) a value sitting exactly on a cutoff (e.g. SS 130)
// classifies into the UPPER band, and (2) the drawn stripe edges land exactly
// on the conventional cutoff for every score type (130, 16, 70, 2.0, …),
// instead of a rounded percentile like 97 → SS 128.
const BAND_Z_CUTS = [-2, -4 / 3, -2 / 3, 2 / 3, 4 / 3, 2];
const BAND_PCT_CUTS = BAND_Z_CUTS.map((z) => normalCDF(z) * 100);

const CLASSIFICATION_BANDS = [
  {
    key: "extremely_low",
    label: "Score extrêmement bas",
    color: "#C25A50",
    percentile: { min: 0, max: BAND_PCT_CUTS[0] },
    standard:   { min: -Infinity, max: 69 },
    z:          { min: -Infinity, max: -2.00 },
    scale:      { min: -Infinity, max: 3 }
  },
  {
    key: "below_average",
    label: "Score inférieur à la moyenne",
    color: "#D98E5A",
    percentile: { min: BAND_PCT_CUTS[0], max: BAND_PCT_CUTS[1] },
    standard:   { min: 70, max: 79 },
    z:          { min: -2.00, max: -1.34 },
    scale:      { min: 4, max: 5 }
  },
  {
    key: "low_average",
    label: "Score dans la basse moyenne",
    color: "#E3C173",
    percentile: { min: BAND_PCT_CUTS[1], max: BAND_PCT_CUTS[2] },
    standard:   { min: 80, max: 89 },
    z:          { min: -1.33, max: -0.68 },
    scale:      { min: 6, max: 7 }
  },
  {
    key: "average",
    label: "Score dans la moyenne",
    color: "#93C088",
    percentile: { min: BAND_PCT_CUTS[2], max: BAND_PCT_CUTS[3] },
    standard:   { min: 90, max: 109 },
    z:          { min: -0.67, max: 0.66 },
    scale:      { min: 8, max: 11 }
  },
  {
    key: "high_average",
    label: "Score dans la haute moyenne",
    color: "#6BA9C4",
    percentile: { min: BAND_PCT_CUTS[3], max: BAND_PCT_CUTS[4] },
    standard:   { min: 110, max: 119 },
    z:          { min: 0.67, max: 1.32 },
    scale:      { min: 12, max: 13 }
  },
  {
    key: "superior",
    label: "Score supérieur à la moyenne",
    color: "#8E92C9",
    percentile: { min: BAND_PCT_CUTS[4], max: BAND_PCT_CUTS[5] },
    standard:   { min: 120, max: 129 },
    z:          { min: 1.33, max: 1.99 },
    scale:      { min: 14, max: 15 }
  },
  {
    key: "extremely_high",
    label: "Score extrêmement élevé",
    color: "#C285B4",
    percentile: { min: BAND_PCT_CUTS[5], max: 100 },
    standard:   { min: 130, max: Infinity },
    z:          { min: 2.00, max: Infinity },
    scale:      { min: 16, max: Infinity }
  }
];

/**
 * Get the classification band for a given percentile value.
 * Boundaries follow the reference table exactly: e.g. "<2" = extremely_low,
 * "2-8" = below_average. So each band's lower edge is inclusive except for
 * the very first band (extremely_low), and we walk bands low-to-high using
 * strict "<=" against each band's max, which matches "<2", "<=8", "<=24"...
 * (the printed table's upper bound of each row is inclusive).
 */
function getBandForPercentile(percentile) {
  if (percentile === null || percentile === undefined || isNaN(percentile)) return null;
  percentile = clamp(Number(percentile), 0, 100);

  // Strict "<" so a value exactly on a cutoff (e.g. SS 130 → 97.725) lands in
  // the UPPER band ("à partir de 130 = extrêmement élevé"). Cut-points share the
  // normalCDF used by toPercentile, so they match a scored value bit-for-bit.
  if (percentile < BAND_PCT_CUTS[0]) return CLASSIFICATION_BANDS[0]; // extrêmement bas  (< SS 70)
  if (percentile < BAND_PCT_CUTS[1]) return CLASSIFICATION_BANDS[1]; // inférieur        (70–79)
  if (percentile < BAND_PCT_CUTS[2]) return CLASSIFICATION_BANDS[2]; // basse moyenne    (80–89)
  if (percentile < BAND_PCT_CUTS[3]) return CLASSIFICATION_BANDS[3]; // moyenne          (90–109)
  if (percentile < BAND_PCT_CUTS[4]) return CLASSIFICATION_BANDS[4]; // haute moyenne    (110–119)
  if (percentile < BAND_PCT_CUTS[5]) return CLASSIFICATION_BANDS[5]; // supérieur        (120–129)
  return CLASSIFICATION_BANDS[6];                                    // extrêmement élevé (≥ 130)
}

/**
 * Get band boundaries expressed in a target scale, for drawing chart stripes.
 * Returns array of {key,label,color,min,max} with min/max in the target scale.
 * Infinity edges are resolved to a sensible finite clamp by the caller (chart axis range).
 */
function getBandsInScale(scaleKey) {
  // scaleKey one of: "percentile", "standard", "z", "scale"
  return CLASSIFICATION_BANDS.map(b => ({
    key: b.key,
    label: b.label,
    color: b.color,
    min: b[scaleKey].min,
    max: b[scaleKey].max
  }));
}

/**
 * Get display-scale bands for any of the 5 score types.
 *
 * Percentile uses its own authoritative boundaries (they already tile).
 * Every other scale DERIVES its band edges from the percentile cut-points
 * via fromPercentile(). This guarantees the stripes tile perfectly with no
 * gaps on any scale (the discrete integer ranges in the printed AQNP table,
 * e.g. scale 4-5 / 6-7, leave gaps between integers and must NOT be used as
 * continuous stripe edges). It is also fully consistent with point
 * classification, since a point is classified by converting its value to a
 * percentile first — so a point always lands inside the stripe of its band.
 */
function getBandsForDisplayType(type) {
  if (type === "Percentile") return getBandsInScale("percentile");

  return CLASSIFICATION_BANDS.map(b => {
    const minVal = b.percentile.min === 0 ? -Infinity : fromPercentile(b.percentile.min, type);
    const maxVal = b.percentile.max === 100 ? Infinity : fromPercentile(b.percentile.max, type);
    return { key: b.key, label: b.label, color: b.color, min: minVal, max: maxVal };
  });
}

// ---- Exports (works both as <script> global and as ES module) ------------
const ScoringEngine = {
  normalCDF,
  normalInverseCDF,
  SCORE_TYPES,
  toPercentile,
  fromPercentile,
  convertScore,
  CLASSIFICATION_BANDS,
  getBandForPercentile,
  getBandsInScale,
  getBandsForDisplayType,
  clamp
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = ScoringEngine;
} else {
  window.ScoringEngine = ScoringEngine;
}
