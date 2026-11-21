// ==UserScript==
// @name         Drafter.lol → Stream Overlay
// @namespace    draft-overlay
// @version      0.1.0
// @description  Reads the draft from a drafter.lol spectator page and sends it to the stream overlay.
// @match        https://drafter.lol/*
// @match        https://*.drafter.lol/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      firebaseio.com
// @connect      firebasedatabase.app
// @connect      googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ═════════════════════════ 1. YOUR FIREBASE PROJECT ═════════════════════════
  const DB_URL  = 'https://YOUR-PROJECT-default-rtdb.firebaseio.com';
  const API_KEY = 'YOUR_WEB_API_KEY';
  const CHANNEL = 'main';

  // ═════════════════════════ 2. DRAFTER.LOL SELECTORS ═════════════════════════
  // These are PLACEHOLDERS. Fill them in using DevTools on a spectator page
  // (see README → "Finding the selectors"). Turn on Debug in the panel to see
  // outlines around everything each selector matches.
  const SEL = {
    bluePicks: '.blue-side .pick',     // must match exactly 5 elements, in pick order
    redPicks:  '.red-side .pick',
    blueBans:  '.blue-side .ban',      // 5 elements, in ban order
    redBans:   '.red-side .ban',
    timer:     '.timer',               // element whose text is the countdown number
  };

  // How to tell a slot is LOCKED vs just HOVERED. Edit to match the site.
  // Option A: the site adds a class while hovering   → return !el.matches('.hovering')
  // Option B: the site adds a class once locked       → return el.matches('.locked')
  // Option C: hovered champs are semi-transparent     → return getComputedStyle(img).opacity === '1'
  function isLocked(el, champ) {
    if (!champ) return false;
    return !el.matches('.hover, .hovering, .selecting, .active');
  }

  // How to read the champion from a slot. The default handles the common cases:
  // <img src=".../champion/Ahri.png">, alt/title text, or a CSS background-image.
  function readChamp(el) {
    const img = el.querySelector('img') || (el.tagName === 'IMG' ? el : null);
    const fromUrl = url => {
      const m = url && url.match(/\/(?:champion\/(?:splash\/|loading\/|tiles\/)?)?([A-Za-z' .&]+?)(?:_\d+)?\.(?:png|jpe?g|webp)/i);
      return m ? m[1] : null;
    };
    if (img) {
      const c = fromUrl(img.currentSrc || img.src) || img.alt || img.title;
      if (c && !/placeholder|empty|none|default/i.test(c)) return c.trim();
    }
    const bg = getComputedStyle(el).backgroundImage;
    const c = bg && bg !== 'none' ? fromUrl(bg) : null;
    if (c) return c;
    const t = el.getAttribute('data-champion') || el.getAttribute('title');
    return t ? t.trim() : null;
  }

  // ═════════════════════════ Nothing below needs editing ═════════════════════
  let ui, dbg;
  let broadcasting = false, debug = false, last = '', pending = null, lastSent = 0;

  function readSlots(sel) {
    return Array.from({ length: 5 }, (_, i) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return { champ: null, locked: false };
      const champ = readChamp(el);
      return { champ, locked: isLocked(el, champ) };
    });
  }

  function readDraft() {
    const t = parseInt((document.querySelector(SEL.timer)?.textContent || '').replace(/\D/g, ''), 10);
    return {
      blue: { picks: readSlots(SEL.bluePicks), bans: readSlots(SEL.blueBans) },
      red:  { picks: readSlots(SEL.redPicks),  bans: readSlots(SEL.redBans) },
      timer: Number.isFinite(t) ? t : null,
    };
  }

  // ───────── Firebase (REST via GM_xmlhttpRequest so the site's CSP can't block it) ─────────
  const gm = (method, url, body, headers = { 'Content-Type': 'application/json' }) => new Promise((resolve, reject) =>
    GM_xmlhttpRequest({ method, url, headers, data: body, onload: r => (r.status < 300 ? resolve(JSON.parse(r.responseText || 'null')) : reject(new Error(r.status + ' ' + r.responseText))), onerror: reject }));

  let token = null, tokenExp = 0;
  async function getToken() {
    if (token && Date.now() < tokenExp) return token;
    let email = GM_getValue('email'), password = GM_getValue('password');
    if (!email || !password) {
      email = prompt('Overlay login – Firebase user email:'); password = prompt('Password:');
      if (!email || !password) throw new Error('No login');
    }
    const r = await gm('POST', `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      JSON.stringify({ email, password, returnSecureToken: true }));
    GM_setValue('email', email); GM_setValue('password', password);
    token = r.idToken; tokenExp = Date.now() + (Number(r.expiresIn) - 120) * 1000;
    return token;
  }
  GM_registerMenuCommand('Reset overlay login', () => { GM_setValue('email', ''); GM_setValue('password', ''); token = null; alert('Login cleared.'); });

  const put = async (path, data) => gm('PUT', `${DB_URL.replace(/\/$/, '')}/channels/${CHANNEL}/${path}.json?auth=${await getToken()}`, JSON.stringify(data));

  // ───────── Change detection → throttled send ─────────
  function tick() {
    const draft = readDraft();
    if (debug) showDebug(draft);
    if (!broadcasting) return;
    const json = JSON.stringify(draft);
    if (json === last) return;
    last = json;
    pending = draft;
    const wait = Math.max(0, 120 - (Date.now() - lastSent));   // max ~8 writes/sec
    setTimeout(flush, wait);
  }
  async function flush() {
    if (!pending) return;
    const d = pending; pending = null; lastSent = Date.now();
    try { await put('draft', { ...d, updatedAt: Date.now() }); setStatus('live'); }
    catch (e) { console.error('[overlay]', e); setStatus('error'); last = ''; }
  }

  // Ignore changes inside our own panel. Debug outlines/text are only written when they
  // differ, so the extra mutation they cause settles after one pass instead of looping.
  const ours = r => ui?.contains(r.target) || dbg?.contains(r.target);
  new MutationObserver(recs => { if (!recs.every(ours)) tick(); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(tick, 1000);   // safety net (e.g. canvas/CSS-only timers)

  // ───────── Floating panel ─────────
  ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;z-index:2147483647;right:12px;bottom:12px;font:12px system-ui;color:#fff;background:#111d;border:1px solid #444;border-radius:8px;padding:8px;display:flex;gap:6px;align-items:center';
  ui.innerHTML = `<button data-b>🔴 Broadcast this draft</button><button data-d>Debug</button><span data-s style="opacity:.7">off</span>`;
  document.body.appendChild(ui);
  const btn = ui.querySelector('[data-b]'), status = ui.querySelector('[data-s]');
  const setStatus = s => { status.textContent = s; status.style.color = s === 'live' ? '#3ccf7a' : s === 'error' ? '#ff5a6a' : ''; };

  btn.onclick = async () => {
    broadcasting = !broadcasting;
    btn.textContent = broadcasting ? '⏹ Stop broadcasting' : '🔴 Broadcast this draft';
    setStatus(broadcasting ? 'starting…' : 'off');
    if (broadcasting) {
      try { await put('source', { url: location.href, startedAt: Date.now() }); last = ''; tick(); }
      catch (e) { alert('Could not start: ' + e.message); broadcasting = false; btn.textContent = '🔴 Broadcast this draft'; setStatus('error'); }
    }
  };
  ui.querySelector('[data-d]').onclick = () => { debug = !debug; if (!debug) clearDebug(); else tick(); };

  // ───────── Debug: outline matched elements + show parsed state ─────────
  dbg = document.createElement('pre');
  dbg.style.cssText = 'position:fixed;z-index:2147483646;left:12px;bottom:12px;max-height:60vh;overflow:auto;margin:0;padding:8px;background:#000d;color:#7f7;font:11px monospace;border-radius:6px;display:none';
  document.body.appendChild(dbg);
  const OUT = { bluePicks: '3px solid #2f8cff', redPicks: '3px solid #ff3b4e', blueBans: '2px dashed #2f8cff', redBans: '2px dashed #ff3b4e', timer: '2px solid #ffd34d' };
  function showDebug(draft) {
    dbg.style.display = 'block';
    const counts = Object.fromEntries(Object.keys(SEL).map(k => [k, document.querySelectorAll(SEL[k]).length]));
    for (const k in OUT) document.querySelectorAll(SEL[k]).forEach(el => { if (!el.style.outline) { el.style.outline = OUT[k]; el.style.outlineOffset = '-2px'; } });
    const fmt = s => s.map(x => (x.champ || '·') + (x.locked ? '✓' : x.champ ? '?' : '')).join('  ');
    const text = `matches (want 5 each, timer 1): ${JSON.stringify(counts)}\n` +
      `BLUE bans : ${fmt(draft.blue.bans)}\nBLUE picks: ${fmt(draft.blue.picks)}\n` +
      `RED  bans : ${fmt(draft.red.bans)}\nRED  picks: ${fmt(draft.red.picks)}\ntimer: ${draft.timer}\n(✓ locked, ? hovering)`;
    if (dbg.textContent !== text) dbg.textContent = text;
  }
  function clearDebug() {
    dbg.style.display = 'none';
    for (const k in OUT) document.querySelectorAll(SEL[k]).forEach(el => { el.style.outline = ''; });
  }
})();
