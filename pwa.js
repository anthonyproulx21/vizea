/* Vizéa — pwa.js
   Registers the service worker (offline use) and drives the install experience:
   a discreet dismissible pop-up (Chromium), plus a permanent "Installer" entry
   (home button + footer link) leading to the install page. The install page
   shows step-by-step instructions tailored to the visitor's browser, with a
   one-click button on Chromium. Installation is always optional. */
(function () {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function () { /* offline/unsupported: ignore */ });
    });
  }

  var deferredPrompt = null;
  var DISMISS_KEY = "vizea_install_dismissed";
  var $ = function (id) { return document.getElementById(id); };

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {} }
  function hidePopup() { var p = $("installPopup"); if (p) p.hidden = true; }
  function showPopup() { if (isStandalone()) return; var p = $("installPopup"); if (p) p.hidden = false; }

  function doInstall() {
    hidePopup();
    var status = $("installStatus");
    if (deferredPrompt) {
      if (status) status.hidden = true;
      var p = deferredPrompt;
      deferredPrompt = null;
      p.prompt();
      if (p.userChoice && p.userChoice.then) { p.userChoice.then(function () {}).catch(function () {}); }
      return;
    }
    // No native prompt available (already installed, or the browser hasn't armed
    // installation yet). Explain instead of doing nothing silently.
    if (status) {
      status.textContent = "Aucune fenêtre d'installation ne s'est ouverte. Vizéa est peut-être déjà installée — vérifiez vos applications (menu Démarrer sur Windows, Dock ou dossier Applications sur Mac). Sinon, cliquez l'icône d'installation à droite de la barre d'adresse, puis « Installer ».";
      status.hidden = false;
    }
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!dismissed()) showPopup();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    hidePopup();
    var hero = $("installAppBtn"); if (hero) hero.hidden = true;
    var fl = $("installFooterLink"); if (fl) fl.hidden = true;
  });

  // Detect the platform so the install page can show the right steps.
  function detectPlatform() {
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) return "ios";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\/|Chromium\/|Edg\//.test(ua) && !/OPR\//.test(ua)) return "chromium";
    if (/Safari\//.test(ua)) return "safari-mac";
    return "other";
  }

  function showSteps() {
    var key = detectPlatform();
    var blocks = document.querySelectorAll("#page-install .install-steps");
    if (!blocks.length) return;
    var matched = false;
    blocks.forEach(function (b) { var on = b.dataset.browser === key; b.hidden = !on; if (on) matched = true; });
    if (!matched) { var o = document.querySelector('#page-install .install-steps[data-browser="other"]'); if (o) o.hidden = false; }
    var det = $("installDetected");
    if (det) {
      var labels = {
        chromium: "Votre navigateur permet l'installation en un clic :",
        "safari-mac": "Sur Safari (Mac), l'installation se fait par le menu :",
        ios: "Sur votre appareil (iPhone / iPad) :",
        firefox: "", other: ""
      };
      var t = labels[key] || "";
      if (t) { det.textContent = t; det.hidden = false; }
    }
  }

  function wire() {
    var install = $("installPopupBtn"); if (install) install.addEventListener("click", doInstall);
    var later = $("installLaterBtn"); if (later) later.addEventListener("click", function () { hidePopup(); remember(); });
    var close = $("installCloseBtn"); if (close) close.addEventListener("click", function () { hidePopup(); remember(); });
    var now = $("installNowBtn"); if (now) now.addEventListener("click", doInstall);
    if (isStandalone()) {
      var hero = $("installAppBtn"); if (hero) hero.hidden = true;
      var fl = $("installFooterLink"); if (fl) fl.hidden = true;
    }
    showSteps();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.VizeaPWA = { install: doInstall, canInstall: function () { return !!deferredPrompt; } };
})();
