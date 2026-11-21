// Draft broadcaster: reads the draft from a drafter.lol page and sends it to Firebase.
// Loaded into the drafter.lol tab by the bookmarklet (see control panel) or the optional
// Tampermonkey loader. Firebase settings come from ../config.js, so there's one place to edit.
(async function () {
  'use strict';
  if (window.__draftBroadcaster) { window.__draftBroadcaster.toggle(); return; }   // clicked twice -> show/hide panel

  // ========================= DRAFTER.LOL SELECTORS =========================
  // PLACEHOLDERS: fill these in using DevTools on a spectator page
  // (README -> "Finding the selectors"). Click Debug on the panel to see what matches.
  const SEL = {
    bluePicks: '.blue-side .pick',     // exactly 5 elements, in pick order
    redPicks:  '.red-side .pick',
    blueBans:  '.blue-side .ban',      // 5 elements, in ban order
    redBans:   '.red-side .ban',
    timer:     '.timer',               // element whose text is the countdown number
  };

  // LOCKED vs HOVERED. Edit to match the site:
  //  A) class while hovering -> return !el.matches('.hovering')
  //  B) class once locked    -> return el.matches('.locked')
  //  C) hovered art is faded -> return getComputedStyle(el.querySelector('img')).opacity === '1'
  function isLocked(el, champ) {
    if (!champ) return false;
    return !el.matches('.hover, .hovering, .selecting, .active');
  }

  // Champion from a slot: image URL, alt/title text, CSS background, or data attribute.
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

  // ========================= Nothing below needs editing =====================
  const scriptUrl = new URL(document.currentScript?.src || window.__draftBroadcasterSrc);
  const BASE = new URL('../', scriptUrl).href;
  const CHANNEL_OVERRIDE = scriptUrl.searchParams.get('ch');
  const { CONFIG } = await import(`${BASE}config.js?v=${Date.now()}`);
  const DB = CONFIG.firebase.databaseURL.replace(/\/$/, '');
  const KEY = CONFIG.firebase.apiKey;
  const CH = CHANNEL_OVERRIDE || CONFIG.channel;

  // --------- Auth (refresh token kept only for this tab's session; password never stored) ---------
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch {} } };
  let idToken = null, exp = 0;
  const post = async (url, body, form) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || j.error || r.status); return j;
  };
  async function signIn(email, password) {
    const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, JSON.stringify({ email, password, returnSecureToken: true }));
    idToken = j.idToken; exp = Date.now() + (j.expiresIn - 120) * 1000; ss.set('draftBroadcasterRefresh', j.refreshToken);
  }
  async function token() {
    if (idToken && Date.now() < exp) return idToken;
    const rt = ss.get('draftBroadcasterRefresh');
    if (!rt) throw new Error('NEED_LOGIN');
    const j = await post(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`, true);
    idToken = j.id_token; exp = Date.now() + (j.expires_in - 120) * 1000; ss.set('draftBroadcasterRefresh', j.refresh_token);
    return idToken;
  }
  async function put(path, data) {
    const r = await fetch(`${DB}/channels/${CH}/${path}.json?auth=${await token()}`, { method: 'PUT', body: JSON.stringify(data) });
    if (!r.ok) throw new Error(r.status === 401 ? 'Permission denied - is this user in admins?' : `Write failed (${r.status})`);
  }

  // --------- Reading the page ---------
  const readSlots = sel => Array.from({ length: 5 }, (_, i) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) return { champ: null, locked: false };
    const champ = readChamp(el);
    return { champ, locked: isLocked(el, champ) };
  });
  function readDraft() {
    const t = parseInt((document.querySelector(SEL.timer)?.textContent || '').replace(/\D/g, ''), 10);
    return {
      blue: { picks: readSlots(SEL.bluePicks), bans: readSlots(SEL.blueBans) },
      red:  { picks: readSlots(SEL.redPicks),  bans: readSlots(SEL.redBans) },
      timer: Number.isFinite(t) ? t : null,
    };
  }

  // --------- Panel UI ---------
  const ui = document.createElement('div');
  ui.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:12px;bottom:12px;font:13px system-ui,sans-serif;color:#fff;background:#111e;border:1px solid #444;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;min-width:240px;box-shadow:0 4px 20px #0008';
  ui.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <b style="font:600 13px system-ui">\ud83d\udce1 Draft Broadcaster</b><span data-s style="font:12px system-ui;opacity:.7">off</span>
    </div>
    <form data-login style="display:none;flex-direction:column;gap:6px">
      <input data-email type="email" placeholder="Email" autocomplete="username" required>
      <input data-pw type="password" placeholder="Password" autocomplete="current-password" required>
      <button>Sign in &amp; broadcast</button>
    </form>
    <div style="display:flex;gap:6px">
      <button data-b style="flex:1">\ud83d\udd34 Broadcast this draft</button><button data-d>Debug</button><button data-x title="Hide (click the bookmark to show again)">\u2715</button>
    </div>`;
  ui.querySelectorAll('input,button').forEach(el => el.style.cssText = 'font:13px system-ui;padding:6px 8px;border-radius:6px;border:1px solid #555;background:#222;color:#fff;cursor:pointer');
  document.body.appendChild(ui);
  const $ = s => ui.querySelector(s);
  const status = $('[data-s]'), btn = $('[data-b]'), form = $('[data-login]');
  const setStatus = (s, c) => { status.textContent = s; status.style.color = c || ''; };

  let broadcasting = false, debug = false, last = '', pending = null, lastSent = 0;

  async function start() {
    try {
      await put('source', { url: location.href, startedAt: Date.now() });
      broadcasting = true; last = ''; btn.textContent = '\u23f9 Stop broadcasting'; form.style.display = 'none';
      setStatus('live', '#3ccf7a'); tick();
    } catch (e) {
      if (e.message === 'NEED_LOGIN') { form.style.display = 'flex'; $('[data-email]').focus(); setStatus('sign in'); }
      else setStatus(e.message, '#ff5a6a');
    }
  }
  function stop() { broadcasting = false; btn.textContent = '\ud83d\udd34 Broadcast this draft'; setStatus('off'); }
  btn.onclick = () => (broadcasting ? stop() : start());
  form.onsubmit = async e => {
    e.preventDefault(); setStatus('signing in\u2026');
    try { await signIn($('[data-email]').value, $('[data-pw]').value); $('[data-pw]').value = ''; start(); }
    catch (err) { setStatus(err.message.replace(/_/g, ' ').toLowerCase(), '#ff5a6a'); }
  };
  $('[data-d]').onclick = () => { debug = !debug; debug ? tick() : clearDebug(); };
  $('[data-x]').onclick = () => (ui.style.display = 'none');

  // --------- Change detection -> throttled writes ---------
  function tick() {
    const draft = readDraft();
    if (debug) showDebug(draft);
    if (!broadcasting) return;
    const json = JSON.stringify(draft);
    if (json === last) return;
    last = json; pending = draft;
    setTimeout(flush, Math.max(0, 120 - (Date.now() - lastSent)));   // max ~8 writes/sec
  }
  async function flush() {
    if (!pending) return;
    const d = pending; pending = null; lastSent = Date.now();
    try { await put('draft', { ...d, updatedAt: Date.now() }); setStatus('live', '#3ccf7a'); }
    catch (e) { console.error('[broadcaster]', e); setStatus(e.message === 'NEED_LOGIN' ? 'sign in again' : e.message, '#ff5a6a'); last = ''; }
  }

  const dbg = document.createElement('pre');
  dbg.style.cssText = 'all:initial;position:fixed;z-index:2147483646;left:12px;bottom:12px;max-height:60vh;overflow:auto;padding:8px;background:#000d;color:#7f7;font:11px/1.35 monospace;border-radius:6px;white-space:pre;display:none';
  document.body.appendChild(dbg);

  // Ignore changes inside our own panel. Debug outlines/text are only written when they differ,
  // so the extra mutation they cause settles after one pass instead of looping.
  const ours = r => ui.contains(r.target) || dbg.contains(r.target);
  new MutationObserver(recs => { if (!recs.every(ours)) tick(); })
    .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(tick, 1000);   // safety net

  const OUT = { bluePicks: '3px solid #2f8cff', redPicks: '3px solid #ff3b4e', blueBans: '2px dashed #2f8cff', redBans: '2px dashed #ff3b4e', timer: '2px solid #ffd34d' };
  function showDebug(draft) {
    dbg.style.display = 'block';
    const counts = Object.fromEntries(Object.keys(SEL).map(k => [k, document.querySelectorAll(SEL[k]).length]));
    for (const k in OUT) document.querySelectorAll(SEL[k]).forEach(el => { if (!el.style.outline) { el.style.outline = OUT[k]; el.style.outlineOffset = '-2px'; } });
    const fmt = s => s.map(x => (x.champ || '\u00b7') + (x.locked ? '\u2713' : x.champ ? '?' : '')).join('  ');
    const text = `matches (want 5 each, timer 1): ${JSON.stringify(counts)}\n` +
      `BLUE bans : ${fmt(draft.blue.bans)}\nBLUE picks: ${fmt(draft.blue.picks)}\n` +
      `RED  bans : ${fmt(draft.red.bans)}\nRED  picks: ${fmt(draft.red.picks)}\ntimer: ${draft.timer}   channel: ${CH}\n(\u2713 locked, ? hovering)`;
    if (dbg.textContent !== text) dbg.textContent = text;
  }
  function clearDebug() {
    dbg.style.display = 'none';
    for (const k in OUT) document.querySelectorAll(SEL[k]).forEach(el => { el.style.outline = ''; });
  }

  window.__draftBroadcaster = { toggle: () => (ui.style.display = ui.style.display === 'none' ? 'flex' : 'none') };
  if (ss.get('draftBroadcasterRefresh')) setStatus('ready - press Broadcast');
})().catch(e => alert('Draft broadcaster failed to load: ' + e.message + '\n\nIf this mentions "Content Security Policy", drafter.lol blocks bookmarklets - use manual mode in the control panel.'));
