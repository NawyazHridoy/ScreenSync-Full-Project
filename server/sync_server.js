/**
 * ScreenSync Cross-Device Cloud/LAN Synchronization Server (Zero External Dependencies)
 * Enables genuine network synchronization of usage sessions, reel events, installations,
 * and goals across multiple physical devices (Android, iOS, Windows, macOS, ChromeOS).
 *
 * Run: node server/sync_server.js
 * Default endpoint: http://0.0.0.0:3001/api/sync
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.SCREENSYNC_SYNC_PORT || 3001);
const STORE_PATH = path.join(__dirname, "cloud_sync_store.json");

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    }
  } catch (e) {}
  return {
    syncVersion: 1,
    installationsByUser: {},
    sessionsByUser: {},
    reelEventsByUser: {},
    settingsByUser: {},
    dedupLog: {}
  };
}

function saveStore(store) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {}
}

const store = loadStore();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/sync")) {
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const userId = urlObj.searchParams.get("userId") || "usr_rahim_01";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      syncVersion: store.syncVersion,
      userId,
      installations: store.installationsByUser[userId] || [],
      sessions: store.sessionsByUser[userId] || [],
      reelEvents: store.reelEventsByUser[userId] || [],
      settings: store.settingsByUser[userId] || null
    }));
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/sync")) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        const uid = payload.userId;
        if (!uid) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Missing userId" }));
          return;
        }
        if (!store.installationsByUser[uid]) store.installationsByUser[uid] = [];
        if (!store.sessionsByUser[uid]) store.sessionsByUser[uid] = [];
        if (!store.reelEventsByUser[uid]) store.reelEventsByUser[uid] = [];

        let addedSessions = 0;
        let addedReels = 0;

        (Array.isArray(payload.installations) ? payload.installations : []).forEach((inst) => {
          if (!inst || !inst.installationId) return;
          const idx = store.installationsByUser[uid].findIndex(i => i.installationId === inst.installationId);
          if (idx === -1) store.installationsByUser[uid].push(inst);
          else store.installationsByUser[uid][idx] = { ...store.installationsByUser[uid][idx], ...inst };
        });

        (Array.isArray(payload.sessions) ? payload.sessions : []).forEach((s) => {
          if (!s || !s.sessionId) return;
          const key = `${uid}::${s.installationKey || s.installationId || "dev"}::${s.sessionId}`;
          if (!store.dedupLog[key]) {
            store.dedupLog[key] = true;
            store.sessionsByUser[uid].push(s);
            addedSessions += 1;
          }
        });

        (Array.isArray(payload.reelEvents) ? payload.reelEvents : []).forEach((r) => {
          if (!r || !r.eventId) return;
          const key = `${uid}::${r.installationKey || r.installationId || "dev"}::${r.eventId}`;
          if (!store.dedupLog[key]) {
            store.dedupLog[key] = true;
            store.reelEventsByUser[uid].push(r);
            addedReels += 1;
          }
        });

        if (payload.settings && typeof payload.settings === "object") {
          store.settingsByUser[uid] = payload.settings;
        }

        if (addedSessions > 0 || addedReels > 0) {
          store.syncVersion += 1;
          saveStore(store);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          syncVersion: store.syncVersion,
          addedSessions,
          addedReels,
          installations: store.installationsByUser[uid],
          sessions: store.sessionsByUser[uid],
          reelEvents: store.reelEventsByUser[uid]
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[ScreenSync Sync Server] Listening on http://127.0.0.1:${PORT}/api/sync`);
  });
}

module.exports = { server, store };
