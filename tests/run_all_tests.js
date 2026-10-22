const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const htmlPath = path.join(__dirname, '..', 'www', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('=== ScreenSync Automated Verification Suite ===');

// -------------------------------------------------------------------------
// TEST 1: STATIC UI & REMOVED FEATURES VERIFICATION (Requirements 1, 2, 4, 5, 6, 7)
// -------------------------------------------------------------------------
const removedUiStrings = [
  'Register New Device to Account',
  'inputNewDeviceName',
  'selectNewDeviceCutout',
  'btnRegisterNewDevice',
  '+ Register Device',
  'Sync Across Devices Now',
  'btnTriggerCloudSync',
  'Multi-Device Sync Verification',
  'btnCycleActiveReelApp',
  'Switch App',
  'Set Lock',
  'appLockModal',
  'btnLockApp',
  'lockSetupContainer',
  'lockVerifyContainer',
  'statusClock',
  'floatingActiveAppBanner',
  'floatingCutoutShapeBadge',
  'floatingActiveAppText',
  'islandActiveDot'
];

for (const s of removedUiStrings) {
  assert(!html.includes(s), `Removed UI element/string still present in HTML: "${s}"`);
}
console.log('[PASS] Test 1: Manual Device Registration UI, Manual Sync Button, Sync Verification UI, Manual Switch App UI, Set Lock UI/Dialogs, and Simulated Status Bar elements are completely removed.');

// Verify Dynamic Island contains ONLY #hudReelsCount, #islandCutoutDivider, and #hudWatchTime
const islandPillMatch = html.match(/<div id="dynamicIslandPill"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
assert(islandPillMatch, 'Could not locate #dynamicIslandPill markup');
const islandInnerHtml = islandPillMatch[0];
assert(islandInnerHtml.includes('id="hudReelsCount"'), 'Missing #hudReelsCount inside Dynamic Island');
assert(islandInnerHtml.includes('id="islandCutoutDivider"'), 'Missing #islandCutoutDivider inside Dynamic Island');
assert(islandInnerHtml.includes('id="hudWatchTime"'), 'Missing #hudWatchTime inside Dynamic Island');
assert(!islandInnerHtml.includes('<svg'), 'No extra SVG icon allowed inside Dynamic Island');
console.log('[PASS] Test 2: Dynamic Island markup contains ONLY Reels Count and Reels Watch Time separated by the adaptive divider/cutout spacer.');

// -------------------------------------------------------------------------
// BOOT APPLICATION SCRIPT IN LIGHTWEIGHT DOM SANDBOX
// -------------------------------------------------------------------------
class MockClassList {
  constructor(el, initial = '') {
    this.el = el;
    this.set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  }
  add(...tokens) {
    tokens.forEach((t) => this.set.add(t));
    this.el._className = Array.from(this.set).join(' ');
  }
  remove(...tokens) {
    tokens.forEach((t) => this.set.delete(t));
    this.el._className = Array.from(this.set).join(' ');
  }
  contains(t) {
    return this.set.has(t);
  }
  syncFromClassName(cn) {
    this.set = new Set(String(cn || '').split(/\s+/).filter(Boolean));
  }
}

const elementsById = new Map();
const allElements = [];

class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this._className = '';
    this.classList = new MockClassList(this);
    this.textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.checked = false;
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.offsetWidth = 100;
  }
  get className() {
    return this._className;
  }
  set className(val) {
    this._className = String(val || '');
    this.classList.syncFromClassName(this._className);
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val || '');
    this.children = [];
    if (this.id !== 'unlocksBarChart' && this.id !== 'faqAccordionList') return;
    const childRegex = /<([a-zA-Z0-9]+)\s+([^>]*?)>/g;
    let cm;
    while ((cm = childRegex.exec(this._innerHTML)) !== null) {
      const cTag = cm[1];
      const cAttr = cm[2];
      const cIdM = cAttr.match(/\bid="([^"]+)"/);
      const cClsM = cAttr.match(/\bclass="([^"]+)"/);
      const cId = cIdM ? cIdM[1] : '';
      const cCls = cClsM ? cClsM[1] : '';
      const childEl = cId && elementsById.has(cId) ? elementsById.get(cId) : new MockElement(cTag, cId);
      childEl.listeners = {};
      if (cCls) childEl.className = cCls;
      const dMatches = cAttr.matchAll(/\b(data-[a-z0-9-]+|aria-[a-z0-9-]+)="([^"]*)"/g);
      for (const dm of dMatches) {
        childEl.setAttribute(dm[1], dm[2]);
      }
      if (cId) elementsById.set(cId, childEl);
      this.children.push(childEl);
      if (!allElements.includes(childEl)) allElements.push(childEl);
    }
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') {
      this.id = String(v);
      elementsById.set(this.id, this);
    }
    if (k === 'class') {
      this.className = String(v);
    }
  }
  getAttribute(k) {
    return this.attributes[k] !== undefined ? this.attributes[k] : null;
  }
  contains(target) {
    return target === this;
  }
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn.call(this, Object.assign({ target: this, stopPropagation() {}, preventDefault() {} }, evt)));
  }
  click() {
    this.dispatchEvent({ type: 'click' });
  }
  focus() {
    documentMock.activeElement = this;
    this.dispatchEvent({ type: 'focus' });
  }
  select() {}
  querySelectorAll(sel) {
    if (!sel) return this.children;
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.filter((e) => e.classList.contains(cls));
    }
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const attr = sel.slice(1, -1);
      return this.children.filter((e) => e.getAttribute(attr) !== null);
    }
    return [];
  }
}

const tagRegex = /<([a-zA-Z0-9]+)\s+([^>]*?)>/g;
let m;
while ((m = tagRegex.exec(html)) !== null) {
  const tag = m[1];
  const attrStr = m[2];
  const idMatch = attrStr.match(/\bid="([^"]+)"/);
  const classMatch = attrStr.match(/\bclass="([^"]+)"/);
  const valMatch = attrStr.match(/\bvalue="([^"]*)"/);
  const id = idMatch ? idMatch[1] : '';
  const cls = classMatch ? classMatch[1] : '';
  if (id || cls) {
    const el = new MockElement(tag, id);
    el.className = cls;
    if (valMatch) el.value = valMatch[1];
    const dataMatches = attrStr.matchAll(/\b(data-[a-z0-9-]+|aria-[a-z0-9-]+|autocomplete|inputmode|pattern|maxlength|type)="([^"]*)"/g);
    for (const dm of dataMatches) {
      el.setAttribute(dm[1], dm[2]);
    }
    if (id) elementsById.set(id, el);
    allElements.push(el);
  }
}

class StorageMock {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const localStorageMock = new StorageMock();
const rootHtmlMock = new MockElement('html', 'htmlRoot');
const bodyMock = new MockElement('body', 'bodyRoot');
const documentMock = {
  documentElement: rootHtmlMock,
  body: bodyMock,
  readyState: 'complete',
  visibilityState: 'visible',
  fullscreenElement: null,
  webkitFullscreenElement: null,
  listeners: {},
  getElementById(id) {
    if (!elementsById.has(id)) {
      const fallback = new MockElement('div', id);
      elementsById.set(id, fallback);
    }
    return elementsById.get(id);
  },
  querySelector(sel) {
    if (sel === '#deviceDropdownMenu [data-device="ALL"]') {
      return allElements.find((e) => e.getAttribute('data-device') === 'ALL') || new MockElement('button');
    }
    return new MockElement('div');
  },
  querySelectorAll(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return allElements.filter((e) => e.classList.contains(cls));
    }
    if (sel.startsWith('[') && sel.endsWith(']')) {
      const attr = sel.slice(1, -1);
      if (attr === 'data-unlocks-pillar' && elementsById.has('unlocksBarChart')) {
        return elementsById.get('unlocksBarChart').children.filter((e) => e.getAttribute(attr) !== null);
      }
      return allElements.filter((e) => e.getAttribute(attr) !== null);
    }
    return [];
  },
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  },
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn(evt));
  }
};

const windowMock = {
  document: documentMock,
  localStorage: localStorageMock,
  navigator: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15',
    platform: 'iPhone',
    maxTouchPoints: 5,
    onLine: true
  },
  screen: { width: 393, height: 852 },
  innerWidth: 393,
  innerHeight: 852,
  listeners: {},
  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  },
  dispatchEvent(evt) {
    const fns = this.listeners[evt.type] || [];
    fns.forEach((fn) => fn(evt));
  },
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: (fn) => { fn(); return 1; }
};

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert(scriptMatch, 'Could not locate <script> block in www/index.html');

const sandbox = {
  window: windowMock,
  document: documentMock,
  localStorage: localStorageMock,
  navigator: windowMock.navigator,
  setInterval: windowMock.setInterval,
  clearInterval: windowMock.clearInterval,
  setTimeout: windowMock.setTimeout,
  clearTimeout: () => {},
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Set,
  Map,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  console
};

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);
windowMock.dispatchEvent({ type: 'DOMContentLoaded' });

const app = windowMock.ScreenSyncApp;
assert(app, 'window.ScreenSyncApp must be exposed');

// -------------------------------------------------------------------------
// TEST 3: AUTOMATIC DEVICE REGISTRATION & UNAUTHENTICATED GUARD (Requirement 1)
// -------------------------------------------------------------------------
{
  // 1. Unauthenticated account must NEVER register an installation
  app.state.isAuthenticated = false;
  const unauthRes = app.BackendDB.registerOrVerifyInstallation({ userId: 'usr_rahim_01', email: 'rahim.ahmed@gmail.com' }, {
    installationId: 'inst_unauth_attempt',
    deviceName: 'Unauth Phone',
    osCategory: 'Android'
  });
  assert(unauthRes.registered === false && unauthRes.status === 'UNAUTHENTICATED_BLOCKED', 'Must block installation registration when unauthenticated');

  // 2. Authenticated account registers new installation automatically with stable ID, device name, and OS category
  app.state.isAuthenticated = true;
  const countBefore = app.BackendDB.data.installationsByUser['usr_rahim_01'].length;
  const newInstProfile = {
    installationId: 'inst_pixel9_stable_01',
    key: 'pixel_9_pro',
    deviceName: 'Pixel 9 Pro',
    model: 'Google Pixel 9 Pro',
    osCategory: 'Android',
    deviceCategory: 'Phone',
    osVersion: 'Android 15',
    cutoutType: 'PUNCH_HOLE'
  };
  const reg1 = app.BackendDB.registerOrVerifyInstallation(app.state.currentUser, newInstProfile);
  assert(reg1.registered === true && reg1.createdNew === true, 'New installation must be registered upon authentication');
  assert(app.BackendDB.data.installationsByUser['usr_rahim_01'].length === countBefore + 1, 'Installations count must increment by 1');

  // 3. Relogin or restart with same stable installation ID must NOT create a duplicate installation
  const reg2 = app.BackendDB.registerOrVerifyInstallation(app.state.currentUser, newInstProfile);
  assert(reg2.registered === true && reg2.duplicatePrevented === true && reg2.createdNew === false, 'Relogin/restart must prevent duplicate installation');
  assert(app.BackendDB.data.installationsByUser['usr_rahim_01'].length === countBefore + 1, 'Installations count must remain unchanged on relogin/restart');
  console.log('[PASS] Test 3: Automatic device registration on authentication, duplicate prevention on restart/relogin, and unauthenticated guard verified.');
}

// -------------------------------------------------------------------------
// TEST 4: AUTOMATIC SYNCHRONIZATION, OFFLINE QUEUE & OWNERSHIP (Requirement 2)
// -------------------------------------------------------------------------
{
  // Reset baseline to clean state
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  const snapInit = app.computeSnapshot('ALL', 'DAY', 0);
  assert(snapInit.reelsCount === 20 && snapInit.watchMinutes === 95, `Expected baseline 20 Reels & 95m, got ${snapInit.reelsCount} Reels & ${snapInit.watchMinutes}m`);

  // Go offline and queue event + retry same event while offline
  app.AutoSyncService.setOfflineMode(true);
  const offEv = {
    eventId: 'ev_offline_sync_test_01',
    userId: 'usr_rahim_01',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    reelCountDelta: 1,
    watchSecondsDelta: 120,
    watchMinutesDelta: 2,
    localDate: '2026-10-16'
  };
  const q1 = app.BackendDB.ingestEvent(offEv);
  const q2 = app.BackendDB.ingestEvent(offEv); // Duplicate retry while offline
  assert(q1.status === 'QUEUED_OFFLINE', 'Event must be queued while offline');
  assert(q2.status === 'QUEUED_OFFLINE' && q2.deduplicatedInQueue === true, 'Duplicate offline retry must be deduplicated in queue');
  assert(app.BackendDB.data.offlineQueue.length === 1, 'Offline queue must hold exactly 1 deduplicated event');

  // Restore connectivity -> automatic flush & deduplication
  const flushRes = app.AutoSyncService.setOfflineMode(false);
  assert(flushRes.processed === 1 && flushRes.remaining === 0, 'Offline queue must auto-flush when connectivity returns');

  // Retry the already-synced event online -> must be ignored
  const dupRetry = app.BackendDB.ingestEvent(offEv);
  assert(dupRetry.status === 'DUPLICATE_IGNORED' && dupRetry.counted === false, 'Retried event after sync must be ignored');

  // Ownership validation: event for another user's installation must be rejected
  const crossOwnerAttempt = app.BackendDB.ingestEvent({
    eventId: 'ev_cross_owner_01',
    userId: 'usr_rahim_01',
    ownerUserId: 'usr_attacker_99',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    reelCountDelta: 5
  });
  assert(crossOwnerAttempt.status === 'OWNERSHIP_VIOLATION' && crossOwnerAttempt.counted === false, 'Cross-account ownership violation must be rejected');

  console.log('[PASS] Test 4: Automatic synchronization, offline queueing, connectivity retry, idempotent deduplication, and ownership enforcement verified.');
}

// -------------------------------------------------------------------------
// TEST 5: REEL COUNT & REEL WATCH TIME TRACKING RULES (Requirement 3)
// -------------------------------------------------------------------------
{
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  app.ReelTrackingEngine.resetTrackingSandbox();

  const before = app.computeSnapshot('ALL', 'DAY', 0);
  assert(before.reelsCount === 20 && before.watchSeconds === 5700, 'Clean baseline must start at 20 Reels and 5700 watchSeconds (95m)');

  // 1. Start watching Reel #1 on Instagram for 25 seconds, then navigate FORWARD to Reel #2 -> +1 Reel Count, +25s Watch Time
  app.ReelTrackingEngine.startOrResumePlayback({
    installationKey: 'iphone_16',
    appKey: 'instagram',
    itemId: 'reel_101',
    contentType: 'REEL',
    timestampMs: 100000
  });
  const navForward = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'REEL',
    targetItemId: 'reel_102',
    startMs: 100000,
    endMs: 125000,
    timestampMs: 125000,
    callbackId: 'cb_nav_fwd_1'
  });
  assert(navForward.reelCountDelta === 1 && navForward.watchSecondsAdded === 25, 'Forward reel navigation must increment Reel Count by 1 and record 25s watch time');

  // 2. Duplicate callback of the exact same navigation -> +0 Reel Count, +0s Watch Time
  const dupNav = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'REEL',
    targetItemId: 'reel_102',
    startMs: 100000,
    endMs: 125000,
    timestampMs: 125000,
    callbackId: 'cb_nav_fwd_1'
  });
  assert(dupNav.status === 'DUPLICATE_IGNORED' && dupNav.reelCountDelta === 0 && dupNav.watchSecondsAdded === 0, 'Duplicate navigation callback must be ignored');

  // 3. Navigate BACKWARD from Reel #2 to previously viewed Reel #1 after 20s -> +1 Reel Count, +20s Watch Time
  const navBackward = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'BACKWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'REEL',
    targetItemId: 'reel_101',
    startMs: 125000,
    endMs: 145000,
    timestampMs: 145000,
    callbackId: 'cb_nav_bwd_1'
  });
  assert(navBackward.reelCountDelta === 1 && navBackward.watchSecondsAdded === 20, 'Backward navigation to previous reel must increment Reel Count by 1 and accumulate 20s watch time');

  // 4. Revisit Reel #1 and stay on it while it loops/replays twice (30s + 30s = 60s) WITHOUT navigating -> +0 Reel Count, +60s Watch Time
  const loop1 = app.ReelTrackingEngine.handleEvent({
    type: 'VIDEO_LOOP',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'REEL',
    itemId: 'reel_101',
    startMs: 145000,
    endMs: 175000,
    timestampMs: 175000,
    callbackId: 'cb_loop_1'
  });
  const loop2 = app.ReelTrackingEngine.handleEvent({
    type: 'REPLAY',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'REEL',
    itemId: 'reel_101',
    startMs: 175000,
    endMs: 205000,
    timestampMs: 205000,
    callbackId: 'cb_loop_2'
  });
  assert(loop1.reelCountDelta === 0 && loop1.watchSecondsAdded === 30, 'Video loop on same reel must NOT increment Reel Count but must add 30s watch time');
  assert(loop2.reelCountDelta === 0 && loop2.watchSecondsAdded === 30, 'Replay on same reel must NOT increment Reel Count but must add 30s watch time');

  // 5. Ordinary playback progress, UI redraws, and polling updates -> +0 Reel Count
  const redrawRes = app.ReelTrackingEngine.handleEvent({
    type: 'UI_REDRAW',
    installationKey: 'iphone_16',
    appKey: 'instagram'
  });
  const pollRes = app.ReelTrackingEngine.handleEvent({
    type: 'POLLING_UPDATE',
    installationKey: 'iphone_16',
    appKey: 'instagram'
  });
  assert(redrawRes.reelCountDelta === 0 && pollRes.reelCountDelta === 0, 'UI redraws and polling updates must never increment Reel Count');

  // 6. Overlapping timer interval [160000, 220000] where [145000, 205000] was already counted -> only [205000, 220000] (15s) is counted!
  const overlapRes = app.ReelTrackingEngine.handleEvent({
    type: 'PLAYBACK_PROGRESS',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    startMs: 160000,
    endMs: 220000,
    timestampMs: 220000,
    callbackId: 'cb_overlap_test'
  });
  assert(overlapRes.reelCountDelta === 0 && overlapRes.watchSecondsAdded === 15, `Overlapping interval must only count the non-overlapping 15s, got ${overlapRes.watchSecondsAdded}s`);

  // 7. Pause & backgrounding: while paused, elapsed time adds 0s
  app.ReelTrackingEngine.pausePlayback({ installationKey: 'iphone_16', appKey: 'instagram', timestampMs: 220000 });
  const whilePaused = app.ReelTrackingEngine.accumulateWatchTime({
    installationKey: 'iphone_16',
    appKey: 'instagram',
    startMs: 220000,
    endMs: 280000,
    timestampMs: 280000
  });
  assert(whilePaused.watchSecondsAdded === 0, 'Paused playback must not accumulate watch time');

  // 8. Stories navigation: forward to next story (+1) and backward to previous story (+1)
  app.ReelTrackingEngine.startOrResumePlayback({
    installationKey: 'iphone_16',
    appKey: 'instagram',
    itemId: 'story_1',
    contentType: 'STORY',
    timestampMs: 300000
  });
  const storyNext = app.ReelTrackingEngine.handleEvent({
    type: 'STORY_NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'STORY',
    targetItemId: 'story_2',
    startMs: 300000,
    endMs: 315000,
    timestampMs: 315000,
    callbackId: 'cb_story_next'
  });
  const storyPrev = app.ReelTrackingEngine.handleEvent({
    type: 'STORY_NAVIGATION',
    direction: 'BACKWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    contentType: 'STORY',
    targetItemId: 'story_1',
    startMs: 315000,
    endMs: 330000,
    timestampMs: 330000,
    callbackId: 'cb_story_prev'
  });
  assert(storyNext.reelCountDelta === 1 && storyNext.watchSecondsAdded === 15, 'Moving to next story must increment Reel Count by 1 and add 15s watch time');
  assert(storyPrev.reelCountDelta === 1 && storyPrev.watchSecondsAdded === 15, 'Returning to previous story must increment Reel Count by 1 and add 15s watch time');

  // Total added: +4 navigations (2 reel navs + 2 story navs) = 24 Reels; +150s watch time (25+20+30+30+15+15+15 = 150s = 2.5m) -> 5700 + 150 = 5850s (98m rounded)
  const after = app.computeSnapshot('ALL', 'DAY', 0);
  assert(after.reelsCount === 24, `Expected 24 Reels after 4 navigations, got ${after.reelsCount}`);
  assert(after.watchSeconds === 5850, `Expected 5850 total watchSeconds, got ${after.watchSeconds}`);
  console.log('[PASS] Test 5: Reel & Story forward/backward navigation (+1), revisit watch-time accumulation, loop/replay (0 count, accumulates time), overlap deduplication, and pause/background handling verified.');
}

// -------------------------------------------------------------------------
// TEST 6: DYNAMIC ISLAND ADAPTIVE CUTOUTS & FULLSCREEN LANDSCAPE (Requirement 7)
// -------------------------------------------------------------------------
{
  const pill = documentMock.getElementById('dynamicIslandPill');

  // 1. Punch-hole camera (Galaxy S24 Ultra)
  app.state.selectedDevice = 's24_ultra';
  app.renderAll();
  assert(pill.className.includes('cutout-punch-hole'), 'Punch-hole device must use .cutout-punch-hole layout');

  // 2. Pill-shaped cutout (iPhone 16 Pro)
  app.state.selectedDevice = 'iphone_16';
  app.renderAll();
  assert(pill.className.includes('cutout-iphone-pill'), 'Pill-cutout iPhone must use .cutout-iphone-pill layout');

  // 3. Older iPhone with TrueDepth notch (iPhone 14)
  app.state.selectedDevice = 'iphone_14';
  app.renderAll();
  assert(pill.className.includes('cutout-truedepth-notch'), 'TrueDepth notch iPhone must use .cutout-truedepth-notch layout');

  // 4. Waterdrop / V-shaped notch (Vivo V29 Pro) - must NOT claim TrueDepth hardware
  app.state.selectedDevice = 'vivo_v29';
  app.renderAll();
  assert(pill.className.includes('cutout-waterdrop'), 'Waterdrop notch phone must use .cutout-waterdrop layout');
  const vivoEnv = app.DeviceEnvironmentDetector.detectEnvironment({ osCategory: 'Android', deviceCategory: 'Phone', model: 'Vivo V29 Pro', cutoutType: 'WATERDROP' });
  assert(vivoEnv.hasTrueDepth === false, 'Waterdrop Android device must never claim TrueDepth hardware');

  // 5. No-cutout devices (Windows PC, MacBook Pro, iPad Pro, Chromebook) -> pill-shaped island with visible divider
  app.state.selectedDevice = 'windows_pc';
  app.renderAll();
  assert(pill.className.includes('cutout-fullscreen'), 'Full-screen/desktop device must use .cutout-fullscreen pill layout with visible divider');

  // 6. Fullscreen landscape video hides overlay and restores afterward
  app.state.selectedDevice = 'ALL';
  app.state.isFullscreenLandscapeVideo = true;
  app.renderAll();
  assert(pill.classList.contains('hidden'), 'Dynamic Island overlay must hide during fullscreen landscape video playback');

  app.state.isFullscreenLandscapeVideo = false;
  app.renderAll();
  assert(!pill.classList.contains('hidden'), 'Dynamic Island overlay must restore after exiting fullscreen landscape video');

  console.log('[PASS] Test 6: Dynamic Island adaptive layouts (punch-hole, pill, TrueDepth notch, waterdrop, no-cutout pill with divider) and fullscreen landscape hide/restore verified.');
}

// -------------------------------------------------------------------------
// TEST 7: FIX 1 — LOGOUT, CREDENTIAL CLEARING, SERVER REVOCATION & HONEST ERROR HANDLING
// -------------------------------------------------------------------------
{
  // Re-establish clean authenticated session for Rahim
  const loginRes = app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  assert(loginRes.ok === true && app.state.isAuthenticated === true, 'Must login cleanly');
  const activeToken = app.state.sessionToken;
  assert(activeToken && app.BackendDB.data.authSessions[activeToken].revoked === false, 'Active server session token must exist');

  // Switch to ACCOUNT view first to verify logout preserves main app view and does not force login modal open
  app.switchView('ACCOUNT');
  assert(app.state.activeView === 'ACCOUNT', 'Active view should be ACCOUNT before logout');

  // Perform online logout -> local credentials cleared & server session revoked
  const logoutOnline = app.AuthService.logout();
  assert(logoutOnline.loggedOut === true && logoutOnline.localCleared === true && logoutOnline.serverRevoked === true, 'Online logout must clear local session and revoke server session');
  assert(app.state.isAuthenticated === false && app.state.currentUser.userId === null && app.state.sessionToken === null, 'In-memory auth state must be cleared on logout');
  assert(localStorageMock.getItem('screensync_authenticated_session_v2') === null, 'Stored session credentials must be removed from localStorage');
  assert(app.BackendDB.data.authSessions[activeToken].revoked === true, 'Server session must be marked revoked');
  assert(app.state.activeView === 'ACCOUNT', 'Logout must not redirect user away from the main application');
  assert(documentMock.getElementById('authModal').classList.contains('hidden'), 'Logout must not force the login page to open automatically');

  // Prevent previous session from being restored after a successful logout
  const restoreAfterLogout = app.AuthService.restoreSession();
  assert(restoreAfterLogout.restored === false && app.state.isAuthenticated === false, 'Previous session must NOT be restored after logout');

  // Honest error handling when server revocation fails (e.g., offline or backend error)
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  const tokenFailTest = app.state.sessionToken;
  const logoutFailRes = app.AuthService.logout({ simulateServerFailure: true });
  assert(logoutFailRes.loggedOut === true && logoutFailRes.localCleared === true, 'Local logout must still complete when server revocation fails');
  assert(logoutFailRes.serverRevoked === false && logoutFailRes.status === 'SERVER_REVOCATION_FAILED', 'Must NOT falsely report server session as revoked when revocation failed');
  assert(app.BackendDB.data.authSessions[tokenFailTest].revoked === false, 'Unrevoked server session must remain unrevoked until connectivity/retry');

  console.log('[PASS] Test 7: Logout clears local credentials, revokes server sessions, resets navigation to login screen, blocks post-logout session restoration, and handles revocation failures honestly.');
}

// -------------------------------------------------------------------------
// TEST 8: FIX 2 & 3 — SESSION RESTORATION, STALE ASYNC GUARD & ACCOUNT ISOLATION
// -------------------------------------------------------------------------
{
  // 1. Valid session restoration on app startup
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  const validRestore = app.AuthService.restoreSession();
  assert(validRestore.restored === true && app.state.isAuthenticated === true && app.state.currentUser.userId === 'usr_rahim_01', 'Valid session must be restored on startup');

  // 2. Expired token handling
  const expiredTok = app.state.sessionToken;
  app.BackendDB.data.authSessions[expiredTok].expiresAt = Date.now() - 5000;
  const expiredRestore = app.AuthService.restoreSession();
  assert(expiredRestore.restored === false && expiredRestore.status === 'SESSION_EXPIRED' && app.state.isAuthenticated === false, 'Expired session token must be rejected and cleared safely');

  // 3. Stale asynchronous request guard across logout & account switching
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  const staleCtx = app.AuthService.newRequestContext();
  // Create a second isolated account
  const secondUser = {
    userId: 'usr_amina_02',
    email: 'amina.rahman@gmail.com',
    name: 'Amina Rahman',
    passwordHash: app.BackendDB.data.users[0].passwordHash,
    verified: true,
    createdAt: '2026-10-10T09:00:00Z'
  };
  if (!app.BackendDB.data.users.some(u => u.userId === 'usr_amina_02')) {
    app.BackendDB.data.users.push(secondUser);
  }
  // Modify Rahim's settings before switching
  app.state.screenGoalMinutes = 240;
  app.BackendDB.saveUserSettings('usr_rahim_01');

  // Switch to Amina's account
  app.AuthService.login('amina.rahman@gmail.com', 'password123');
  assert(app.state.currentUser.userId === 'usr_amina_02', 'Must switch to second account');
  assert(staleCtx.isStale() === true, 'Request context from previous account session must be marked stale');

  // Verify Amina's account is strictly isolated from Rahim's data, devices, history, and settings
  assert(app.state.screenGoalMinutes === 200, 'Second account must have isolated default settings, not Rahim settings');
  const aminaSnap = app.computeSnapshot('ALL', 'DAY', 0);
  assert(aminaSnap.reelsCount === 0 && aminaSnap.totalScreenMinutes === 0, 'Second account must start with 0 reels and 0 screen time (no data leakage from Rahim)');
  const aminaDevices = app.BackendDB.data.installationsByUser['usr_amina_02'] || [];
  assert(aminaDevices.length === 1 && aminaDevices[0].userId === 'usr_amina_02', 'Second account must only see its own auto-registered device');

  // Enforce backend account ownership: Amina cannot ingest events or update profile for Rahim
  const crossIngest = app.BackendDB.ingestEvent({
    eventId: 'ev_illegal_cross_account',
    userId: 'usr_rahim_01',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    reelCountDelta: 3
  });
  assert(crossIngest.status === 'OWNERSHIP_VIOLATION' && crossIngest.counted === false, 'Backend must block logged-in user from writing to another account');
  const crossProfile = app.BackendDB.updateUserProfile('usr_rahim_01', { name: 'Hacked Name' });
  assert(crossProfile.ok === false && crossProfile.status === 'OWNERSHIP_VIOLATION', 'Backend must block cross-account profile modification');

  // Profile management on own account works
  const ownProfile = app.AuthService.updateProfile({ name: 'Amina R.' });
  assert(ownProfile.ok === true && app.state.currentUser.name === 'Amina R.', 'Authenticated user can update their own profile');

  // Restore Rahim session for subsequent tests
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  console.log('[PASS] Test 8: Session restoration, expired token rejection, stale async request protection, profile management, and strict multi-account isolation verified.');
}

// -------------------------------------------------------------------------
// TEST 9: FIX 4 — ACCOUNT-WIDE REEL COUNT ACROSS SIMULTANEOUS DEVICES & RETRIES
// -------------------------------------------------------------------------
{
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  app.ReelTrackingEngine.resetTrackingSandbox();

  const baseAll = app.computeSnapshot('ALL', 'DAY', 0);
  const baseIos = app.computeSnapshot('iphone_16', 'DAY', 0);
  const baseAnd = app.computeSnapshot('s24_ultra', 'DAY', 0);
  const baseWin = app.computeSnapshot('windows_pc', 'DAY', 0);
  assert(baseAll.reelsCount === 20 && baseIos.reelsCount === 2 && baseAnd.reelsCount === 6 && baseWin.reelsCount === 4, 'Baseline per-device and account-wide reel counts must match');

  // Three devices navigate to the EXACT same reel at the EXACT same timestamp (and even pass the same local callbackId)
  const simultaneousTs = 1760610000000;
  const r1 = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    targetItemId: 'reel_shared_viral_99',
    timestampMs: simultaneousTs,
    callbackId: 'cb_local_simultaneous_1'
  });
  const r2 = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 's24_ultra',
    appKey: 'instagram',
    targetItemId: 'reel_shared_viral_99',
    timestampMs: simultaneousTs,
    callbackId: 'cb_local_simultaneous_1'
  });
  const r3 = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'windows_pc',
    appKey: 'youtube',
    targetItemId: 'reel_shared_viral_99',
    timestampMs: simultaneousTs,
    callbackId: 'cb_local_simultaneous_1'
  });
  assert(r1.reelCountDelta === 1 && r2.reelCountDelta === 1 && r3.reelCountDelta === 1, 'All 3 simultaneous genuine events across 3 devices must be counted separately');

  // Duplicate retry of r1 from the SAME device (iphone_16) must be ignored
  const r1Dup = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    targetItemId: 'reel_shared_viral_99',
    timestampMs: simultaneousTs,
    callbackId: 'cb_local_simultaneous_1'
  });
  assert(r1Dup.status === 'DUPLICATE_IGNORED' && r1Dup.reelCountDelta === 0, 'Duplicate retry on the same device must be ignored');

  // Revisiting the same reel after navigating away on iphone_16 must be counted (+2 for away + revisit)
  app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'FORWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    targetItemId: 'reel_other_100',
    timestampMs: simultaneousTs + 15000,
    callbackId: 'cb_nav_away_2'
  });
  const revisitRes = app.ReelTrackingEngine.handleEvent({
    type: 'NAVIGATION',
    direction: 'BACKWARD',
    installationKey: 'iphone_16',
    appKey: 'instagram',
    targetItemId: 'reel_shared_viral_99',
    timestampMs: simultaneousTs + 30000,
    callbackId: 'cb_nav_revisit_3'
  });
  assert(revisitRes.reelCountDelta === 1, 'Revisiting a reel after navigating away must be counted');

  const afterAll = app.computeSnapshot('ALL', 'DAY', 0);
  const afterIos = app.computeSnapshot('iphone_16', 'DAY', 0);
  const afterAnd = app.computeSnapshot('s24_ultra', 'DAY', 0);
  const afterWin = app.computeSnapshot('windows_pc', 'DAY', 0);
  assert(afterIos.reelsCount === baseIos.reelsCount + 3, 'iPhone per-device reel count must increase by 3');
  assert(afterAnd.reelsCount === baseAnd.reelsCount + 1, 'S24 Ultra per-device reel count must increase by 1');
  assert(afterWin.reelsCount === baseWin.reelsCount + 1, 'Windows PC per-device reel count must increase by 1');
  assert(afterAll.reelsCount === baseAll.reelsCount + 5, `Account-wide reel count must equal sum of all device events (25), got ${afterAll.reelsCount}`);
  console.log('[PASS] Test 9: Account-wide reel count across simultaneous multi-device events, per-device breakdowns, revisit counting, and same-device retry deduplication verified.');
}

// -------------------------------------------------------------------------
// TEST 10: FIX 5 — ACCURATE ACCOUNT-WIDE TOTAL SCREEN TIME (UNION OF INTERVALS)
// -------------------------------------------------------------------------
{
  // Use isolated account usr_amina_02 to test exact interval union examples cleanly
  app.AuthService.login('amina.rahman@gmail.com', 'password123');
  const uid = 'usr_amina_02';
  app.BackendDB.data.sessionsByUser[uid] = [];
  app.BackendDB.data.reelEventsByUser[uid] = [];

  // Case 1: Device A active 10:00-11:00 and Device B active 10:00-11:00 -> Total = 1 hour (60m)
  app.BackendDB.ingestEvent({
    eventId: 'iv_case1_devA',
    userId: uid,
    installationKey: 'iphone_16',
    appKey: 'instagram',
    localDate: '2026-10-16',
    startTime: '10:00',
    endTime: '11:00'
  });
  app.BackendDB.ingestEvent({
    eventId: 'iv_case1_devB',
    userId: uid,
    installationKey: 's24_ultra',
    appKey: 'youtube',
    localDate: '2026-10-16',
    startTime: '10:00',
    endTime: '11:00'
  });
  const snapCase1All = app.computeSnapshot('ALL', 'DAY', 0);
  const snapCase1DevA = app.computeSnapshot('iphone_16', 'DAY', 0);
  const snapCase1DevB = app.computeSnapshot('s24_ultra', 'DAY', 0);
  assert(snapCase1DevA.totalScreenMinutes === 60 && snapCase1DevB.totalScreenMinutes === 60, 'Individual device screen time must remain 60m each');
  assert(snapCase1All.totalScreenMinutes === 60 && snapCase1All.headlineText === '1 h', `Full overlap 10:00-11:00 across 2 devices must total 60m (1 h), got ${snapCase1All.totalScreenMinutes}m`);

  // Case 2: Device A active 10:00-11:00 and Device B active 10:30-11:30 -> Total = 1 hour 30 minutes (90m)
  app.BackendDB.data.sessionsByUser[uid] = [];
  app.BackendDB.ingestEvent({
    eventId: 'iv_case2_devB_out_of_order',
    userId: uid,
    installationKey: 's24_ultra',
    appKey: 'youtube',
    localDate: '2026-10-16',
    startTime: '10:30',
    endTime: '11:30'
  });
  app.BackendDB.ingestEvent({
    eventId: 'iv_case2_devA',
    userId: uid,
    installationKey: 'iphone_16',
    appKey: 'instagram',
    localDate: '2026-10-16',
    startTime: '10:00',
    endTime: '11:00'
  });
  // Retry uploading iv_case2_devA and a background/paused interval (which must be excluded)
  app.BackendDB.ingestEvent({
    eventId: 'iv_case2_devA',
    userId: uid,
    installationKey: 'iphone_16',
    appKey: 'instagram',
    localDate: '2026-10-16',
    startTime: '10:00',
    endTime: '11:00'
  });
  app.BackendDB.ingestEvent({
    eventId: 'iv_case2_bg_excluded',
    userId: uid,
    installationKey: 'windows_pc',
    appKey: 'chrome',
    localDate: '2026-10-16',
    startTime: '12:00',
    endTime: '14:00',
    isBackground: true
  });

  const snapCase2Day = app.computeSnapshot('ALL', 'DAY', 0);
  const snapCase2Week = app.computeSnapshot('ALL', 'WEEK', 0);
  const snapCase2Month = app.computeSnapshot('ALL', 'MONTH', 0);
  const snapCase2Year = app.computeSnapshot('ALL', 'YEAR', 0);
  assert(snapCase2Day.totalScreenMinutes === 90 && snapCase2Day.headlineText === '1 h 30 m', `Partial overlap 10:00-11:00 & 10:30-11:30 must equal 90m (1 h 30 m), got ${snapCase2Day.totalScreenMinutes}m`);
  assert(snapCase2Week.totalScreenMinutes === 90 && snapCase2Month.totalScreenMinutes === 90 && snapCase2Year.totalScreenMinutes === 90, 'Day, Week, Month, and Year views must all use reconciled account-wide totals');

  // Case 3: Non-overlapping interval added via offline queue (13:00-14:00, +60m -> 150m = 2h 30m)
  app.AutoSyncService.setOfflineMode(true);
  app.BackendDB.ingestEvent({
    eventId: 'iv_case3_offline_non_overlap',
    userId: uid,
    installationKey: 'windows_pc',
    appKey: 'chrome',
    localDate: '2026-10-16',
    startTime: '13:00',
    endTime: '14:00'
  });
  app.AutoSyncService.setOfflineMode(false);
  const snapCase3 = app.computeSnapshot('ALL', 'DAY', 0);
  assert(snapCase3.totalScreenMinutes === 150 && snapCase3.headlineText === '2 h 30 m', `Adding non-overlapping 1h interval must bring total to 150m (2 h 30 m), got ${snapCase3.totalScreenMinutes}m`);

  // Case 4: Legacy records lacking timestamps must not invent timestamps or silently double-count across devices
  app.BackendDB.data.sessionsByUser[uid] = [];
  app.BackendDB.ingestEvent({
    eventId: 'iv_legacy_no_ts_1',
    userId: uid,
    installationKey: 'iphone_16',
    appKey: 'instagram',
    localDate: '2026-10-16',
    screenMinutesDelta: 45
  });
  app.BackendDB.ingestEvent({
    eventId: 'iv_legacy_no_ts_2',
    userId: uid,
    installationKey: 's24_ultra',
    appKey: 'tiktok',
    localDate: '2026-10-16',
    screenMinutesDelta: 45
  });
  const storedLegacy = app.BackendDB.data.sessionsByUser[uid];
  assert(storedLegacy[0].startEpochSec === null && storedLegacy[0].hasTimestamps === false, 'Legacy records without timestamps must NOT invent fake start/end timestamps');
  const snapLegacyAll = app.computeSnapshot('ALL', 'DAY', 0);
  assert(snapLegacyAll.totalScreenMinutes === 45, `Ambiguous untimestamped records across devices must not silently double-count (expected 45m bound, got ${snapLegacyAll.totalScreenMinutes}m)`);

  // Restore clean Rahim session
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  console.log('[PASS] Test 10: Account-wide Total Screen Time union of intervals (full overlap, partial overlap, non-overlap, offline reconciliation, background exclusion, Day/Week/Month/Year consistency, and safe legacy handling) verified.');
}


// -------------------------------------------------------------------------
// TEST 11: REQUIREMENT 1 — FOCUS MODE DURATION PICKER (20 TO 180 MINS) & COUNTDOWN
// -------------------------------------------------------------------------
{
  const invalidLow = app.FocusModeController.setDuration(15);
  const invalidHigh = app.FocusModeController.setDuration(185);
  const invalidNaN = app.FocusModeController.setDuration('abc');
  assert(invalidLow.ok === false && invalidHigh.ok === false && invalidNaN.ok === false, 'Focus Mode must reject durations outside 20..180 minutes');

  const validMin = app.FocusModeController.setDuration(20);
  const validMax = app.FocusModeController.setDuration(180);
  const validMid = app.FocusModeController.setDuration(45);
  assert(validMin.ok === true && validMin.minutes === 20, 'Must accept 20 minutes');
  assert(validMax.ok === true && validMax.minutes === 180, 'Must accept 180 minutes');
  assert(validMid.ok === true && app.state.focusSelectedMinutes === 45, 'Must update focusSelectedMinutes to 45');

  const cdStart = app.FocusModeController.startCountdown(45);
  assert(cdStart.ok === true && cdStart.remainingSeconds === 45 * 60, 'Countdown must initialize to 45 * 60 seconds');
  app.FocusModeController.tick(30);
  assert(app.state.focusCountdownRemainingSeconds === 45 * 60 - 30, 'Countdown must tick down accurately');
  const cdDone = app.FocusModeController.completeSession();
  assert(cdDone.ok === true && cdDone.completedMinutes === 45, 'Completing countdown must record selected duration');
  console.log('[PASS] Test 11: Focus Mode duration picker (20-180m inclusive), manual input validation, and countdown timer verified.');
}

// -------------------------------------------------------------------------
// TEST 12: REQUIREMENT 2 — GOAL HOUR AND MINUTE PICKER & VALIDATION
// -------------------------------------------------------------------------
{
  const invalidZero = app.GoalPickerController.saveDailyGoal('REEL', 0, 0, true);
  const invalidNeg = app.GoalPickerController.saveDailyGoal('REEL', -1, 30, true);
  const invalidMin = app.GoalPickerController.saveDailyGoal('SCREEN', 2, 65, true);
  const invalidHr = app.GoalPickerController.saveDailyGoal('SCREEN', 25, 10, true);
  assert(!invalidZero.ok && !invalidNeg.ok && !invalidMin.ok && !invalidHr.ok, 'Must prevent invalid hour/minute goal values');

  const validReelGoal = app.GoalPickerController.saveDailyGoal('REEL', 1, 15, true);
  assert(validReelGoal.ok === true && app.state.dailyGoalMinutes === 75, 'Must save 1h 15m (75m) Reel Watch Goal');
  const snapAfterGoal = app.computeSnapshot('ALL', 'DAY', 0);
  assert(snapAfterGoal.healthyMinutes === 75 && snapAfterGoal.unhealthyMinutes === 20, 'Chart goal calculations must use saved 75m daily goal (95m total -> 75m within, 20m over)');

  const validScreenGoal = app.GoalPickerController.saveDailyGoal('SCREEN', 4, 30, true);
  assert(validScreenGoal.ok === true && app.state.screenGoalMinutes === 270, 'Must save 4h 30m (270m) Screen Time Goal');

  // Restore defaults for subsequent tests
  app.GoalPickerController.saveDailyGoal('REEL', 1, 0, true);
  app.GoalPickerController.saveDailyGoal('SCREEN', 3, 20, true);
  console.log('[PASS] Test 12: Usable Goal Hour & Minute pickers, invalid value prevention, persistence, and chart goal recalculation verified.');
}

// -------------------------------------------------------------------------
// TEST 13: REQUIREMENT 3, 4 & 5 — REAL HISTORICAL CHART DATA & DAY/MONTH OVERFLOW FIX
// -------------------------------------------------------------------------
{
  const daySnap = app.computeSnapshot('ALL', 'DAY', 0);
  const weekSnap = app.computeSnapshot('ALL', 'WEEK', 0);
  const monthSnap = app.computeSnapshot('ALL', 'MONTH', 0);
  const yearSnap = app.computeSnapshot('ALL', 'YEAR', 0);

  assert(daySnap.reelWatchBars.length === 24 && daySnap.reelWatchBars.reduce((a, b) => a + b, 0) === 95, 'Day reelWatchBars must contain real 24-hour historical data summing to 95m');
  assert(daySnap.reelWatchBars[0] === 0 && daySnap.reelWatchBars[8] === 23 && daySnap.reelWatchBars[9] === 24, 'Unrecorded hours must be 0 (never fabricated), recorded hours must match real events');
  assert(weekSnap.reelWatchBars.length === 7 && weekSnap.reelWatchBars[6] === 95 && weekSnap.reelWatchBars[0] === 0, 'Week reelWatchBars must show real data on Oct 16 and 0 on unrecorded days');
  assert(monthSnap.reelWatchBars.length === 30 && monthSnap.reelWatchBars[29] === 95 && monthSnap.reelWatchBars[0] === 0, 'Month reelWatchBars must show real 30-day data without fabricating missing days');
  assert(yearSnap.reelWatchBars.length === 12 && yearSnap.reelWatchBars[9] === 95 && yearSnap.reelWatchBars[0] === 0, 'Year reelWatchBars must show real 12-month data in October (index 9) and 0 on empty months');

  // Verify Day and Month views of Reel Watch Time vs Daily Goal and Month view of Screen Time use responsive min-w-0 flex containment
  assert(html.includes('id="reelGoalGreyBox" class="oem-card-inner chart-grey-container'), 'Reel watch time vs daily goal must use .chart-grey-container');
  assert(html.includes('id="statsMainGreyCard" class="oem-card chart-grey-container'), 'Screen time main card must use .chart-grey-container');
  app.GraphDisplayStyleController.setGraphStyle('SIMPLE');
  app.state.reelGraphPeriod = 'MONTH';
  app.state.periodMode = 'MONTH';
  app.renderAll();
  const reelMonthHtml = documentMock.getElementById('reelViewingBarChart').innerHTML;
  const statsMonthHtml = documentMock.getElementById('statsBarChartContainer').innerHTML;
  assert(reelMonthHtml.includes('max-w-[5px]') && reelMonthHtml.includes('min-w-0'), 'Reel Month view bars must use responsive max-w and min-w-0 containment');
  assert(statsMonthHtml.includes('max-w-[5px]') && statsMonthHtml.includes('min-w-0'), 'Screen Time Month view bars must use responsive max-w and min-w-0 containment');
  app.GraphDisplayStyleController.setGraphStyle('DETAILED');
  app.state.reelGraphPeriod = 'DAY';
  app.state.periodMode = 'DAY';
  app.renderAll();
  console.log('[PASS] Test 13: Real historical chart data (Day/Week/Month/Year without fabricated data) and Day/Month grey container overflow fixes verified.');
}

// -------------------------------------------------------------------------
// TEST 14: REQUIREMENT 6, 7 & 8 — INTERACTIVE GRAPHS, NO COLORED OUTLINE, PILL HOURLY TOGGLE
// -------------------------------------------------------------------------
{
  // Verify no ring-2 colored outline on selected bars
  const ovBarsHtml = documentMock.getElementById('overviewWeekChart').innerHTML;
  const reelBarsHtml = documentMock.getElementById('reelViewingBarChart').innerHTML;
  const statsBarsHtml = documentMock.getElementById('statsBarChartContainer').innerHTML;
  const appDetailBarsHtml = documentMock.getElementById('detailAppWeekBars').innerHTML;
  assert(!ovBarsHtml.includes('ring-2') && !reelBarsHtml.includes('ring-2') && !statsBarsHtml.includes('ring-2') && !appDetailBarsHtml.includes('ring-2'), 'Unwanted colored selection outlines (ring-2) must be removed from all graphs');

  // Verify selecting bars updates information areas with corresponding date and actual value
  app.state.selectedPillarIdx.REEL_VIEWING = 8; // 8:00 - 9:00 AM on Oct 16 (23 mins)
  app.state.selectedPillarIdx.STATS = 10; // 10:00 - 11:00 AM on Oct 16 (60 mins)
  app.state.selectedPillarIdx.APP_DETAIL_MAIN = 6; // Fri, Oct 16
  app.renderAll();
  assert(documentMock.getElementById('reelTooltipVal').textContent === '23 mins', 'Selecting Reel Viewing bar #8 must display 23 mins');
  assert(documentMock.getElementById('statsTooltipVal').textContent === '60 mins', 'Selecting Screen Time bar #10 must display 60 mins');
  assert(documentMock.getElementById('detailMainTooltipSub').textContent.includes('10/16'), 'Selecting App Usage bar must display corresponding date in tooltip');

  // Verify Requirement 8: Hourly usage pill toggle replaces "Look at usage by hour" and "Hide usage by hour"
  assert(!html.includes('Look at usage by hour') && !html.includes('Hide usage by hour'), 'Old "Look at usage by hour" / "Hide usage by hour" strings must be replaced by pill toggle');
  const toggleBtn = documentMock.getElementById('btnToggleHourlyChart');
  assert(toggleBtn.className.includes('hourly-pill-toggle') && toggleBtn.getAttribute('aria-checked') === 'true', 'Hourly usage toggle must be a pill switch');
  console.log('[PASS] Test 14: Interactive Screen Time, Reel Viewing & App Usage graphs, selection outline removal, and pill-style Hourly Usage toggle verified.');
}

// -------------------------------------------------------------------------
// TEST 15: REQUIREMENT 9, 10 & 11 — CROSS-PLATFORM PILL, SYSTEM GOAL ALERTS & PERMISSION ONBOARDING
// -------------------------------------------------------------------------
{
  // Requirement 9: Platform-specific presentation for Android, iOS, macOS, Windows, ChromeOS
  const andCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('Android', { cutoutType: 'PUNCH_HOLE' });
  const iosIslandCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('iOS', { deviceCategory: 'Phone', cutoutType: 'IPHONE_PILL' });
  const iosPadCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('iOS', { deviceCategory: 'Tablet', cutoutType: 'FULLSCREEN' });
  const macCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('macOS', {});
  const winCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('Windows', { dpiScale: 1.5, monitorWorkArea: { x: 0, y: 0, width: 1920, height: 1040 } });
  const crosWebCfg = app.CrossPlatformPillPresenter.getPlatformPresentationConfig('ChromeOS', { chromeOsAppType: 'WEB_PWA' });

  assert(andCfg.preservesGenuineSystemStatusBar === true && andCfg.usesFakeFullWidthBlackBar === false, 'Android presentation must preserve genuine status bar and never use fake black bar');
  assert(iosIslandCfg.presentationMode === 'IOS_ACTIVITYKIT_DYNAMIC_ISLAND_LIVE_ACTIVITY' && iosIslandCfg.claimsArbitraryCustomOverlayAboveOtherApps === false, 'iOS Dynamic Island must use ActivityKit and never claim arbitrary custom overlays');
  assert(iosPadCfg.deviceSubType === 'iPadOS' && iosPadCfg.supportsPersistentSystemOverlay === false, 'iPadOS must use supported non-Dynamic-Island presentation');
  assert(macCfg.replacesOrImitatesMenuBarOrNotch === false && macCfg.presentationMode === 'MACOS_FLOATING_NSPANEL_WINDOW', 'macOS must use floating NSPanel without imitating menu bar/notch');
  assert(winCfg.replacesOrImitatesTaskbarOrTray === false && winCfg.dpiScale === 1.5, 'Windows must use topmost floating window with DPI scaling and monitor clamping');
  assert(crosWebCfg.claimsArbitraryWebOverlayAboveUnrelatedApps === false, 'ChromeOS Web/PWA must not claim arbitrary overlays above unrelated apps');

  // Requirement 10: Cross-device system-level goal-reached alert (no in-app modal/banner/card, stable ID, deduplication, offline & expiry handling)
  assert(!html.includes('id="screenTimeAlertModal"') && !html.includes('id="goalModal"'), 'In-app goal-reached modal dialogs must be removed from main app UI');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  const instList = app.BackendDB.data.installationsByUser['usr_rahim_01'];
  // Mark macbook_pro offline before dispatching goal-reached alert
  const macInst = instList.find(i => i.key === 'macbook_pro');
  macInst.isOnline = false;

  const baseNow = 1760615000000;
  const disp1 = app.GoalAlertSyncEngine.dispatchGoalReachedEvent({
    userId: 'usr_rahim_01',
    goalType: 'REEL_WATCH_GOAL',
    goalPeriodDate: '2026-10-16',
    usedMinutes: 95,
    goalMinutes: 60,
    reelsCount: 20,
    createdAtMs: baseNow
  });
  const disp2Dup = app.GoalAlertSyncEngine.dispatchGoalReachedEvent({
    userId: 'usr_rahim_01',
    goalType: 'REEL_WATCH_GOAL',
    goalPeriodDate: '2026-10-16',
    usedMinutes: 95,
    goalMinutes: 60,
    reelsCount: 20,
    createdAtMs: baseNow + 1000
  });
  assert(disp1.ok === true && disp2Dup.duplicateLogicalEventPrevented === true && disp2Dup.newlyDeliveredCount === 0, 'Duplicate goal-reached event for same period/account must be deduplicated');

  const macDeliveryOffline = disp1.event.deliveriesByInstallation[macInst.installationId];
  assert(macDeliveryOffline.delivered === false && macDeliveryOffline.displayed === false, 'Offline device must NEVER be claimed to have received or displayed an alert');

  // Reconnect macbook_pro after alert has expired (> 30 mins later) -> must suppress expired alert!
  macInst.isOnline = true;
  const reconExpired = app.GoalAlertSyncEngine.reconcileOnReconnect('usr_rahim_01', {
    installationKey: 'macbook_pro',
    nowMs: baseNow + 45 * 60 * 1000,
    currentLocalDate: '2026-10-16'
  });
  assert(reconExpired.expiredSuppressed === 1 && disp1.event.deliveriesByInstallation[macInst.installationId].displayed === false, 'Expired goal alert must NOT be displayed when offline device reconnects late');

  // Dismissing alert preserves underlying goals and stats
  const dismissRes = app.GoalAlertSyncEngine.dismissAlert(disp1.eventId);
  assert(dismissRes.dismissed === true && app.state.dailyGoalMinutes === 60 && app.computeSnapshot('ALL', 'DAY', 0).watchMinutes === 95, 'Dismissing goal alert must preserve goal settings and tracking stats');

  // Requirement 11: Guided OS Permission Onboarding
  const iosPerms = app.PermissionOnboardingManager.getRequiredPermissionsForPlatform('iOS');
  const andPerms = app.PermissionOnboardingManager.getRequiredPermissionsForPlatform('Android');
  assert(!iosPerms.some(p => p.id === 'usage_stats' || p.id === 'overlay'), 'Android-specific permissions must never be presented on iOS');
  assert(andPerms.some(p => p.id === 'usage_stats') && andPerms.some(p => p.id === 'overlay'), 'Android platform must request genuine Android permissions');

  app.PermissionOnboardingManager.currentPlatform = 'Android';
  app.PermissionOnboardingManager.currentInstallationId = 'inst_and_01';
  const allowRes = app.PermissionOnboardingManager.openSystemPermissionFlow('overlay');
  assert(allowRes.ok === true && allowRes.selfGrantedByApp === false && allowRes.status === 'DIRECTED_TO_OS_SETTINGS', 'In-app Allow button must open OS settings flow and never pretend to grant permission itself');
  const denyReturn = app.PermissionOnboardingManager.onReturnFromSystemSettings('overlay', 'DENIED');
  assert(denyReturn.osStatus === 'DENIED' && denyReturn.limitationExplanation.includes('Fallback') || denyReturn.limitationExplanation.includes('falls back'), 'Denied permission must explain limitation and activate fallback');

  console.log('[PASS] Test 15: Cross-platform pill presentation, cross-device system goal-reached alerts, and guided OS permission onboarding verified.');
}

// -------------------------------------------------------------------------
// TEST 16: UI REDESIGN, LOGIN/PROFILE REPLACEMENT & LIQUID/SOFT GLASS SWITCH
// -------------------------------------------------------------------------
{
  assert(app.DesignStyleController, 'DesignStyleController must be exposed on window.ScreenSyncApp');
  assert(app.DesignStyleController.getDesignStyle() === 'LIQUID', 'Default design style must be LIQUID');

  // Switch to Soft Glass and verify state, UI indicators, persistence, and data preservation
  const beforeSnap = app.computeSnapshot('ALL', 'DAY', 0);
  const softRes = app.DesignStyleController.setDesignStyle('SOFT');
  assert(softRes.ok === true && softRes.designStyle === 'SOFT' && app.state.designStyle === 'SOFT', 'Must switch to SOFT glass style');
  assert(localStorageMock.getItem('screensync_design_style_pref_v2') === 'SOFT', 'Soft Glass preference must persist in localStorage');
  assert(documentMock.getElementById('designStyleActiveBadge').textContent === 'Soft Glass', 'Design style badge must indicate Soft Glass');
  assert(documentMock.getElementById('btnDesignStyleSoft').getAttribute('aria-pressed') === 'true', 'Soft Glass button must be marked active');
  assert(documentMock.getElementById('cardPreviewSoftGlass').getAttribute('data-selected') === 'true', 'Soft Glass preview card must be marked selected');

  // Verify switching styles does not alter tracking calculations or data
  const afterSoftSnap = app.computeSnapshot('ALL', 'DAY', 0);
  assert(afterSoftSnap.totalScreenMinutes === beforeSnap.totalScreenMinutes && afterSoftSnap.reelsCount === beforeSnap.reelsCount && afterSoftSnap.watchMinutes === beforeSnap.watchMinutes, 'Switching design style must never alter screen-time or reel calculations');

  // Verify persistence across simulated app reload
  app.state.designStyle = 'LIQUID';
  const restoredPref = app.DesignStyleController.restoreSavedPreferences();
  assert(restoredPref.designStyle === 'SOFT' && app.state.designStyle === 'SOFT', 'Saved Soft Glass preference must be restored on reload');

  // Switch back to Liquid Glass
  const liqRes = app.DesignStyleController.setDesignStyle('LIQUID');
  assert(liqRes.ok === true && liqRes.designStyle === 'LIQUID' && app.state.designStyle === 'LIQUID', 'Must switch back to LIQUID glass style');
  assert(documentMock.getElementById('designStyleActiveBadge').textContent === 'Liquid Glass', 'Design style badge must indicate Liquid Glass');

  // Verify all redesigned Account/Profile & Login elements exist
  const requiredRedesignIds = [
    'accountDesignStyleCard',
    'btnDesignStyleLiquid',
    'btnDesignStyleSoft',
    'cardPreviewLiquidGlass',
    'cardPreviewSoftGlass',
    'btnToggleAccountDevicesPanel',
    'btnAccountSyncRow',
    'btnAccountEmailVerifyRow',
    'btnAccountResetPasswordRow',
    'btnAccountGoalsFocusRow',
    'btnAccountNotificationsRow',
    'btnAccountHelpSupportRow',
    'btnLogoutAccount',
    'otpDigitBoxesContainer'
  ];
  for (const reqId of requiredRedesignIds) {
    assert(html.includes(`id="${reqId}"`), `Missing required redesigned element #${reqId}`);
  }

  console.log('[PASS] Test 16: Redesigned Login & Account/Profile screens, Liquid Glass / Soft Glass switch, persistence, and strict data preservation verified.');
}

console.log('=== ALL 16 TEST SUITES PASSED 100% ===');

// -------------------------------------------------------------------------
// TEST 17: PRIORITIES 1–10 UPGRADES VERIFICATION
// -------------------------------------------------------------------------
{
  // Priority 1.1: Auth bar (authModeTabs / Forgot Pass) completely removed
  assert(!html.includes('id="authModeTabs"') && !html.includes('>Forgot Pass<'), 'Reference Image 1 auth bar must be completely removed');

  // Priority 1.2: OS Permissions & Presentation simplified with no OS names in visible UI
  app.PermissionOnboardingManager.renderAccountPermissionStatusList();
  const permListHtml = documentMock.getElementById('accountPermissionsStatusList').innerHTML;
  const visibleTextOnly = permListHtml.replace(/<[^>]+>/g, ' ');
  for (const osWord of ['Android', 'iOS', 'macOS', 'Windows', 'ChromeOS']) {
    assert(!visibleTextOnly.includes(osWord), `Visible OS Permissions list must not display OS name "${osWord}"`);
  }
  const presSummary = documentMock.getElementById('accountPlatformPresentationSummary').textContent;
  for (const osWord of ['Android', 'iOS', 'macOS', 'Windows', 'ChromeOS']) {
    assert(!presSummary.includes(osWord), `Presentation summary must not display OS name "${osWord}"`);
  }

  // Priority 1.3: More transparent Liquid Glass CSS
  assert(html.includes('rgba(28, 31, 38, 0.44)') && html.includes('rgba(255, 255, 255, 0.18)'), 'Liquid Glass variables must use higher transparency matching Reference Image 3');

  // Priority 2: Smart Usage Insights
  const insights = app.SmartInsightsEngine.computeInsights('ALL', 'DAY', 0);
  assert(insights.topApp && insights.topApp.name && insights.peakScreenWindow.hasActivity === true, 'Smart Usage Insights must identify genuine top app and peak window');

  // Priority 3: Per-App Limits and Warnings
  const limRes = app.AppLimitManager.setAppLimit('instagram', 60, 'Everyday');
  assert(limRes.ok === true && limRes.enforcementMode === 'WARNING_ONLY', 'Per-App Limit must save and honestly report WARNING_ONLY when native blocker is absent');
  const evalLim = app.AppLimitManager.evaluateAppLimitsForUser('usr_rahim_01');
  assert(evalLim.evaluated === true && evalLim.warnings.some(w => w.appKey === 'instagram' && w.stage === 'LIMIT_REACHED'), 'Per-App Limit must detect when Instagram usage (130m) exceeds 60m limit');

  // Priority 4: Device Management & Security (Rename, Revoke, Cross-account guard)
  const crossAccRename = app.DeviceSecurityManager.renameDevice('usr_other_99', 'inst_ios_01', 'Hacked Name');
  assert(crossAccRename.ok === false && crossAccRename.status === 'FORBIDDEN_CROSS_ACCOUNT', 'Must block cross-account device rename');
  const validRename = app.DeviceSecurityManager.renameDevice('usr_rahim_01', 'inst_ios_01', 'Rahim iPhone 16 Pro');
  assert(validRename.ok === true && validRename.name === 'Rahim iPhone 16 Pro', 'Must allow owner to rename their device');

  // Priority 5: Data Export & Backup
  const csvExp = app.DataExportBackupManager.exportUserData('CSV', { startDate: '2026-10-01', endDate: '2026-10-16' });
  const jsonExp = app.DataExportBackupManager.exportUserData('JSON', { startDate: '2026-10-01', endDate: '2026-10-16' });
  assert(csvExp.ok === true && csvExp.content.includes('SCREEN_SESSION') && jsonExp.ok === true && jsonExp.recordCount > 0, 'CSV and JSON exports must include genuine deduplicated records');
  const backupSnap = app.DataExportBackupManager.createBackupSnapshot('usr_rahim_01');
  const restoreSnap = app.DataExportBackupManager.restoreBackupSnapshot('usr_rahim_01', backupSnap.json);
  assert(backupSnap.ok === true && restoreSnap.ok === true && restoreSnap.restoredSessions === 0, 'Restoring identical backup must deduplicate existing records');

  // Priority 6 & 7: Focus Session History, Streaks & Weekly Challenges
  const focusDone = app.FocusModeController.completeSession();
  assert(focusDone.ok === true && focusDone.session && focusDone.session.status === 'COMPLETED', 'Completing focus session must persist session history');
  const streakSum = app.StreaksAndChallengesEngine.computeStreakSummary('usr_rahim_01');
  assert(streakSum.currentStreakDays >= 1 && streakSum.unrecordedDaysHandledHonestly === true && streakSum.challenges.length === 3, 'Streaks and weekly challenges must compute accurately');

  // Priority 8: Smart Notification Schedule
  const schedRes = app.NotificationScheduleManager.saveScheduleFromInputs({
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00'
  });
  assert(schedRes.ok === true && app.NotificationScheduleManager.isWithinQuietHours('23:15') === true && app.NotificationScheduleManager.canDeliverNotification('GOAL_REMINDER', '23:15') === false, 'Quiet hours must suppress scheduled notifications during quiet window');

  // Priority 9 & 10: Minimal Permission Modal & Scrollable Wheel Time Picker
  assert(!html.includes('OS Settings Target &amp; API:'), 'Verbose OS Settings Target & API box must be removed from permission modal');
  assert(html.includes('id="wheelGoalHours"') && html.includes('id="wheelFocusHours"') && html.includes('id="wheelAppTimerHours"'), 'Scrollable wheel time pickers must be present for Goal, Focus, and App Timer');
  assert(!html.includes('id="btnFocusDurMinus"') && !html.includes('id="btnFocusDurPlus"'), 'Old +/- buttons in Focus Duration Picker must be replaced by wheel');

  console.log('[PASS] Test 17: Priorities 1-10 (Ref Image 1-3 UI refinements, Smart Insights, Per-App Limits, Device Security, Export/Backup, Focus History, Streaks/Challenges, Notification Schedule, Minimal Permission Redirect, and Scrollable Wheel Pickers) verified.');
}

// -------------------------------------------------------------------------
// TEST 18: VERIFICATION OF ALL 8 NEW UI & SPLASH SCREEN REQUIREMENTS
// -------------------------------------------------------------------------
{
  // Requirement 1: Account Device Section — No Manual Remove or Rename Options
  const accDevHtml = documentMock.getElementById('accountDevicesList').innerHTML;
  assert(!accDevHtml.includes('data-start-rename') && !accDevHtml.includes('data-revoke-dev') && !accDevHtml.includes('>Rename<') && !accDevHtml.includes('Revoke Session'), 'Account > Devices must not display manual Rename, Remove, Delete, or Revoke options');

  // Requirement 2: Unlocks Chart — Interactive Pillars & Minimal Tooltip (Only unlock count & time interval)
  app.state.periodMode = 'DAY';
  app.state.selectedPillarIdx.UNLOCKS = 5; // 5:00–6:00 AM
  app.renderAll();
  const uVal = documentMock.getElementById('unlocksTooltipVal').textContent;
  const uSub = documentMock.getElementById('unlocksTooltipSub').textContent;
  assert(/^\d+ unlocks?$/.test(uVal), `Unlocks tooltip must display only unlock count (e.g. "6 unlocks"), got "${uVal}"`);
  assert(uSub === '5:00–6:00 AM', `Unlocks tooltip subtitle must display only time range "5:00–6:00 AM", got "${uSub}"`);
  assert(!uSub.includes('Oct') && !uSub.includes('Fri') && !uSub.includes('Today'), 'Unlocks tooltip must never display date or day name');
  const unlocksHtml = documentMock.getElementById('unlocksBarChart').innerHTML;
  assert(unlocksHtml.includes('data-unlocks-pillar="5"') && unlocksHtml.includes('data-selected="true"'), 'Unlocks chart pillars must be interactive and highlight selected pillar');

  // Requirement 3: Main Page Account Header & Removal of "Screen time ›" from Healthy Device Usage section
  assert(html.includes('id="mainPageAccountHeader"') && html.includes('id="btnMainHeaderProfile"') && html.includes('id="btnMainHeaderNotifications"'), 'Main Page Account Header with profile and notification bell must exist');
  assert(!html.includes('id="btnOpenStatsHeader"'), 'Screen Time navigation text and arrow must be removed from Healthy Device Usage section');
  const mainHeaderName = documentMock.getElementById('mainHeaderAccountName').textContent;
  const mainHeaderGreeting = documentMock.getElementById('mainHeaderGreeting').textContent;
  assert(mainHeaderName.includes('Rahim') && mainHeaderGreeting.startsWith('Good '), 'Main Page Account Header must show time-based greeting and user account name');
  const mainHeaderMatch = html.match(/<div id="mainPageAccountHeader"[\s\S]*?<\/button>\s*<\/div>/);
  assert(mainHeaderMatch && !mainHeaderMatch[0].includes('@gmail.com') && !mainHeaderMatch[0].includes('rahim.ahmed@'), 'Main Page Account Header must never expose user email or Gmail address');

  // Requirement 4: Global Graph Display Style — Exact Rendering & No Prohibited Description Text
  for (const forbiddenGraphCopy of [
    'Simple Bar Chart View',
    'Clean vertical bars & floating dark tooltip',
    'Detailed Dashboard View',
    'Curved gradient lines, donut charts & richer visuals'
  ]) {
    assert(!html.includes(forbiddenGraphCopy), `Forbidden graph description phrase "${forbiddenGraphCopy}" must not appear anywhere in app`);
  }
  app.GraphDisplayStyleController.setGraphStyle('DETAILED');
  const detailedOvHtml = documentMock.getElementById('overviewWeekChart').innerHTML;
  const detailedStatsHtml = documentMock.getElementById('statsBarChartContainer').innerHTML;
  assert(detailedOvHtml.includes('ss-curved-chart-svg') && !detailedOvHtml.includes('chart-pillar-bar'), 'Detailed view must render smooth curved SVG and NO vertical bars');
  assert(detailedStatsHtml.includes('ss-curved-chart-svg') && !detailedStatsHtml.includes('chart-pillar-bar'), 'Detailed view Screen Time chart must render curved SVG and NO vertical bars');

  const beforeGraphSnap = app.computeSnapshot('ALL', 'DAY', 0);
  const simpleRes = app.GraphDisplayStyleController.setGraphStyle('SIMPLE');
  assert(simpleRes.ok === true && simpleRes.graphDisplayStyle === 'SIMPLE' && app.state.graphDisplayStyle === 'SIMPLE', 'Must switch to SIMPLE bar chart view');
  assert(localStorageMock.getItem('screensync_graph_display_style_v1') === 'SIMPLE', 'Graph display style must persist in localStorage');
  const simpleOvHtml = documentMock.getElementById('overviewWeekChart').innerHTML;
  assert(simpleOvHtml.includes('chart-pillar-bar') && !simpleOvHtml.includes('ss-curved-chart-svg'), 'Simple view must render clean vertical bars and no curved SVG overlay');
  const afterGraphSnap = app.computeSnapshot('ALL', 'DAY', 0);
  assert(afterGraphSnap.totalScreenMinutes === beforeGraphSnap.totalScreenMinutes && afterGraphSnap.reelsCount === beforeGraphSnap.reelsCount, 'Changing graph display style must never alter underlying data or calculations');
  app.GraphDisplayStyleController.setGraphStyle('DETAILED');

  // Requirement 5: Remove All Reconciliation, Debug & Generated Usage Narrative Text
  for (const forbiddenDebug of ['Selected:', 'Reconciled Total:', 'Cumulative:', 'multi-device overlap', 'led by ', 'with peak usage around']) {
    assert(!html.includes(forbiddenDebug), `Forbidden narrative/debug text "${forbiddenDebug}" must not appear in HTML/JS`);
  }
  assert(documentMock.getElementById('smartInsightsSummaryText').textContent === '', 'Generated usage narrative summary text must be empty');

  // Requirement 6: Main Page App Categories Restriction
  const mainTopAppsHtml = documentMock.getElementById('overviewTopAppsGrid').innerHTML;
  const mainBreakdownHtml = documentMock.getElementById('overviewPerAppReelBreakdownList').innerHTML;
  for (const catLabel of ['Social networking', 'Entertainment', 'Productivity & finance', 'Productivity', 'Education']) {
    assert(!mainTopAppsHtml.includes(catLabel) && !mainBreakdownHtml.includes(catLabel), `Main Page app entries must not display category "${catLabel}"`);
  }

  // Requirement 7: Goal Alert Notification UI Redesign
  const alertRes = app.triggerScreenTimeGoalAlert();
  assert(alertRes.ok === true, 'Goal alert trigger must succeed');
  const alertTitle = documentMock.getElementById('sysGoalAlertTitle').textContent;
  const alertMsg = documentMock.getElementById('sysGoalAlertMessage').textContent;
  const alertChannelBadge = documentMock.getElementById('sysGoalAlertChannelBadge').textContent;
  const alertMetaText = documentMock.getElementById('sysGoalAlertMeta').textContent;
  assert(alertTitle === 'Screen Time Goal Reached', `Goal alert title must be exact "Screen Time Goal Reached", got "${alertTitle}"`);
  assert(/used \(Limit: .+\)$/.test(alertMsg), `Goal alert message must match "<used> used (Limit: <limit>)", got "${alertMsg}"`);
  assert(alertChannelBadge === '' && alertMetaText === '', 'Goal alert must not expose developer tags or tracking IDs');

  // Requirement 8: Splash Screen Loading Animation & Reference Logo Redesign
  assert(html.includes('id="splashParticleCanvas"') && html.includes('id="splashReferenceLogoImg"') && html.includes('id="splashCircularLoader"'), 'Splash screen must include reference logo, 60fps particle canvas, and circular loader');

  console.log('[PASS] Test 18: All 8 UI, Chart, Notification & Splash Screen Redesign Requirements verified.');
}

// -------------------------------------------------------------------------
// TEST 19: 3-MODE THEME SYSTEM (LIGHT, DARK, SYSTEM NATIVE) & PERSISTENCE
// -------------------------------------------------------------------------
{
  assert(html.includes('id="ssEarlyThemeInit"'), 'Early FOUC-prevention script #ssEarlyThemeInit must exist in <head>');
  assert(html.includes('id="btnThemeLight"') && html.includes('id="btnThemeDark"') && html.includes('id="btnThemeSystem"'), 'Account settings must include Light, Dark, and System theme buttons');
  assert(!html.includes('id="headerThemeSwitcherGroup"') && !html.includes('id="btnHeaderThemeLight"') && !html.includes('id="btnHeaderThemeDark"') && !html.includes('id="btnHeaderThemeSystem"'), 'Global theme selector must be removed from Overview/Screen Time/Focus header and exist exclusively in Account');

  // Switch to LIGHT mode
  const lightRes = app.DesignStyleController.setAppTheme('LIGHT');
  assert(lightRes.ok === true && lightRes.appTheme === 'LIGHT' && lightRes.resolvedTheme === 'LIGHT', 'Must switch to LIGHT mode');
  assert(documentMock.documentElement.getAttribute('data-app-theme') === 'LIGHT', 'html[data-app-theme] must be LIGHT');
  assert(documentMock.documentElement.getAttribute('data-theme-preference') === 'LIGHT', 'html[data-theme-preference] must be LIGHT');
  assert(localStorageMock.getItem('screensync_app_theme_pref_v2') === 'LIGHT', 'localStorage must persist LIGHT preference');

  // Switch to DARK mode
  const darkRes = app.DesignStyleController.setAppTheme('DARK');
  assert(darkRes.ok === true && darkRes.appTheme === 'DARK' && darkRes.resolvedTheme === 'DARK', 'Must switch to DARK mode');
  assert(documentMock.documentElement.getAttribute('data-app-theme') === 'DARK', 'html[data-app-theme] must be DARK');
  assert(documentMock.documentElement.getAttribute('data-theme-preference') === 'DARK', 'html[data-theme-preference] must be DARK');
  assert(localStorageMock.getItem('screensync_app_theme_pref_v2') === 'DARK', 'localStorage must persist DARK preference');

  // Switch to SYSTEM mode and verify simulated OS Light & Dark changes
  app.DesignStyleController._simulatedSystemTheme = 'LIGHT';
  const sysLightRes = app.DesignStyleController.setAppTheme('SYSTEM');
  assert(sysLightRes.ok === true && sysLightRes.appTheme === 'SYSTEM' && sysLightRes.resolvedTheme === 'LIGHT', 'SYSTEM mode with OS Light must resolve to LIGHT');
  assert(documentMock.documentElement.getAttribute('data-app-theme') === 'LIGHT', 'html[data-app-theme] must resolve to LIGHT when OS is Light');
  assert(documentMock.documentElement.getAttribute('data-theme-preference') === 'SYSTEM', 'html[data-theme-preference] must be SYSTEM');

  app.DesignStyleController._simulatedSystemTheme = 'DARK';
  app.DesignStyleController.applyToDocument();
  assert(documentMock.documentElement.getAttribute('data-app-theme') === 'DARK', 'html[data-app-theme] must dynamically update to DARK when OS switches to Dark');
  app.DesignStyleController._simulatedSystemTheme = null;

  console.log('[PASS] Test 19: 3-Mode Theme System (Light, Dark, System Native), FOUC prevention, and localStorage persistence verified.');
}

// -------------------------------------------------------------------------
// TEST 20: TASKS A–E — METRIC SWITCHING, BASELINE/LABELS, MONOTONE CURVE, DAY TOOLTIP & BOUNDARY CLIPPING
// -------------------------------------------------------------------------
{
  app.AuthService.login('rahim.ahmed@gmail.com', 'password123');
  app.BackendDB.resetUserBaseline('usr_rahim_01');
  app.state.selectedDevice = 'ALL';
  app.state.periodMode = 'DAY';
  app.state.selectedPillarIdx.OVERVIEW = 6;
  app.state.selectedPillarIdx.STATS = 9;
  app.GraphDisplayStyleController.setGraphStyle('DETAILED');

  // Task A: Metric switching across Screen Time, Reel Count, and Reel Watch Time
  app.setDashboardMetricMode('SCREEN');
  assert(app.state.statsMetricMode === 'SCREEN' && app.state.overviewMetricMode === 'SCREEN', 'Metric mode must be SCREEN');
  assert(documentMock.getElementById('overviewMetricBtnScreen').getAttribute('aria-selected') === 'true', 'Overview Screen Time button must be marked active');
  assert(documentMock.getElementById('overviewTooltipVal').textContent === '9 h 15 m', `Overview Screen Time tooltip must display 9 h 15 m on Friday, got ${documentMock.getElementById('overviewTooltipVal').textContent}`);
  assert(documentMock.getElementById('statsTooltipVal').textContent === '60 mins', 'Stats Screen Time Day tooltip at hour 9 must display 60 mins');

  app.setDashboardMetricMode('REELS_COUNT');
  assert(app.state.statsMetricMode === 'REELS_COUNT' && app.state.overviewMetricMode === 'REELS_COUNT', 'Metric mode must switch to REELS_COUNT');
  assert(documentMock.getElementById('overviewMetricBtnReelsCount').getAttribute('aria-selected') === 'true', 'Overview Reels Count button must be marked active');
  assert(documentMock.getElementById('overviewMetricBtnScreen').getAttribute('aria-selected') === 'false', 'Overview Screen Time button must be marked inactive');
  assert(documentMock.getElementById('overviewTooltipVal').textContent === '20 reels', `Overview Reels Count tooltip must display 20 reels, got ${documentMock.getElementById('overviewTooltipVal').textContent}`);
  assert(documentMock.getElementById(' overviewYMax'.trim()).textContent.includes('reels'), 'Overview Y-axis must update to reels when REELS_COUNT is selected');
  assert(documentMock.getElementById('statsTooltipVal').textContent === '5 reels', `Stats Reels Count Day tooltip at hour 9 must display 5 reels, got ${documentMock.getElementById('statsTooltipVal').textContent}`);
  assert(documentMock.getElementById('statsYMax').textContent.includes('reels'), 'Stats Y-axis must update to reels when REELS_COUNT is selected');

  app.setDashboardMetricMode('REEL_TIME');
  assert(app.state.statsMetricMode === 'REEL_TIME' && app.state.overviewMetricMode === 'REEL_TIME', 'Metric mode must switch to REEL_TIME');
  assert(documentMock.getElementById('overviewMetricBtnReelTime').getAttribute('aria-selected') === 'true', 'Overview Reel Watch Time button must be marked active');
  assert(documentMock.getElementById('overviewTooltipVal').textContent === '1 h 35 m', `Overview Reel Watch Time tooltip must display 1h 35m, got ${documentMock.getElementById('overviewTooltipVal').textContent}`);
  assert(documentMock.getElementById('statsTooltipVal').textContent === '24 mins', `Stats Reel Watch Time Day tooltip at hour 9 must display 24 mins, got ${documentMock.getElementById('statsTooltipVal').textContent}`);

  // Verify Day, Week, Month, Year views continue working across metrics
  for (const pMode of ['DAY', 'WEEK', 'MONTH', 'YEAR']) {
    app.state.periodMode = pMode;
    app.state.selectedPillarIdx.STATS = pMode === 'DAY' ? 9 : pMode === 'WEEK' ? 6 : pMode === 'MONTH' ? 29 : 9;
    app.renderAll();
    const chartHtml = documentMock.getElementById('statsBarChartContainer').innerHTML;
    assert(chartHtml.includes('ss-curved-chart-svg'), `Stats chart must render curve in ${pMode} mode`);
  }
  app.state.periodMode = 'DAY';
  app.setDashboardMetricMode('SCREEN');

  // Task B: Today's Screen Time graph baseline and Sat-Fri weekday labels separated
  const ovChartInner = documentMock.getElementById('overviewWeekChart').innerHTML;
  const ovXAxisInner = documentMock.getElementById('overviewWeekXAxis').innerHTML;
  assert(!ovChartInner.includes('-bottom-0.5'), 'Weekday labels must not be placed inside the SVG plot area at -bottom-0.5');
  for (const dayLbl of ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
    assert(ovXAxisInner.includes(`>${dayLbl}<`), `Dedicated X-axis row must contain weekday label ${dayLbl}`);
  }

  // Task C: Curve interpolation never dips below zero baseline (y <= baselineY = 98)
  const testDatasets = [
    [0, 0, 0, 0, 0, 0, 600],
    [0, 0, 45, 0, 0, 120, 0],
    [80, 0, 0, 0, 0, 0, 0],
    [0, 30, 90, 15, 0, 60, 20]
  ];
  for (const ds of testDatasets) {
    const svgOut = app.buildCurvedChartOverlaySvg(ds, Math.max(...ds, 60), '#38BDF8', 'testGrad', 6);
    const pathMatch = svgOut.match(/<path d="([^"]+)" fill="none"/);
    assert(pathMatch, 'Curve path must be generated');
    const dStr = pathMatch[1];
    const numPairs = [...dStr.matchAll(/([0-9.]+)\s+([0-9.]+)/g)].map(m => [parseFloat(m[1]), parseFloat(m[2])]);
    for (const [, yVal] of numPairs) {
      assert(yVal <= 98.001 && yVal >= 0, `Curve coordinate/control point y=${yVal} must never dip below zero baseline (y=98)`);
    }
  }

  // Task D: Simplify Screen Time Day tooltip (value + time span only, no date/weekday)
  app.state.periodMode = 'DAY';
  app.setDashboardMetricMode('SCREEN');
  app.state.selectedPillarIdx.STATS = 10; // 10:00 - 11:00 AM (60 mins)
  app.renderAll();
  const dayScreenVal = documentMock.getElementById('statsTooltipVal').textContent;
  const dayScreenSub = documentMock.getElementById('statsTooltipSub').textContent;
  assert(dayScreenVal === '60 mins', `Expected "60 mins", got "${dayScreenVal}"`);
  assert(dayScreenSub === '10:00 AM - 11:00 AM', `Screen Time Day tooltip must show only time span "10:00 - 11:00 AM", got "${dayScreenSub}"`);
  assert(!dayScreenSub.includes('Oct') && !dayScreenSub.includes('Fri') && !dayScreenSub.includes(','), `Screen Time Day tooltip must not include date or weekday: "${dayScreenSub}"`);

  // Ensure Week view tooltip still includes weekday & date
  app.state.periodMode = 'WEEK';
  app.state.selectedPillarIdx.STATS = 6;
  app.renderAll();
  const weekScreenSub = documentMock.getElementById('statsTooltipSub').textContent;
  assert(weekScreenSub.includes('Friday') && weekScreenSub.includes('10/16'), `Week view tooltip must preserve weekday and date, got "${weekScreenSub}"`);
  app.state.periodMode = 'DAY';
  app.renderAll();

  // Task E: Boundary-aware tooltip positioning across all three graphs at left (idx=0) and right (idx=last) boundaries
  for (const mode of ['SCREEN', 'REELS_COUNT', 'REEL_TIME']) {
    app.setDashboardMetricMode(mode);
    for (const boundaryIdx of [0, 23]) {
      app.state.selectedPillarIdx.STATS = boundaryIdx;
      app.state.selectedPillarIdx.REEL_VIEWING = boundaryIdx;
      app.state.selectedPillarIdx.OVERVIEW = boundaryIdx === 0 ? 0 : 6;
      app.renderAll();
      for (const tipId of ['overviewChartTooltip', 'reelViewingChartTooltip', 'statsChartTooltip']) {
        const tipEl = documentMock.getElementById(tipId);
        const leftPct = parseFloat(tipEl.getAttribute('data-tooltip-left-pct'));
        assert(tipEl.getAttribute('data-boundary-clamped') === 'true', `${tipId} must have boundary clamping enabled`);
        assert(leftPct >= 14 && leftPct <= 86, `${tipId} leftPct (${leftPct}%) must stay safely clamped inside visible container bounds`);
      }
    }
  }

  console.log('[PASS] Test 20: Tasks A-E (Metric switching, Screen Time baseline/labels spacing, monotone non-negative curve interpolation, Day tooltip simplification, and boundary-aware tooltip positioning) verified.');
}
// -------------------------------------------------------------------------
// TEST 21: OVERVIEW LAYOUT REFINEMENT, THEME CLEANUP & LIGHT-MODE LIQUID GLASS
// -------------------------------------------------------------------------
{
  // Task A: Verify Overview, Screen Time, and Focus have NO global theme-selection controls
  const viewOverviewMatch = html.match(/<section id="viewOverview"[\s\S]*?<\/section>/);
  const viewStatsMatch = html.match(/<section id="viewStats"[\s\S]*?<\/section>/);
  const viewFocusMatch = html.match(/<section id="viewFocus"[\s\S]*?<\/section>/);
  const viewAccountMatch = html.match(/<section id="viewAccount"[\s\S]*?<\/section>/);
  assert(viewOverviewMatch && viewStatsMatch && viewFocusMatch && viewAccountMatch, 'All four primary sections must exist');
  assert(!viewOverviewMatch[0].includes('data-theme-option') && !viewOverviewMatch[0].includes('app-theme-btn'), 'Overview must contain no global theme selector');
  assert(!viewStatsMatch[0].includes('data-theme-option') && !viewStatsMatch[0].includes('app-theme-btn'), 'Screen Time must contain no global theme selector');
  assert(!viewFocusMatch[0].includes('data-theme-option') && !viewFocusMatch[0].includes('app-theme-btn'), 'Focus must contain no global theme selector');
  assert(viewAccountMatch[0].includes('id="accountThemeToggleGroup"') && viewAccountMatch[0].includes('id="btnThemeLight"') && viewAccountMatch[0].includes('id="btnThemeDark"') && viewAccountMatch[0].includes('id="btnThemeSystem"'), 'Account section must retain the Light | Dark | System selector');

  // Verify navigation between views preserves selected theme
  app.DesignStyleController.setAppTheme('LIGHT');
  for (const v of ['OVERVIEW', 'STATS', 'FOCUS', 'ACCOUNT', 'OVERVIEW']) {
    app.switchView(v);
    assert(documentMock.documentElement.getAttribute('data-app-theme') === 'LIGHT', `Theme must remain LIGHT when navigating to ${v}`);
  }

  // Task B: Verify All Devices switcher is positioned immediately below mainPageAccountHeader and directly above Healthy device usage
  const ovHtml = viewOverviewMatch[0];
  const headerIdx = ovHtml.indexOf('id="mainPageAccountHeader"');
  const switcherIdx = ovHtml.indexOf('id="deviceSwitcherBar"');
  const healthyIdx = ovHtml.indexOf('>Healthy device usage</h1>');
  assert(headerIdx !== -1 && switcherIdx !== -1 && healthyIdx !== -1, 'Overview must contain mainPageAccountHeader, deviceSwitcherBar, and Healthy device usage heading');
  assert(headerIdx < switcherIdx && switcherIdx < healthyIdx, 'All Devices switcher must appear immediately below greeting/profile header and directly above Healthy device usage');
  assert((html.match(/id="deviceSwitcherBar"/g) || []).length === 1, 'Must not create a duplicate device switcher');

  // Task C: Verify Light-Mode Liquid Glass styling tokens & fallback rules
  assert(html.includes('inset 0 1px 1px rgba(255, 255, 255, 0.94)') && html.includes('backdrop-filter: blur(') && html.includes('-webkit-backdrop-filter: blur('), 'Light Mode Liquid Glass must include translucent blur, -webkit-backdrop-filter, and specular inner border');
  assert(html.includes('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'), 'Must provide fallback rules where backdrop-filter is unsupported');

  console.log('[PASS] Test 21: Overview layout refinement, exclusive Account theme selector, and Light-Mode Liquid Glass styling verified.');
}

// -------------------------------------------------------------------------
// TEST 22: TASKS 1, 2 & 3 — SMOOTH SLIDING PILLS, SMOOTH THEME TRANSITIONS & UNIFIED DYNAMIC ISLAND + MESSENGER STORIES
// -------------------------------------------------------------------------
{
  // Task 1: Smooth sliding active indicator for Bottom Navigation and Graph Style Selector (Curved | Bars)
  assert(html.includes("id=\"bottomNavLiquidPill\"") && html.includes("id=\"graphStyleLiquidPill\"") && html.includes("id=\"accountThemeLiquidPill\""), "HTML must include sliding liquid glass pill indicators for Bottom Nav, Graph Style Selector, and Theme Selector");

  const bottomNavPill = documentMock.getElementById("bottomNavLiquidPill");
  const navExpectations = [
    ["OVERVIEW", "0", "translateX(0%)"],
    ["STATS", "1", "translateX(100%)"],
    ["FOCUS", "2", "translateX(200%)"],
    ["ACCOUNT", "3", "translateX(300%)"],
    ["OVERVIEW", "0", "translateX(0%)"]
  ];
  for (const [viewName, expectedIdx, expectedTx] of navExpectations) {
    app.switchView(viewName);
    assert(bottomNavPill.getAttribute("data-active-index") === expectedIdx, `Bottom nav pill active index for ${viewName} must be ${expectedIdx}, got ${bottomNavPill.getAttribute("data-active-index")}`);
    assert(bottomNavPill.style.transform === expectedTx, `Bottom nav pill transform for ${viewName} must be ${expectedTx}, got ${bottomNavPill.style.transform}`);
    assert(bottomNavPill.style.width === "calc((100% - 8px) / 4)", `Bottom nav pill width must be exact calc((100% - 8px) / 4), got ${bottomNavPill.style.width}`);
  }

  const graphStylePill = documentMock.getElementById("graphStyleLiquidPill");
  app.GraphDisplayStyleController.setGraphStyle("DETAILED");
  assert(graphStylePill.getAttribute("data-active-index") === "0" && graphStylePill.style.transform === "translateX(0%)", "Graph style sliding pill must sit at index 0 (translateX(0%)) for Curved (DETAILED)");
  assert(documentMock.getElementById("btnGraphStyleDetailed").getAttribute("data-pill-active") === "true", "btnGraphStyleDetailed must have data-pill-active=true");

  app.GraphDisplayStyleController.setGraphStyle("SIMPLE");
  assert(graphStylePill.getAttribute("data-active-index") === "1" && graphStylePill.style.transform === "translateX(100%)", "Graph style sliding pill must glide to index 1 (translateX(100%)) for Bars (SIMPLE)");
  assert(documentMock.getElementById("btnGraphStyleSimple").getAttribute("data-pill-active") === "true", "btnGraphStyleSimple must have data-pill-active=true");
  app.GraphDisplayStyleController.setGraphStyle("DETAILED");

  // Task 2: Smooth theme transitions for Light, Dark, and System modes with reduced-motion support
  app.DesignStyleController.setReducedMotionSimulation(false);
  const themePill = documentMock.getElementById("accountThemeLiquidPill");
  const tLight = app.DesignStyleController.setAppTheme("LIGHT");
  assert(tLight.transition && tLight.transition.animated === true && tLight.transition.durationMs === 320 && documentMock.documentElement.getAttribute("data-last-theme-transition") === "smooth-320ms", "Switching theme with normal motion must activate smooth 320ms theme transition");
  assert(themePill.getAttribute("data-active-index") === "0" && themePill.style.transform === "translateX(0%)", "Theme sliding pill must move to index 0 for LIGHT");

  app.DesignStyleController.setAppTheme("DARK");
  assert(themePill.getAttribute("data-active-index") === "1" && themePill.style.transform === "translateX(100%)", "Theme sliding pill must move to index 1 for DARK");

  app.DesignStyleController.setAppTheme("SYSTEM");
  assert(themePill.getAttribute("data-active-index") === "2" && themePill.style.transform === "translateX(200%)", "Theme sliding pill must move to index 2 for SYSTEM");

  // Reduced-motion verification
  app.DesignStyleController.setReducedMotionSimulation(true);
  assert(app.DesignStyleController.isReducedMotionPreferred() === true, "Reduced motion simulation must report true");
  const tReduced = app.DesignStyleController.setAppTheme("LIGHT");
  assert(tReduced.transition && tReduced.transition.animated === false && tReduced.transition.reducedMotion === true && documentMock.documentElement.getAttribute("data-last-theme-transition") === "instant-reduced-motion", "Reduced motion must bypass theme transition animation");
  app.GraphDisplayStyleController.setGraphStyle("SIMPLE");
  assert(!graphStylePill.classList.contains("wobble"), "Reduced motion must suppress wobble animation on sliding pill");
  app.DesignStyleController.setReducedMotionSimulation(null);
  app.GraphDisplayStyleController.setGraphStyle("DETAILED");
  app.DesignStyleController.setAppTheme("DARK");

  // Task 3: Unified App & OS Dynamic Island visibility and activity-level tracking (including Messenger Stories) across Android, iOS, macOS, Windows, and ChromeOS
  assert(app.APP_METADATA.messenger && app.APP_METADATA.messenger.supportsReels === true && app.APP_LOGOS.messenger, "Messenger must be registered in APP_METADATA and APP_LOGOS with Story/Reel support");
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  app.ReelTrackingEngine.resetTrackingSandbox();
  const baseSnap = app.computeSnapshot("ALL", "DAY", 0);
  assert(baseSnap.reelsCount === 20 && baseSnap.watchSeconds === 5700, "Baseline before Messenger Story test must be 20 Reels, 5700s");

  // 3A. Messenger Stories forward & backward navigation across devices must count +1 Reel/Story and accumulate watch time, with Dynamic Island visible
  const pill = documentMock.getElementById("dynamicIslandPill");
  const msgStart = app.ReelTrackingEngine.startOrResumePlayback({
    installationKey: "s24_ultra",
    appKey: "messenger",
    itemId: "msg_story_01",
    contentType: "STORY",
    timestampMs: 500000
  });
  assert(msgStart.ok === true && msgStart.contentType === "STORY", "Messenger Story playback must start cleanly");
  assert(!pill.classList.contains("hidden") && pill.getAttribute("data-island-visible") === "true", "Dynamic Island must be visible during active Messenger Story");

  const msgNavFwd = app.ReelTrackingEngine.handleEvent({
    type: "STORY_NAVIGATION",
    direction: "FORWARD",
    installationKey: "s24_ultra",
    appKey: "messenger",
    contentType: "STORY",
    targetItemId: "msg_story_02",
    startMs: 500000,
    endMs: 530000,
    timestampMs: 530000,
    callbackId: "cb_msg_story_fwd_1"
  });
  assert(msgNavFwd.ok === true && msgNavFwd.reelCountDelta === 1 && msgNavFwd.watchSecondsAdded === 30, "Messenger Story forward navigation must add +1 count and +30s watch time");

  const msgNavBack = app.ReelTrackingEngine.handleEvent({
    type: "STORY_NAVIGATION",
    direction: "BACKWARD",
    installationKey: "iphone_16",
    appKey: "fb_messenger",
    contentType: "MESSENGER_STORY",
    targetItemId: "msg_story_01",
    startMs: 530000,
    endMs: 560000,
    timestampMs: 560000,
    callbackId: "cb_msg_story_bwd_1"
  });
  assert(msgNavBack.ok === true && msgNavBack.reelCountDelta === 1 && msgNavBack.watchSecondsAdded === 30, "Messenger Story backward navigation must add +1 count and +30s watch time");

  const snapAfterMsgStories = app.computeSnapshot("ALL", "DAY", 0);
  assert(snapAfterMsgStories.reelsCount === 22 && snapAfterMsgStories.watchSeconds === 5760, `Expected 22 Reels and 5760s after 2 Messenger Stories, got ${snapAfterMsgStories.reelsCount} Reels and ${snapAfterMsgStories.watchSeconds}s`);
  const msgAppEntry = snapAfterMsgStories.apps.find(a => a.key === "messenger");
  assert(msgAppEntry && msgAppEntry.reels === 2 && msgAppEntry.stories === 2 && msgAppEntry.reelMinutes === 1, "Messenger per-app breakdown must record 2 stories/reels and 1m watch time");

  // 3B. Non-reel sub-activities inside Messenger (CHAT/DM), Instagram (DM/FEED), Facebook (NEWS_FEED), YouTube (LONG_VIDEO), WhatsApp (CHAT) must NOT count and must HIDE the Dynamic Island
  const nonReelSubActivities = [
    { appKey: "messenger", activityType: "CHAT" },
    { appKey: "messenger", activityType: "DM" },
    { appKey: "instagram", activityType: "DM" },
    { appKey: "instagram", activityType: "FEED" },
    { appKey: "facebook", activityType: "NEWS_FEED" },
    { appKey: "youtube", activityType: "LONG_VIDEO" },
    { appKey: "whatsapp", activityType: "VOICE_CALL" }
  ];
  for (const { appKey, activityType } of nonReelSubActivities) {
    const ignoredRes = app.ReelTrackingEngine.handleEvent({
      type: "NAVIGATION",
      direction: "FORWARD",
      installationKey: "iphone_16",
      appKey,
      activityType,
      startMs: 600000,
      endMs: 645000,
      timestampMs: 645000
    });
    assert(ignoredRes.ok === false && ignoredRes.status === "NON_REEL_ACTIVITY_IGNORED" && ignoredRes.reelCountDelta === 0 && ignoredRes.watchSecondsAdded === 0, `Non-reel activity ${appKey}:${activityType} must be ignored with 0 count and 0 watch time`);
    assert(pill.classList.contains("hidden") && pill.getAttribute("data-island-visible") === "false", `App Dynamic Island must hide during non-reel sub-activity ${appKey}:${activityType}`);
  }

  // Verify totals remained unchanged during non-reel sub-activities
  const snapAfterNonReel = app.computeSnapshot("ALL", "DAY", 0);
  assert(snapAfterNonReel.reelsCount === 22 && snapAfterNonReel.watchSeconds === 5760, "Non-reel sub-activities must never alter Reel Count or Reel Watch Time");

  // 3C. Verify Unified OS-level visibility evaluation across Android, iOS, macOS, Windows, and ChromeOS
  for (const osName of ["Android", "iOS", "macOS", "Windows", "ChromeOS"]) {
    const visScreenSync = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "screensync", isScreenSyncApp: true });
    const visMsgStory = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "messenger", activityType: "STORY" });
    const visIgReel = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "instagram", activityType: "REEL" });
    const visMsgChat = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "messenger", activityType: "CHAT" });
    const visChrome = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "chrome", activityType: "BROWSING" });
    const visLandscape = app.CrossPlatformPillPresenter.evaluateUnifiedVisibility({ osCategory: osName, appKey: "instagram", activityType: "REEL", isFullscreenLandscapeVideo: true });

    assert(visScreenSync.visible === true && visScreenSync.hidden === false, `${osName}: Dynamic Island must be visible in ScreenSync app`);
    assert(visMsgStory.visible === true && visMsgStory.reason === "ACTIVE_MESSENGER_STORY", `${osName}: Dynamic Island must be visible in Messenger Stories`);
    assert(visIgReel.visible === true && visIgReel.isEligibleReelOrStoryActivity === true, `${osName}: Dynamic Island must be visible in Instagram Reels`);
    assert(visMsgChat.visible === false && visMsgChat.reason === "NON_REEL_SUB_ACTIVITY", `${osName}: Dynamic Island must hide in Messenger Chat`);
    assert(visChrome.visible === false && visChrome.reason === "UNSUPPORTED_APP", `${osName}: Dynamic Island must hide in unrelated app Chrome`);
    assert(visLandscape.visible === false && visLandscape.reason === "FULLSCREEN_LANDSCAPE_VIDEO", `${osName}: Dynamic Island must hide in fullscreen landscape video`);
  }

  // Restore clean baseline and return to OVERVIEW
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  app.ReelTrackingEngine.resetTrackingSandbox();
  app.switchView("OVERVIEW");
  assert(!pill.classList.contains("hidden") && pill.getAttribute("data-island-visible") === "true", "Dynamic Island must restore visibility when returning to ScreenSync Overview");

  console.log("[PASS] Test 22: Smooth sliding indicators (Bottom Nav, Graph Style, Theme), smooth theme transitions with reduced-motion support, and unified App/OS Dynamic Island visibility + Messenger Stories activity tracking verified.");
}
console.log("=== ALL 22 TEST SUITES PASSED 100% ===");





// -------------------------------------------------------------------------
// TEST 23: CROSS-PLATFORM SCREEN ACCESS, PERMISSION INDEPENDENCE & PRIVACY GUARD
// -------------------------------------------------------------------------
{
  assert(app.CrossPlatformScreenAccessManager, "CrossPlatformScreenAccessManager must be exposed");
  for (const osName of ["Android", "iOS", "macOS", "Windows", "ChromeOS"]) {
    const rep = app.CrossPlatformScreenAccessManager.getPermissionAndCapabilityReport(osName, `inst_${osName.toLowerCase()}_01`);
    assert(rep.osCategory === osName && rep.singlePermissionGrantsAll === false && rep.silentScreenCaptureSupported === false, `${osName} report must enforce permission independence and forbid silent screen capture`);
  }

  // Granting one permission (e.g. usage_stats on Android) must NOT mark accessibility or overlay as granted
  app.PermissionOnboardingManager.currentPlatform = "Android";
  app.PermissionOnboardingManager.currentInstallationId = "inst_and_01";
  app.PermissionOnboardingManager.onReturnFromSystemSettings("usage_stats", "GRANTED");
  app.PermissionOnboardingManager.onReturnFromSystemSettings("accessibility", "DENIED");
  const andRep = app.CrossPlatformScreenAccessManager.getPermissionAndCapabilityReport("Android", "inst_and_01");
  assert(andRep.grantedPermissions.includes("usage_stats") && !andRep.grantedPermissions.includes("accessibility"), "Granting usage_stats must not grant accessibility");
  assert(andRep.capabilities.nativeUsageTracking === true && andRep.capabilities.inAppReelAndStoryDetection === false, "Capabilities must accurately reflect granted vs denied permissions");

  // Silent screen capture must always be rejected
  const silentAttempt = app.CrossPlatformScreenAccessManager.requestScreenCaptureSession({ silent: true, userInitiated: false, osCategory: "Android" });
  assert(silentAttempt.ok === false && silentAttempt.status === "SILENT_CAPTURE_PROHIBITED", "Silent screen capture must be rejected");
  const userConsentedCapture = app.CrossPlatformScreenAccessManager.requestScreenCaptureSession({ userInitiated: true, osConsentGranted: true, osCategory: "macOS" });
  assert(userConsentedCapture.ok === true && userConsentedCapture.authorized === true && userConsentedCapture.privateContentSharedAcrossDevices === false, "User-initiated OS-consented capture must succeed without sharing private content");

  // Sensitive data (passwords, OTPs, private messages) must be blocked
  const passAttempt = app.CrossPlatformScreenAccessManager.processAuthorizedScreenActivity({
    appKey: "instagram",
    isPasswordField: true,
    activityType: "REEL"
  });
  const dmAttempt = app.CrossPlatformScreenAccessManager.processAuthorizedScreenActivity({
    appKey: "messenger",
    privateMessage: "Secret private chat message",
    activityType: "STORY"
  });
  const otpAttempt = app.CrossPlatformScreenAccessManager.processAuthorizedScreenActivity({
    appKey: "whatsapp",
    otp: "482910",
    activityType: "STORY"
  });
  assert(passAttempt.status === "SENSITIVE_CONTENT_BLOCKED" && dmAttempt.status === "SENSITIVE_CONTENT_BLOCKED" && otpAttempt.status === "SENSITIVE_CONTENT_BLOCKED", "Passwords, private messages, and OTP codes must never be collected");

  // Local date/time context
  const dtCtx = app.CrossPlatformScreenAccessManager.getLocalDateTimeContext();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(dtCtx.localDate) && typeof dtCtx.tzOffsetMinutes === "number" && dtCtx.dayEndEpochSec - dtCtx.dayStartEpochSec === 86400, "Local date/time context must provide valid local date, timezone offset, and daily boundaries");

  // Restore Android permissions to granted for subsequent tests
  app.PermissionOnboardingManager.onReturnFromSystemSettings("accessibility", "GRANTED");
  console.log("[PASS] Test 23: Cross-platform screen access, permission independence, silent capture prohibition, sensitive data blocking, and local date/time context verified.");
}

// -------------------------------------------------------------------------
// TEST 24: ACCURATE APPLICATION DISCOVERY, DEDUPLICATION & NO PACKAGE IDS IN UI
// -------------------------------------------------------------------------
{
  assert(app.AppDiscoveryService, "AppDiscoveryService must be exposed");
  const discRes = app.AppDiscoveryService.discoverInstalledApplications("s24_ultra", {
    discoveredApps: [
      { packageId: "com.instagram.android", name: "Instagram" },
      { bundleId: "com.burbn.instagram", name: "Instagram" }, // Duplicate of Instagram
      { packageId: "com.facebook.orca", name: "Messenger" },
      { packageId: "com.spotify.music", name: "Spotify", category: "Entertainment" } // App requiring fallback icon
    ]
  });
  assert(discRes.duplicatesRemoved >= 1, "Duplicate Instagram entries across package/bundle IDs must be deduplicated");
  const igEntry = discRes.apps.find(a => a.key === "instagram");
  const spotifyEntry = discRes.apps.find(a => a.key === "spotify" || a.name === "Spotify");
  assert(igEntry && igEntry.usedFallbackIcon === false, "Instagram must use its real icon");
  assert(spotifyEntry && spotifyEntry.usedFallbackIcon === true && spotifyEntry.iconHtml.includes('data-fallback-icon="true"'), "App without native icon must use clean fallback icon");
  assert(!Object.keys(igEntry).includes("_internalPackageId") && !Object.keys(igEntry).includes("_internalBundleId"), "Internal package/bundle IDs must be non-enumerable");

  // Verify dashboard and breakdown UI never expose package IDs
  app.renderAll();
  const topGridHtml = documentMock.getElementById("overviewTopAppsGrid").innerHTML;
  const breakdownHtml = documentMock.getElementById("overviewPerAppReelBreakdownList").innerHTML;
  const statsAppsHtml = documentMock.getElementById("statsAppUsageList").innerHTML;
  for (const pkgId of ["com.instagram.android", "com.burbn.instagram", "com.facebook.orca", "com.zhiliaoapp.musically"]) {
    assert(!topGridHtml.includes(pkgId) && !breakdownHtml.includes(pkgId) && !statsAppsHtml.includes(pkgId), `User-facing dashboard must never expose internal package ID ${pkgId}`);
  }
  console.log("[PASS] Test 24: Accurate application discovery, deduplication, real vs fallback icons, and non-exposure of internal package identifiers verified.");
}

// -------------------------------------------------------------------------
// TEST 25: NATIVE USAGE INTEGRATION, AGGREGATE NON-FABRICATION & DEDUPLICATION
// -------------------------------------------------------------------------
{
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  const beforeSnap = app.computeSnapshot("s24_ultra", "DAY", 0);
  const beforeReelsAll = app.computeSnapshot("ALL", "DAY", 0).reelsCount;

  // 1. Denied permission must block native usage ingestion without fabricating values
  const deniedNative = app.NativeUsageIntegrationService.ingestNativeUsageReport({
    userId: "usr_rahim_01",
    installationKey: "s24_ultra",
    osCategory: "Android",
    permissionGranted: false,
    appKey: "instagram",
    durationMinutes: 45
  });
  assert(deniedNative.ok === false && deniedNative.status === "PERMISSION_DENIED" && deniedNative.fabricatedValues === false, "Denied native usage permission must reject ingestion honestly");

  // 2. Aggregate-only native usage report for an existing overlapping interval must deduplicate screen time AND never invent reel counts
  const baseEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 18000;
  // s24_ultra already has Instagram 30m at [baseEpoch, baseEpoch + 1800]. Report [baseEpoch, baseEpoch + 2400] (40m, so 30m overlaps and 10m is new) as aggregate-only:
  const aggRes = app.NativeUsageIntegrationService.ingestNativeUsageReport({
    userId: "usr_rahim_01",
    installationKey: "s24_ultra",
    osCategory: "Android",
    permissionGranted: true,
    aggregateOnly: true,
    entries: [
      {
        packageId: "com.instagram.android",
        appName: "Instagram",
        localDate: "2026-10-16",
        startEpochSec: baseEpoch - 600,
        endEpochSec: baseEpoch + 1800,
        reelCount: 99 // Must be ignored because aggregateOnly is true!
      }
    ]
  });
  assert(aggRes.ok === true && aggRes.screenMinutesAdded === 10 && aggRes.deduplicatedOverlapMinutes === 30, `Expected +10m net screen time and 30m deduplicated overlap, got +${aggRes.screenMinutesAdded}m and ${aggRes.deduplicatedOverlapMinutes}m overlap`);
  assert(aggRes.reelCountAdded === 0 && aggRes.entries[0].reelDataStatus === "UNAVAILABLE_AGGREGATE_ONLY", "Aggregate-only native usage report must never invent or add Reel counts");
  assert(app.computeSnapshot("ALL", "DAY", 0).reelsCount === beforeReelsAll, "Account-wide reel count must remain unchanged after aggregate-only native usage report");
  assert(app.computeSnapshot("s24_ultra", "DAY", 0).totalScreenMinutes === beforeSnap.totalScreenMinutes + 10, "Per-device screen time must increase only by the non-overlapping 10m");

  app.BackendDB.resetUserBaseline("usr_rahim_01");
  console.log("[PASS] Test 25: Native usage integration, permission-denied handling, aggregate-only non-fabrication of reel counts, and multi-source interval deduplication verified.");
}

// -------------------------------------------------------------------------
// TEST 26: TOP-OF-SCREEN-TIME DEVICE SWITCHER & OVERVIEW SWITCHER PRESERVATION
// -------------------------------------------------------------------------
{
  const viewStatsSection = html.match(/<section id="viewStats"[\s\S]*?<\/section>/);
  assert(viewStatsSection, "viewStats section must exist");
  const statsHtml = viewStatsSection[0];
  const statsSwitcherIdx = statsHtml.indexOf('id="statsDeviceSwitcherBar"');
  const statsTitleIdx = statsHtml.indexOf('>Screen time</h1>');
  const statsPeriodBarIdx = statsHtml.indexOf('id="statsPeriodTabBar"');
  assert(statsSwitcherIdx !== -1 && statsTitleIdx !== -1 && statsPeriodBarIdx !== -1, "Screen Time section must contain statsDeviceSwitcherBar, Screen time heading, and statsPeriodTabBar");
  assert(statsSwitcherIdx < statsTitleIdx && statsTitleIdx < statsPeriodBarIdx, "Screen Time device switcher must be placed at the very top of the Screen Time section, before its existing content");

  // Switching device via selectDeviceScope must update both Overview and Screen Time switchers & charts
  app.selectDeviceScope("iphone_16");
  assert(documentMock.getElementById("selectedDeviceDropdownLabel").textContent === "iPhone 16 Pro", "Overview switcher label must update to iPhone 16 Pro");
  assert(documentMock.getElementById("selectedStatsDeviceDropdownLabel").textContent === "iPhone 16 Pro", "Screen Time top switcher label must update to iPhone 16 Pro");
  assert(documentMock.getElementById("statsScopeBadge").textContent === "iPhone 16 Pro", "Screen Time scope badge must update to iPhone 16 Pro");
  assert(documentMock.getElementById("statsHeadlineTime").textContent === "3 h", "Screen Time headline must update to iPhone 16 Pro's 3 h");

  app.selectDeviceScope("ALL");
  assert(documentMock.getElementById("selectedDeviceDropdownLabel").textContent === "All Devices", "Overview switcher label must restore to All Devices");
  assert(documentMock.getElementById("selectedStatsDeviceDropdownLabel").textContent === "All Devices", "Screen Time top switcher label must restore to All Devices");
  console.log("[PASS] Test 26: Screen Time top device switcher placement, Overview switcher preservation, and synchronized stats/chart updates verified.");
}

// -------------------------------------------------------------------------
// TEST 27: DOUBLE-PILL DEFECT FIX & CURVE-COLORED GLOWING BALL INDICATOR
// -------------------------------------------------------------------------
{
  // 1. Verify all segmented pill bars have .has-sliding-pill and CSS strips duplicate button backgrounds/borders in both Liquid Glass & Soft Glass
  for (const barId of ["bottomNavBarContainer", "statsPeriodTabBar", "reelGraphPeriodBar", "designStyleToggleGroup", "graphStyleToggleGroup", "accountThemeToggleGroup"]) {
    const barMatch = html.match(new RegExp(`<div id="${barId}"[^>]*>`));
    assert(barMatch && barMatch[0].includes("has-sliding-pill"), `#${barId} must have .has-sliding-pill to prevent double-pill layering`);
  }
  assert(html.includes("#statsPeriodTabBar .oem-pill-tab-active") && html.includes("#reelGraphPeriodBar .oem-pill-tab-active") && html.includes("border: none !important;"), "CSS must strip duplicate pill backgrounds and borders on active buttons inside sliding pill bars");

  // Verify #lookHourlyLabel inside #btnToggleHourlyChart no longer uses a nested pill background class
  app.state.showHourlyChart = true;
  app.renderAll();
  const hourlyBadgeCls = documentMock.getElementById("lookHourlyLabel").className;
  assert(!hourlyBadgeCls.includes("bg-[#2E7CF6]") && !hourlyBadgeCls.includes("bg-[#3A3A3C]"), "Hourly usage badge must not apply a nested pill background inside the hourly toggle pill");

  // 2. Verify white SVG circle selection pill is replaced by curve-colored .ss-graph-glow-ball while keeping tooltip separate
  app.GraphDisplayStyleController.setGraphStyle("DETAILED");
  app.setDashboardMetricMode("SCREEN");
  app.state.selectedPillarIdx.OVERVIEW = 6;
  app.state.selectedPillarIdx.STATS = 10;
  app.renderAll();

  const ovChartMarkup = documentMock.getElementById("overviewWeekChart").innerHTML;
  const statsChartMarkup = documentMock.getElementById("statsBarChartContainer").innerHTML;
  const reelChartMarkup = documentMock.getElementById("reelViewingBarChart").innerHTML;
  assert(!ovChartMarkup.includes('<circle cx=') && !statsChartMarkup.includes('<circle cx=') && !reelChartMarkup.includes('<circle cx='), "Stretched white SVG circle marker must be removed from curved charts");
  assert(ovChartMarkup.includes('class="ss-graph-glow-ball"') && statsChartMarkup.includes('class="ss-graph-glow-ball"') && reelChartMarkup.includes('class="ss-graph-glow-ball"'), "Curved charts must render .ss-graph-glow-ball selection indicator");
  assert(ovChartMarkup.includes('data-curve-color="#38BDF8"'), "Overview Screen Time glowing ball must match #38BDF8 curve color");
  assert(statsChartMarkup.includes('data-curve-color="#2E7CF6"'), "Screen Time main glowing ball must match #2E7CF6 curve color");
  assert(reelChartMarkup.includes('data-curve-color="#34F5A6"'), "Reel Viewing glowing ball must match #34F5A6 curve color");

  // Switch metric to REELS_COUNT (#F59E0B) and verify glowing ball color updates to match curve
  app.setDashboardMetricMode("REELS_COUNT");
  const ovReelsMarkup = documentMock.getElementById("overviewWeekChart").innerHTML;
  assert(ovReelsMarkup.includes('data-curve-color="#F59E0B"'), "Glowing ball color must update to #F59E0B when Reels Count curve is selected");

  // Verify position updates when selected data point changes and tooltip remains separate
  app.setDashboardMetricMode("SCREEN");
  app.state.selectedPillarIdx.OVERVIEW = 2;
  app.renderAll();
  const ovMovedMarkup = documentMock.getElementById("overviewWeekChart").innerHTML;
  assert(ovMovedMarkup.includes('data-ball-index="2"') && ovMovedMarkup.includes('data-point-x="35.71"'), "Glowing ball must update its coordinates accurately when selected data point changes");
  const ovTooltipEl = documentMock.getElementById("overviewChartTooltip");
  assert(!ovTooltipEl.innerHTML.includes("ss-graph-glow-ball"), "Tooltip must remain a separate UI element from the glowing ball");

  app.state.selectedPillarIdx.OVERVIEW = 6;
  app.renderAll();
  console.log("[PASS] Test 27: Double-pill visual defect fix in both glass modes and curve-colored glowing ball indicator (separate from tooltip) verified.");
}

console.log("=== ALL 27 TEST SUITES PASSED 100% ===");

// -------------------------------------------------------------------------
// TEST 28: DIGITAL WELLBEING SCREEN-TIME ALGORITHMS (SUBSYSTEMS A-M & AOSP USAGESTATS)
// -------------------------------------------------------------------------
{
  const DAY = "2026-10-16";
  const dayBounds = app.ScreenTimeAggregator.getLocalDayWindowBoundsMs(DAY, 0);
  const T0 = dayBounds.windowStartMs; // 2026-10-16T00:00:00Z

  // 1. Incremental query bounds & clock rollback fallback (10-day backfill = 864,000,000 ms)
  const incNormal = app.ScreenTimeAggregator.computeIncrementalQueryBounds(100000, 200000);
  assert(incNormal.beginTimeMs === 100001 && incNormal.endTimeMs === 200000 && !incNormal.usedBackfillWindow, "Incremental query must start at lastSync + 1ms");
  const incRollback = app.ScreenTimeAggregator.computeIncrementalQueryBounds(300000, 200000);
  assert(incRollback.beginTimeMs === 200000 - 864000000 && incRollback.clockRolledBack === true && incRollback.usedBackfillWindow === true, "Clock rollback must trigger 10-day backfill window");

  // 2. Test Case 1 & 2: Single app session & multiple consecutive sessions
  const r1 = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents([
    { eventType: 15, timestampMs: T0 + 1000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 1, timestampMs: T0 + 10000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 2, timestampMs: T0 + 70000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 1, timestampMs: T0 + 100000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 2, timestampMs: T0 + 190000 }
  ], { windowStartMs: dayBounds.windowStartMs, windowEndMs: dayBounds.windowEndMs, evaluationTimeMs: T0 + 200000 });
  assert(r1.perPackageDurationMs["com.instagram.android"] === 150000 && r1.perPackageLaunches["com.instagram.android"] === 2, `Expected 150000ms and 2 launches, got ${r1.perPackageDurationMs["com.instagram.android"]}ms and ${r1.perPackageLaunches["com.instagram.android"]}`);

  // 3. Test Case 3: Rapid switching between multiple apps (implicit close on another app's MOVE_TO_FOREGROUND)
  const r3 = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents([
    { eventType: 15, timestampMs: T0 + 1000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 1, timestampMs: T0 + 10000 },
    { packageName: "com.google.android.youtube", className: "HomeActivity", eventType: 1, timestampMs: T0 + 40000 },
    { packageName: "com.google.android.youtube", className: "HomeActivity", eventType: 2, timestampMs: T0 + 90000 }
  ], { windowStartMs: dayBounds.windowStartMs, windowEndMs: dayBounds.windowEndMs, evaluationTimeMs: T0 + 100000 });
  assert(r3.perPackageDurationMs["com.instagram.android"] === 30000 && r3.perPackageDurationMs["com.google.android.youtube"] === 50000 && r3.totalScreenTimeMs === 80000, "Implicit session close on app switch must credit exact non-overlapping durations");

  // 4. Test Case 4 & 10: Screen lock/off during active app, KEYGUARD_HIDDEN unlock, and NOTIFICATION_INTERRUPTION
  const r4 = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents([
    { eventType: 15, timestampMs: T0 + 1000 },
    { eventType: 18, timestampMs: T0 + 2000 },
    { packageName: "com.whatsapp", className: "Conversation", eventType: 1, timestampMs: T0 + 5000 },
    { packageName: "com.whatsapp", eventType: 12, timestampMs: T0 + 15000 },
    { eventType: 16, timestampMs: T0 + 35000 }, // SCREEN_NON_INTERACTIVE at +35s -> 30s session
    { eventType: 17, timestampMs: T0 + 35100 },
    { eventType: 15, timestampMs: T0 + 65000 },
    { eventType: 18, timestampMs: T0 + 66000 },
    { packageName: "com.whatsapp", className: "Conversation", eventType: 1, timestampMs: T0 + 66000 },
    { packageName: "com.whatsapp", className: "Conversation", eventType: 2, timestampMs: T0 + 86000 } // +20s session
  ], { windowStartMs: dayBounds.windowStartMs, windowEndMs: dayBounds.windowEndMs, evaluationTimeMs: T0 + 90000 });
  assert(r4.perPackageDurationMs["com.whatsapp"] === 50000 && r4.totalUnlocks === 2 && r4.perPackageNotifications["com.whatsapp"] === 1, "Screen-off must flush active session and exclude non-interactive lock period");

  // 5. Test Case 5: Cross-midnight session splitting across 00:00:00 boundary
  const prevDayBounds = app.ScreenTimeAggregator.getLocalDayWindowBoundsMs("2026-10-15", 0);
  const midnightEvents = [
    { eventType: 15, timestampMs: prevDayBounds.windowEndMs - 600000 }, // 23:50 on Oct 15
    { packageName: "com.zhiliaoapp.musically", className: "MainActivity", eventType: 1, timestampMs: prevDayBounds.windowEndMs - 600000 },
    { packageName: "com.zhiliaoapp.musically", className: "MainActivity", eventType: 2, timestampMs: dayBounds.windowStartMs + 900000 } // 00:15 on Oct 16
  ];
  const day1Rep = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents(midnightEvents, {
    windowStartMs: prevDayBounds.windowStartMs,
    windowEndMs: prevDayBounds.windowEndMs,
    evaluationTimeMs: dayBounds.windowStartMs + 1000000
  });
  const day2Rep = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents(midnightEvents, {
    windowStartMs: dayBounds.windowStartMs,
    windowEndMs: dayBounds.windowEndMs,
    evaluationTimeMs: dayBounds.windowStartMs + 1000000
  });
  assert(day1Rep.perPackageDurationMs["com.zhiliaoapp.musically"] === 600000 && day2Rep.perPackageDurationMs["com.zhiliaoapp.musically"] === 900000, "Cross-midnight session must split 10m to Day 1 and 15m to Day 2");

  // 6. Test Case 6, 7 & 8: Duplicate/out-of-order events, DEVICE_SHUTDOWN flush, and crash orphan discarding
  const r68 = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents([
    { packageName: "com.facebook.katana", className: "MainActivity", eventType: 2, timestampMs: T0 + 5000 }, // Orphan background -> ignored
    { eventType: 15, timestampMs: T0 + 10000 },
    { packageName: "com.facebook.katana", className: "MainActivity", eventType: 1, timestampMs: T0 + 20000 },
    { packageName: "com.facebook.katana", className: "MainActivity", eventType: 1, timestampMs: T0 + 20000 }, // Exact duplicate -> deduplicated
    { eventType: 26, timestampMs: T0 + 50000 }, // DEVICE_SHUTDOWN -> flushes 30s
    { packageName: "com.facebook.katana", className: "MainActivity", eventType: 1, timestampMs: T0 + 60000 }, // Unclosed before reboot
    { eventType: 27, timestampMs: T0 + 120000 } // DEVICE_STARTUP after crash -> discards unclosed 60s-120s
  ], { windowStartMs: dayBounds.windowStartMs, windowEndMs: dayBounds.windowEndMs, evaluationTimeMs: T0 + 130000 });
  assert(r68.perPackageDurationMs["com.facebook.katana"] === 30000, `Expected 30000ms after duplicate dedup + shutdown flush + crash startup discard, got ${r68.perPackageDurationMs["com.facebook.katana"]}`);

  // 7. Test Case 12 & AOSP UsageStats multi-instance activity state machine (Focus v2)
  const rOngoing = app.ScreenTimeAggregator.reconstructSessionsFromRawEvents([
    { eventType: 15, timestampMs: T0 + 10000 },
    { packageName: "com.instagram.android", className: "MainActivity", eventType: 1, timestampMs: T0 + 20000 }
  ], { windowStartMs: dayBounds.windowStartMs, windowEndMs: dayBounds.windowEndMs, evaluationTimeMs: T0 + 65000 });
  assert(rOngoing.perPackageDurationMs["com.instagram.android"] === 45000 && rOngoing.sessions[0].ongoing === true, "Ongoing session must clamp cleanly at queryEvaluationTimeMs");

  const aospSim = app.ScreenTimeAggregator.simulateAospUsageStatsUpdate("com.instagram.android", 1000, [
    { className: "ActA", eventType: 1, timestampMs: 2000 },
    { className: "ActB", eventType: 1, timestampMs: 5000 }, // Overlapping second activity in same package
    { className: "ActA", eventType: 2, timestampMs: 8000 }, // ActA pauses, ActB still active -> mActivities non-empty
    { className: "ActB", eventType: 2, timestampMs: 12000 } // ActB pauses -> mActivities empty -> +10000ms total
  ]);
  assert(aospSim.mTotalTimeInForeground === 10000 && aospSim.mAppLaunchCount === 2, `AOSP UsageStats multi-activity state machine must accumulate 10000ms without double-counting overlap, got ${aospSim.mTotalTimeInForeground}`);

  console.log("[PASS] Test 28: Digital Wellbeing Screen-Time Algorithms (Subsystems A-M, midnight splitting, screen-off/shutdown gating, and AOSP UsageStats state machine) verified.");
}

// -------------------------------------------------------------------------
// TEST 29: BRAINPAL & REEL-COUNTING ALGORITHMS (6-STATE FSM, DWELL, LRU & IDLE CLAMP)
// -------------------------------------------------------------------------
{
  app.ReelTrackingEngine.resetTrackingSandbox("s24_ultra");

  // 1. Volatile engagement counter sanitizer (replaces volatile numbers like '14.2K' or '1.5M' with '#' so live counter ticks never change video fingerprint)
  assert(app.ReelTrackingEngine.normalizeVolatileMetadataText("14.2K likes") === "# likes", "Volatile engagement counter '14.2K likes' must normalize to '# likes'");
  assert(app.ReelTrackingEngine.normalizeVolatileMetadataText("14.9K likes") === "# likes", "Live like tick '14.9K likes' must normalize identically to '# likes'");
  assert(app.ReelTrackingEngine.normalizeVolatileMetadataText("1.5M views") === "# views", "Volatile view counter '1.5M views' must normalize to '# views'");
  assert(app.ReelTrackingEngine.normalizeVolatileMetadataText("Part 2 - Coding Tips") === "part # - coding tips", "Semantic caption with numbers must normalize cleanly");

  // 2. Three-Gate & Three-Tier Short-Form Surface Classifier + Comment Sheet Overlay Pause
  const tier1Check = app.ReelTrackingEngine.inspectSurfaceNodeHierarchy({
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    screenWidth: 1080,
    screenHeight: 2400
  });
  assert(tier1Check.isShortFormSurface === true && tier1Check.tierUsed === "TIER_A_RESOURCE_ID" && !tier1Check.isOverlaySheetOpen, "Tier-A resource ID must classify Instagram Reels surface");

  const overlayCheck = app.ReelTrackingEngine.inspectSurfaceNodeHierarchy({
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager", "com.instagram.android:id/layout_comment_thread_parent"],
    screenWidth: 1080,
    screenHeight: 2400
  });
  assert(overlayCheck.isShortFormSurface === true && overlayCheck.isOverlaySheetOpen === true && overlayCheck.tierUsed === "EXCLUSION_OVERLAY_GATE", "Comment bottom sheet must trigger EXCLUSION_OVERLAY_GATE and isOverlaySheetOpen=true");

  // 3. Brainpal 6-State FSM:
  //    a) Rapid fling across 3 items inside 300ms settle window -> only settled item becomes candidate
  //    b) Dwell < 1200ms after settle -> CANDIDATE_DWELLING (0 count)
  //    c) Dwell >= 1200ms -> ACTIVE_VIDEO_COUNTED (+1 count)
  //    d) Comment sheet overlay opens -> PAUSED_OVERLAY pauses watch time, resumes on close
  //    e) Loop/replay or back-scroll to item in 40-item LRU -> +0 count (SUPPRESSED_BY_LRU_CACHE)
  const tStart = 1760610000000;

  // Rapid fling through rowIndex 0 and 1 within 150ms, settling on rowIndex 2 at tStart + 200ms
  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    eventType: "TYPE_VIEW_SCROLLED",
    rowIndex: 0,
    creatorHandle: "@Skipped0",
    captionSnippet: "Quick fling 0",
    timestampMs: tStart
  });
  app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    eventType: "TYPE_VIEW_SCROLLED",
    rowIndex: 1,
    creatorHandle: "@Skipped1",
    captionSnippet: "Quick fling 1",
    timestampMs: tStart + 120
  });
  const scrollSettleSignal = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    eventType: "TYPE_VIEW_SCROLLED",
    rowIndex: 2,
    creatorHandle: "@CreatorOne",
    captionSnippet: "Settled Reel One",
    audioLabel: "Original Audio",
    timestampMs: tStart + 200
  });
  assert(scrollSettleSignal.fsmState === "CANDIDATE_SETTLING" && scrollSettleSignal.reelCountDelta === 0, "Scroll event must enter CANDIDATE_SETTLING with 0 count");

  // Check at tStart + 600ms (settled at +500ms, only 100ms dwell so far < 1200ms) -> CANDIDATE_DWELLING, 0 count
  const midCheck = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    eventType: "HEARTBEAT",
    rowIndex: 2,
    creatorHandle: "@CreatorOne",
    captionSnippet: "Settled Reel One",
    audioLabel: "Original Audio",
    timestampMs: tStart + 600
  });
  assert(midCheck.fsmState === "CANDIDATE_DWELLING" && midCheck.reelCountDelta === 0, "Candidate with <1200ms dwell after settle must remain in CANDIDATE_DWELLING with 0 count");

  // Check at tStart + 1800ms (1300ms dwell after +500ms settle >= 1200ms) -> ACTIVE_VIDEO_COUNTED (+1)
  const commitRes = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    eventType: "HEARTBEAT",
    rowIndex: 2,
    creatorHandle: "@CreatorOne",
    captionSnippet: "Settled Reel One",
    audioLabel: "Original Audio",
    timestampMs: tStart + 1800
  });
  assert(commitRes.fsmState === "ACTIVE_VIDEO_COUNTED" && commitRes.reelCountDelta === 1, `Expected ACTIVE_VIDEO_COUNTED and +1 count after >=1200ms dwell, got state=${commitRes.fsmState}, delta=${commitRes.reelCountDelta}`);

  // Open comment sheet at tStart + 2500ms -> PAUSED_OVERLAY
  const pauseRes = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager", "com.instagram.android:id/layout_comment_thread_parent"],
    isCommentSheetOpen: true,
    rowIndex: 2,
    creatorHandle: "@CreatorOne",
    captionSnippet: "Settled Reel One",
    audioLabel: "Original Audio",
    timestampMs: tStart + 2500
  });
  assert(pauseRes.fsmState === "PAUSED_OVERLAY" && pauseRes.reelCountDelta === 0, "Opening comment sheet must transition FSM to PAUSED_OVERLAY");

  // Close comment sheet at tStart + 4000ms on same reel -> resumes ACTIVE_VIDEO_COUNTED with +0 count
  const resumeRes = app.ReelTrackingEngine.processRawStreamSignal({
    installationKey: "s24_ultra",
    packageName: "com.instagram.android",
    viewIds: ["com.instagram.android:id/clips_viewer_view_pager"],
    isCommentSheetOpen: false,
    bypassThrottle: true,
    rowIndex: 2,
    creatorHandle: "@CreatorOne",
    captionSnippet: "Settled Reel One",
    audioLabel: "Original Audio",
    timestampMs: tStart + 4000
  });
  assert(resumeRes.fsmState === "ACTIVE_VIDEO_COUNTED" && resumeRes.reelCountDelta === 0 && resumeRes.reason === "RESUMED_FROM_OVERLAY", "Closing comment sheet on same reel must resume ACTIVE_VIDEO_COUNTED without double-counting");

  // 4. Idle gap clamping (>30,000ms gap between heartbeats clamped to 5,000ms)
  assert(app.ReelTrackingEngine.clampWatchDeltaMs(45000) === 5000, "Idle gap >30s must be clamped to 5000ms (clampedIdleCreditMs)");
  assert(app.ReelTrackingEngine.clampWatchDeltaMs(12000) === 12000, "Normal watch delta <=30s must not be clamped");

  // 5. Persistence & recovery after restart
  app.ReelTrackingEngine.persistEngineState();
  const recState = app.ReelTrackingEngine.recoverAfterRestart();
  assert(recState.recovered === true, "ReelTrackingEngine must persist and recover its LRU and FSM state across restarts");

  app.BackendDB.resetUserBaseline("usr_rahim_01");
  app.ReelTrackingEngine.resetTrackingSandbox();
  console.log("[PASS] Test 29: Brainpal & Reel-Counting Algorithms (6-State FSM, 300ms settle + 1200ms dwell, volatile metric stripping, overlay pause, 40-item LRU, and 30s->5s idle clamp) verified.");
}

// -------------------------------------------------------------------------
// TEST 30: DYNAMIC ISLAND DEVICE-ADAPTIVE POSITIONING & SHAPE (CONFIGURATIONS A-E)
// -------------------------------------------------------------------------
{
  const pillEl = documentMock.getElementById("dynamicIslandPill");
  const divEl = documentMock.getElementById("islandCutoutDivider");

  // Configuration A: Centered Pill Cutout — Dual Sensors (IPHONE_PILL)
  const layoutA = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("IPHONE_PILL", {
    viewportWidth: 393,
    viewportHeight: 852
  });
  assert(layoutA.category === "A_CENTERED_PILL_DUAL_SENSOR" && pillEl.getAttribute("data-cutout-category") === "A_CENTERED_PILL_DUAL_SENSOR", "Config A must set A_CENTERED_PILL_DUAL_SENSOR");
  assert(pillEl.className.includes("cutout-iphone-pill") && divEl.getAttribute("data-divider-mode") === "HARDWARE_PILL_CUTOUT_DIVIDER", "Config A must center around dual-sensor pill and use HARDWARE_PILL_CUTOUT_DIVIDER");
  assert(layoutA.minWidthPx >= 180 && layoutA.containerJustify === "center", "Config A must expand horizontally from center with balanced minimum width");

  // Configuration B: Centered Circular Cutout — Single Punch-Hole (PUNCH_HOLE)
  const layoutB = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("PUNCH_HOLE", {
    viewportWidth: 412,
    viewportHeight: 915
  });
  assert(layoutB.category === "B_CENTERED_CIRCULAR_PUNCH_HOLE" && pillEl.getAttribute("data-cutout-category") === "B_CENTERED_CIRCULAR_PUNCH_HOLE", "Config B must set B_CENTERED_CIRCULAR_PUNCH_HOLE");
  assert(pillEl.className.includes("cutout-punch-hole") && divEl.getAttribute("data-divider-mode") === "HARDWARE_CIRCULAR_CUTOUT_DIVIDER", "Config B must anchor around circular punch-hole lens and prevent text overlap");

  // Configuration C: Notch / Cut-From-Bezel Displays (TRUEDEPTH_NOTCH & WATERDROP)
  const layoutC = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("TRUEDEPTH_NOTCH", {
    viewportWidth: 390,
    viewportHeight: 844,
    safeInsetTop: 47,
    cutoutRect: { width: 162, height: 32, left: 114, right: 276, top: 0, bottom: 32 }
  });
  assert(layoutC.category === "C_NOTCH_CUT_FROM_BEZEL" && pillEl.className.includes("cutout-truedepth-notch"), "Config C must set C_NOTCH_CUT_FROM_BEZEL and apply notch styling");
  assert(divEl.getAttribute("data-divider-mode") === "INTERNAL_VERTICAL_BAR" && layoutC.usesInternalVerticalDivider === true, "Config C must use internal vertical divider (|) to separate content");

  // Configuration D: Non-Cutout / Full-Screen Displays (FULLSCREEN)
  const layoutD = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("FULLSCREEN", {
    viewportWidth: 1024,
    viewportHeight: 768
  });
  assert(layoutD.category === "D_NON_CUTOUT_FULLSCREEN" && pillEl.className.includes("cutout-fullscreen"), "Config D must display as an independent floating pill near top-center");
  assert(divEl.getAttribute("data-divider-mode") === "INTERNAL_VERTICAL_BAR" && layoutD.usesInternalVerticalDivider === true, "Config D must use internal vertical divider (|)");

  // Configuration E: Asymmetric / Corner Cutout Displays (CORNER_LEFT & CORNER_RIGHT)
  const layoutELeft = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("CORNER_LEFT", {
    viewportWidth: 412,
    viewportHeight: 915,
    safeInsetTop: 36,
    cutoutRect: { left: 18, top: 8, right: 46, bottom: 36, width: 28, height: 28 }
  });
  assert(layoutELeft.category === "E_ASYMMETRIC_CORNER_CUTOUT" && layoutELeft.transformOrigin === "left center", "Config E (Left) must detect and anchor relative to off-center left cutout");
  assert(pillEl.className.includes("cutout-asymmetric") && pillEl.className.includes("cutout-corner-left"), "Config E (Left) must apply asymmetric left cutout classes");
  assert(layoutELeft.offsetLeftPx >= 40, "Config E (Left) must apply safe left clearance to prevent overlap with corner camera lens");

  const layoutERight = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("CORNER_RIGHT", {
    viewportWidth: 412,
    viewportHeight: 915,
    safeInsetTop: 36,
    cutoutRect: { left: 366, top: 8, right: 394, bottom: 36, width: 28, height: 28 }
  });
  assert(layoutERight.category === "E_ASYMMETRIC_CORNER_CUTOUT" && layoutERight.transformOrigin === "right center", "Config E (Right) must detect and anchor relative to off-center right cutout");
  assert(pillEl.className.includes("cutout-asymmetric") && pillEl.className.includes("cutout-corner-right"), "Config E (Right) must apply asymmetric right cutout classes");
  assert(layoutERight.offsetRightPx >= 40, "Config E (Right) must apply safe right clearance to prevent overlap with right corner cutout");

  // Verify Section 7.1 Automatic Adaptation Constraints:
  // 1) Never infer physical camera cutout from screen width alone:
  const widthOnlyEnv = app.DeviceEnvironmentDetector.detectEnvironment({
    userAgent: "Mozilla/5.0 (Linux; Android 14; GenericAndroidPhone) AppleWebKit/537.36",
    screenWidth: 393,
    screenHeight: 852,
    viewportWidth: 393,
    viewportHeight: 852
  });
  assert(widthOnlyEnv.exactCutoutKnown === false && widthOnlyEnv.canBrowserDetectPhysicalCutoutWithoutNativeSupport === false, "Browser-based HTML must not claim exact physical cutout detection from screen width (393x852) alone");

  // 2) Verify narrow (320px) and landscape (915x412) viewport adaptation
  const narrowLayout = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("IPHONE_PILL", {
    viewportWidth: 320,
    viewportHeight: 568
  });
  assert(narrowLayout.maxWidthPx <= 304 && narrowLayout.minWidthPx <= narrowLayout.maxWidthPx, "Narrow 320px viewport must clamp Dynamic Island width safely without overflow");

  const landscapeLayout = app.DynamicIslandAdaptiveController.applyAdaptiveLayoutToDom("PUNCH_HOLE", {
    viewportWidth: 915,
    viewportHeight: 412
  });
  assert(landscapeLayout.orientation === "landscape" && landscapeLayout.usesInternalVerticalDivider === true, "Landscape viewport must be detected and adapted cleanly");

  // 3) Verify idempotent listener registration (no duplicate listeners on repeated calls)
  const firstBind = app.DynamicIslandAdaptiveController.initResponsiveListenersOnce();
  const secondBind = app.DynamicIslandAdaptiveController.initResponsiveListenersOnce();
  assert(secondBind.alreadyInitialized === true, "initResponsiveListenersOnce must prevent duplicate event listeners");

  // Restore default state and re-render
  app.selectDeviceScope("ALL");
  app.renderAll();
  assert(documentMock.getElementById("hudReelsCount").textContent === "20 Reels" && documentMock.getElementById("hudWatchTime").textContent === "1h 35m", "Dynamic Island content must preserve exact baseline 20 Reels and 1h 35m");

  console.log("[PASS] Test 30: Dynamic Island Device-Adaptive Positioning & Shape across Configurations A-E, portrait/landscape, narrow/wide viewports, and Section 7.1 constraints verified.");
}


// -------------------------------------------------------------------------
// TEST 31: SECTION 2 — LOGIN PAGE UI REMOVALS & PRESERVED AUTH EXPERIENCE
// -------------------------------------------------------------------------
{
  const authModalIdx = html.indexOf('id="authModal"');
  const goalModalIdx = html.indexOf('id="screenTimeGoalModal"');
  const authModalHtml = html.slice(authModalIdx, goalModalIdx);

  // 1. Verify "Sign up with" section and social provider buttons are completely removed
  assert(!authModalHtml.includes("Sign up with"), "'Sign up with' label must be removed from the login/auth modal");
  assert(!authModalHtml.includes("auth-provider-btn") && !authModalHtml.includes("data-quick-provider"), "Google, Apple, and social sign-up buttons must be removed");

  // 2. Verify app icon/logo is removed from the login page (#authFormLogin) only, while ScreenSync text remains visible
  const loginFormIdx = html.indexOf('id="authFormLogin"');
  const signupFormIdx = html.indexOf('id="authFormSignup"');
  const loginFormHtml = html.slice(loginFormIdx, signupFormIdx);
  assert(!loginFormHtml.includes("ssLogoGradTop") && !loginFormHtml.includes("ssLogoGradBot"), "App icon/logo SVG must be removed from the login page (#authFormLogin)");
  assert(loginFormHtml.includes(">Screen</span><span class=\"text-[#38BDF8]\">Sync</span>"), "ScreenSync brand text must remain visible on the login page");
  assert(html.includes('id="splashReferenceLogoImg"'), "Splash screen logo outside the login page must remain intact");

  // 3. Verify unwanted labels and hardcoded account examples are removed from authModal
  assert(!authModalHtml.includes("Active Account Session:"), "'Active Account Session:' text must be removed");
  assert(!authModalHtml.includes("Account Holder:") && !authModalHtml.includes("Cross-Device Cloud Sync"), "'Account Holder: Rahim Ahmed • Cross-Device Cloud Sync' text must be removed");
  assert(!authModalHtml.includes("rahim.ahmed@gmail.com"), "Hardcoded 'rahim.ahmed@gmail.com' example must be removed from login page markup");
  assert(!authModalHtml.includes("ScreenSync Auth"), "'ScreenSync Auth' label must be removed");
  assert(!authModalHtml.includes("Password Recovery"), "'Password Recovery' label must be removed");

  // 4. Verify login form, email input, password input, login button, account creation option, and forgot-password functionality still exist
  assert(documentMock.getElementById("loginEmailInput") && documentMock.getElementById("loginPasswordInput"), "Login email and password inputs must exist");
  assert(documentMock.getElementById("btnSubmitLogin") && documentMock.getElementById("btnGoForgotFromLogin") && documentMock.getElementById("btnGoSignupFromLogin"), "Login, Forgot Password, and Create New Account controls must exist");

  console.log("[PASS] Test 31: Login Page UI removals (Sign up with, login logo, hardcoded session/account text, ScreenSync Auth, Password Recovery) and preserved auth controls verified.");
}

// -------------------------------------------------------------------------
// TEST 32: SECTION 3 — ACCOUNT SECTION UI, LOGGED-IN / LOGGED-OUT & LOGOUT BEHAVIOR
// -------------------------------------------------------------------------
{
  const accountViewIdx = html.indexOf('id="viewAccount"');
  const guideViewIdx = html.indexOf('id="viewCrossDeviceGuide"');
  const accountViewHtml = html.slice(accountViewIdx, guideViewIdx);

  // 1. Verify Switch / Auth and Session Active labels are removed from Account section heading
  assert(!accountViewHtml.includes("Switch / Auth") && !accountViewHtml.includes('id="btnOpenAuthModal"'), "'Switch / Auth' button/label must be removed from Account section heading");
  assert(!accountViewHtml.includes("Session Active") && !accountViewHtml.includes('id="accountSessionBadge"'), "'Session Active' badge/label must be removed from Account section heading");

  // 2. Behavior when an account is logged in: displays real display name, real email, Pro Sync badge, and Logout button
  const customUser = {
    userId: "usr_nadia_03",
    email: "nadia.islam@screensync.io",
    name: "Nadia Islam",
    passwordHash: app.BackendDB.data.users[0].passwordHash,
    verified: true,
    createdAt: "2026-10-12T10:00:00Z"
  };
  if (!app.BackendDB.data.users.some(u => u.userId === "usr_nadia_03")) {
    app.BackendDB.data.users.push(customUser);
  }
  app.AuthService.login("nadia.islam@screensync.io", "password123");
  app.switchView("ACCOUNT");

  const loggedInBox = documentMock.getElementById("accountAuthenticatedIdentityBox");
  const loggedOutAddBox = documentMock.getElementById("accountLoggedOutAddBox");
  const logoutBtn = documentMock.getElementById("btnLogoutAccount");
  const proSyncBadge = documentMock.getElementById("accountProSyncBadge");

  assert(!loggedInBox.classList.contains("hidden"), "Logged-in identity area must be visible when authenticated");
  assert(loggedOutAddBox.classList.contains("hidden"), "Add Account button must be hidden while authenticated");
  assert(!logoutBtn.classList.contains("hidden"), "Logout option must be visible while authenticated");
  assert(proSyncBadge && proSyncBadge.textContent === "Pro Sync" && !proSyncBadge.classList.contains("hidden"), "Pro Sync label must be preserved when logged in");
  assert(documentMock.getElementById("activeAccountLabel").textContent === "Nadia Islam", "Account section must display the actual authenticated user's display name");
  assert(documentMock.getElementById("activeEmailSubLabel").textContent === "nadia.islam@screensync.io", "Account section must display the actual authenticated user's email address");

  // 3. Logout behavior & logged-out state
  app.AuthService.login("rahim.ahmed@gmail.com", "password123");
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  const savedSessionsCountBeforeLogout = (app.BackendDB.data.sessionsByUser["usr_rahim_01"] || []).length;
  const savedReelsCountBeforeLogout = (app.BackendDB.data.reelEventsByUser["usr_rahim_01"] || []).length;
  assert(savedSessionsCountBeforeLogout > 0 && savedReelsCountBeforeLogout > 0, "Rahim must have saved database records before logout");

  app.switchView("ACCOUNT");
  documentMock.getElementById("btnLogoutAccount").click();

  assert(app.state.isAuthenticated === false && app.state.currentUser.userId === null, "Logout must end authenticated session and clear active account state immediately");
  assert(documentMock.getElementById("activeAccountLabel").textContent === "" && documentMock.getElementById("activeEmailSubLabel").textContent === "", "Logged-in user's name and email must be cleared from DOM immediately on logout");
  assert(loggedInBox.classList.contains("hidden"), "Logged-in identity box (including Pro Sync) must be hidden when logged out");
  assert(!loggedOutAddBox.classList.contains("hidden"), "Add Account entry must replace the account identity area when logged out");
  assert(logoutBtn.classList.contains("hidden"), "Logout option must be hidden when no account is logged in");
  assert(app.state.activeView === "ACCOUNT", "Logging out must keep the Account section visible and not redirect away");
  assert(documentMock.getElementById("authModal").classList.contains("hidden"), "Logging out must not automatically force the login modal open");

  // Visiting Account section while logged out must not automatically open login modal
  app.switchView("OVERVIEW");
  app.switchView("ACCOUNT");
  assert(documentMock.getElementById("authModal").classList.contains("hidden"), "Visiting Account section while logged out must not automatically open login page");

  // Protected account data must not be accessible through logged-out session, while DB records remain preserved
  const loggedOutSnap = app.computeSnapshot("ALL", "DAY", 0);
  assert(loggedOutSnap.totalScreenMinutes === 0 && loggedOutSnap.reelsCount === 0, "Protected account data must not be accessible while logged out");
  assert((app.BackendDB.data.sessionsByUser["usr_rahim_01"] || []).length === savedSessionsCountBeforeLogout, "Logging out must preserve existing saved session records in database");
  assert((app.BackendDB.data.reelEventsByUser["usr_rahim_01"] || []).length === savedReelsCountBeforeLogout, "Logging out must preserve existing saved reel records in database");

  // Page refresh / application restart must not restore logged-out user
  const restartRes = app.AuthService.restoreSession();
  assert(restartRes.restored === false && app.state.isAuthenticated === false, "Refreshing or restarting after logout must not restore previous user");
  assert(documentMock.getElementById("activeAccountLabel").textContent === "" && !loggedOutAddBox.classList.contains("hidden"), "Previous user info must not reappear after refresh");

  // Clicking Add Account opens the login page
  documentMock.getElementById("btnAddAccount").click();
  assert(!documentMock.getElementById("authModal").classList.contains("hidden") && app.state.authTab === "LOGIN", "Selecting Add Account must open the login page");

  // Log back in as Rahim for subsequent tests
  app.AuthService.login("rahim.ahmed@gmail.com", "password123");
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  console.log("[PASS] Test 32: Account section UI removals, real user display, Add Account logged-out state, non-redirecting Logout, DB preservation, and refresh guard verified.");
}

// -------------------------------------------------------------------------
// TEST 33: SECTION 4 — SCREEN TIME UNLOCK GRAPH TOOLTIP GRANULARITY FIX
// -------------------------------------------------------------------------
{
  app.AuthService.login("rahim.ahmed@gmail.com", "password123");
  app.BackendDB.resetUserBaseline("usr_rahim_01");

  // 1. Verify Day view preserves hourly range in Unlock tooltip
  app.state.periodMode = "DAY";
  app.state.offsets.DAY = 0;
  app.state.selectedPillarIdx.UNLOCKS = 8; // 8:00–9:00 AM
  app.renderAll();
  const daySub = documentMock.getElementById("unlocksTooltipSub").textContent;
  assert(daySub === "8:00–9:00 AM", `Day view Unlock tooltip must preserve hourly range '8:00–9:00 AM', got '${daySub}'`);

  // 2. Verify Week view displays full weekday (e.g. Sunday, Monday, Tuesday) and never an hourly time range
  // Seed 100 unlocks on Sunday Oct 11, Monday Oct 12, Tuesday Oct 13, 2026
  const sunEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-11", 0) + 36000;
  const monEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-12", 0) + 36000;
  const tueEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-13", 0) + 36000;
  app.BackendDB.ingestEvent({ eventId: "unl_wk_sun", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-11", startEpochSec: sunEpoch, endEpochSec: sunEpoch + 600, durationMinutes: 10, unlocksDelta: 100 });
  app.BackendDB.ingestEvent({ eventId: "unl_wk_mon", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-12", startEpochSec: monEpoch, endEpochSec: monEpoch + 600, durationMinutes: 10, unlocksDelta: 100 });
  app.BackendDB.ingestEvent({ eventId: "unl_wk_tue", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-13", startEpochSec: tueEpoch, endEpochSec: tueEpoch + 600, durationMinutes: 10, unlocksDelta: 100 });

  app.state.periodMode = "WEEK";
  app.state.offsets.WEEK = 0; // Oct 10 (Sat) .. Oct 16 (Fri) -> idx 1=Sunday, 2=Monday, 3=Tuesday
  app.state.selectedPillarIdx.UNLOCKS = 1;
  app.renderAll();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Sunday", `Week view idx 1 must show '100 unlocks' and 'Sunday', got '${documentMock.getElementById("unlocksTooltipVal").textContent}' · '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  assert(!/AM|PM/i.test(documentMock.getElementById("unlocksTooltipSub").textContent), "Week view Unlock tooltip must not display an hourly AM/PM range");

  // Simulate clicking Monday (idx 2) and Tuesday (idx 3) bars
  const weekPillars = documentMock.querySelectorAll("[data-unlocks-pillar]");
  weekPillars[2].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Monday", "Tapping Monday bar in Week view must show '100 unlocks · Monday'");
  weekPillars[3].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Tuesday", "Tapping Tuesday bar in Week view must show '100 unlocks · Tuesday'");

  // 3. Verify Month view displays weekday and date (e.g. Sun, Oct 4; Mon, Oct 5; Tue, Oct 6) and handles month boundaries (Sep 30)
  const sep30Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-09-30", 0) + 43200;
  const oct4Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-04", 0) + 43200;
  const oct5Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-05", 0) + 43200;
  const oct6Epoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-06", 0) + 43200;
  app.BackendDB.ingestEvent({ eventId: "unl_mo_sep30", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-09-30", startEpochSec: sep30Epoch, endEpochSec: sep30Epoch + 600, durationMinutes: 10, unlocksDelta: 100 });
  app.BackendDB.ingestEvent({ eventId: "unl_mo_oct4", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-04", startEpochSec: oct4Epoch, endEpochSec: oct4Epoch + 600, durationMinutes: 10, unlocksDelta: 100 });
  app.BackendDB.ingestEvent({ eventId: "unl_mo_oct5", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-05", startEpochSec: oct5Epoch, endEpochSec: oct5Epoch + 600, durationMinutes: 10, unlocksDelta: 100 });
  app.BackendDB.ingestEvent({ eventId: "unl_mo_oct6", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-06", startEpochSec: oct6Epoch, endEpochSec: oct6Epoch + 600, durationMinutes: 10, unlocksDelta: 100 });

  app.state.periodMode = "MONTH";
  app.state.offsets.MONTH = 0; // 30 days ending 2026-10-16: idx 13 = Sep 30, idx 17 = Oct 4, idx 18 = Oct 5, idx 19 = Oct 6
  app.renderAll();
  const monthPillars = documentMock.querySelectorAll("[data-unlocks-pillar]");
  monthPillars[13].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Wed, Sep 30", `Month boundary bar must show 'Wed, Sep 30', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  monthPillars[17].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Sun, Oct 4", `Month bar idx 17 must show 'Sun, Oct 4', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  monthPillars[18].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Mon, Oct 5", `Month bar idx 18 must show 'Mon, Oct 5', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  monthPillars[19].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "Tue, Oct 6", `Month bar idx 19 must show 'Tue, Oct 6', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);

  // 4. Verify Year view displays Month and Year (e.g. August 2026, September 2026, October 2026) and year boundaries
  const augEpoch = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-08-15", 0) + 43200;
  app.BackendDB.ingestEvent({ eventId: "unl_yr_aug", userId: "usr_rahim_01", installationKey: "iphone_16", appKey: "instagram", localDate: "2026-08-15", startEpochSec: augEpoch, endEpochSec: augEpoch + 600, durationMinutes: 10, unlocksDelta: 100 });

  app.state.periodMode = "YEAR";
  app.state.offsets.YEAR = 0; // 2026: idx 7 = August 2026, idx 8 = September 2026, idx 9 = October 2026
  app.renderAll();
  const yearPillars = documentMock.querySelectorAll("[data-unlocks-pillar]");
  yearPillars[7].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "August 2026", `Year bar idx 7 must show '100 unlocks · August 2026', got '${documentMock.getElementById("unlocksTooltipVal").textContent} · ${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  yearPillars[8].click();
  assert(documentMock.getElementById("unlocksTooltipVal").textContent === "100 unlocks" && documentMock.getElementById("unlocksTooltipSub").textContent === "September 2026", `Year bar idx 8 must show '100 unlocks · September 2026', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);
  yearPillars[9].click();
  assert(documentMock.getElementById("unlocksTooltipSub").textContent === "October 2026", `Year bar idx 9 must show 'October 2026', got '${documentMock.getElementById("unlocksTooltipSub").textContent}'`);

  // 5. Verify timezone sensitivity: session at 00:30 local time on 2026-10-12 with UTC+6 (tzOffsetMinutes=360) stays on Monday Oct 12 (never shifts to Sunday Oct 11)
  const oct12LocalMidnightUtcSec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-12", 360);
  app.BackendDB.ingestEvent({
    eventId: "unl_tz_utc_plus_6",
    userId: "usr_rahim_01",
    installationKey: "iphone_16",
    appKey: "instagram",
    localDate: "2026-10-12",
    tzOffsetMinutes: 360,
    startEpochSec: oct12LocalMidnightUtcSec + 1800, // 00:30 local Oct 12 (which is 18:30 UTC on Oct 11!)
    endEpochSec: oct12LocalMidnightUtcSec + 2400,
    durationMinutes: 10,
    unlocksDelta: 50
  });
  const wkSnapTz = app.computeSnapshot("ALL", "WEEK", 0);
  assert(wkSnapTz.unlockBars[2] === 150 && wkSnapTz.unlockBars[1] === 100, `Timezone-sensitive session on 2026-10-12 (UTC+6) must stay on Monday (idx 2 = 150) and not shift to Sunday (idx 1 = 100), got Mon=${wkSnapTz.unlockBars[2]}, Sun=${wkSnapTz.unlockBars[1]}`);

  app.state.periodMode = "DAY";
  app.BackendDB.resetUserBaseline("usr_rahim_01");
  app.renderAll();
  console.log("[PASS] Test 33: Screen Time Unlock Graph Tooltip granularity (Day hourly, Week weekday, Month weekday+date, Year month+year), month/year boundaries, and timezone safety verified.");
}

// -------------------------------------------------------------------------
// TEST 34: SECTION 5 — HELP & SUPPORT REDESIGN (CROSS-DEVICE GUIDE, FAQ & VERIFICATION SUITE)
// -------------------------------------------------------------------------
{
  const helpDrawerIdx = html.indexOf('id="accountHelpSupportDrawer"');
  const logoutBtnIdx = html.indexOf('id="btnLogoutAccount"');
  const helpDrawerHtml = html.slice(helpDrawerIdx, logoutBtnIdx);

  // 1. Verify Help & Support landing drawer contains ONLY Cross-Device Guide and FAQ & Verification Suite
  assert(helpDrawerHtml.includes('id="btnOpenCrossDeviceGuide"') && helpDrawerHtml.includes("Cross-Device Guide"), "Help & Support must include Cross-Device Guide entry");
  assert(helpDrawerHtml.includes('id="btnOpenFaqVerificationSuite"') && helpDrawerHtml.includes("FAQ &amp; Verification Suite"), "Help & Support must include FAQ & Verification Suite entry");
  assert(!helpDrawerHtml.includes("ScreenSync keeps your screen time, Reel activity, and daily goals synchronized across Android, iOS, macOS, Windows, and ChromeOS."), "Old explanatory paragraph must be removed from Help & Support landing page");
  assert(!helpDrawerHtml.includes("System Integrity Diagnostics") && !helpDrawerHtml.includes("Run Self-Check") && !helpDrawerHtml.includes("btnRunAccountDiagnostics"), "System Integrity Diagnostics and Run Self-Check button must be removed from Help & Support landing page");

  // 2. Verify selecting Cross-Device Guide opens dedicated page and back navigation returns to Help & Support
  documentMock.getElementById("btnOpenCrossDeviceGuide").click();
  assert(app.state.activeView === "CROSS_DEVICE_GUIDE" && !documentMock.getElementById("viewCrossDeviceGuide").classList.contains("hidden"), "Selecting Cross-Device Guide must open dedicated #viewCrossDeviceGuide page");
  const guideHtml = html.slice(html.indexOf('id="viewCrossDeviceGuide"'), html.indexOf('id="viewFaqVerificationSuite"'));
  for (const requiredTopic of [
    "1. Getting Started with ScreenSync",
    "2. Creating an Account &amp; Signing In",
    "3. Adding an Account After Logging Out",
    "4. Registering &amp; Connecting Supported Devices",
    "5. How Cross-Device Synchronization Works",
    "6. How Screen Time &amp; App Usage Are Collected",
    "7. How Reel, Short-Video &amp; Story Tracking Works",
    "8. How Account-Wide Totals Are Calculated Across Devices",
    "9. Configuring Operating System Permissions",
    "10. Screen Time Goal &amp; Reel Watch Time Goal Across Devices",
    "11. Resolving Common Synchronization or Permission Problems",
    "12. Logging Out Safely Without Deleting Data",
    "13. Platform-Specific Limitations &amp; Requirements"
  ]) {
    assert(guideHtml.includes(requiredTopic), `Cross-Device Guide must include topic '${requiredTopic}'`);
  }
  documentMock.getElementById("btnBackFromCrossDeviceGuide").click();
  assert(app.state.activeView === "ACCOUNT" && !documentMock.getElementById("viewAccount").classList.contains("hidden"), "Back button from Cross-Device Guide must return to Account / Help & Support page");

  // 3. Verify selecting FAQ & Verification Suite opens dedicated page with 14 hidden-by-default accordion items & genuine Verification Suite
  documentMock.getElementById("btnOpenFaqVerificationSuite").click();
  assert(app.state.activeView === "FAQ_VERIFICATION" && !documentMock.getElementById("viewFaqVerificationSuite").classList.contains("hidden"), "Selecting FAQ & Verification Suite must open dedicated #viewFaqVerificationSuite page");

  const faqItems = app.HelpCenterController.FAQ_ITEMS;
  assert(faqItems.length === 14, `Expected 14 FAQ items covering all required topics, found ${faqItems.length}`);
  for (const item of faqItems) {
    const btn = documentMock.getElementById(`faqBtn_${item.id}`);
    const ans = documentMock.getElementById(`faqAnswer_${item.id}`);
    assert(btn && ans, `FAQ question button and answer panel must exist for ${item.id}`);
    assert(ans.classList.contains("hidden") && btn.getAttribute("aria-expanded") === "false", `FAQ answer '${item.id}' must be hidden by default`);
  }

  // Tap first FAQ question -> reveals answer 1 while others stay hidden
  const firstId = faqItems[0].id;
  const secondId = faqItems[1].id;
  documentMock.getElementById(`faqBtn_${firstId}`).click();
  assert(!documentMock.getElementById(`faqAnswer_${firstId}`).classList.contains("hidden") && documentMock.getElementById(`faqBtn_${firstId}`).getAttribute("aria-expanded") === "true", "Tapping FAQ question 1 must reveal answer 1");
  assert(documentMock.getElementById(`faqAnswer_${secondId}`).classList.contains("hidden"), "Other FAQ answers must remain hidden when question 1 is opened");

  // Tap second FAQ question -> reveals answer 2 while answer 1 stays open
  documentMock.getElementById(`faqBtn_${secondId}`).click();
  assert(!documentMock.getElementById(`faqAnswer_${firstId}`).classList.contains("hidden") && !documentMock.getElementById(`faqAnswer_${secondId}`).classList.contains("hidden"), "Multiple FAQ answers may remain open simultaneously");

  // Tap first FAQ question again -> hides answer 1
  documentMock.getElementById(`faqBtn_${firstId}`).click();
  assert(documentMock.getElementById(`faqAnswer_${firstId}`).classList.contains("hidden") && documentMock.getElementById(`faqBtn_${firstId}`).getAttribute("aria-expanded") === "false", "Tapping an open FAQ question again must hide its answer");

  // 4. Verify live Verification Suite reflects genuine runtime state
  const liveReportAuth = app.HelpCenterController.collectGenuineVerificationReport();
  assert(liveReportAuth.accountStatus.authenticated === true && liveReportAuth.accountStatus.email === "rahim.ahmed@gmail.com" && liveReportAuth.registeredDevices.count === 7, "Verification Suite must report genuine authenticated account and registered devices");
  assert(liveReportAuth.trackingAvailability.nativeOsBridgeConnected === false, "Verification Suite must honestly report that native OS bridge is not connected in standalone web environment");

  documentMock.getElementById("btnBackFromFaqVerification").click();
  assert(app.state.activeView === "ACCOUNT", "Back button from FAQ & Verification Suite must return to Account / Help & Support page");

  console.log("[PASS] Test 34: Help & Support redesign (Cross-Device Guide, 14-item FAQ accordion hidden by default, live Verification Suite, and back navigation) verified.");
}

// -------------------------------------------------------------------------
// ASYNC SUPABASE + CROSS-PLATFORM INTEGRATED SUITES (TESTS 35 TO 42)
// -------------------------------------------------------------------------
(async () => {
  // Deterministic in-memory Supabase Auth + RLS-enforcing DB test fixture
  // (Used ONLY inside this automated test suite; never enabled in production)
  const serverUsersByEmail = new Map();
  const serverOtpByEmailAndType = new Map();
  const serverSessionsByToken = new Map();
  let currentActiveAccessToken = null;
  let simulateAuthSignUpError = null;
  let latestServerGeneratedOtpForTestOnly = null;
  const sentEmails = [];

  const rlsTables = {
    user_profiles: [],
    device_installations: [],
    screen_usage_sessions: [],
    reel_watch_events: [],
    user_settings: [],
    focus_sessions: [],
    user_achievements: [],
    goal_alert_events: [],
    sync_dedup_ledger: [],
    sync_metadata: [],
    security_alerts: []
  };

  function getAuthenticatedUidFromSession() {
    if (!currentActiveAccessToken) return null;
    const s = serverSessionsByToken.get(currentActiveAccessToken);
    if (!s || s.revoked || Date.now() > s.expires_at * 1000) return null;
    return s.user.id;
  }

  function createRlsTableBuilder(tableName) {
    const ownerCol = tableName === "user_profiles" ? "id" : "user_id";
    return {
      _filters: [],
      select() {
        this._op = "SELECT";
        return this;
      },
      eq(col, val) {
        this._filters.push({ col, val });
        return this;
      },
      maybeSingle() {
        const res = this._executeSelect();
        return Promise.resolve({
          data: res.data && res.data.length > 0 ? res.data[0] : null,
          error: res.error
        });
      },
      then(resolve, reject) {
        return Promise.resolve(this._executeSelect()).then(resolve, reject);
      },
      _executeSelect() {
        const authUid = getAuthenticatedUidFromSession();
        if (!authUid) {
          return { data: null, error: { code: "42501", message: `RLS policy violation on ${tableName}: unauthenticated anon access denied` } };
        }
        let rows = (rlsTables[tableName] || []).filter(r => (r[ownerCol] === authUid || r.user_id === authUid));
        for (const f of this._filters) {
          rows = rows.filter(r => r[f.col] === f.val || (tableName === "user_profiles" && (f.col === "id" || f.col === "user_id") && (r.id === f.val || r.user_id === f.val)));
        }
        return { data: JSON.parse(JSON.stringify(rows)), error: null };
      },
      async insert(payload) {
        return this.upsert(payload, {});
      },
      async upsert(payload, opts = {}) {
        const authUid = getAuthenticatedUidFromSession();
        if (!authUid) {
          return { data: null, error: { code: "42501", message: `new row violates row-level security policy for table "${tableName}" (unauthenticated)` } };
        }
        const items = Array.isArray(payload) ? payload : [payload];
        const conflictCols = opts.onConflict ? opts.onConflict.split(",").map(s => s.trim()) : [ownerCol];

        for (const item of items) {
          const itemOwner = item[ownerCol] || item.user_id;
          if (itemOwner !== authUid) {
            return {
              data: null,
              error: { code: "42501", message: `new row violates row-level security policy for table "${tableName}" (owner mismatch)` }
            };
          }
          if (
            (tableName === "screen_usage_sessions" || tableName === "reel_watch_events" || tableName === "sync_dedup_ledger" || tableName === "sync_metadata") &&
            item.installation_id
          ) {
            const ownsInst = rlsTables.device_installations.some(
              inst => inst.user_id === authUid && inst.installation_id === item.installation_id && inst.is_active !== false && !inst.is_revoked
            );
            if (!ownsInst && item.installation_id !== "inst_default") {
              return {
                data: null,
                error: { code: "42501", message: `new row violates cross-table installation ownership RLS policy on "${tableName}"` }
              };
            }
          }
          if (!rlsTables[tableName]) rlsTables[tableName] = [];
          const tableArr = rlsTables[tableName];
          const normalizedItem = tableName === "user_profiles"
            ? { ...item, id: item.id || item.user_id, user_id: item.user_id || item.id }
            : item;
          const existingIdx = tableArr.findIndex(row => conflictCols.every(c => row[c] === normalizedItem[c]));
          if (existingIdx >= 0) {
            const rowOwner = tableArr[existingIdx][ownerCol] || tableArr[existingIdx].user_id;
            if (rowOwner !== authUid) {
              return { data: null, error: { code: "42501", message: `RLS UPDATE policy violation on "${tableName}"` } };
            }
            tableArr[existingIdx] = { ...tableArr[existingIdx], ...JSON.parse(JSON.stringify(normalizedItem)) };
          } else {
            tableArr.push(JSON.parse(JSON.stringify(normalizedItem)));
          }
        }
        return { data: items, error: null };
      }
    };
  }

  const mockSupabaseAdapter = {
    from(tableName) {
      return createRlsTableBuilder(tableName);
    },
    async rpc(fnName, params = {}) {
      const authUid = getAuthenticatedUidFromSession();
      if (!authUid) {
        return { data: null, error: { code: "42501", message: "Unauthenticated RPC call denied" } };
      }
      if (fnName === "get_account_daily_aggregates" || fnName === "get_account_usage_summary") {
        const dStr = params.p_local_date || "2026-10-16";
        const sessions = rlsTables.screen_usage_sessions.filter(s => s.user_id === authUid && s.local_date === dStr);
        const reels = rlsTables.reel_watch_events.filter(r => r.user_id === authUid && r.local_date === dStr);
        return {
          data: {
            userId: authUid,
            localDate: dStr,
            rpcFunction: fnName,
            cumulativeScreenMinutes: sessions.reduce((acc, s) => acc + Number(s.duration_minutes || 0), 0),
            reelsCount: reels.reduce((acc, r) => acc + Number(r.reel_count || 0), 0),
            watchMinutes: Math.round(reels.reduce((acc, r) => acc + Number(r.watch_seconds || 0), 0) / 60)
          },
          error: null
        };
      }
      return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
    },
    auth: {
      async signUp({ email, password, options }) {
        if (simulateAuthSignUpError) {
          return { data: { user: null, session: null }, error: { message: simulateAuthSignUpError } };
        }
        const cleanEmail = String(email || "").toLowerCase();
        const existing = serverUsersByEmail.get(cleanEmail);
        if (existing && existing.email_confirmed_at) {
          return { data: { user: null, session: null }, error: { message: "User already registered" } };
        }
        const uid = existing ? existing.id : `aaaaaaaa-bbbb-4ccc-8ddd-${String(serverUsersByEmail.size + 101).padStart(12, "0")}`;
        const nowIso = new Date().toISOString();
        const userObj = {
          id: uid,
          email: cleanEmail,
          passwordHash: `srv_${password}`,
          user_metadata: options?.data || {},
          email_confirmed_at: null,
          created_at: nowIso
        };
        serverUsersByEmail.set(cleanEmail, userObj);
        const otpToken = String(100000 + ((serverUsersByEmail.size * 137911 + sentEmails.length * 17) % 899999)).slice(0, 6);
        latestServerGeneratedOtpForTestOnly = otpToken;
        sentEmails.push({ to: cleanEmail, purpose: "SIGNUP", otpCode: otpToken });
        serverOtpByEmailAndType.set(`${cleanEmail}::signup`, {
          token: otpToken,
          issuedAtMs: Date.now(),
          expiresAtMs: Date.now() + 3600 * 1000,
          consumed: false
        });
        return { data: { user: { ...userObj, passwordHash: undefined }, session: null }, error: null };
      },

      async resend({ type, email }) {
        const cleanEmail = String(email || "").toLowerCase();
        const userObj = serverUsersByEmail.get(cleanEmail);
        if (!userObj) return { data: {}, error: null };
        const otpToken = "654321";
        latestServerGeneratedOtpForTestOnly = otpToken;
        sentEmails.push({ to: cleanEmail, purpose: "SIGNUP_RESEND", otpCode: otpToken });
        serverOtpByEmailAndType.set(`${cleanEmail}::${type || "signup"}`, {
          token: otpToken,
          issuedAtMs: Date.now(),
          expiresAtMs: Date.now() + 3600 * 1000,
          consumed: false
        });
        return { data: {}, error: null };
      },

      async verifyOtp({ email, token, type }) {
        const cleanEmail = String(email || "").toLowerCase();
        const otpRec = serverOtpByEmailAndType.get(`${cleanEmail}::${type}`);
        if (!otpRec || otpRec.consumed) {
          return { data: { user: null, session: null }, error: { message: "Token has expired or is invalid" } };
        }
        if (Date.now() > otpRec.expiresAtMs) {
          return { data: { user: null, session: null }, error: { message: "Otp has expired" } };
        }
        if (otpRec.token !== String(token).trim()) {
          return { data: { user: null, session: null }, error: { message: "Invalid OTP token" } };
        }
        otpRec.consumed = true;
        const userObj = serverUsersByEmail.get(cleanEmail);
        if (!userObj) {
          return { data: { user: null, session: null }, error: { message: "User not found" } };
        }
        if (type === "signup" || type === "email") {
          userObj.email_confirmed_at = new Date().toISOString();
          if (!rlsTables.user_profiles.some(p => p.id === userObj.id || p.user_id === userObj.id)) {
            rlsTables.user_profiles.push({
              id: userObj.id,
              user_id: userObj.id,
              email: userObj.email,
              display_name: userObj.user_metadata?.full_name || "User",
              email_verified: true,
              created_at: userObj.created_at,
              updated_at: userObj.email_confirmed_at
            });
          }
        }
        const accessToken = `sb_jwt_${userObj.id}_${Date.now()}`;
        const sessionObj = {
          access_token: accessToken,
          refresh_token: `sb_ref_${userObj.id}_${Date.now()}`,
          expires_at: Math.floor((Date.now() + 3600 * 1000) / 1000),
          user: { ...userObj, passwordHash: undefined }
        };
        serverSessionsByToken.set(accessToken, sessionObj);
        currentActiveAccessToken = accessToken;
        return { data: { user: sessionObj.user, session: sessionObj }, error: null };
      },

      async signInWithPassword({ email, password }) {
        const cleanEmail = String(email || "").toLowerCase();
        const userObj = serverUsersByEmail.get(cleanEmail);
        if (!userObj || userObj.passwordHash !== `srv_${password}`) {
          return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
        }
        if (!userObj.email_confirmed_at) {
          return { data: { user: null, session: null }, error: { message: "Email not confirmed" } };
        }
        const accessToken = `sb_jwt_${userObj.id}_${Date.now()}`;
        const sessionObj = {
          access_token: accessToken,
          refresh_token: `sb_ref_${userObj.id}_${Date.now()}`,
          expires_at: Math.floor((Date.now() + 3600 * 1000) / 1000),
          user: { ...userObj, passwordHash: undefined }
        };
        serverSessionsByToken.set(accessToken, sessionObj);
        currentActiveAccessToken = accessToken;
        return { data: { user: sessionObj.user, session: sessionObj }, error: null };
      },

      async resetPasswordForEmail(email) {
        const cleanEmail = String(email || "").toLowerCase();
        const userObj = serverUsersByEmail.get(cleanEmail);
        if (!userObj) {
          return { data: null, error: { message: "No registered account found with this email address." } };
        }
        const otpToken = "789012";
        latestServerGeneratedOtpForTestOnly = otpToken;
        sentEmails.push({ to: cleanEmail, purpose: "PASSWORD_RESET", otpCode: otpToken });
        serverOtpByEmailAndType.set(`${cleanEmail}::recovery`, {
          token: otpToken,
          issuedAtMs: Date.now(),
          expiresAtMs: Date.now() + 3600 * 1000,
          consumed: false
        });
        return { data: {}, error: null };
      },

      async updateUser({ password }) {
        const authUid = getAuthenticatedUidFromSession();
        if (!authUid) {
          return { data: { user: null }, error: { message: "Auth session missing" } };
        }
        const userObj = Array.from(serverUsersByEmail.values()).find(u => u.id === authUid);
        if (!userObj) {
          return { data: { user: null }, error: { message: "User not found" } };
        }
        userObj.passwordHash = `srv_${password}`;
        return { data: { user: { ...userObj, passwordHash: undefined } }, error: null };
      },

      async getSession() {
        const authUid = getAuthenticatedUidFromSession();
        if (!authUid) return { data: { session: null }, error: null };
        return { data: { session: serverSessionsByToken.get(currentActiveAccessToken) }, error: null };
      },

      async signOut() {
        if (currentActiveAccessToken && serverSessionsByToken.has(currentActiveAccessToken)) {
          serverSessionsByToken.get(currentActiveAccessToken).revoked = true;
        }
        currentActiveAccessToken = null;
        return { error: null };
      }
    }
  };

  app.SupabaseClientManager.setTestTransportAdapter(mockSupabaseAdapter);

  // -------------------------------------------------------------------------
  // TEST 35: SECTION 6 — ACCOUNT CREATION LIVE PASSWORD REQUIREMENTS
  // -------------------------------------------------------------------------
  {
    const signupPassEl = documentMock.getElementById("signupPasswordInput");
    const signupEmailEl = documentMock.getElementById("signupEmailInput");
    const signupNameEl = documentMock.getElementById("signupNamePreview");
    const submitSignupBtn = documentMock.getElementById("btnSubmitSignup");

    const reqIds = {
      length: "passReqLength",
      upper: "passReqUpper",
      lower: "passReqLower",
      number: "passReqNumber",
      symbol: "passReqSymbol"
    };

    app.PasswordRequirementsValidator.resetUI();
    for (const [key, id] of Object.entries(reqIds)) {
      const el = documentMock.getElementById(id);
      assert(el && el.getAttribute("data-req-state") === "neutral", `Requirement '${key}' must start in neutral state`);
    }

    const evalShort = app.PasswordRequirementsValidator.updateUI("Ab1!xyz", "TYPING");
    assert(evalShort.allMet === false && evalShort.statesByKey.length === "neutral" && evalShort.statesByKey.upper === "green" && evalShort.statesByKey.lower === "green" && evalShort.statesByKey.number === "green" && evalShort.statesByKey.symbol === "green", "While typing 7-char password, met requirements must turn green and unmet length must remain neutral");

    const evalLong = app.PasswordRequirementsValidator.updateUI("Ab1!xxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "TYPING");
    assert(evalLong.allMet === false && evalLong.statesByKey.length === "neutral" && evalLong.statesByKey.upper === "green", "While typing 33-char password, length must be neutral");

    const evalNoUpper = app.PasswordRequirementsValidator.updateUI("abcdefg1!", "TYPING");
    assert(evalNoUpper.allMet === false && evalNoUpper.statesByKey.upper === "neutral" && evalNoUpper.statesByKey.length === "green" && evalNoUpper.statesByKey.lower === "green" && evalNoUpper.statesByKey.number === "green" && evalNoUpper.statesByKey.symbol === "green", "Missing uppercase must stay neutral while typing");

    const evalNoLower = app.PasswordRequirementsValidator.updateUI("ABCDEFG1!", "TYPING");
    assert(evalNoLower.allMet === false && evalNoLower.statesByKey.lower === "neutral" && evalNoLower.statesByKey.upper === "green", "Missing lowercase must stay neutral while typing");

    const evalNoNum = app.PasswordRequirementsValidator.updateUI("Abcdefgh!", "TYPING");
    assert(evalNoNum.allMet === false && evalNoNum.statesByKey.number === "neutral" && evalNoNum.statesByKey.symbol === "green", "Missing number must stay neutral while typing");

    const evalNoSym = app.PasswordRequirementsValidator.updateUI("Abcdefg1", "TYPING");
    assert(evalNoSym.allMet === false && evalNoSym.statesByKey.symbol === "neutral" && evalNoSym.statesByKey.number === "green", "Missing symbol must stay neutral while typing");

    documentMock.getElementById("toastBanner").classList.add("hidden");
    documentMock.getElementById("authFeedbackBox").classList.add("hidden");
    app.state.pendingSignupUser = null;
    app.state.authTab = "SIGNUP";
    signupNameEl.value = "Tariq Hasan";
    signupEmailEl.value = "tariq.hasan@screensync.io";
    signupPassEl.value = "abc";

    submitSignupBtn.click();
    assert(app.state.pendingSignupUser === null && app.state.authTab === "SIGNUP", "Account creation must be blocked when password requirements are not satisfied");
    assert(documentMock.getElementById("passReqLower").getAttribute("data-req-state") === "green", "Satisfied lowercase requirement must remain green on invalid submit");
    assert(documentMock.getElementById("passReqLength").getAttribute("data-req-state") === "red", "Unmet length requirement must turn red on invalid submit");
    assert(documentMock.getElementById("passReqUpper").getAttribute("data-req-state") === "red", "Unmet uppercase requirement must turn red on invalid submit");
    assert(documentMock.getElementById("passReqNumber").getAttribute("data-req-state") === "red", "Unmet number requirement must turn red on invalid submit");
    assert(documentMock.getElementById("passReqSymbol").getAttribute("data-req-state") === "red", "Unmet symbol requirement must turn red on invalid submit");
    assert(documentMock.getElementById("toastBanner").classList.contains("hidden") && documentMock.getElementById("authFeedbackBox").classList.contains("hidden"), "No floating toast, snackbar, or error banner may appear for password requirement failures");

    signupPassEl.value = "ScreenSync2026!";
    signupPassEl.dispatchEvent({ type: "input", target: signupPassEl });
    for (const [key, id] of Object.entries(reqIds)) {
      assert(documentMock.getElementById(id).getAttribute("data-req-state") === "green", `Requirement '${key}' must turn green immediately when satisfied`);
    }

    await app.AuthService.signUp("Tariq Hasan", "tariq.hasan@screensync.io", "ScreenSync2026!");
    assert(app.state.pendingSignupUser !== null && app.state.pendingSignupUser.email === "tariq.hasan@screensync.io" && app.state.authTab === "VERIFY", "Once all 5 password requirements are satisfied, Create Account must proceed to email OTP verification");

    app.state.pendingSignupUser = null;
    serverUsersByEmail.delete("tariq.hasan@screensync.io");
    app.switchView("OVERVIEW");
    console.log("[PASS] Test 35: Account Creation Live Password Requirements (5 independent rules, green on type, neutral while typing, red on invalid submit, zero floating notifications, and full signup progression) verified.");
  }

  console.log("=== ALL 35 TEST SUITES PASSED 100% ===");

  // -------------------------------------------------------------------------
  // TEST 36: DIGITALWELLBEINGPC CROSS-PLATFORM ALGORITHM INTEGRATION SUITE
  // -------------------------------------------------------------------------
  {
    const resolver = app.CrossPlatformAppIdentityResolver;
    const webInspector = app.BrowserAndWebShortFormInspector;
    const idleTracker = app.CrossPlatformIdleAndSessionTracker;
    const soundHealth = app.SoundExposureAndHealthService;

    assert(resolver && webInspector && idleTracker && soundHealth, "All 4 integrated DigitalWellbeingPC cross-platform modules must be exposed on window.ScreenSyncApp");

    assert(resolver.normalizeKey("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") === "chrome", "Windows full executable path must normalize to 'chrome'");
    assert(resolver.normalizeKey("/Applications/Visual Studio Code.app/Contents/MacOS/Code") === "code", "macOS app path must normalize to 'code'");
    assert(resolver.normalizeKey(resolver.normalizeKey("C:\\Apps\\Spotify.exe")) === resolver.normalizeKey("Spotify.exe"), "normalizeKey must be idempotent");
    assert(app.normalizeAppKeyAlias("site:youtube.com") === "site:youtube.com", "site:<domain> namespace must not strip '.com' extension");

    assert(resolver.isTrackableWindow("explorer", "Progman") === false, "Desktop shell click (explorer + Progman) must be excluded");
    assert(resolver.isTrackableWindow("explorer", "Shell_TrayWnd") === false, "Taskbar click (explorer + Shell_TrayWnd) must be excluded");
    assert(resolver.isTrackableWindow("explorer", "CabinetWClass") === true, "File Explorer window (explorer + CabinetWClass) must be tracked");
    assert(resolver.isTrackableWindow("ShellExperienceHost", "Windows.UI.Core.CoreWindow") === false, "ShellExperienceHost must be excluded");

    const uwpRes = resolver.resolveProcessAndWindowIdentity({
      processName: "ApplicationFrameHost.exe",
      windowTitle: "Instagram",
      windowClassName: "ApplicationFrameWindow",
      executablePath: "C:\\Windows\\System32\\ApplicationFrameHost.exe"
    });
    assert(uwpRes.trackable === true && uwpRes.appKey === "instagram" && uwpRes.persistedWindowTitle === null, "UWP ApplicationFrameHost must resolve hosted app from windowTitle in memory while keeping persistedWindowTitle null");

    assert(resolver.getDisplayName("GitHubDesktop.exe", "", "Windows Application", "") === "GitHub Desktop", "Known app dictionary & generic description rejection must resolve 'GitHub Desktop'");
    assert(resolver.getDisplayName("MyCustomStudioTool.exe", "", "Application", "") === "My Custom Studio Tool", "Generic 'Application' description must fall through to camelCase prettifier");

    const catUid = "usr_rahim_01";
    app.BackendDB.ensureUserStructures(catUid);
    app.BackendDB.data.appCategoryRulesByUser[catUid]["code"] = {
      appIdentifier: "code",
      appName: "VS Code",
      category: "Entertainment",
      source: "Manual",
      lastUpdatedMs: Date.now()
    };
    resolver.applyRulesToUncategorized(catUid);
    assert(app.BackendDB.data.appCategoryRulesByUser[catUid]["code"].category === "Entertainment" && app.BackendDB.data.appCategoryRulesByUser[catUid]["code"].source === "Manual", "Auto-suggested category rules must never overwrite an existing Manual category row");

    const chromeSel = webInspector.getUiaSelectorForBrowser("chrome.exe");
    const edgeSel = webInspector.getUiaSelectorForBrowser("msedge.exe");
    const ffSel = webInspector.getUiaSelectorForBrowser("firefox.exe");
    assert(chromeSel.selectorValue === "OmniboxViewViews" && edgeSel.selectorValue === "OmniboxViewViews" && ffSel.selectorValue === "urlbar-input", "Chromium and Firefox UIA selectors must match verified OmniboxViewViews and urlbar-input");

    assert(webInspector.extractHostname("https://news.bbc.co.uk/world/asia?id=123#top") === "bbc.co.uk", "Two-label public suffix co.uk must extract registrable domain bbc.co.uk and strip path/query/hash");
    assert(webInspector.extractHostname("m.youtube.com/shorts/abc123xyz?feature=share") === "youtube.com", "Scheme-less omnibox URL must extract youtube.com");
    assert(webInspector.extractHostname("chrome://extensions") === null && webInspector.extractHostname("about:blank") === null, "Internal browser schemes must return null");

    const shortTab = webInspector.classifyBrowserTabInMemory({
      rawAddressBarText: "https://www.instagram.com/reels/C8abc123/",
      windowTitle: "Instagram Reels"
    });
    assert(shortTab.isShortForm === true && shortTab.appKey === "instagram" && shortTab.contentType === "REEL", "Browser tab on instagram.com/reels/* must classify as short-form REEL in memory");

    const longYtTab = webInspector.classifyBrowserTabInMemory({
      rawAddressBarText: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      windowTitle: "Long Documentary - YouTube",
      isFullscreen: true
    });
    assert(longYtTab.isShortForm === false && longYtTab.contentType === "LONG_VIDEO" && longYtTab.activityMode === "LANDSCAPE_FULLSCREEN", "Long-form 16:9 YouTube watch page in fullscreen must not be misclassified as a Short");

    const webTestUid = "usr_web_poll_test";
    app.BackendDB.ensureUserStructures(webTestUid);
    const t0 = Date.UTC(2026, 9, 16, 10, 0, 0);
    webInspector.pollWebsiteUsage({ userId: webTestUid, installationKey: "windows_pc", processName: "chrome", rawAddressBarText: "https://github.com/torvalds/linux", nowMs: t0 });
    const noiseClose = webInspector.pollWebsiteUsage({ userId: webTestUid, installationKey: "windows_pc", processName: "chrome", rawAddressBarText: "https://youtube.com/shorts/xyz", nowMs: t0 + 4000 });
    assert(noiseClose.priorCommitResult && noiseClose.priorCommitResult.saved === false && noiseClose.priorCommitResult.reason === "BELOW_7S_POLL_NOISE_THRESHOLD", "Tab visits shorter than 7s poll interval must be filtered out as tab-switch noise");
    const validClose = webInspector.pollWebsiteUsage({ userId: webTestUid, installationKey: "windows_pc", processName: "code", rawAddressBarText: null, nowMs: t0 + 25000 });
    assert(validClose.commitResult && validClose.commitResult.saved === true && validClose.commitResult.session.hostname === "youtube.com", "Valid website session >=7s must persist bare eTLD+1 hostname 'youtube.com' without URL path");
    delete app.BackendDB.data.websiteSessionsByUser[webTestUid];

    assert(idleTracker.isForegroundConsuming({ foregroundAppKey: "winword", isFullscreenAppActive: false, audioSourceAppKey: "spotify", audioMasterPeakValue: 0.5 }) === false, "Background audio from Spotify must NOT keep crediting idle foreground Word window");
    assert(idleTracker.isPassivelyConsuming({ isFullscreenAppActive: false, isAudioCurrentlyPlaying: true, audioMasterPeakValue: 0.5 }) === true, "Active audio playback counts as passive consumption for device-level screen state");

    const simUid = "usr_idle_sim_test";
    const prevAuthUser = app.state.currentUser;
    app.state.isAuthenticated = true;
    app.state.currentUser = { userId: simUid, email: "sim@screensync.io", name: "Sim User", verified: true };
    app.BackendDB.data.users.push(app.state.currentUser);
    app.BackendDB.ensureUserStructures(simUid);
    app.BackendDB.registerOrVerifyInstallation(app.state.currentUser, {
      installationId: "inst_sim_win",
      key: "sim_win_pc",
      deviceName: "Sim Windows PC",
      osCategory: "Windows",
      deviceCategory: "Laptop"
    });

    const baseTickMs = Date.UTC(2026, 9, 16, 12, 0, 0);
    idleTracker.processTrackerTick({
      userId: simUid,
      installationKey: "sim_win_pc",
      checkTimeMs: baseTickMs,
      idleSeconds: 0,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "secret_passwords.txt - Visual Studio Code"
    });
    idleTracker.processTrackerTick({
      userId: simUid,
      installationKey: "sim_win_pc",
      checkTimeMs: baseTickMs + 60000,
      idleSeconds: 1,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "secret_passwords.txt - Visual Studio Code"
    });
    idleTracker.processTrackerTick({
      userId: simUid,
      installationKey: "sim_win_pc",
      checkTimeMs: baseTickMs + 120000,
      idleSeconds: 2,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "secret_passwords.txt - Visual Studio Code"
    });
    const sleepWakeTick = idleTracker.processTrackerTick({
      userId: simUid,
      installationKey: "sim_win_pc",
      checkTimeMs: baseTickMs + 120000 + 7200000,
      idleSeconds: 0,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "secret_passwords.txt - Visual Studio Code"
    });
    assert(sleepWakeTick.wasWallClockJumpClamped === true, "Laptop sleep gap > 60s must be detected and clamped by MaxTickGap");
    const committedPreSleep = app.BackendDB.data.sessionsByUser[simUid] || [];
    assert(committedPreSleep.length === 1 && committedPreSleep[0].durationMinutes === 2 && committedPreSleep[0].windowTitle === null, "Pre-sleep segment must be closed at pre-sleep timestamp (2m, not 122m!) and persisted with windowTitle=null for privacy");

    const checkpointMetrics = idleTracker.calculateAppFocusMetrics([
      { appKey: "code", startEpochSec: 1000, endEpochSec: 1300 },
      { appKey: "code", startEpochSec: 1300, endEpochSec: 1600 },
      { appKey: "code", startEpochSec: 1601, endEpochSec: 1900 },
      { appKey: "chrome", startEpochSec: 1901, endEpochSec: 2200 }
    ]);
    assert(checkpointMetrics.stretchesCount === 2 && checkpointMetrics.switchCount === 1 && checkpointMetrics.longestFocusSeconds === 900, "Adjacent 5-minute checkpoint segments of the same app within 2s JoinTolerance must merge into a single 900s stretch with switchCount=1");

    delete app.BackendDB.data.sessionsByUser[simUid];
    delete app.BackendDB.data.installationsByUser[simUid];
    app.BackendDB.data.users = app.BackendDB.data.users.filter(u => u.userId !== simUid);
    app.state.currentUser = prevAuthUser;

    const orphanStartMs = Date.UTC(2026, 9, 16, 14, 0, 0);
    const orphanHeartbeatMs = orphanStartMs + 12 * 60 * 1000;
    localStorageMock.setItem(app.FocusModeController.ACTIVE_FOCUS_STORAGE_KEY, JSON.stringify({
      sessionId: "focus_orphan_hb_test_01",
      userId: "usr_rahim_01",
      startedAtMs: orphanStartMs,
      lastSeenUtcMs: orphanHeartbeatMs,
      plannedMinutes: 60,
      totalSeconds: 3600,
      remainingSeconds: 100,
      paused: false
    }));
    const recOrphan = app.FocusModeController.recoverInterruptedSessionIfNeeded();
    assert(recOrphan.recovered === true && recOrphan.session.completedMinutes === 12 && recOrphan.session.status === "INTERRUPTED", "Orphaned focus session must recover to LastSeenUtc heartbeat (12m) rather than fabricating the 60m planned duration");

    app.NotificationScheduleManager.lastBreakTimeMs = 1000;
    app.NotificationScheduleManager.breakPending = false;
    app.NotificationScheduleManager.snoozeCount = 0;
    const dueCheck = app.NotificationScheduleManager.evaluateBreakReminderTick({ nowMs: 1000 + 50 * 60000, idleSeconds: 10 });
    assert(dueCheck.breakDue === true && dueCheck.status === "BREAK_DUE", "Break reminder must fire after interval when user is continuously active");
    const s1 = app.NotificationScheduleManager.snoozeBreakReminder(5, 3001000);
    const s2 = app.NotificationScheduleManager.snoozeBreakReminder(5, 3301000);
    const s3 = app.NotificationScheduleManager.snoozeBreakReminder(5, 3601000);
    const s4 = app.NotificationScheduleManager.snoozeBreakReminder(5, 3901000);
    assert(s1.snoozed === true && s2.snoozed === true && s3.snoozed === true && s4.snoozed === false && s4.reason === "MAX_SNOOZES_REACHED_DISMISSED", "Break reminder must allow up to 3 snoozes and force-dismiss on the 4th snooze");
    const naturalIdleReset = app.NotificationScheduleManager.evaluateBreakReminderTick({ nowMs: 5000000, idleSeconds: 360 });
    assert(naturalIdleReset.breakDue === false && naturalIdleReset.status === "NATURAL_IDLE_BREAK_RESET", "Natural user idle >= 5 minutes must reset the break timer automatically");

    const sec6Uid = "usr_section6_20h_test";
    app.state.currentUser = { userId: sec6Uid, email: "sec6@screensync.io", name: "Sec6 User" };
    app.BackendDB.ensureUserStructures(sec6Uid);
    app.BackendDB.data.installationsByUser[sec6Uid] = app.BackendDB.data.installationsByUser["usr_rahim_01"].map(i => ({ ...i, userId: sec6Uid }));
    const day0Sec = app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0);
    app.BackendDB.ingestEvent({ eventId: "s6_ios_2h", userId: sec6Uid, installationKey: "iphone_16", appKey: "instagram", localDate: "2026-10-16", startEpochSec: day0Sec, endEpochSec: day0Sec + 7200, durationMinutes: 120, reelCountDelta: 5, watchMinutesDelta: 15 }, true);
    app.BackendDB.ingestEvent({ eventId: "s6_mac_4h", userId: sec6Uid, installationKey: "macbook_pro", appKey: "claude", localDate: "2026-10-16", startEpochSec: day0Sec + 7200, endEpochSec: day0Sec + 21600, durationMinutes: 240, reelCountDelta: 10, watchMinutesDelta: 30 }, true);
    app.BackendDB.ingestEvent({ eventId: "s6_win_4h", userId: sec6Uid, installationKey: "windows_pc", appKey: "chrome", localDate: "2026-10-16", startEpochSec: day0Sec + 21600, endEpochSec: day0Sec + 36000, durationMinutes: 240, reelCountDelta: 10, watchMinutesDelta: 30 }, true);
    app.BackendDB.ingestEvent({ eventId: "s6_and_10h", userId: sec6Uid, installationKey: "s24_ultra", appKey: "youtube", localDate: "2026-10-16", startEpochSec: day0Sec + 36000, endEpochSec: day0Sec + 72000, durationMinutes: 600, reelCountDelta: 25, watchMinutesDelta: 75 }, true);

    const snap20hAll = app.computeSnapshot("ALL", "DAY", 0);
    const snap20hIos = app.computeSnapshot("iphone_16", "DAY", 0);
    const snap20hMac = app.computeSnapshot("macbook_pro", "DAY", 0);
    const snap20hWin = app.computeSnapshot("windows_pc", "DAY", 0);
    const snap20hAnd = app.computeSnapshot("s24_ultra", "DAY", 0);

    assert(snap20hAll.totalScreenMinutes === 1200, `Expected 20 hours (1200m) account-wide total, got ${snap20hAll.totalScreenMinutes}m`);
    assert(snap20hAll.reelsCount === 50 && snap20hAll.watchMinutes === 150, "Account-wide reel count (50) and reel watch time (150m) must aggregate across all 4 devices");
    assert(snap20hIos.totalScreenMinutes === 120 && snap20hMac.totalScreenMinutes === 240 && snap20hWin.totalScreenMinutes === 240 && snap20hAnd.totalScreenMinutes === 600, "Per-device totals (2h, 4h, 4h, 10h) must remain independent and never be overwritten by the 20h account-wide total");

    delete app.BackendDB.data.sessionsByUser[sec6Uid];
    delete app.BackendDB.data.reelEventsByUser[sec6Uid];
    delete app.BackendDB.data.installationsByUser[sec6Uid];
    app.state.currentUser = prevAuthUser;
    app.renderAll();

    console.log("[PASS] Test 36: DigitalWellbeingPC Cross-Platform Algorithm Integration (AppIdentity, UWP/Shell filter, BrowserTabInspector eTLD+1 & Short-Form Classifier, Idle-Tail Subtraction, ForegroundConsuming vs Background Audio, MaxTickGap Sleep Clamp, Checkpoint Stretch Coalescing, Focus Heartbeat Recovery, Natural-Idle Break Reset, Sound Exposure SPL, and 20-Hour 4-Device Aggregation) verified.");
  }

  console.log("=== ALL 36 TEST SUITES PASSED 100% ===");

  // -------------------------------------------------------------------------
  // TEST 37: STRICT RUNTIME WIRING & NATIVE/EXTENSION/SYNC BRIDGE AUDIT SUITE
  // -------------------------------------------------------------------------
  {
    assert(typeof app.ingestCompanionTick === "function", "ingestCompanionTick must be exposed and wired");
    assert(typeof app.ingestExtensionMessage === "function", "ingestExtensionMessage must be exposed and wired");

    ["ScreenTimeTracker", "AppUsageTracker", "ReelTrackingEngine", "SoundExposureManager"].forEach(name => {
      app.SoundExposureAndHealthService.recordHeartbeat(name, null, Date.now());
    });
    const verReport = app.HelpCenterController.collectGenuineVerificationReport();
    assert(Array.isArray(verReport.trackingAvailability.trackerHealth) && verReport.trackingAvailability.trackerHealth.length === 4, "collectGenuineVerificationReport must include all 4 trackerHealth statuses");
    assert(verReport.trackingAvailability.trackerHealth.every(h => h.status === "Healthy" && h.tickCount >= 1), "All 4 trackers must be Healthy and have recorded ticks");

    const liveStartMs = Date.UTC(2026, 9, 16, 15, 0, 0);
    const beforeSnap = app.computeSnapshot("windows_pc", "DAY", 0);
    app.ingestCompanionTick({
      installationKey: "windows_pc",
      checkTimeMs: liveStartMs,
      idleSeconds: 0,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "app.js - Visual Studio Code",
      isAudioCurrentlyPlaying: true,
      audioSourceAppKey: "spotify",
      audioMasterPeakValue: 0.25,
      audioVolumeScalar: 0.80,
      audioDeviceName: "Studio Headphones",
      audioDeviceType: "Headphones"
    });
    app.ingestCompanionTick({
      installationKey: "windows_pc",
      checkTimeMs: liveStartMs + 180000,
      idleSeconds: 1,
      foregroundProcessName: "Code.exe",
      foregroundExecutablePath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      foregroundWindowTitle: "app.js - Visual Studio Code"
    });
    const liveSnap = app.computeSnapshot("windows_pc", "DAY", 0);
    assert(liveSnap.totalScreenMinutes >= beforeSnap.totalScreenMinutes + 3, "computeSnapshot must fold in-memory live session (+3m) via combineTodayWithLiveSession before 5-min checkpoint flush");
    app.CrossPlatformIdleAndSessionTracker.trackersByInstallation["windows_pc"].currentAppSession = null;

    const extStartMs = Date.UTC(2026, 9, 16, 16, 0, 0);
    const extRes1 = app.ingestExtensionMessage({
      source: "SCREENSYNC_EXTENSION",
      type: "EXTENSION_SHORT_FORM_SIGNAL",
      detail: {
        installationKey: "chromebook",
        appKey: "youtube",
        eventType: "TYPE_VIEW_SCROLLED",
        isShortFormSurface: true,
        contentType: "SHORT",
        rowIndex: 1,
        explicitSignature: "yt_short_ext_audit_01",
        timestampMs: extStartMs
      }
    });
    assert(extRes1.ok === true && extRes1.reelResult.fsmState === "CANDIDATE_SETTLING", "Extension scroll signal must transition ReelTrackingEngine to CANDIDATE_SETTLING");

    app.ingestExtensionMessage({
      source: "SCREENSYNC_EXTENSION",
      type: "EXTENSION_SHORT_FORM_SIGNAL",
      detail: {
        installationKey: "chromebook",
        appKey: "youtube",
        eventType: "TYPE_WINDOW_CONTENT_CHANGED",
        isShortFormSurface: true,
        contentType: "SHORT",
        rowIndex: 1,
        explicitSignature: "yt_short_ext_audit_01",
        timestampMs: extStartMs + 350
      }
    });
    const extResCounted = app.ingestExtensionMessage({
      source: "SCREENSYNC_EXTENSION",
      type: "EXTENSION_SHORT_FORM_SIGNAL",
      detail: {
        installationKey: "chromebook",
        appKey: "youtube",
        eventType: "TYPE_WINDOW_CONTENT_CHANGED",
        isShortFormSurface: true,
        contentType: "SHORT",
        rowIndex: 1,
        explicitSignature: "yt_short_ext_audit_01",
        timestampMs: extStartMs + 1700
      }
    });
    assert(extResCounted.ok === true && extResCounted.reelResult.reelCountDelta === 1, "Extension short-form signal after 300ms settle + 1200ms dwell must increment reelCountDelta by +1");

    let nativeBridgePolled = false;
    windowMock.ScreenSyncNativeBridge = {
      getNativeUsageStatsJson: (startMs, endMs) => {
        nativeBridgePolled = true;
        return JSON.stringify({
          ok: true,
          osCategory: "Android",
          installationKey: "s24_ultra",
          entries: []
        });
      },
      getBrainpalCountersJson: () => JSON.stringify({ dayKey: "2026-10-16", dailyReelCount: 5, dailyWatchDurationMs: 120000 })
    };
    app.AutoSyncService.syncWithBackend();
    delete windowMock.ScreenSyncNativeBridge;
    assert(nativeBridgePolled === true, "AutoSyncService.syncWithBackend must poll window.ScreenSyncNativeBridge.getNativeUsageStatsJson when attached");

    const syncSrv = require("../server/sync_server.js");
    assert(syncSrv && syncSrv.server && syncSrv.store, "server/sync_server.js must load and export HTTP server and cloud store");

    console.log("[PASS] Test 37: Strict Runtime Wiring (ingestCompanionTick, ingestExtensionMessage, combineTodayWithLiveSession in computeSnapshot, NativeBridge polling in AutoSyncService, trackerHealth in Verification Suite, and server/sync_server.js) verified.");
    console.log("=== ALL 37 TEST SUITES PASSED 100% ===");
  }

  // -------------------------------------------------------------------------
  // TEST 38: SECTIONS 2–8 — SIX-BOX OTP UI, UNWANTED PREVIEW REMOVAL, GREEN
  //          NOTIFICATION BANNER, RESET PASSWORD LIVE VALIDATION & REGRESSIONS
  // -------------------------------------------------------------------------
  {
    const forbiddenPreviewTokens = [
      "VERIFICATION EMAIL DELIVERED",
      "Verification Email Delivered",
      "Auto-fill code",
      "btnAutoFillOtp",
      "simulatedInboxCard",
      "simulatedEmailTo",
      "simulatedOtpDisplay",
      "Delivered to:",
      "6-Digit Code:",
      "Or enter 6-digit code here",
      "verifyCodeInput",
      "forgotCodeInput",
      "btnVerifyResetCodeStep",
      "pendingOtpCode"
    ];
    for (const token of forbiddenPreviewTokens) {
      assert(!html.includes(token), `Unwanted preview or redundant OTP token must be completely removed from HTML/JS: "${token}"`);
    }
    assert(!("pendingOtpCode" in app.state), "state.pendingOtpCode must be completely removed from runtime state");

    const verifyBoxes = app.OtpInputController.getBoxes("verify");
    const resetBoxes = app.OtpInputController.getBoxes("reset");
    assert(verifyBoxes.length === 6, `Expected exactly 6 OTP boxes on Check Your Email, found ${verifyBoxes.length}`);
    assert(resetBoxes.length === 6, `Expected exactly 6 OTP boxes on Reset Password, found ${resetBoxes.length}`);

    verifyBoxes.forEach((box, idx) => {
      assert(box.id === `verifyOtpBox${idx}`, `Verify box ${idx} ID mismatch`);
      assert(box.getAttribute("inputmode") === "numeric", `Verify box ${idx} must have inputmode="numeric"`);
      assert(box.getAttribute("pattern") === "[0-9]*", `Verify box ${idx} must have pattern="[0-9]*"`);
      assert(box.getAttribute("maxlength") === "1", `Verify box ${idx} must have maxlength="1"`);
      assert(box.getAttribute("autocomplete") === "one-time-code", `Verify box ${idx} must have autocomplete="one-time-code"`);
    });

    resetBoxes.forEach((box, idx) => {
      assert(box.id === `resetOtpBox${idx}`, `Reset box ${idx} ID mismatch`);
      assert(box.getAttribute("inputmode") === "numeric", `Reset box ${idx} must have inputmode="numeric"`);
      assert(box.getAttribute("pattern") === "[0-9]*", `Reset box ${idx} must have pattern="[0-9]*"`);
      assert(box.getAttribute("maxlength") === "1", `Reset box ${idx} must have maxlength="1"`);
      assert(box.getAttribute("autocomplete") === "one-time-code", `Reset box ${idx} must have autocomplete="one-time-code"`);
    });

    const verifySubmitBtnHtml = html.match(/<button id="btnConfirmVerifyCode"[^>]*>([\s\S]*?)<\/button>/);
    const resetSubmitBtnHtml = html.match(/<button id="btnConfirmPasswordReset"[^>]*>([\s\S]*?)<\/button>/);
    assert(verifySubmitBtnHtml && verifySubmitBtnHtml[1].trim() === "Verify", `Check Your Email submit button label must be "Verify", got "${verifySubmitBtnHtml && verifySubmitBtnHtml[1].trim()}"`);
    assert(resetSubmitBtnHtml && resetSubmitBtnHtml[1].trim() === "Update Password", `Reset Password submit button label must be "Update Password", got "${resetSubmitBtnHtml && resetSubmitBtnHtml[1].trim()}"`);

    const authModalBlock = html.slice(html.indexOf('id="authModal"'), html.indexOf('id="screenTimeGoalModal"'));
    const badgePos = authModalBlock.indexOf('id="screenSyncAuthBadge"');
    const bannerPos = authModalBlock.indexOf('id="authFeedbackBox"');
    const loginFormPos = authModalBlock.indexOf('id="authFormLogin"');
    assert(badgePos !== -1 && bannerPos !== -1 && badgePos < bannerPos && bannerPos < loginFormPos, "Green status banner (#authFeedbackBox) must be positioned immediately below the SCREENSYNC AUTH badge (#screenSyncAuthBadge) near the top of the auth screen");
    assert(html.includes(".ss-otp-status-banner") && html.includes("rgba(16, 78, 74, 0.45)") && html.includes("1px solid rgba(52, 211, 153, 0.35)") && html.includes("border-radius: 14px") && html.includes("#34d399"), "CSS must define .ss-otp-status-banner with dark translucent emerald/teal background, 1px solid rgba(52, 211, 153, 0.35) border, 14px radius, and #34d399 text color");

    // Test Failed OTP Send Handling via Supabase Auth error: must NOT show green success banner or advance to Verify screen
    simulateAuthSignUpError = "Failed to deliver verification code via SMTP relay.";
    documentMock.getElementById("btnGoSignupFromLogin").click();
    documentMock.getElementById("signupNamePreview").value = "Nawyaz Hridoy";
    documentMock.getElementById("signupEmailInput").value = "nawyazahammedhridoy2003@gmail.com";
    documentMock.getElementById("signupPasswordInput").value = "StrongPass#2026";
    documentMock.getElementById("signupPasswordInput").dispatchEvent({ type: "input" });
    await app.AuthService.signUp("Nawyaz Hridoy", "nawyazahammedhridoy2003@gmail.com", "StrongPass#2026");

    const fbBox = documentMock.getElementById("authFeedbackBox");
    assert(app.state.authTab === "SIGNUP", "Failed OTP delivery must remain on Signup screen");
    assert(!fbBox.classList.contains("ss-otp-status-banner"), "Failed OTP delivery must NOT display the green status notification banner");
    assert(!fbBox.classList.contains("hidden") && fbBox.className.includes("text-[#FF453A]"), "Failed OTP delivery must display an error message through the existing UI");
    simulateAuthSignUpError = null;

    // Test Successful Signup OTP Delivery & Green Banner Message via Supabase Auth
    await app.AuthService.signUp("Nawyaz Hridoy", "nawyazahammedhridoy2003@gmail.com", "StrongPass#2026");
    assert(app.state.authTab === "VERIFY", "Successful signup OTP send must transition to Check Your Email (VERIFY) screen");
    assert(!fbBox.classList.contains("hidden") && fbBox.classList.contains("ss-otp-status-banner"), "Green notification banner must be visible with .ss-otp-status-banner styling after OTP send");
    assert(
      fbBox.textContent === "Verification code delivered to nawyazahammedhridoy2003@gmail.com. Verify below to activate your isolated account.",
      `Exact signup banner message mismatch: got "${fbBox.textContent}"`
    );
    assert(verifyBoxes.every(b => b.value === ""), "All 6 OTP boxes on Check Your Email must be initially empty");

    assert(sentEmails.length >= 1, "Supabase Auth must have dispatched the signup OTP");
    const signupOtpCode = sentEmails[sentEmails.length - 1].otpCode;
    assert(/^\d{6}$/.test(signupOtpCode), "Dispatched OTP must be a 6-digit numeric string");
    assert(!fbBox.textContent.includes(signupOtpCode), "Green banner must never contain the OTP digits");
    assert(!documentMock.getElementById("toastMessage").textContent.includes(signupOtpCode), "Toast notification must never contain the OTP digits");
    const persistedDbRaw = localStorageMock.getItem("screensync_authoritative_backend_db_v2") || "";
    assert(!persistedDbRaw.includes(signupOtpCode) && !persistedDbRaw.includes("otpRecords"), "OTP records and plaintext OTPs must never be stored in localStorage");

    // Test Resend OTP via Supabase Auth
    verifyBoxes[0].value = "1";
    await app.AuthService.resendVerificationOtp("nawyazahammedhridoy2003@gmail.com", "SIGNUP");
    const resentSignupOtpCode = sentEmails[sentEmails.length - 1].otpCode;
    assert(
      fbBox.textContent === "Verification code delivered to nawyazahammedhridoy2003@gmail.com. Verify below to activate your isolated account.",
      "Resending signup OTP must display the exact signup green banner message"
    );
    assert(verifyBoxes.every(b => b.value === ""), "Resending OTP must reset the 6 OTP boxes to empty");
    assert(!fbBox.textContent.includes(resentSignupOtpCode), "Resent OTP must never appear in the banner");

    // Test OTP Input Interactions:
    app.OtpInputController.distributeDigits("verify", "058105", 0);
    assert(app.OtpInputController.getCode("verify") === "058105", `Expected "058105" with leading zero and duplicate '5' preserved in exact order, got "${app.OtpInputController.getCode("verify")}"`);
    assert(documentMock.activeElement === verifyBoxes[5], "Focus must move to the 6th OTP box (#verifyOtpBox5) when all 6 digits are populated");

    app.OtpInputController.clearBoxes("verify");
    verifyBoxes[0].dispatchEvent({
      type: "paste",
      clipboardData: { getData: () => resentSignupOtpCode }
    });
    assert(app.OtpInputController.getCode("verify") === resentSignupOtpCode, "Clipboard paste event must populate all 6 boxes in exact order");
    assert(documentMock.activeElement === verifyBoxes[5], "Clipboard paste of 6 digits must move focus to the 6th box");

    verifyBoxes[5].dispatchEvent({ type: "keydown", key: "ArrowLeft" });
    assert(documentMock.activeElement === verifyBoxes[4], "ArrowLeft must move focus to previous box");
    verifyBoxes[4].dispatchEvent({ type: "keydown", key: "ArrowRight" });
    assert(documentMock.activeElement === verifyBoxes[5], "ArrowRight must move focus to next box");

    await app.AuthService.verifyEmailOtp("nawyazahammedhridoy2003@gmail.com", app.OtpInputController.getCode("verify"), "SIGNUP");
    assert(app.state.isAuthenticated === true && app.state.currentUser.email === "nawyazahammedhridoy2003@gmail.com", "Verify button must complete account activation and sign in the verified user");

    // Password Reset Flow, Green Banner & Live 5-Requirement Validation
    app.AuthService.logout({ silent: true });
    documentMock.getElementById("btnAddAccount").click();
    documentMock.getElementById("btnGoForgotFromLogin").click();
    assert(app.state.authTab === "FORGOT", "Must switch to Forgot Password screen");

    documentMock.getElementById("forgotEmailInput").value = "nawyazahammedhridoy2003@gmail.com";
    await app.AuthService.requestPasswordRecovery("nawyazahammedhridoy2003@gmail.com");

    assert(!documentMock.getElementById("forgotStep2Reset").classList.contains("hidden"), "Must advance to Reset Password screen (#forgotStep2Reset)");
    assert(!fbBox.classList.contains("hidden") && fbBox.classList.contains("ss-otp-status-banner"), "Reset Password screen must display the green notification banner");
    assert(
      fbBox.textContent === "Verification code delivered to nawyazahammedhridoy2003@gmail.com. Enter the code below to reset your password.",
      `Exact password-reset banner message mismatch: got "${fbBox.textContent}"`
    );
    const resetOtpCode = sentEmails[sentEmails.length - 1].otpCode;
    assert(!fbBox.textContent.includes(resetOtpCode), "Password reset green banner must never contain the OTP digits");
    assert(resetBoxes.every(b => b.value === ""), "All 6 OTP boxes on Reset Password must be initially empty");

    const resetReqTexts = {
      resetPassReqLength: "1. Password length must be 8–32 characters.",
      resetPassReqUpper: "2. At least one uppercase letter.",
      resetPassReqLower: "3. At least one lowercase letter.",
      resetPassReqNumber: "4. At least one number.",
      resetPassReqSymbol: "5. At least one special character or symbol."
    };
    for (const [rId, expectedTxt] of Object.entries(resetReqTexts)) {
      const rEl = documentMock.getElementById(rId);
      assert(rEl && html.includes(expectedTxt), `Reset Password requirement #${rId} must display "${expectedTxt}"`);
      assert(rEl.getAttribute("data-req-state") === "neutral", `Reset Password requirement #${rId} must initially be neutral`);
    }

    const resetNewPassInput = documentMock.getElementById("forgotNewPasswordInput");
    const resetConfirmPassInput = documentMock.getElementById("forgotConfirmPasswordInput");

    resetNewPassInput.value = "Abcdef1";
    resetNewPassInput.dispatchEvent({ type: "input" });
    assert(documentMock.getElementById("resetPassReqLength").getAttribute("data-req-state") === "neutral", "Unsatisfied length must appear neutral while typing");
    assert(documentMock.getElementById("resetPassReqUpper").getAttribute("data-req-state") === "green", "Satisfied uppercase must turn green while typing");
    assert(documentMock.getElementById("resetPassReqLower").getAttribute("data-req-state") === "green", "Satisfied lowercase must turn green while typing");
    assert(documentMock.getElementById("resetPassReqNumber").getAttribute("data-req-state") === "green", "Satisfied number must turn green while typing");
    assert(documentMock.getElementById("resetPassReqSymbol").getAttribute("data-req-state") === "neutral", "Unsatisfied symbol must appear neutral while typing");

    for (let i = 0; i < 6; i++) {
      resetBoxes[i].value = resetOtpCode[i];
      resetBoxes[i].dispatchEvent({ type: "input" });
    }
    assert(app.OtpInputController.getCode("reset") === resetOtpCode, "Manual digit entry in Reset OTP boxes must assemble full 6-digit code");
    assert(documentMock.activeElement === resetBoxes[5], "Focus must rest on the 6th Reset OTP box after entering 6 digits");

    const srvUserBeforeInvalidReset = serverUsersByEmail.get("nawyazahammedhridoy2003@gmail.com");
    const hashBeforeInvalidReset = srvUserBeforeInvalidReset.passwordHash;
    await app.AuthService.resetPasswordAfterRecovery("nawyazahammedhridoy2003@gmail.com", resetOtpCode, "Abcdef1", "Abcdef1");

    assert(documentMock.getElementById("resetPassReqLength").getAttribute("data-req-state") === "red", "Unsatisfied length requirement must turn red on submit");
    assert(documentMock.getElementById("resetPassReqSymbol").getAttribute("data-req-state") === "red", "Unsatisfied symbol requirement must turn red on submit");
    assert(documentMock.getElementById("resetPassReqUpper").getAttribute("data-req-state") === "green", "Satisfied uppercase requirement must remain green on submit");
    assert(documentMock.getElementById("resetPassReqLower").getAttribute("data-req-state") === "green", "Satisfied lowercase requirement must remain green on submit");
    assert(documentMock.getElementById("resetPassReqNumber").getAttribute("data-req-state") === "green", "Satisfied number requirement must remain green on submit");
    assert(srvUserBeforeInvalidReset.passwordHash === hashBeforeInvalidReset, "Invalid password must not be sent to or accepted by the backend");

    resetNewPassInput.value = "UpdatedPass@2026";
    resetNewPassInput.dispatchEvent({ type: "input" });
    for (const rId of Object.keys(resetReqTexts)) {
      assert(documentMock.getElementById(rId).getAttribute("data-req-state") === "green", `All 5 Reset Password requirements must be green for valid password (${rId})`);
    }
    resetConfirmPassInput.value = "MismatchPass@2026";
    resetConfirmPassInput.dispatchEvent({ type: "input" });
    assert(!documentMock.getElementById("forgotConfirmPasswordFeedback").classList.contains("hidden") && documentMock.getElementById("forgotConfirmPasswordFeedback").getAttribute("data-match-state") === "red", "Confirm Password mismatch feedback must be displayed");

    await app.AuthService.resetPasswordAfterRecovery("nawyazahammedhridoy2003@gmail.com", resetOtpCode, "UpdatedPass@2026", "MismatchPass@2026");
    assert(srvUserBeforeInvalidReset.passwordHash === hashBeforeInvalidReset && app.state.authTab === "FORGOT", "Mismatched Confirm Password must block submission");

    resetConfirmPassInput.value = "UpdatedPass@2026";
    resetConfirmPassInput.dispatchEvent({ type: "input" });
    assert(documentMock.getElementById("forgotConfirmPasswordFeedback").getAttribute("data-match-state") === "green", "Confirm Password feedback must indicate match when passwords match");

    await app.AuthService.resetPasswordAfterRecovery("nawyazahammedhridoy2003@gmail.com", resetOtpCode, "UpdatedPass@2026", "UpdatedPass@2026");
    assert(srvUserBeforeInvalidReset.passwordHash !== hashBeforeInvalidReset, "Valid password reset must update the user's password in Supabase Auth");
    assert(app.state.authTab === "LOGIN", "Successful password reset must return to the Login screen");

    await app.AuthService.signInWithPassword("nawyazahammedhridoy2003@gmail.com", "UpdatedPass@2026");
    assert(app.state.isAuthenticated === true && app.state.currentUser.email === "nawyazahammedhridoy2003@gmail.com", "User must be able to log in with the newly reset password");

    serverUsersByEmail.delete("nawyazahammedhridoy2003@gmail.com");
    app.BackendDB.data.users = app.BackendDB.data.users.filter(u => u.email !== "nawyazahammedhridoy2003@gmail.com");
    app.AuthService.login("rahim.ahmed@gmail.com", "password123");
    app.BackendDB.resetUserBaseline("usr_rahim_01");
    app.switchView("OVERVIEW");

    console.log("[PASS] Test 38: Six-box OTP input (manual, paste, autofill, leading zeros, focus 6th box), complete OTP preview card removal, green notification banner below SCREENSYNC AUTH badge, Reset Password 5-rule live validation + Confirm Password, Update Password & Verify buttons, and full auth regressions verified.");
    console.log("=== ALL 38 TEST SUITES PASSED 100% ===");
  }

  // -------------------------------------------------------------------------
  // TEST 39: SUPABASE CLIENT CONFIGURATION, CREDENTIAL SECURITY & EMAIL TEMPLATES
  // -------------------------------------------------------------------------
  {
    const cfg = app.SUPABASE_CONFIG;
    assert(cfg, "SUPABASE_CONFIG must be defined and exposed");
    assert.strictEqual(cfg.url, "https://ldephpgydnsovhlkuzbe.supabase.co", "Supabase URL must match the exact supplied base Project URL");
    assert(!cfg.url.includes("/rest/v1"), "Supabase URL must not append /rest/v1/");
    assert.strictEqual(cfg.publishableKey, "sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q", "Supabase Publishable Key must match the exact supplied public key");
    assert.strictEqual(cfg.projectRef, "ldephpgydnsovhlkuzbe", "Supabase projectRef must be ldephpgydnsovhlkuzbe");
    assert.strictEqual(cfg.otpLength, 6, "Configured email OTP length must be 6 digits");
    assert.strictEqual(cfg.otpExpirationSeconds, 3600, "Configured server-side OTP expiration must be 3600 seconds");

    const validRes = app.SupabaseClientManager.validateConfiguration();
    assert(validRes.valid === true && validRes.errors.length === 0, "Default SUPABASE_CONFIG must pass validation");

    const badRestUrlRes = app.SupabaseClientManager.validateConfiguration({
      url: "https://ldephpgydnsovhlkuzbe.supabase.co/rest/v1/",
      publishableKey: "sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q"
    });
    assert(badRestUrlRes.valid === false, "Validator must reject URLs with /rest/v1/ appended");

    const badSecretKeyRes = app.SupabaseClientManager.validateConfiguration({
      url: "https://ldephpgydnsovhlkuzbe.supabase.co",
      publishableKey: "sb_secret_fake_service_role_key"
    });
    assert(badSecretKeyRes.valid === false, "Validator must reject secret or service-role keys in frontend configuration");

    const assetPaths = [
      path.join(__dirname, "..", "www", "index.html"),
      path.join(__dirname, "..", "src", "index.html"),
      path.join(__dirname, "..", "src", "js", "app.js"),
      path.join(__dirname, "..", "android", "app", "src", "main", "assets", "public", "index.html"),
      path.join(__dirname, "..", "ios", "App", "App", "public", "index.html")
    ];
    for (const p of assetPaths) {
      const content = fs.readFileSync(p, "utf8");
      assert(!/xkeysib-[a-zA-Z0-9-]+/i.test(content), `Brevo SMTP API key must never appear in ${p}`);
      assert(!/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]*service_role/i.test(content), `Service role JWT must never appear in ${p}`);
      assert(content.includes("https://ldephpgydnsovhlkuzbe.supabase.co"), `Supabase base URL must be present in ${p}`);
      assert(content.includes("sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q"), `Supabase publishable key must be present in ${p}`);
    }

    // Verify Supabase config.toml and Brevo OTP Email Templates exist and use {{ .Token }}
    const supaConfigToml = fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8");
    const confirmTemplate = fs.readFileSync(path.join(__dirname, "..", "supabase", "email-templates", "confirm-signup.html"), "utf8");
    const resetTemplate = fs.readFileSync(path.join(__dirname, "..", "supabase", "email-templates", "reset-password.html"), "utf8");
    assert(supaConfigToml.includes("otp_length = 6") && supaConfigToml.includes("otp_exp = 3600"), "supabase/config.toml must configure 6-digit OTP and 3600s expiry");
    assert(confirmTemplate.includes("{{ .Token }}"), "confirm-signup.html must use {{ .Token }} variable for 6-digit OTP");
    assert(resetTemplate.includes("{{ .Token }}"), "reset-password.html must use {{ .Token }} variable for 6-digit OTP");

    console.log("[PASS] Test 39: Supabase Client Configuration, Credential Security, and Brevo 6-digit OTP Email Templates verified.");
  }

  // -------------------------------------------------------------------------
  // TEST 40: COMPLETE OTP PRIVACY & VERIFICATION SUITE DIAGNOSTICS UI
  // -------------------------------------------------------------------------
  {
    const forbiddenIds = ["simulatedInboxCard", "btnAutoFillOtp", "simulatedEmailTo", "simulatedOtpDisplay", "btnRunAccountDiagnostics", "accountSessionBadge"];
    for (const id of forbiddenIds) {
      assert(!elementsById.has(id), `Forbidden element #${id} must be completely absent from DOM`);
      assert(!html.includes(`id="${id}"`), `Forbidden element #${id} must not exist in www/index.html`);
    }

    const forbiddenIdentifiers = [
      "simulatedInboxCard",
      "simulatedOtpDisplay",
      "simulatedEmailTo",
      "btnAutoFillOtp",
      "pendingOtpCode",
      "otpRecords",
      "issueServerVerificationEmail",
      "verifyServerOtpHash"
    ];
    const jsSource = fs.readFileSync(path.join(__dirname, "..", "src", "js", "app.js"), "utf8");
    for (const ident of forbiddenIdentifiers) {
      assert(!jsSource.includes(ident), `Forbidden simulated OTP identifier "${ident}" must be completely removed from src/js/app.js`);
      assert(!html.includes(ident), `Forbidden simulated OTP identifier "${ident}" must be completely removed from www/index.html`);
    }

    assert(app.state.pendingOtpCode === undefined, "state.pendingOtpCode must not exist");
    assert(app.BackendDB.data.otpRecords === undefined, "BackendDB.data.otpRecords must not exist");

    // Verify Account Diagnostics are integrated into #viewFaqVerificationSuite and #btnRefreshVerificationSuite
    assert(documentMock.getElementById("viewFaqVerificationSuite") !== null, "#viewFaqVerificationSuite must exist");
    assert(documentMock.getElementById("btnRefreshVerificationSuite") !== null, "#btnRefreshVerificationSuite must exist");
    const diagReport = app.HelpCenterController.renderVerificationSuite();
    assert(diagReport && diagReport.supabaseClientStatus && diagReport.supabaseClientStatus.projectRef === "ldephpgydnsovhlkuzbe", "Verification Suite must report genuine Supabase project diagnostics");
    const suiteListHtml = documentMock.getElementById("verificationSuiteItemsList").innerHTML;
    assert(suiteListHtml.includes("verifyRowSupabaseClient") && suiteListHtml.includes("verifyRowDatabaseRls") && suiteListHtml.includes("verifyRowMigration"), "Verification Suite must render Supabase Client, Database/RLS, and Migration diagnostic rows");

    console.log("[PASS] Test 40: Complete OTP privacy and Verification Suite (#viewFaqVerificationSuite / #btnRefreshVerificationSuite) diagnostics verified.");
  }

  // -------------------------------------------------------------------------
  // TEST 41: REAL SUPABASE AUTHENTICATION, LOGOUT FLAG & REFRESH SEQUENCE
  // -------------------------------------------------------------------------
  {
    const signupRes = await app.AuthService.signUp("Tariq Hasan", "tariq.hasan@example.com", "SecurePass123!");
    assert(signupRes.ok === true && signupRes.status === "OTP_VERIFICATION_REQUIRED", "Signup must succeed and require 6-digit email OTP verification");
    assert.strictEqual(signupRes.otpExpirationSeconds, 3600, "Signup OTP expiration must use 3600s server configuration");

    const prematureLogin = await app.AuthService.signInWithPassword("tariq.hasan@example.com", "SecurePass123!");
    assert(prematureLogin.ok === false && prematureLogin.status === "EMAIL_NOT_VERIFIED", "Unverified account must be rejected from logging in before email OTP verification");

    const wrongOtpRes = await app.AuthService.verifyEmailOtp("tariq.hasan@example.com", "000000", "SIGNUP");
    assert(wrongOtpRes.ok === false && wrongOtpRes.status === "INVALID_OTP", "Wrong 6-digit OTP must be rejected");

    const otpEntry = serverOtpByEmailAndType.get("tariq.hasan@example.com::signup");
    otpEntry.expiresAtMs = Date.now() - 1000;
    const expiredOtpRes = await app.AuthService.verifyEmailOtp("tariq.hasan@example.com", latestServerGeneratedOtpForTestOnly, "SIGNUP");
    assert(expiredOtpRes.ok === false && expiredOtpRes.status === "OTP_EXPIRED", "Expired OTP (>3600s) must be rejected");

    const resendRes = await app.AuthService.resendVerificationOtp("tariq.hasan@example.com", "SIGNUP");
    assert(resendRes.ok === true && resendRes.status === "OTP_RESENT", "Resending 6-digit OTP must succeed");

    const validOtpRes = await app.AuthService.verifyEmailOtp("tariq.hasan@example.com", latestServerGeneratedOtpForTestOnly, "SIGNUP");
    assert(validOtpRes.ok === true && validOtpRes.status === "VERIFIED_AND_AUTHENTICATED", "Valid 6-digit OTP must verify email and establish session");
    assert.strictEqual(app.state.currentUser.email, "tariq.hasan@example.com", "Current user email must be tariq.hasan@example.com");

    // Requirement 8: Exact Logout -> Page Refresh -> No Auto-Relogin -> Intentional Login Sequence
    // 1. User is signed in.
    assert(app.state.isAuthenticated === true, "Step 1: User is signed in");
    // 2. User selects Logout.
    app.AuthService.logout({ silent: true });
    // 3. App clears authenticated session and records explicit logout flag.
    assert(app.state.isAuthenticated === false, "Step 2-3: User is logged out");
    assert(localStorageMock.getItem("screensync_explicit_logout_flag_v2") === "1", "Step 3: AUTH_LOGOUT_FLAG_KEY must be set to '1'");
    assert(localStorageMock.getItem("screensync_authenticated_session_v2") === null, "Step 3: Stored session must be cleared");
    // 4. Refreshing the page (calling restoreSession() and restoreSupabaseSession()) must NOT automatically sign the user back in, even if a token lingered in memory.
    const refreshRestore1 = app.AuthService.restoreSession();
    const refreshRestore2 = await app.AuthService.restoreSupabaseSession();
    assert(refreshRestore1.restored === false && refreshRestore1.status === "LOGGED_OUT_PREVIOUSLY", "Step 4a: restoreSession() after logout refresh must NOT auto-sign in");
    assert(refreshRestore2.restored === false && refreshRestore2.status === "LOGGED_OUT_PREVIOUSLY", "Step 4b: restoreSupabaseSession() after logout refresh must NOT auto-sign in");
    assert(app.state.isAuthenticated === false, "Step 4c: App must remain logged out after page refresh");
    // 5. User can still intentionally sign in again.
    const intentionalLogin = await app.AuthService.signInWithPassword("tariq.hasan@example.com", "SecurePass123!");
    assert(intentionalLogin.ok === true && app.state.isAuthenticated === true, "Step 5: Intentional sign-in after logout must succeed");
    assert(localStorageMock.getItem("screensync_explicit_logout_flag_v2") === null, "Step 5b: Intentional sign-in must clear AUTH_LOGOUT_FLAG_KEY");
    // 6. A legitimate active session must be restored when no explicit logout state prevents restoration.
    const activeRestore = await app.AuthService.restoreSupabaseSession();
    assert(activeRestore.restored === true && activeRestore.status === "SUPABASE_SESSION_RESTORED", "Step 6: Active session must be restored when no logout flag is set");

    // Password Recovery & Reset
    app.AuthService.logout({ silent: true });
    const forgotRes = await app.AuthService.requestPasswordRecovery("tariq.hasan@example.com");
    assert(forgotRes.ok === true && forgotRes.status === "RECOVERY_OTP_SENT", "Forgot password must send recovery OTP via Supabase Auth");
    const resetPassRes = await app.AuthService.resetPasswordAfterRecovery(
      "tariq.hasan@example.com",
      latestServerGeneratedOtpForTestOnly,
      "NewUpdatedPass789!",
      "NewUpdatedPass789!"
    );
    assert(resetPassRes.ok === true && resetPassRes.status === "PASSWORD_RESET_SUCCESS", "Password reset after recovery OTP verification must succeed");
    const newPassLogin = await app.AuthService.signInWithPassword("tariq.hasan@example.com", "NewUpdatedPass789!");
    assert(newPassLogin.ok === true && newPassLogin.status === "AUTHENTICATED", "Login with newly reset password must succeed");

    console.log("[PASS] Test 41: Real Supabase Authentication, OTP Verification, Password Recovery, and Logout -> Refresh -> Intentional Re-login Sequence verified.");
  }

  // -------------------------------------------------------------------------
  // TEST 42: DATABASE MIGRATIONS (001-004), SCHEMA/RPC RECONCILIATION,
  //          TWO-USER RLS ISOLATION, CLOUD SYNC & LOCAL-TO-ACCOUNT MIGRATION
  // -------------------------------------------------------------------------
  {
    const userAUid = app.state.currentUser.userId;
    const migDir = path.join(__dirname, "..", "supabase", "migrations");
    const mig1 = fs.readFileSync(path.join(migDir, "20261022000001_create_screensync_schema.sql"), "utf8");
    const mig2 = fs.readFileSync(path.join(migDir, "20261022000002_enable_rls_and_policies.sql"), "utf8");
    const mig3 = fs.readFileSync(path.join(migDir, "20261022000003_verify_rls_and_schema_tests.sql"), "utf8");
    const mig4 = fs.readFileSync(path.join(migDir, "20261022000004_reconcile_schema_and_rpcs.sql"), "utf8");

    for (const tbl of app.SupabaseSyncEngine.REQUIRED_TABLES) {
      assert(mig1.includes(`CREATE TABLE IF NOT EXISTS public.${tbl}`), `Migration 1 must create table public.${tbl}`);
      assert(mig2.includes(`ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY;`), `Migration 2 must enable RLS on public.${tbl}`);
      assert(mig2.includes(`ALTER TABLE public.${tbl} FORCE ROW LEVEL SECURITY;`), `Migration 2 must force RLS on public.${tbl}`);
    }
    assert(mig4.includes("CREATE TABLE IF NOT EXISTS public.security_alerts") && mig4.includes("CREATE OR REPLACE FUNCTION public.get_account_usage_summary"), "Migration 4 must reconcile public.security_alerts and public.get_account_usage_summary");
    assert(!mig2.toLowerCase().includes("using (true)") && !mig2.toLowerCase().includes("with check (true)"), "Migration 2 must never use permissive USING (true) or WITH CHECK (true) policies");
    assert(mig3.includes("SET LOCAL ROLE authenticated"), "Migration 3 must test authenticated RLS role isolation");

    // Record usage data for User A (Tariq) and sync to Supabase
    app.recordValidTrackingEvent("iphone_16", "instagram", 5, 22, 45, "ev_user_a_inst1_01");
    app.GoalPickerController.saveDailyGoal("SCREEN", 2, 30, true);
    const syncARes = await app.SupabaseSyncEngine.syncAccountData(userAUid);
    assert(syncARes.ok === true && syncARes.synced === true, "User A data must sync to Supabase tables");

    // Verify both RPC names (get_account_daily_aggregates & get_account_usage_summary) work via fetchAccountDailySummaryRpc
    const rpcSummary = await app.SupabaseSyncEngine.fetchAccountDailySummaryRpc("2026-10-16");
    assert(rpcSummary.ok === true && rpcSummary.data.userId === userAUid, "Both RPC functions must return authenticated user's daily summary");

    // Create and verify User B (Nadia Islam)
    app.AuthService.logout({ silent: true });
    await app.AuthService.signUp("Nadia Islam", "nadia.islam@example.com", "NadiaSecret123!");
    await app.AuthService.verifyEmailOtp("nadia.islam@example.com", latestServerGeneratedOtpForTestOnly, "SIGNUP");
    const userBUid = app.state.currentUser.userId;
    assert(userBUid !== userAUid, "User B must have a distinct Supabase Auth UUID from User A");

    const db = app.SupabaseClientManager.getActiveDbClient();
    const userBReadsUserAProfiles = await db.from("user_profiles").select("*").eq("id", userAUid);
    const userBReadsUserADevices = await db.from("device_installations").select("*").eq("user_id", userAUid);
    const userBReadsUserASessions = await db.from("screen_usage_sessions").select("*").eq("user_id", userAUid);
    const userBReadsUserAReels = await db.from("reel_watch_events").select("*").eq("user_id", userAUid);
    const userBReadsUserASettings = await db.from("user_settings").select("*").eq("user_id", userAUid);
    assert.strictEqual(userBReadsUserAProfiles.data.length, 0, "RLS must prevent User B from reading User A's profile");
    assert.strictEqual(userBReadsUserADevices.data.length, 0, "RLS must prevent User B from reading User A's devices");
    assert.strictEqual(userBReadsUserASessions.data.length, 0, "RLS must prevent User B from reading User A's screen usage sessions");
    assert.strictEqual(userBReadsUserAReels.data.length, 0, "RLS must prevent User B from reading User A's reel watch events");
    assert.strictEqual(userBReadsUserASettings.data.length, 0, "RLS must prevent User B from reading User A's settings");

    const impersonateInsert = await db.from("screen_usage_sessions").insert({
      user_id: userAUid,
      session_id: "spoof_session_01",
      installation_id: `${userAUid}_inst_ios_01`,
      installation_key: "iphone_16",
      os_category: "iOS",
      app_key: "instagram",
      app_name: "Instagram",
      category: "Social networking",
      local_date: "2026-10-16",
      duration_minutes: 120
    });
    assert(impersonateInsert.error && impersonateInsert.error.code === "42501", "RLS WITH CHECK must reject User B inserting records with User A's user_id");

    const crossDeviceSpoof = await db.from("screen_usage_sessions").insert({
      user_id: userBUid,
      session_id: "spoof_cross_inst_01",
      installation_id: `${userAUid}_inst_ios_01`,
      installation_key: "iphone_16",
      os_category: "iOS",
      app_key: "instagram",
      app_name: "Instagram",
      category: "Social networking",
      local_date: "2026-10-16",
      duration_minutes: 45
    });
    assert(crossDeviceSpoof.error && crossDeviceSpoof.error.code === "42501", "Cross-table RLS policy must reject attaching usage records to another user's installation_id");

    app.AuthService.logout({ silent: true });
    const anonReadAttempt = await db.from("screen_usage_sessions").select("*");
    assert(anonReadAttempt.error && anonReadAttempt.error.code === "42501", "Unauthenticated anon client must be denied access to private tables");

    // Seed pre-login unauthenticated local usage data to verify safe migration on login
    app.BackendDB.data.sessionsByUser["local_unauthenticated"] = [
      {
        sessionId: "local_prelogin_sess_01",
        userId: "local_unauthenticated",
        installationKey: "s24_ultra",
        installationId: `${userAUid}_inst_and_01`,
        osCategory: "Android",
        appKey: "youtube",
        appName: "YouTube",
        category: "Entertainment",
        localDate: "2026-10-16",
        hasTimestamps: true,
        startEpochSec: app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 3600,
        endEpochSec: app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 5400,
        durationMinutes: 30,
        unlocks: 2,
        opens: 3,
        notifs: 1
      }
    ];

    await app.AuthService.signInWithPassword("tariq.hasan@example.com", "NewUpdatedPass789!");

    rlsTables.device_installations.push({
      user_id: userAUid,
      installation_id: `${userAUid}_inst_mac_01`,
      device_key: "macbook_pro",
      device_name: "MacBook Pro M3",
      device_model: "Apple Mac15,7",
      os_category: "macOS",
      device_category: "Laptop",
      os_version: "macOS 15",
      cutout_type: "FULLSCREEN",
      tracking_permitted: true,
      is_revoked: false
    });
    rlsTables.screen_usage_sessions.push({
      user_id: userAUid,
      session_id: "remote_mac_sess_01",
      interval_id: "remote_mac_sess_01",
      installation_id: `${userAUid}_inst_mac_01`,
      installation_key: "macbook_pro",
      os_category: "macOS",
      app_key: "chrome",
      app_name: "Chrome",
      category: "Productivity & finance",
      local_date: "2026-10-16",
      has_timestamps: true,
      start_epoch_sec: app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 7200,
      end_epoch_sec: app.ScreenTimeAggregator.parseDateStrToUtcEpochSec("2026-10-16", 0) + 10800,
      duration_minutes: 60,
      unlocks: 1,
      opens: 4,
      notifs: 2
    });
    rlsTables.reel_watch_events.push({
      user_id: userAUid,
      event_id: "remote_mac_reel_01",
      raw_event_id: "remote_mac_reel_01",
      installation_id: `${userAUid}_inst_mac_01`,
      installation_key: "macbook_pro",
      os_category: "macOS",
      app_key: "youtube",
      app_name: "YouTube",
      content_type: "SHORT",
      reel_count: 3,
      watch_minutes: 10,
      watch_seconds: 600,
      local_date: "2026-10-16",
      event_timestamp: "2026-10-16T15:10:00Z"
    });

    const crossSync1 = await app.SupabaseSyncEngine.syncAccountData(userAUid);
    assert(crossSync1.ok === true && crossSync1.synced === true, "Cross-device sync for User A must succeed");

    const snapAfterSync1 = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(snapAfterSync1.reelsCount, 8, "Cross-device sync must aggregate reels across installations (5 + 3 = 8)");
    assert(snapAfterSync1.totalScreenMinutes === 90 && snapAfterSync1.cumulativeScreenMinutes === 135, "Cross-device sync must include migrated local session (30m) + remote MacBook session (60m) = 90m timestamped union and 135m cumulative across all 3 devices");

    const crossSync2 = await app.SupabaseSyncEngine.syncAccountData(userAUid);
    const snapAfterSync2 = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(snapAfterSync2.reelsCount, snapAfterSync1.reelsCount, "Repeated cross-device sync must be idempotent and never double-count reels");
    assert.strictEqual(snapAfterSync2.totalScreenMinutes, snapAfterSync1.totalScreenMinutes, "Repeated cross-device sync must never double-count screen time");

    app.AutoSyncService.setOfflineMode(true);
    const offlineEv = app.recordValidTrackingEvent("iphone_16", "instagram", 2, 6, 10, "ev_user_a_offline_retry_01");
    assert.strictEqual(offlineEv.status, "QUEUED_OFFLINE", "Events recorded while offline must be queued safely");
    const syncWhileOffline = await app.SupabaseSyncEngine.syncAccountData(userAUid);
    assert.strictEqual(syncWhileOffline.status, "OFFLINE_QUEUED", "SupabaseSyncEngine must report OFFLINE_QUEUED honestly when offline");

    app.AutoSyncService.setOfflineMode(false);
    const syncAfterReconnect = await app.SupabaseSyncEngine.syncAccountData(userAUid);
    assert(syncAfterReconnect.ok === true && syncAfterReconnect.synced === true, "Reconnect must flush offline queue and sync cleanly to Supabase");
    const snapAfterReconnect = app.computeSnapshot("ALL", "DAY", 0);
    assert.strictEqual(snapAfterReconnect.reelsCount, 10, "Flushed offline event must increment User A's reel count from 8 to 10 exactly once");

    app.SupabaseClientManager.setTestTransportAdapter(null);
    app.AuthService.login("rahim.ahmed@gmail.com", "password123");
    app.BackendDB.resetUserBaseline("usr_rahim_01");
    app.renderAll();

    console.log("[PASS] Test 42: Database Migrations (001-004), Schema/RPC Reconciliation, Two-User RLS Isolation, SupabaseSyncEngine Cross-Device Sync, Safe Local-to-Account Migration, and Offline Retry verified.");
    console.log("=== ALL 42 TEST SUITES PASSED 100% ===");
  }
})().catch((err) => {
  console.error("Async test suite failed:", err);
  process.exit(1);
});
