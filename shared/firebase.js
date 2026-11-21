// Tiny Firebase Realtime Database client – no SDK, just REST + Server-Sent Events.

import { CONFIG } from '../config.js';
const DB = CONFIG.firebase.databaseURL.replace(/\/$/, '');

// Live-listen to a path. Calls onData(tree) on every change. EventSource auto-reconnects.
export function listen(path, onData, onStatus = () => {}) {
  let tree = null;
  const es = new EventSource(`${DB}/${path}.json`);
  const apply = (p, data, merge) => {
    const keys = p.split('/').filter(Boolean);
    if (!keys.length) { tree = merge ? { ...(tree || {}), ...data } : data; return; }
    tree = tree && typeof tree === 'object' ? tree : {};
    let node = tree;
    for (const k of keys.slice(0, -1)) node = node[k] = (node[k] && typeof node[k] === 'object') ? node[k] : {};
    const last = keys.at(-1);
    node[last] = merge ? { ...(node[last] || {}), ...data } : data;
  };
  es.addEventListener('put',   e => { const m = JSON.parse(e.data); apply(m.path, m.data, false); onData(structuredClone(tree)); });
  es.addEventListener('patch', e => { const m = JSON.parse(e.data); apply(m.path, m.data, true);  onData(structuredClone(tree)); });
  es.onopen  = () => onStatus('connected');
  es.onerror = () => onStatus('reconnecting');
  return () => es.close();
}

// Email/password sign-in for writers (control panel). Refreshes the token automatically.
export class Auth {
  constructor() { this.idToken = null; this.refreshToken = null; this.expires = 0; }

  async signIn(email, password) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CONFIG.firebase.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Sign-in failed');
    this._set(j.idToken, j.refreshToken, j.expiresIn);
    return j;
  }

  async restore(refreshToken) {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.firebase.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Session expired');
    this._set(j.id_token, j.refresh_token, j.expires_in);
  }

  _set(id, refresh, expiresIn) {
    this.idToken = id; this.refreshToken = refresh;
    this.expires = Date.now() + (Number(expiresIn) - 120) * 1000;
  }

  async token() {
    if (!this.idToken) throw new Error('Not signed in');
    if (Date.now() > this.expires) await this.restore(this.refreshToken);
    return this.idToken;
  }
}

export async function write(auth, path, data, method = 'PUT') {
  const r = await fetch(`${DB}/${path}.json?auth=${await auth.token()}`, { method, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`Write failed (${r.status}): ${await r.text()}`);
  return r.json();
}
