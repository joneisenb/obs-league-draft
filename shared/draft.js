// Draft model, tournament pick/ban order, and change detection.
//
// Draft shape (what the userscript writes and the overlay reads):
// {
//   blue: { bans: [Slot x5], picks: [Slot x5] },
//   red:  { bans: [Slot x5], picks: [Slot x5] },
//   timer: 23 | null,
//   updatedAt: 1732000000000
// }
// Slot = { champ: "Ahri" | null, locked: true|false }
//   champ set + locked=false  → hovering
//   champ set + locked=true   → locked in
//   champ null + locked=true  → "no ban"

const emptySlot = () => ({ champ: null, locked: false });

export function emptyDraft() {
  const side = () => ({ bans: Array.from({ length: 5 }, emptySlot), picks: Array.from({ length: 5 }, emptySlot) });
  return { blue: side(), red: side(), timer: null, updatedAt: 0 };
}

// Firebase drops empty arrays / nulls, so always re-inflate to the full shape.
export function normalizeDraft(d) {
  const out = emptyDraft();
  if (!d) return out;
  for (const side of ['blue', 'red']) for (const type of ['bans', 'picks']) {
    const src = d?.[side]?.[type] || [];
    for (let i = 0; i < 5; i++) {
      const s = src[i] || {};
      out[side][type][i] = { champ: s.champ || null, locked: !!s.locked };
    }
  }
  out.timer = Number.isFinite(d.timer) ? d.timer : null;
  out.updatedAt = d.updatedAt || 0;
  return out;
}

// Standard tournament draft order.
const S = (phase, side, type, i) => ({ phase, side, type, i });
export const ORDER = [
  S('ban1', 'blue', 'bans', 0), S('ban1', 'red', 'bans', 0),
  S('ban1', 'blue', 'bans', 1), S('ban1', 'red', 'bans', 1),
  S('ban1', 'blue', 'bans', 2), S('ban1', 'red', 'bans', 2),
  S('pick1', 'blue', 'picks', 0), S('pick1', 'red', 'picks', 0),
  S('pick1', 'red', 'picks', 1), S('pick1', 'blue', 'picks', 1),
  S('pick1', 'blue', 'picks', 2), S('pick1', 'red', 'picks', 2),
  S('ban2', 'red', 'bans', 3), S('ban2', 'blue', 'bans', 3),
  S('ban2', 'red', 'bans', 4), S('ban2', 'blue', 'bans', 4),
  S('pick2', 'red', 'picks', 3), S('pick2', 'blue', 'picks', 3),
  S('pick2', 'blue', 'picks', 4), S('pick2', 'red', 'picks', 4),
];

export const PHASE_LABEL = { ban1: 'Ban Phase 1', pick1: 'Pick Phase 1', ban2: 'Ban Phase 2', pick2: 'Pick Phase 2', done: 'Draft Complete' };

// Current step = first step in ORDER whose slot isn't locked yet.
export function currentStep(draft) {
  for (let n = 0; n < ORDER.length; n++) {
    const st = ORDER[n];
    if (!draft[st.side][st.type][st.i].locked) return { ...st, n };
  }
  return { phase: 'done', side: null, type: null, i: null, n: ORDER.length };
}

// Compare two drafts → list of events for animations/sound.
export function diff(prev, next) {
  const events = [];
  for (const side of ['blue', 'red']) for (const type of ['bans', 'picks']) {
    for (let i = 0; i < 5; i++) {
      const a = prev[side][type][i], b = next[side][type][i];
      if (!a.locked && b.locked) events.push({ kind: type === 'bans' ? 'ban' : 'pick', side, type, i, champ: b.champ });
      else if (!b.locked && b.champ && b.champ !== a.champ) events.push({ kind: 'hover', side, type, i, champ: b.champ });
    }
  }
  const pp = currentStep(prev).phase, np = currentStep(next).phase;
  if (pp !== np) events.push({ kind: 'phase', from: pp, to: np });
  if (np === 'done' && pp !== 'done') events.push({ kind: 'complete' });
  return events;
}
