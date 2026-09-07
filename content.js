// Notify background that a valid Amazon page is loaded
chrome.runtime.sendMessage({ type: 'AMAZON_VISITED' }, (response) => {
    if (response && response.trackName) {
        const hasShownToast = sessionStorage.getItem('smt4_toast_shown');
        if (!hasShownToast) {
            showSamuraiToast(response.trackName);
            sessionStorage.setItem('smt4_toast_shown', 'true');
        }
    }
});

const userInteracted = () => {
    chrome.runtime.sendMessage({ type: 'USER_INTERACTED' });
};
document.addEventListener('click', userInteracted, { once: true });
document.addEventListener('keydown', userInteracted, { once: true });

// Keep-alive connection for Firefox background script
let port = null;

function connectKeepAlive() {
  port = chrome.runtime.connect({ name: 'keep-alive' });
  port.onDisconnect.addListener(() => {
    console.log("Keep-alive port disconnected. Attempting to reconnect...");
    setTimeout(connectKeepAlive, 5000); // Reconnect after 5 seconds
  });
}

connectKeepAlive();

// Periodic ping to keep background alive in Firefox MV3
setInterval(() => {
  if (port) {
    try {
      port.postMessage({ type: 'ping' });
    } catch (e) {
      // Port might be closed, handled by onDisconnect
    }
  }
}, 15000);


// Create a stylish toast notification
function showSamuraiToast(trackName) {
  const toast = document.createElement('div');
  toast.id = 'smt4-toast';
  const header = document.createElement('div');
  header.className = 'toast-header';
  header.textContent = 'Amazon SMT Music Companion';

  const body = document.createElement('div');
  body.className = 'toast-body';
  body.textContent = trackName ? `Now Playing: ${trackName}` : "";

  toast.appendChild(header);
  toast.appendChild(body);
  document.body.appendChild(toast);

  // Remove after 5 seconds
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 1000);
  }, 4000);
}
