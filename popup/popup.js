// Connect to background to hold popup focus state
const popupPort = chrome.runtime.connect({ name: 'popup' });

const volumeSlider = document.getElementById('volume-slider');
const trackSelect = document.getElementById('track-select');
const toggleBtn = document.getElementById('toggle-btn');
const restartBtn = document.getElementById('restart-btn');
const randomBtn = document.getElementById('random-btn');
const repeatBtn = document.getElementById('repeat-btn');
const marketStatus = document.getElementById('market-status');
const progressBar = document.getElementById('progress-bar');
const timeDisplay = document.getElementById('time-display');

const PLAY_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;

let isCurrentlyOnAmazon = false;

// Populate track list from CONFIG
function populateTracks() {
    trackSelect.innerHTML = '';
    CONFIG.TRACKS.forEach(track => {
        const option = document.createElement('option');
        option.value = getTrackUrl(track.filename);
        option.textContent = track.name;
        trackSelect.appendChild(option);
    });
}

// Load initial settings
chrome.storage.local.get(['enabled', 'volume', 'track', 'repeat'], (data) => {
    populateTracks();

    const isEnabled = data.enabled !== false;
    updateToggleIcon(isEnabled, true);

    volumeSlider.value = data.volume || 50;
    trackSelect.value = data.track || getDefaultTrackUrl();

    updateRepeatState(!!data.repeat);
    checkAmazonTab();
});

function updateRepeatState(isRepeating) {
    if (isRepeating) {
        repeatBtn.classList.add('active');
    } else {
        repeatBtn.classList.remove('active');
    }
}

function updateMarketStatus(isAmazon) {
    isCurrentlyOnAmazon = !!isAmazon;
    if (isCurrentlyOnAmazon) {
        marketStatus.textContent = "ONLINE";
        marketStatus.style.color = "#fff";
        marketStatus.style.opacity = "1";
    } else {
        marketStatus.textContent = "OFFLINE // NO TARGET DETECTED";
        marketStatus.style.color = "var(--accent-red)";
        marketStatus.style.opacity = "0.8";
    }
}

async function checkAmazonTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const url = tab?.url || "";
        const isAmazon = url.includes('amazon.com') || url.includes('amazon.ca') || url.includes('amazon.co.uk') ||
            url.includes('amazon.de') || url.includes('amazon.fr') || url.includes('amazon.it') ||
            url.includes('amazon.es') || url.includes('amazon.co.jp');
        updateMarketStatus(isAmazon);
    } catch (e) {
        console.error("Popup checkAmazonTab failed", e);
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateProgress() {
    chrome.runtime.sendMessage({ type: 'GET_PROGRESS' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response) {
            const { currentTime, duration, paused, isAmazon } = response;
            if (isAmazon !== undefined) {
                updateMarketStatus(isAmazon);
            }
            if (duration > 0) {
                progressBar.value = (currentTime / duration) * 100;
                timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
            }
            chrome.storage.local.get('enabled', (data) => {
                updateToggleIcon(data.enabled !== false, paused);
            });
        }
    });
}

// Start polling for progress while popup is open
const progressInterval = setInterval(updateProgress, 400);

progressBar.addEventListener('input', () => {
    const seekTo = progressBar.value;
    chrome.runtime.sendMessage({ type: 'SEEK_TRACK', progress: parseFloat(seekTo) });
});

function updateToggleIcon(enabled, actualPaused) {
    toggleBtn.innerHTML = (enabled && !actualPaused) ? PAUSE_ICON : PLAY_ICON;

    if (enabled) {
        toggleBtn.classList.add('active-power');
    } else {
        toggleBtn.classList.remove('active-power');
    }

    const statusIcon = document.getElementById('status-icon');
    if (statusIcon) {
        statusIcon.style.opacity = (enabled && !actualPaused) ? "1" : "0.5";
        statusIcon.style.filter = (enabled && !actualPaused) ? "none" : "grayscale(1)";
    }
}

volumeSlider.addEventListener('input', () => {
    chrome.storage.local.set({ volume: parseInt(volumeSlider.value) });
});

trackSelect.addEventListener('change', () => {
    chrome.storage.local.set({ track: trackSelect.value, enabled: true });
});

toggleBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('enabled');
    const currentlyEnabled = data.enabled !== false;
    chrome.storage.local.set({ enabled: !currentlyEnabled });
});

restartBtn.addEventListener('click', () => {
    chrome.storage.local.set({ enabled: true });
    chrome.runtime.sendMessage({ type: 'RESTART_TRACK' });

    restartBtn.style.backgroundColor = "#fff";
    setTimeout(() => restartBtn.style.backgroundColor = "", 150);
});

randomBtn.addEventListener('click', () => {
    chrome.storage.local.set({ enabled: true });
    chrome.runtime.sendMessage({ type: 'RANDOMIZE_TRACK' });

    randomBtn.style.backgroundColor = "#fff";
    setTimeout(() => randomBtn.style.backgroundColor = "", 150);
});

repeatBtn.addEventListener('click', () => {
    const newState = !repeatBtn.classList.contains('active');
    updateRepeatState(newState);
    chrome.storage.local.set({ repeat: newState });
});

// Sync UI when storage updates externally
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.track) {
            trackSelect.value = changes.track.newValue;
        }
        if (changes.repeat) {
            updateRepeatState(changes.repeat.newValue);
        }
    }
});
