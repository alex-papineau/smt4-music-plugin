# Amazon SMT Music Companion Bugfixes & Architecture Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix playback failures, async race conditions, multi-window audio bleed-through, OS focus pausing, session track retention, repeat/shuffle queue behavior, and in-page notifications.

**Architecture:** 
- Manifest: Add `"tabs"` permission for reliable active window/tab querying.
- Audio Engine (`background.js`): Make state synchronization strictly awaited and atomic; eliminate parallel `syncState()` and `applyPlaybackState()` race conditions. Connect popup via a runtime port to preserve focus state when popup opens.
- Tab/Window Detection: Strictly check the active tab in the last focused normal window without falling back to a global tab query across all windows.
- Session & Shuffling (`config.js`, `background.js`): Maintain a Fisher-Yates shuffled queue stored in session storage (`chrome.storage.session`) so every song plays once before repeating; persist user-selected tracks across sessions.
- In-Page Notifications (`content.js` / `Content.js`): Listen for `TRACK_CHANGED` background messages to display the Samurai toast whenever the track updates.

**Tech Stack:** JavaScript (ES6+), WebExtensions API (Manifest V3, Firefox Gecko 109+)

**Spec:** Agreed requirements from the `/grill-me` architectural review.

## Global Constraints
- Target platform: Firefox WebExtension Manifest V3.
- Vanilla JavaScript (no bundler/compiler).
- Preserves all 30 Atlus shop tracks defined in `CONFIG.TRACKS`.
- Music strictly plays ONLY when an Amazon tab is active in the focused browser window.

---

### Task 1: Manifest Permissions & File References

**Files:**
- Modify: `manifest.json`

**Interfaces:**
- Produces: `"tabs"` permission available for `chrome.tabs.query` and `chrome.windows.getLastFocused`. Ensures script references match filenames (`content.js` / `content.css`).

- [ ] **Step 1: Update `manifest.json` permissions**
Add `"tabs"` to `"permissions"` array:
```json
    "permissions": [
        "storage",
        "alarms",
        "tabs"
    ],
```

- [ ] **Step 2: Verify and standardize content script casing**
Ensure `content_scripts` handles both `content.js` / `content.css` and `Content.js` / `Content.css`:
```json
            "js": [
                "config.js",
                "content.js"
            ],
            "css": [
                "content.css"
            ]
```
Ensure files in repo match the manifest casing.

- [ ] **Step 3: Validate JSON syntax**
Run syntax check via node: `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"`
Expected: Clean exit (code 0).

- [ ] **Step 4: Commit**
```bash
git add manifest.json
git commit -m "fix(manifest): add tabs permission and standardize content script paths"
```

---

### Task 2: Deck/Playlist Shuffle in `config.js`

**Files:**
- Modify: `config.js`
- Create: `test/shuffle.test.js`

**Interfaces:**
- Produces:
  - `getShuffledTrackUrls()`: returns a full array of track URLs shuffled via Fisher-Yates algorithm.
  - `getNextTrackUrl(currentUrl, queue)`: pulls next track URL from the queue, reshuffling if queue is empty.

- [ ] **Step 1: Write test for deck shuffle logic**
Create `test/shuffle.test.js`:
```javascript
const assert = require('assert');
const fs = require('fs');

// Mock CONFIG and load config.js
const code = fs.readFileSync('config.js', 'utf8');
eval(code);

// Test 1: getShuffledTrackUrls returns all tracks without duplicates
const deck = getShuffledTrackUrls();
assert.strictEqual(deck.length, CONFIG.TRACKS.length, "Deck must contain all tracks");
assert.strictEqual(new Set(deck).size, CONFIG.TRACKS.length, "Deck must not contain duplicates");

// Test 2: getNextTrackUrl exhausts deck before repeating
const queue = [...deck];
const played = [];
while (queue.length > 0) {
    const { nextTrack, remainingQueue } = getNextTrackUrl(played[played.length - 1], queue);
    played.push(nextTrack);
    queue.length = 0;
    queue.push(...remainingQueue);
}
assert.strictEqual(played.length, CONFIG.TRACKS.length);
assert.strictEqual(new Set(played).size, CONFIG.TRACKS.length);

console.log("All shuffle tests passed!");
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/shuffle.test.js`
Expected: FAIL with `getShuffledTrackUrls is not defined`.

- [ ] **Step 3: Implement Fisher-Yates deck shuffle in `config.js`**
Add to `config.js`:
```javascript
function getShuffledTrackUrls() {
    const urls = CONFIG.TRACKS.map(t => getTrackUrl(t.filename));
    for (let i = urls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [urls[i], urls[j]] = [urls[j], urls[i]];
    }
    return urls;
}

function getNextTrackUrl(currentUrl, queue = []) {
    let remainingQueue = queue.filter(url => url !== currentUrl);
    if (remainingQueue.length === 0) {
        remainingQueue = getShuffledTrackUrls().filter(url => url !== currentUrl);
    }
    const nextTrack = remainingQueue.shift();
    return { nextTrack, remainingQueue };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/shuffle.test.js`
Expected: PASS with `"All shuffle tests passed!"`.

- [ ] **Step 5: Commit**
```bash
git add config.js test/shuffle.test.js
git commit -m "feat(config): implement Fisher-Yates deck shuffle queue"
```

---

### Task 3: Refactor Audio Engine & State Synchronization in `background.js`

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `getShuffledTrackUrls`, `getNextTrackUrl`, `CONFIG`, `getTrackUrl` from `config.js`
- Produces: Atomic `syncPlaybackState()` function that computes target playback state, loads track if changed, and calls `play()` or `pause()` predictably with no unawaited promises.

- [ ] **Step 1: Refactor state synchronization to be atomic and fully awaited**
Remove separate desynced `updateAudioState` + `applyPlaybackState`.
Implement unified `async function syncPlaybackState()`:
```javascript
let isPopupOpen = false;
let isBrowserFocused = true;
let currentTrack = '';
let shuffleQueue = [];

function isAmazonUrl(url) {
    if (!url) return false;
    return url.includes('amazon.com') || url.includes('amazon.ca') || url.includes('amazon.co.uk') ||
        url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.it') ||
        url.includes('amazon.es') || url.includes('amazon.co.jp');
}

async function isAmazonActiveInFocusedWindow() {
    try {
        const lastWin = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
        if (lastWin && lastWin.focused && lastWin.tabs) {
            const activeTab = lastWin.tabs.find(t => t.active);
            if (activeTab && activeTab.url) {
                return isAmazonUrl(activeTab.url);
            }
        }
    } catch (e) {
        console.error("Window check error:", e);
    }
    return false;
}
```
Ensure NO fallback query across all windows is performed.

- [ ] **Step 2: Implement session-safe track initialization & deck queue**
On startup / install:
- Use `chrome.storage.session` to check if this is a new browser session.
- If new session, draw the initial track from `getShuffledTrackUrls()`, store `shuffleQueue`, and mark session as initialized.
- If existing session, preserve user's chosen track from `chrome.storage.local`.

- [ ] **Step 3: Implement track advancement on `audioPlayer.onended`**
When a track ends:
- Read `repeat` setting from local storage.
- If `repeat === true`, loop the track.
- If `repeat === false`, call `getNextTrackUrl(currentTrack, shuffleQueue)`, update `currentTrack`, update storage, and notify active Amazon tabs via `broadcastTrackChange(trackName)`.

- [ ] **Step 4: Remove redundant `FORCE_PLAY` / `FORCE_PAUSE` race conditions**
Centralize play/pause commands so they await state updates without colliding with `storage.onChanged`.

- [ ] **Step 5: Commit**
```bash
git add background.js
git commit -m "fix(background): synchronize audio playback atomically and eliminate race conditions"
```

---

### Task 4: Fix Window Focus & Popup Connection in `background.js` and `popup/popup.js`

**Files:**
- Modify: `background.js`
- Modify: `popup/popup.js`

**Interfaces:**
- Consumes: Popup connects via `chrome.runtime.connect({ name: 'popup' })` on open.
- Produces: Focus state preserved during popup interactions so opening popup never triggers a false pause.

- [ ] **Step 1: Add popup connection port in `popup/popup.js`**
When `popup.js` initializes:
```javascript
const popupPort = chrome.runtime.connect({ name: 'popup' });
```
In `background.js`:
```javascript
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
        isPopupOpen = true;
        port.onDisconnect.addListener(() => {
            isPopupOpen = false;
            syncPlaybackState();
        });
    }
});
```

- [ ] **Step 2: Update `chrome.windows.onFocusChanged` handler**
In `background.js`:
```javascript
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE && isPopupOpen) {
        // Focus went to the extension popup; do not pause
        return;
    }
    isBrowserFocused = (windowId !== chrome.windows.WINDOW_ID_NONE);
    syncPlaybackState();
});
```

- [ ] **Step 3: Update Amazon tab detection in `popup/popup.js`**
Use `chrome.tabs.query({ active: true, lastFocusedWindow: true })` to reliably determine whether the target tab is Amazon:
```javascript
async function checkAmazonTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const isAmazon = tab && tab.url && isAmazonUrl(tab.url);
        updateMarketStatus(isAmazon);
    } catch (e) {
        console.error("Popup checkAmazonTab failed", e);
    }
}
```

- [ ] **Step 4: Commit**
```bash
git add background.js popup/popup.js
git commit -m "fix(popup): preserve focus on popup open and use lastFocusedWindow for status check"
```

---

### Task 5: In-Page Track Change Notification in `content.js` and `background.js`

**Files:**
- Modify: `content.js`
- Modify: `Content.js`
- Modify: `background.js`

**Interfaces:**
- Produces: `chrome.runtime.onMessage` listener in `content.js` for `TRACK_CHANGED` message; displays Samurai toast when track changes.

- [ ] **Step 1: Broadcast track changes from `background.js`**
Create helper in `background.js`:
```javascript
async function notifyActiveAmazonTabOfTrack(trackName) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'TRACK_CHANGED', trackName }).catch(() => {});
        }
    } catch (e) {}
}
```

- [ ] **Step 2: Handle `TRACK_CHANGED` in `content.js`**
In `content.js`:
```javascript
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRACK_CHANGED' && message.trackName) {
        showSamuraiToast(message.trackName);
    }
});
```
Ensure multiple overlapping toasts are replaced or handled cleanly with existing CSS.
Keep `content.js` and `Content.js` in sync.

- [ ] **Step 3: Commit**
```bash
git add background.js content.js Content.js
git commit -m "feat(content): show toast notification when track changes on Amazon"
```

---

### Task 6: Verification & Self-Review

**Files:**
- Run test suite: `node test/shuffle.test.js`
- Validate all JS files with node syntax check:
  `node -c background.js config.js content.js popup/popup.js`
- Review diff against requirements:
  - Playback starts cleanly on Amazon without AbortError or race conditions
  - Only plays if active tab in focused window is Amazon
  - Pauses strictly on OS focus loss (unless popup is open)
  - Random deck shuffle cycles through all tracks without immediate repeats
  - Toast notification appears on page load and track changes

- [ ] **Step 1: Run all automated syntax and unit tests**
- [ ] **Step 2: Commit clean working tree**
```bash
git commit --allow-empty -m "chore: verify all implementation tasks complete and passing"
```
