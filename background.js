// Initialize storage with defaults
chrome.runtime.onInstalled.addListener(async (details) => {
    const data = await chrome.storage.local.get(['enabled', 'volume', 'track', 'repeat']);

    const defaults = {
        enabled: data.enabled ?? true,
        volume: data.volume ?? 50,
        track: data.track ?? getRandomTrackUrl(),
        repeat: data.repeat ?? false
    };

    await chrome.storage.local.set(defaults);
});

// Audio Player
let audioPlayer = new Audio();
audioPlayer.loop = false; // Default to shuffle (looping handled by ended event or loop property)
audioPlayer.crossOrigin = 'anonymous';

let currentTrack = '';
let currentVolume = 50;
let isAudioEnabled = true;
let isBrowserFocused = true; // Track if the browser window has focus

// Function to handle audio playback state
async function updateAudioState(track, volume, enabled) {
    if (!audioPlayer) return;

    const { repeat } = await chrome.storage.local.get('repeat');
    audioPlayer.loop = !!repeat;

    if (track !== undefined) {
        // ALWAYS stream from GitHub Pages
        const trackUrl = getTrackUrl(track);

        if (trackUrl !== currentTrack && trackUrl) {
            console.log(`Loading track: ${trackUrl}`);
            currentTrack = trackUrl;
            audioPlayer.src = trackUrl;
            // Removed audioPlayer.load() to prevent AbortErrors when followed instantly by play()
        }
    }

    if (volume !== undefined) {
        currentVolume = volume;
        audioPlayer.volume = volume / 100;
    }

    if (enabled !== undefined) {
        isAudioEnabled = enabled;
    }

    console.log(`Audio state updated: enabled=${isAudioEnabled}, volume=${currentVolume}, track=${currentTrack}, repeat=${repeat}`);
}

// Handle track end for shuffle mode
audioPlayer.onended = () => {
    chrome.storage.local.get('repeat', (data) => {
        if (!data.repeat) {
            console.log('Track ended, shuffling to next random track...');
            randomizeTrack();
        }
    });
};

// Play/Pause execution
function applyPlaybackState() {
    if (!audioPlayer) return;
    if (isAudioEnabled) {
        if (audioPlayer.paused) {
            console.log('Starting playback');
            audioPlayer.play().catch(err => {
                if (err.name !== 'AbortError') console.error('Playback failed:', err);
            });
        }
    } else {
        if (!audioPlayer.paused) {
            console.log('Pausing playback');
            audioPlayer.pause();
        }
    }
}

// Sync player with storage and browser tabs
async function syncState() {
    let { enabled, volume, track } = await chrome.storage.local.get(['enabled', 'volume', 'track']);

    // Check if the most recent normal window has an active Amazon tab
    let isActiveTabAmazon = false;
    try {
        const lastWin = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
        if (lastWin && lastWin.tabs) {
            const activeTab = lastWin.tabs.find(t => t.active);
            if (activeTab && activeTab.url) {
                const url = activeTab.url;
                isActiveTabAmazon = url.includes('amazon.com') || url.includes('amazon.ca') || url.includes('amazon.co.uk') ||
                    url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.it') ||
                    url.includes('amazon.es') || url.includes('amazon.co.jp');
            }
        }
    } catch(e) {
        console.error("Window check failed", e);
    }

    // Fallback: check all active tabs if lastWin approach fails (e.g. during OS focus ambiguity)
    if (!isActiveTabAmazon) {
        try {
            const tabs = await chrome.tabs.query({ active: true });
            isActiveTabAmazon = tabs.some(t => {
                const url = t.url || "";
                return url.includes('amazon.com') || url.includes('amazon.ca') || url.includes('amazon.co.uk') ||
                    url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.it') ||
                    url.includes('amazon.es') || url.includes('amazon.co.jp');
            });
        } catch(e) {}
    }

    // New logic: Music ONLY plays if enabled, browser is focused, AND on Amazon.
    const shouldPlay = enabled && isBrowserFocused && isActiveTabAmazon;

    console.log(`Sync complete: shouldPlay=${shouldPlay}, isActiveTabAmazon=${isActiveTabAmazon}, browserFocused=${isBrowserFocused}`);

    updateAudioState(track, volume, shouldPlay);
}

let hasStartedSession = false;

async function handleAmazonVisited() {
    let { enabled, track } = await chrome.storage.local.get(['enabled', 'track']);
    let changedTrack = false;
    
    if (!track || (!hasStartedSession && audioPlayer.paused)) {
        track = getRandomTrackUrl();
        hasStartedSession = true;
        changedTrack = true;
        chrome.storage.local.set({ track }); // Listener handles syncState and playback
    }
    
    if (!changedTrack && enabled !== false) {
        syncState().then(() => applyPlaybackState());
    }
    
    const trackFilename = track.split('/').pop();
    const trackObj = CONFIG.TRACKS.find(t => t.filename === trackFilename || getTrackUrl(t.filename) === track);
    return { trackName: trackObj ? trackObj.name : "Unknown Track" };
}

// Handle incoming messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AMAZON_VISITED') {
        handleAmazonVisited().then(sendResponse);
        return true;
    } else if (message.type === 'RANDOMIZE_TRACK') {
        randomizeTrack();
    } else if (message.type === 'RESTART_TRACK') {
        if (audioPlayer) {
            audioPlayer.currentTime = 0;
            // Force re-sync to start playback if allowed
            syncState().then(() => applyPlaybackState());
        }
    } else if (message.type === 'GET_PROGRESS') {
        if (audioPlayer && !isNaN(audioPlayer.duration)) {
            sendResponse({
                currentTime: audioPlayer.currentTime,
                duration: audioPlayer.duration,
                paused: audioPlayer.paused
            });
        } else {
            sendResponse({ currentTime: 0, duration: 0, paused: true });
        }
        return true; // Keep message channel open for response
    } else if (message.type === 'SEEK_TRACK') {
        if (audioPlayer && audioPlayer.duration) {
            audioPlayer.currentTime = (message.progress / 100) * audioPlayer.duration;
            sendResponse({ success: true });
        }
        return false;
    } else if (message.type === 'FORCE_PLAY') {
        if (audioPlayer) {
            audioPlayer.play().catch(err => {
                if (err.name !== 'AbortError') console.error('Playback failed:', err);
            });
            isAudioEnabled = true;
            syncState();
        }
        return false;
    } else if (message.type === 'FORCE_PAUSE') {
        if (audioPlayer) {
            audioPlayer.pause();
            isAudioEnabled = false;
            syncState();
        }
        return false;
    } else if (message.type === 'USER_INTERACTED') {
        if (isAudioEnabled && audioPlayer && audioPlayer.paused) {
            audioPlayer.play().catch(() => {});
        }
        return false;
    }
    return false;
});

// New random selection (avoids immediate repeat)
async function randomizeTrack() {
    const newTrack = getRandomTrackUrl(currentTrack);
    await chrome.storage.local.set({ track: newTrack });
    syncState().then(() => {
        applyPlaybackState();
    });
}

// Firefox persistent connection listener
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'keep-alive') {
        port.onMessage.addListener(() => { /* Heartbeat */ });
    }
});

// React to setting changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        syncState().then(() => {
            applyPlaybackState();
        });
    }
});

// Script wake-up alarm
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { /* Awake */ });

// Tab lifecycle management
chrome.tabs.onRemoved.addListener(() => {
    setTimeout(() => {
        syncState().then(() => {
            applyPlaybackState();
        });
    }, 100);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        setTimeout(() => {
            syncState().then(() => {
                applyPlaybackState();
            });
        }, 100);
    }
});

chrome.tabs.onActivated.addListener(() => {
    syncState().then(() => {
        applyPlaybackState();
    });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    isBrowserFocused = (windowId !== chrome.windows.WINDOW_ID_NONE);
    syncState().then(() => {
        applyPlaybackState();
    });
});

// Start sync
chrome.windows.getLastFocused({ populate: false }, (window) => {
    if (window && window.focused !== undefined) {
        isBrowserFocused = window.focused;
    }
    syncState();
});
