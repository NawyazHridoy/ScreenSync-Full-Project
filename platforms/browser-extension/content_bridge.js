/**
 * ScreenSync Content Bridge Script
 * Relays messages from the extension background service worker into the ScreenSync web page
 * via window.postMessage so ScreenSyncApp.ingestExtensionMessage can process them across origins.
 */
(function () {
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.source === "SCREENSYNC_EXTENSION") {
        window.postMessage(msg, "*");
      }
    });
  }

  // Drain any queued events on load
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
    try {
      chrome.runtime.sendMessage({ type: "DRAIN_PENDING_EVENTS" }, (resp) => {
        if (resp && Array.isArray(resp.events)) {
          resp.events.forEach((ev) => window.postMessage(ev, "*"));
        }
      });
    } catch (e) {}
  }
})();
