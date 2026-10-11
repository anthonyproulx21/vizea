// Apply the saved theme before first paint, to avoid a flash of the wrong theme.
// Externalized (instead of an inline <script>) so the Content-Security-Policy can
// forbid inline scripts entirely — the single biggest CSP hardening win.
(function () {
  try {
    if (localStorage.getItem("vizea_theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) { /* localStorage unavailable: fall back to the default light theme */ }
  // Home hero animation: hide its final state before first paint (home-anim.js
  // then plays it). Skipped when the visitor prefers reduced motion.
  try {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.classList.add("hero-anim");
    }
  } catch (e) { /* no matchMedia: static hero */ }
})();
