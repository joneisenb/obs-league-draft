import { CONFIG, channel } from '../config.js';
import { normalizeDraft, emptyDraft, currentStep, diff, ORDER, PHASE_LABEL } from '../shared/draft.js';
import { loadChampions, resolve, allChampions, img } from '../shared/ddragon.js';
import { listen } from '../shared/firebase.js';
import { DraftAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEBUG = params.has('debug');
const $ = id => document.getElementById(id);

// ───────────── Build slot DOM once ─────────────
const slots = { blue: { bans: [], picks: [] }, red: { bans: [], picks: [] } };
for (const side of ['blue', 'red']) for (const type of ['bans', 'picks']) {
  const box = document.querySelector(`.side.${side} .${type}`);
  for (let i = 0; i < 5; i++) {
    const el = document.createElement('div');
    el.className = `slot ${type === 'bans' ? 'ban' : 'pick'}`;
    el.dataset.state = 'empty';
    el.innerHTML = `<img alt="">${type === 'picks' ? '<div class="label"></div>' : ''}`;
    el.addEventListener('animationend', e => { if (e.animationName === 'lockin' || e.animationName === 'flash') el.classList.remove('just-locked'); });
    box.appendChild(el);
    slots[side][type].push(el);
  }
}

// ───────────── State ─────────────
let prev = null;              // last rendered draft
let meta = {};
let stepKey = null, timerMax = 30;
const audio = new DraftAudio(CONFIG.audio);

function renderSlot(el, slot, type, active) {
  const c = resolve(slot.champ);
  const state = slot.locked ? (c ? 'locked' : 'nochamp') : (c ? 'hover' : 'empty');
  el.dataset.state = state;
  el.classList.toggle('active', active);
  const im = el.querySelector('img');
  const src = c ? (type === 'picks' ? img.loading(c.id) : img.icon(c.id)) : '';
  if (im.getAttribute('src') !== src) src ? im.setAttribute('src', src) : im.removeAttribute('src');
  const label = el.querySelector('.label');
  if (label) label.textContent = c ? c.name : '';
}

function render(draft) {
  const step = currentStep(draft);
  for (const side of ['blue', 'red']) for (const type of ['bans', 'picks']) {
    draft[side][type].forEach((s, i) => renderSlot(slots[side][type][i], s, type, step.side === side && step.type === type && step.i === i));
  }

  $('phase').textContent = PHASE_LABEL[step.phase];
  $('stage').classList.toggle('complete', step.phase === 'done');

  // Timer + draining bar on the active side
  const key = `${step.n}`;
  if (key !== stepKey) { stepKey = key; timerMax = Math.max(draft.timer || 30, 1); }
  const t = step.phase === 'done' ? null : draft.timer;
  $('timer').textContent = t ?? '';
  $('timer').classList.toggle('urgent', t != null && t <= 10);
  const frac = t == null ? 0 : Math.min(t / timerMax, 1);
  $('timerfill-blue').style.transform = `scaleX(${step.side === 'blue' ? frac : 0})`;
  $('timerfill-red').style.transform  = `scaleX(${step.side === 'red'  ? frac : 0})`;

  if (DEBUG) { $('debug').hidden = false; $('debug').textContent = JSON.stringify({ step, meta, draft }, null, 1); }
}

function renderMeta(m) {
  meta = m || {};
  $('blue-name').textContent = meta.blueName || 'BLUE';
  $('red-name').textContent  = meta.redName  || 'RED';
  $('blue-score').textContent = meta.blueScore ?? 0;
  $('red-score').textContent  = meta.redScore  ?? 0;
  $('game-label').textContent = meta.gameLabel || '';
  setImg($('blue-logo'), meta.blueLogo); setImg($('red-logo'), meta.redLogo);
  const visible = meta.visible !== false;
  $('stage').classList.toggle('hidden', !visible);
  audio.setVolumes({ music: meta.musicVolume, sfx: meta.sfxVolume, muted: !!meta.muted || !visible });
}
const setImg = (el, src) => src ? el.setAttribute('src', src) : el.removeAttribute('src');

let lastHover = 0;
function update(rawDraft) {
  const draft = normalizeDraft(rawDraft);
  const events = prev ? diff(prev, draft) : [];
  render(draft);

  for (const ev of events) {
    if (ev.kind === 'ban' || ev.kind === 'pick') {
      const el = slots[ev.side][ev.type][ev.i];
      el.classList.remove('just-locked'); void el.offsetWidth; el.classList.add('just-locked');
      audio.sfx(ev.kind);
    } else if (ev.kind === 'hover' && performance.now() - lastHover > 150) {
      lastHover = performance.now(); audio.sfx('hover');
    } else if (ev.kind === 'complete') {
      audio.sfx('complete');
    }
  }
  // Music follows the phase (also sets the initial loop on first render).
  audio.setPhase(currentStep(draft).phase);
  prev = draft;
}

// ───────────── Boot ─────────────
await Promise.all([loadChampions(), audio.load()]);

if (audio.locked) {     // OBS autoplays; a normal browser needs one click
  const b = $('click-to-start'); b.hidden = false;
  b.onclick = () => audio.unlock().then(() => (b.hidden = true));
}

if (DEMO) runDemo();
else {
  listen(`channels/${channel()}`, tree => {
    renderMeta(tree?.meta);
    update(tree?.meta?.manual ? tree?.manual : tree?.draft);
  }, status => console.info('[firebase]', status));
}

// ───────────── Demo: fake draft so you can design without a live room ─────────────
function runDemo() {
  renderMeta({ blueName: 'Blue Univ', redName: 'Red State', blueScore: 1, redScore: 0, gameLabel: 'Game 2 · Bo3' });
  const pool = (allChampions().length ? allChampions().map(c => c.id) : ['Ahri', 'Aatrox', 'Jinx', 'LeeSin', 'Thresh', 'Orianna', 'Kaisa', 'Vi', 'Nautilus', 'Azir', 'Gnar', 'Varus', 'Rell', 'Sejuani', 'Viktor', 'KSante', 'Ezreal', 'Rakan', 'Maokai', 'Corki', 'Renekton', 'Xayah'])
    .sort(() => Math.random() - 0.5);
  const d = emptyDraft();
  let n = 0, t = 30, hovers = 0;
  update(structuredClone(d));
  setInterval(() => {
    if (n >= ORDER.length) return;
    const st = ORDER[n];
    const slot = d[st.side][st.type][st.i];
    t -= 1; d.timer = t;
    if (t % 2 === 0 && hovers < 2) { slot.champ = pool.pop(); hovers++; }
    else if (hovers >= 2) { slot.locked = true; n++; t = 30; hovers = 0; }
    update(structuredClone(d));
  }, DEMO && params.get('demo') === 'fast' ? 250 : 700);
}
