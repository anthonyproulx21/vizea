/* ============================================================
   Vizéa — constants.js
   Single source of truth for the canonical cognitive function
   list, used everywhere (test bank tagging, manual score entry,
   suggestion form, chart axis grouping/sort order).
   ============================================================ */

// Canonical list + fixed display/sort order (left-to-right on the chart x-axis)
const COGNITIVE_FUNCTIONS = [
  "Attention",
  "Cognition sociale",
  "Fonctions exécutives",
  "Langage oral",
  "Langage écrit",
  "Mathématiques",
  "Mémoire",
  "Mémoire de travail",
  "Moteur",
  "Psychoaffectif",
  "Raisonnement fluide",
  "Visuospatial",
  "Vitesse de traitement"
];

// Score types available everywhere a score is entered/displayed
const SCORE_TYPE_OPTIONS = ["Scale score", "Standard score", "Percentile", "Z-Score", "T-Score"];

// Default chart color per cognitive function (used unless user customizes in the chart panel)
// Curated, harmonized palette that sits well on the light/dark backgrounds and
// reads as an intentional set (no default brown/olive/grey). Decoupled from the
// classification band colors so the two systems (band = severity, function =
// domain) never collide.
const DEFAULT_FUNCTION_COLORS = {
  "Attention": "#3D7EA6",
  "Cognition sociale": "#E08A4F",
  "Fonctions exécutives": "#4E9E79",
  "Langage oral": "#D0604F",
  "Langage écrit": "#9A78C7",
  "Mathématiques": "#BE8654",
  "Mémoire": "#CF6FA6",
  "Mémoire de travail": "#4E6FB0",
  "Moteur": "#A7B84E",
  "Psychoaffectif": "#4FB0AE",
  "Raisonnement fluide": "#6CA6DF",
  "Visuospatial": "#E0A94E",
  "Vitesse de traitement": "#5FB389"
};

// Extended cycle used when more functions are shown than there are named colors
// (e.g. many custom functions). Harmonized with the named set; the chart assigns
// these in order, skipping any colour already taken by a named function, so even
// a profile with "plein plein" de fonctions stays distinguishable.
const EXTENDED_PALETTE = [
  "#3D7EA6","#D0604F","#4E9E79","#E0A94E","#9A78C7","#4FB0AE","#CF6FA6",
  "#BE8654","#6CA6DF","#5FB389","#E08A4F","#4E6FB0","#A7B84E","#7E5BA6",
  "#C98A3A","#5C97A8","#B05C7A","#6B8E4E","#46789E","#C77A5C","#8A86C2",
  "#3F9E8E","#D49A4E","#7AA0D8","#A85C5C","#5E8C6A","#B98ACF","#4C8C99"
];

const VizeaConstants = {
  COGNITIVE_FUNCTIONS,
  SCORE_TYPE_OPTIONS,
  DEFAULT_FUNCTION_COLORS,
  EXTENDED_PALETTE
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = VizeaConstants;
} else {
  window.VizeaConstants = VizeaConstants;
}
