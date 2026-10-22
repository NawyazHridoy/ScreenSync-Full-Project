/**
 * ScreenSync Browser Extension Background Service Worker (Manifest V3)
 * 1. Polls active tab every 7 seconds with chrome.idle (300s threshold).
 * 2. Receives short-form scroll/dwell events from content_shortform_observer.js.
 * 3. Forwards sanitized tab and short-form events to open ScreenSync tabs via chrome.tabs.sendMessage
 *    (bridged into window.postMessage by content_bridge.js) without persisting full URLs.
 */
const POLL_INTERVAL_MS = 7000;
const IDLE_THRESHOLD_SECONDS = 300;
const pendingEvents = [];

function forwardToScreenSyncTabs(messageObj) {
  pendingEvents.push(messageObj);
  while (pendingEvents.length > 100) pendingEvents.shift();

  if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.query === "function") {
    chrome.tabs.query({}, (tabs) => {
      (tabs || []).forEach((t) => {
        if (!t || !t.id) return;
        const title = String(t.title || "");
        const url = String(t.url || "");
        if (title.includes("ScreenSync") || url.includes("localhost") || url.includes("127.0.0.1") || url.includes("screensync")) {
          try {
            chrome.tabs.sendMessage(t.id, messageObj, () => {
              void chrome.runtime.lastError;
            });
          } catch (e) {}
        }
      });
    });
  }
}

function inspectActiveTab() {
  if (typeof chrome === "undefined" || !chrome.tabs || !chrome.idle) return;
  chrome.idle.queryState(IDLE_THRESHOLD_SECONDS, (idleState) => {
    const isIdle = idleState === "idle" || idleState === "locked";
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url) return;
      const payload = {
        rawAddressBarText: tab.url,
        windowTitle: tab.title || "",
        isAudioPlaying: Boolean(tab.audible),
        isIdle,
        idleSeconds: isIdle ? IDLE_THRESHOLD_SECONDS + 10 : 0,
        timestampMs: Date.now()
      };
      forwardToScreenSyncTabs({
        source: "SCREENSYNC_EXTENSION",
        type: "EXTENSION_TAB_SAMPLE",
        detail: payload,
        ts: Date.now()
      });
    });
  });
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "SHORT_FORM_DOM_SIGNAL") {
      forwardToScreenSyncTabs({
        source: "SCREENSYNC_EXTENSION",
        type: "EXTENSION_SHORT_FORM_SIGNAL",
        detail: msg.detail,
        ts: Date.now()
      });
      sendResponse({ ok: true });
    } else if (msg.type === "DRAIN_PENDING_EVENTS") {
      const batch = pendingEvents.splice(0, pendingEvents.length);
      sendResponse({ ok: true, events: batch });
    }
    return true;
  });
}

setInterval(inspectActiveTab, POLL_INTERVAL_MS);
