// ==UserScript==
// @name         Drafter.lol → Stream Overlay (auto-loader)
// @namespace    draft-overlay
// @version      0.2.0
// @description  OPTIONAL. Loads the draft broadcaster on drafter.lol automatically, same as clicking the bookmarklet.
// @match        https://drafter.lol/*
// @match        https://*.drafter.lol/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// The real code lives in broadcaster/broadcaster.js on your GitHub Pages site,
// so selector fixes there apply to bookmarklet users and this loader alike.
(function () {
  const s = document.createElement('script');
  s.src = 'https://joneisenb.github.io/obs-league-draft/broadcaster/broadcaster.js?v=' + Date.now();
  document.body.appendChild(s);
})();
