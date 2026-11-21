# LoL Draft Overlay (drafter.lol → OBS)

```
Any browser: drafter.lol spectator tab
  └─ 📡 bookmark loads broadcaster.js, which reads the draft → Firebase Realtime Database (free)
                                        │
Streamer's OBS: Browser Source ◄────────┘  overlay on GitHub Pages (free)
Control panel (you): team names, score, mute, manual override ──► Firebase
```

No server to run. The streamer only adds one URL to OBS.

| Folder | What it is |
|---|---|
| `overlay/` | The 1920×1080 OBS overlay (HTML/CSS/JS + audio engine) |
| `control/` | Control panel for team names, logos, score, visibility, volume, manual draft |
| `broadcaster/` | Reads the draft on drafter.lol (loaded by a bookmark) |
| `userscript/` | Optional Tampermonkey auto-loader for the broadcaster |
| `shared/` | Draft model, Data Dragon lookup, Firebase client |
| `config.js` | Your Firebase settings + audio settings |

---

## 1. Try the overlay right now (no setup)

The overlay has a demo mode that plays a fake draft, so you can design and compose before anything else is set up.

```bash
cd lol-draft-overlay
python3 -m http.server 8080
```

Open `http://localhost:8080/overlay/?demo` (or `?demo=fast`). Click the bar at the bottom once to enable audio (OBS doesn't need this).

> It has to be served over http; opening `index.html` directly from disk won't load the modules.

## 2. Firebase (≈10 minutes, free)

1. Go to <https://console.firebase.google.com> → **Add project** (you can turn Analytics off).
2. **Build → Realtime Database → Create database** → pick a region → start in **locked mode**.
3. **Build → Authentication → Get started → Email/Password → Enable.**
4. **Authentication → Users → Add user.** Create one login for yourself (e.g. `overlay@yourteam.gg`). Copy its **User UID**.
5. **Realtime Database → Rules**, paste this, put in your UID, and **Publish**:
   ```json
   {
     "rules": {
       "channels": {
         "$ch": {
           ".read": true,
           ".write": "auth != null && auth.uid === 'PASTE_YOUR_UID_HERE'"
         }
       }
     }
   }
   ```
   Anyone can *read* (the overlay needs that). Only your login can *write*.
6. Copy two values into **`config.js`**:
   - **Database URL**: shown at the top of the Realtime Database "Data" tab (`https://xxx-default-rtdb.firebaseio.com`, or `...firebasedatabase.app` outside the US).
   - **Web API Key**: ⚙ Project settings → General. (If it's not shown yet, click **Add app → Web** and it appears.)

## 3. Host the overlay + control panel (GitHub Pages)

1. Push this folder to a GitHub repo.
2. Repo **Settings → Pages →** Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute you'll have:
   - Overlay: `https://<you>.github.io/<repo>/overlay/`
   - Control panel: `https://<you>.github.io/<repo>/control/` (sign in with the Firebase user from step 2.4)

Netlify or Cloudflare Pages work the same way if you prefer them.

## 4. The broadcaster bookmark (no installs)

The code that reads drafter.lol is `broadcaster/broadcaster.js`, hosted on your GitHub Pages site. Anyone running a draft loads it into their drafter.lol tab with a bookmark:

1. Open the control panel and sign in. In **Broadcaster bookmark**, drag **📡 Broadcast Draft** to your bookmarks bar. (Ctrl+Shift+B / ⌘+Shift+B shows the bar.)
2. Open a drafter.lol **spectator** link and click the bookmark. A small **Draft Broadcaster** panel appears in the corner.

Because everyone loads the same file from GitHub Pages, **fixing a selector in the repo updates everyone's bookmark**. Nobody re-installs anything. GitHub Pages can take a minute or two to publish a change.

*Optional:* `userscript/drafter-overlay.user.js` is a 10-line Tampermonkey script that loads the same file automatically on drafter.lol, so you don't have to click. Only use it if you want that.

> If clicking the bookmark shows a "Content Security Policy" error, drafter.lol is blocking bookmarklets. Use **Manual override** in the control panel instead.

## 5. Finding the selectors (one-time, ~15 minutes)

The broadcaster has to know where drafter.lol puts each slot. Open a test draft's **spectator link**, then:

1. Right-click blue's first pick slot → **Inspect**. Find the element that represents the *whole slot*. Look for a class on it or a parent that makes it unique, e.g. `.team-blue .pick-slot`.
2. In the DevTools **Console**, check it: `document.querySelectorAll('.team-blue .pick-slot').length` should be **5**.
3. Repeat for red picks, blue bans, red bans, and the timer.
4. Put them in `SEL` at the top of **`broadcaster/broadcaster.js`** and commit.
5. Pick a champion in the draft and watch what changes on the slot element while it's **hovered** vs. **locked** (a class, an attribute, the image opacity). Edit `isLocked()` to match.
6. Once GitHub Pages has updated, reload drafter.lol, click the bookmark, then **Debug**. You'll get colored outlines on every matched element and a readout like:
   ```
   matches (want 5 each, timer 1): {"bluePicks":5,"redPicks":5,"blueBans":5,"redBans":5,"timer":1}
   BLUE bans : Aatrox✓  Jinx✓  ·  ·  ·
   RED  picks: Vi?  ·  ·  ·  ·          (✓ locked, ? hovering)
   ```
   When champions show up with the right ✓ / ? as you draft, you're done.

`readChamp()` already handles champion names in image URLs, `alt`/`title` text and CSS backgrounds, and the overlay matches names loosely (`Kai'Sa`, `Kaisa`, `kaisa` all work), so that part usually works without changes.

> Tip: if drafter.lol uses generated class names like `css-1x2y3z` that change between updates, use structure instead: `[class*="blue"] > div:nth-child(2) > div`.

## 6. Match day

**Whoever runs the draft** (doesn't have to be the streamer):
1. Open the control panel → set team names, logos, score, game label.
2. Open the drafter.lol **spectator** link → click the **📡 Broadcast Draft** bookmark → **Broadcast this draft** → sign in. The panel shows `live`.
3. Keep that tab open during the draft. If the page reloads, click the bookmark again (you stay signed in for that tab).
4. Next game: open the new spectator link, click the bookmark, Broadcast. Update the score.

Only one person should broadcast per draft. Two broadcasters would send the overlay conflicting data.

**Streamer (one-time OBS setup):**
- Add **Browser Source** → URL = your overlay URL, **1920 × 1080**.
- ✅ **Control audio via OBS** (so the music shows up in their mixer and can be balanced against casters).
- ❌ **Shutdown source when not visible**. Leave this off, or the music restarts on every scene switch.
- Put it on the draft scene. Use the control panel's **Overlay visible** toggle to fade it in and out.

**If something breaks mid-draft:** tick **Use manual draft** in the control panel, click **Copy live draft → manual**, and finish entering picks by hand. The overlay switches immediately.

## 6b. Adding teammates

Give each person their own login, so you can remove someone without changing everyone's password.

**One-time:** change the database rules to read from an `admins` list:
```json
{
  "rules": {
    "channels": {
      "$ch": {
        ".read": true,
        ".write": "auth != null && root.child('admins').child(auth.uid).val() === true"
      }
    }
  }
}
```
Then in **Realtime Database → Data**, add `admins` → *your UID* → `true` **before publishing**, or you'll lock yourself out.

**To add a person:**
1. **Authentication → Users → Add user** (their email and a temporary password).
2. Copy their **User UID** and add it under `admins` with the value `true`.
3. Send them the control panel link. They sign in and drag the bookmark to their bookmarks bar.

**To remove a person:** delete their entry under `admins`, or click **Disable account** in Authentication.

Also turn off **Authentication → Settings → User actions → Enable create (sign-up)**, so only people you add can have accounts.

## 7. Your soundtrack

Drop files into `overlay/audio/` with these names (or change the paths in `config.js`):

| File | When it plays |
|---|---|
| `loop_ban1.mp3` | Ban phase 1 (loops) |
| `loop_pick1.mp3` | Pick phase 1 (loops) |
| `loop_ban2.mp3` | Ban phase 2 (loops) |
| `loop_pick2.mp3` | Pick phase 2 (loops) |
| `loop_done.mp3` | After the last pick (loops) |
| `sfx_hover.mp3` | A team hovers a champion |
| `sfx_ban.mp3` | A ban locks in |
| `sfx_pick.mp3` | A pick locks in |
| `sfx_complete.mp3` | The final pick locks in |

How the music engine behaves (`overlay/audio.js`):
- **All loops should share one tempo and bar length.** Set `bpm` and `beatsPerBar` in `config.js`. Phase changes wait for the next bar line, then crossfade quickly (`fadeSeconds`).
- Loops stay on one shared timeline. If every loop is the same length (e.g. 8 bars), switching phases continues from the same bar position, so you can write them as layered stems of one piece that builds in intensity.
- Export loops cut exactly on the bar with no silence at the start or end. WAV/OGG work too, though MP3 can add a tiny gap at the loop point; OGG loops seamlessly.
- Missing SFX play test beeps so you can hear the timing before your sounds exist. Missing loops are silent.
- Music and SFX volume plus mute are on the control panel. Hiding the overlay also mutes the music.

## 8. Designing

- Start with the tokens at the top of `overlay/overlay.css` (colors, font, slot sizes, spacing). Then restyle freely. Everything is plain HTML/CSS.
- Slot states you can style: `[data-state="empty|hover|locked|nochamp"]`, `.active` (the slot whose turn it is), `.just-locked` (lock-in animation), and `#stage.complete` (draft finished).
- Pick cards use Data Dragon **loading-screen art** (tall, 308×560). Bans use square icons. Change this in `renderSlot()` in `overlay.js` (`img.splash` gives the wide splash art).
- Add `?debug` to the overlay URL to see the live JSON it's receiving.
- Add `?ch=name` to the overlay and control panel URLs if you ever run two streams at once. The control panel's bookmark carries the channel along automatically.

## Data format

What the broadcaster writes to `channels/<ch>/draft`:

```json
{
  "blue": { "bans": [{"champ": "Aatrox", "locked": true}, …×5], "picks": [{"champ": "Ahri", "locked": false}, …×5] },
  "red":  { … },
  "timer": 23,
  "updatedAt": 1732000000000
}
```

`champ` + `locked:false` = hovering · `locked:true` = locked in · `champ:null, locked:true` = no ban.
The overlay works out the phase and whose turn it is from the standard tournament order (`shared/draft.js`).
