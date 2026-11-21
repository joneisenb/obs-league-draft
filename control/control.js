import { CONFIG, channel } from '../config.js';
import { normalizeDraft } from '../shared/draft.js';
import { loadChampions, allChampions, resolve } from '../shared/ddragon.js';
import { listen, Auth, write } from '../shared/firebase.js';

const CH = channel();
const base = `channels/${CH}`;
const $ = id => document.getElementById(id);
const auth = new Auth();
let tree = {};
$('ch').textContent = `· ${CH}`;

// Bookmarklet: loads broadcaster.js from this same site into the drafter.lol tab.
{
  const src = new URL('../broadcaster/broadcaster.js', location.href).href + (CH !== CONFIG.channel ? `?ch=${encodeURIComponent(CH)}&` : '?');
  const bm = $('bookmarklet');
  bm.href = `javascript:(()=>{var s=document.createElement('script');s.src='${src}v='+Date.now();document.body.appendChild(s)})()`;
  bm.onclick = e => { e.preventDefault(); alert('Drag this to your bookmarks bar, then click it on the drafter.lol page.'); };
}

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// ───────────── Auth ─────────────
async function signedIn() {
  store.set('draft-refresh', auth.refreshToken);
  $('login').hidden = true; $('app').hidden = false;
}
$('login-form').onsubmit = async e => {
  e.preventDefault(); $('login-err').textContent = '';
  try { await auth.signIn($('email').value, $('password').value); signedIn(); }
  catch (err) { $('login-err').textContent = err.message; }
};
const saved = store.get('draft-refresh');
if (saved) auth.restore(saved).then(signedIn).catch(() => store.set('draft-refresh', null));

const patchMeta = obj => write(auth, `${base}/meta`, obj, 'PATCH').catch(err => alert(err.message));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ───────────── Meta controls ─────────────
document.querySelectorAll('[data-meta]').forEach(el => {
  const send = debounce(() => patchMeta({ [el.dataset.meta]: el.value.trim() }), 400);
  el.addEventListener('input', send);
});
document.querySelectorAll('[data-meta-bool]').forEach(el => el.addEventListener('change', () => patchMeta({ [el.dataset.metaBool]: el.checked })));
document.querySelectorAll('[data-meta-num]').forEach(el => {
  const send = debounce(() => patchMeta({ [el.dataset.metaNum]: Number(el.value) }), 120);
  el.addEventListener('input', send);
});
document.querySelectorAll('[data-score]').forEach(b => b.onclick = () => {
  const k = b.dataset.score; patchMeta({ [k]: Math.max(0, (tree.meta?.[k] || 0) + Number(b.dataset.d)) });
});
$('swap').onclick = () => {
  const m = tree.meta || {};
  patchMeta({ blueName: m.redName || '', redName: m.blueName || '', blueLogo: m.redLogo || '', redLogo: m.blueLogo || '', blueScore: m.redScore || 0, redScore: m.blueScore || 0 });
};

// ───────────── Manual draft editor ─────────────
const grid = $('manual-grid');
for (const side of ['blue', 'red']) {
  const col = document.createElement('div'); col.className = `mside ${side}`;
  col.innerHTML = `<h3>${side.toUpperCase()}</h3>`;
  for (const type of ['bans', 'picks']) for (let i = 0; i < 5; i++) {
    const row = document.createElement('div'); row.className = 'mslot';
    row.innerHTML = `<span>${type === 'bans' ? 'Ban' : 'Pick'} ${i + 1}</span>
      <input type="text" list="champ-list" data-path="${side}.${type}.${i}" placeholder="—">
      <label title="Locked in"><input type="checkbox" data-lock="${side}.${type}.${i}"> 🔒</label>`;
    col.appendChild(row);
  }
  grid.appendChild(col);
}

function readManual() {
  const d = normalizeDraft(null);
  grid.querySelectorAll('[data-path]').forEach(inp => {
    const [side, type, i] = inp.dataset.path.split('.');
    const c = inp.value.trim() ? resolve(inp.value.trim()) : null;
    d[side][type][i] = { champ: c ? c.id : null, locked: grid.querySelector(`[data-lock="${inp.dataset.path}"]`).checked };
  });
  d.timer = null; d.updatedAt = Date.now();
  return d;
}
function fillManual(d) {
  d = normalizeDraft(d);
  grid.querySelectorAll('[data-path]').forEach(inp => {
    const [side, type, i] = inp.dataset.path.split('.');
    const s = d[side][type][i];
    if (document.activeElement !== inp) inp.value = s.champ ? (resolve(s.champ)?.name || s.champ) : '';
    grid.querySelector(`[data-lock="${inp.dataset.path}"]`).checked = s.locked;
  });
}
const pushManual = debounce(() => write(auth, `${base}/manual`, readManual()).catch(err => alert(err.message)), 300);
grid.addEventListener('change', pushManual);
$('copy-live').onclick = () => { fillManual(tree.draft); pushManual(); };
$('clear-manual').onclick = () => { fillManual(null); pushManual(); };

// ───────────── Live sync ─────────────
loadChampions().then(list => { $('champ-list').innerHTML = list.map(c => `<option value="${c.name}">`).join(''); });

let filledOnce = false;
listen(base, t => {
  tree = t || {};
  const m = tree.meta || {};
  document.querySelectorAll('[data-meta]').forEach(el => { if (document.activeElement !== el) el.value = m[el.dataset.meta] || ''; });
  document.querySelectorAll('[data-meta-bool]').forEach(el => { el.checked = el.dataset.metaBool === 'visible' ? m.visible !== false : !!m[el.dataset.metaBool]; });
  document.querySelectorAll('[data-meta-num]').forEach(el => { if (document.activeElement !== el && m[el.dataset.metaNum] != null) el.value = m[el.dataset.metaNum]; });
  $('blueScore').value = m.blueScore || 0; $('redScore').value = m.redScore || 0;

  const src = tree.source;
  const age = tree.draft?.updatedAt ? Math.round((Date.now() - tree.draft.updatedAt) / 1000) : null;
  $('source').textContent = src?.url
    ? `Broadcasting from ${src.url} · last update ${age ?? '?'}s ago`
    : 'No draft received yet.';
  if (!filledOnce && tree.manual) { fillManual(tree.manual); filledOnce = true; }
}, status => { $('conn').textContent = status; $('conn').classList.toggle('ok', status === 'connected'); });
