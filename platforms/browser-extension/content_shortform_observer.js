/**
 * ScreenSync Short-Form Web Observer Content Script
 * Runs on YouTube, Instagram, TikTok, Facebook, Messenger, and Snapchat web pages.
 * Detects URL path transitions (/shorts/, /reels/, /stories/, /@.../video/) and scroll events,
 * and sends privacy-safe short-form signals to the background service worker.
 */
(function () {
  let lastReportedPath = "";
  let scrollSeq = 0;

  function detectPlatformFromHost(host) {
    const h = String(host || "").toLowerCase();
    if (h.includes("youtube.com")) return "youtube";
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("tiktok.com")) return "tiktok";
    if (h.includes("facebook.com")) return "facebook";
    if (h.includes("messenger.com")) return "messenger";
    if (h.includes("snapchat.com")) return "snapchat";
    return null;
  }

  function emitShortFormSignal(eventType) {
    const appKey = detectPlatformFromHost(location.hostname);
    if (!appKey) return;
    const path = String(location.pathname || "").toLowerCase();
    const isShortFormPath =
      path.startsWith("/shorts/") ||
      path.startsWith("/reels/") ||
      path.startsWith("/reel/") ||
      path.startsWith("/stories/") ||
      path.startsWith("/spotlight") ||
      (appKey === "tiktok" && (path.includes("/video/") || path === "/" || path.startsWith("/foryou") || path.startsWith("/@")));

    if (!isShortFormPath && eventType === "TYPE_VIEW_SCROLLED") return;
    if (path !== lastReportedPath) {
      scrollSeq += 1;
      lastReportedPath = path;
    }

    const contentType = path.startsWith("/stories/") ? "STORY"
      : appKey === "youtube" ? "SHORT"
      : appKey === "tiktok" ? "TIKTOK"
      : appKey === "snapchat" ? "SPOTLIGHT"
      : "REEL";

    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function") {
      try {
        chrome.runtime.sendMessage({
          type: "SHORT_FORM_DOM_SIGNAL",
          detail: {
            appKey,
            eventType,
            isShortFormSurface: isShortFormPath,
            contentType,
            rowIndex: scrollSeq,
            explicitSignature: `${appKey}|${contentType}|${path}`,
            timestampMs: Date.now()
          }
        });
      } catch (e) {}
    }
  }

  window.addEventListener("wheel", () => emitShortFormSignal("TYPE_VIEW_SCROLLED"), { passive: true });
  window.addEventListener("popstate", () => emitShortFormSignal("TYPE_WINDOW_CONTENT_CHANGED"));
  setInterval(() => emitShortFormSignal("TYPE_WINDOW_CONTENT_CHANGED"), 1500);
})();
