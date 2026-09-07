// Amazon SMT Music Companion - Background Engine

let audioPlayer = new Audio();
audioPlayer.loop = false;
audioPlayer.crossOrigin = 'anonymous';

let currentTrackUrl = '';
let shuffleQueue = [];
let isBrowserFocused = true;
let isPopupOpen = false;
let isSyncing = false;
let pendingSync = false;

// URL validation helper
function isAmazonUrl(url) {
    if (!url) return false;
    return url.includes('amazon.com') || url.includes('amazon.ca') || url.includes('amazon.co.uk') ||
        url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.it') ||
        url.includes('amazon.es') || url.includes('amazon.co.jp');
}

// Get display name from track URL or filename
function getTrackDisplayName(urlOrFilename) {
    if (!urlOrFilename) return "Unknown Track";
    const filename = urlOrFilename.split('/').pop();
    const trackObj = CONFIG.TRACKS.find(t => t.filename === filename || getTrackUrl(t.filename) === urlOrFilename);
    return trackObj ? trackObj.name : "Unknown Track";
}

// Initialize session state and track queue
async function initSession() {
    try {
        let session = {};
        if (chrome.storage.session) {
            session = await chrome.storage.session.get(['sessionInitialized', 'shuffleQueue']);
        }

        const local = await chrome.storage.local.get(['enabled', 'volume', 'track', 'repeat']);

        if (!session.sessionInitialized) {
            // Fresh browser session: generate a newly shuffled deck and pick a fresh starting track
            shuffleQueue = getShuffledTrackUrls();
            const initialTrack = shuffleQueue.shift();

            if (chrome.storage.session) {
                await chrome.storage.session.set({
                    sessionInitialized: true,
                    shuffleQueue
                });
            }

            await chrome.storage.local.set({
                enabled: local.enabled ?? true,
                volume: local.volume ?? 50,
                track: initialTrack,
                repeat: local.repeat ?? false
            });
        } else {
            // Restored session: keep stored queue
            shuffleQueue = session.shuffleQueue || getShuffledTrackUrls();
            if (!local.track) {
                const nextTrack = shuffleQueue.shift() || getDefaultTrackUrl();
                await chrome.storage.local.set({ track: nextTrack });
            }
        }
    } catch (e) {
        console.error("Session init error:", e);
    }
}

// Determine if the active tab in the currently focused normal window is Amazon
async function isAmazonActiveInFocusedWindow() {
    try {
        const lastWin = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
        if (lastWin && lastWin.tabs) {
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

// Notify the active Amazon tab when the track changes
async function notifyActiveAmazonTabOfTrack(trackName) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab && tab.id && tab.url && isAmazonUrl(tab.url)) {
            chrome.tabs.sendMessage(tab.id, { type: 'TRACK_CHANGED', trackName }).catch(() => {});
        }
    } catch (e) {}
}

// Advance to next track in the deck queue
async function advanceToNextTrack() {
    const { nextTrack, remainingQueue } = getNextTrackUrl(currentTrackUrl, shuffleQueue);
    shuffleQueue = remainingQueue;

    if (chrome.storage.session) {
        chrome.storage.session.set({ shuffleQueue }).catch(() => {});
    }

    await chrome.storage.local.set({ track: nextTrack });
}

// Atomic synchronization of playback state
async function syncPlaybackState() {
    if (isSyncing) {
        pendingSync = true;
        return;
    }
    isSyncing = true;

    try {
        const { enabled, volume, track, repeat } = await chrome.storage.local.get(['enabled', 'volume', 'track', 'repeat']);
        const isAmazon = await isAmazonActiveInFocusedWindow();

        // Music plays strictly when enabled, window is focused (or popup is open), and active tab is Amazon
        const shouldPlay = (enabled !== false) && (isBrowserFocused || isPopupOpen) && isAmazon;

        // Apply volume
        if (volume !== undefined) {
            audioPlayer.volume = Math.max(0, Math.min(1, (volume || 50) / 100));
        }

        // Apply loop / repeat mode
        audioPlayer.loop = !!repeat;

        // Apply track source if changed
        const trackUrl = getTrackUrl(track);
        if (trackUrl && trackUrl !== currentTrackUrl) {
            console.log(`Loading track: ${trackUrl}`);
            currentTrackUrl = trackUrl;
            audioPlayer.src = trackUrl;
        }

        // Apply playback
        if (shouldPlay) {
            if (audioPlayer.paused && currentTrackUrl) {
                console.log('Starting playback');
                try {
                    await audioPlayer.play();
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Playback start error:', err);
                    }
                }
            }
        } else {
            if (!audioPlayer.paused) {
                console.log('Pausing playback');
                audioPlayer.pause();
            }
        }

        console.log(`State synced: shouldPlay=${shouldPlay}, isAmazon=${isAmazon}, focused=${isBrowserFocused}, popupOpen=${isPopupOpen}, track=${currentTrackUrl}`);
    } catch (err) {
        console.error("Error during syncPlaybackState:", err);
    } finally {
        isSyncing = false;
        if (pendingSync) {
            pendingSync = false;
            syncPlaybackState();
        }
    }
}

// Handle track ended (advances deck if repeat is off)
audioPlayer.onended = async () => {
    const { repeat } = await chrome.storage.local.get('repeat');
    if (!repeat) {
        console.log('Track ended, advancing to next track in shuffle queue...');
        await advanceToNextTrack();
    }
};

// Message bus
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AMAZON_VISITED') {
        chrome.storage.local.get(['track']).then(({ track }) => {
            sendResponse({ trackName: getTrackDisplayName(track || currentTrackUrl) });
        });
        syncPlaybackState();
        return true;
    } else if (message.type === 'RANDOMIZE_TRACK') {
        advanceToNextTrack();
    } else if (message.type === 'RESTART_TRACK') {
        if (audioPlayer) {
            audioPlayer.currentTime = 0;
            syncPlaybackState();
        }
    } else if (message.type === 'GET_PROGRESS') {
        isAmazonActiveInFocusedWindow().then(isAmazon => {
            if (audioPlayer && !isNaN(audioPlayer.duration)) {
                sendResponse({
                    currentTime: audioPlayer.currentTime,
                    duration: audioPlayer.duration,
                    paused: audioPlayer.paused,
                    isAmazon
                });
            } else {
                sendResponse({ currentTime: 0, duration: 0, paused: true, isAmazon });
            }
        });
        return true;
    } else if (message.type === 'SEEK_TRACK') {
        if (audioPlayer && audioPlayer.duration) {
            audioPlayer.currentTime = (message.progress / 100) * audioPlayer.duration;
            sendResponse({ success: true });
        }
        return false;
    } else if (message.type === 'FORCE_PLAY') {
        chrome.storage.local.set({ enabled: true });
        return false;
    } else if (message.type === 'FORCE_PAUSE') {
        chrome.storage.local.set({ enabled: false });
        return false;
    } else if (message.type === 'USER_INTERACTED') {
        if (audioPlayer && audioPlayer.paused) {
            syncPlaybackState();
        }
        return false;
    }
    return false;
});

// Port connections (popup and keep-alive)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup') {
        isPopupOpen = true;
        port.onDisconnect.addListener(() => {
            isPopupOpen = false;
            syncPlaybackState();
        });
    } else if (port.name === 'keep-alive') {
        port.onMessage.addListener(() => { /* Keep alive ping */ });
    }
});

// React to storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.track && changes.track.newValue) {
            notifyActiveAmazonTabOfTrack(getTrackDisplayName(changes.track.newValue));
        }
        syncPlaybackState();
    }
});

// Browser alarms
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { /* Keep awake */ });

// Window & Tab lifecycle
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE && isPopupOpen) {
        // Focus shifted to extension popup; do not treat as loss of focus
        return;
    }
    isBrowserFocused = (windowId !== chrome.windows.WINDOW_ID_NONE);
    syncPlaybackState();
});

chrome.tabs.onActivated.addListener(() => {
    syncPlaybackState();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        setTimeout(syncPlaybackState, 50);
    }
});

chrome.tabs.onRemoved.addListener(() => {
    setTimeout(syncPlaybackState, 50);
});

// Initial boot
(async () => {
    await initSession();
    try {
        const win = await chrome.windows.getLastFocused({ populate: false });
        if (win && win.focused !== undefined) {
            isBrowserFocused = win.focused;
        }
    } catch (e) {}
    syncPlaybackState();
})();
