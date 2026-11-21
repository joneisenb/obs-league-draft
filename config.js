// ─────────────────────────────────────────────────────────────
//  Shared config for the overlay + control panel.
//  (The userscript has its own copy of the Firebase values at its top.)
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  firebase: {
    // Firebase console → Realtime Database → the URL at the top of the Data tab
    databaseURL: 'https://YOUR-PROJECT-default-rtdb.firebaseio.com',
    // Firebase console → Project settings → General → Web API Key
    apiKey: 'YOUR_WEB_API_KEY',
  },

  // Default channel. Override per-URL with ?ch=name (e.g. two streams at once).
  channel: 'main',

  audio: {
    // All loops must share this tempo/bar length so phase changes land on the bar.
    bpm: 120,
    beatsPerBar: 4,
    musicVolume: 0.6,
    sfxVolume: 0.9,
    fadeSeconds: 0.08,          // short crossfade at the bar line
    // Paths are relative to /overlay/. Missing files are skipped (SFX fall back to test blips).
    loops: {
      ban1:  'audio/loop_ban1.mp3',
      pick1: 'audio/loop_pick1.mp3',
      ban2:  'audio/loop_ban2.mp3',
      pick2: 'audio/loop_pick2.mp3',
      done:  'audio/loop_done.mp3',
    },
    sfx: {
      hover:    'audio/sfx_hover.mp3',
      ban:      'audio/sfx_ban.mp3',
      pick:     'audio/sfx_pick.mp3',
      complete: 'audio/sfx_complete.mp3',
    },
  },
};

export function channel() {
  return new URLSearchParams(location.search).get('ch') || CONFIG.channel;
}
