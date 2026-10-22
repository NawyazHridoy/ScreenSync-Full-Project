package io.screensync.wellness;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * ScreenSyncAccessibilityService
 * Implements the Brainpal & Reel-Counting 6-State FSM, Three-Gate / Three-Tier
 * Short-Form Surface Classifier, Volatile Metric Sanitizer, Per-Package 40-Item LRU
 * Deduplication Cache, and Monotonic Watch-Time Accumulator.
 */
public class ScreenSyncAccessibilityService extends AccessibilityService {

    public enum State {
        INACTIVE,
        SURFACE_ACTIVE,
        REEL_CANDIDATE,
        REEL_COUNTED,
        PAUSED_OVERLAY,
        PAUSED_SYSTEM
    }

    private static final long MIN_REEL_DWELL_MS = 1200L;
    private static final long SCROLL_SETTLE_DEBOUNCE_MS = 300L;
    private static final long HEARTBEAT_TICK_MS = 1000L;
    private static final long MAX_IDLE_GAP_MS = 30000L;
    private static final long IDLE_CLAMP_CREDIT_MS = 5000L;
    private static final int RECENT_SIGNATURE_LRU_SIZE = 40;

    private static final Set<String> SUPPORTED_PACKAGES = new HashSet<>(Arrays.asList(
        "com.instagram.android",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
        "com.zhiliaoapp.musically.go",
        "com.facebook.katana",
        "com.facebook.lite",
        "com.facebook.orca",
        "com.whatsapp",
        "com.snapchat.android"
    ));

    private static final Map<String, Set<String>> TIER1_VIEW_IDS = new HashMap<>();
    static {
        TIER1_VIEW_IDS.put("com.instagram.android", new HashSet<>(Arrays.asList(
            "com.instagram.android:id/clips_viewer_view_pager",
            "com.instagram.android:id/clips_video_container",
            "com.instagram.android:id/reel_viewer_root"
        )));
        TIER1_VIEW_IDS.put("com.google.android.youtube", new HashSet<>(Arrays.asList(
            "com.google.android.youtube:id/reel_recycler",
            "com.google.android.youtube:id/reel_player_page_container",
            "com.google.android.youtube:id/shorts_player_view"
        )));
        Set<String> tiktokIds = new HashSet<>(Arrays.asList(
            "com.zhiliaoapp.musically:id/viewpager",
            "com.ss.android.ugc.trill:id/viewpager"
        ));
        TIER1_VIEW_IDS.put("com.zhiliaoapp.musically", tiktokIds);
        TIER1_VIEW_IDS.put("com.ss.android.ugc.trill", tiktokIds);
        TIER1_VIEW_IDS.put("com.zhiliaoapp.musically.go", tiktokIds);
        TIER1_VIEW_IDS.put("com.facebook.katana", new HashSet<>(Arrays.asList(
            "com.facebook.katana:id/fb_shorts_viewer_pager",
            "com.facebook.katana:id/reels_viewer_container"
        )));
        TIER1_VIEW_IDS.put("com.snapchat.android", new HashSet<>(Arrays.asList(
            "com.snapchat.android:id/spotlight_view_pager"
        )));
    }

    private static final Pattern VOLATILE_METRIC_REGEX = Pattern.compile(
        "^\\d+(\\.\\d+)?[KMBkmb]?(\\s+(likes?|comments?|views?|shares?|reposts?))?$",
        Pattern.CASE_INSENSITIVE
    );

    private State state = State.INACTIVE;
    private String activePackage = null;
    private String candidateSignature = null;
    private int candidateScrollIdx = -1;
    private int lastCountedScrollIdx = -1;
    private long candidateEnteredElapsedMs = 0L;
    private long accumulatedCandidateDwellMs = 0L;
    private long lastTickElapsedMs = 0L;
    private long lastUserInteractionElapsedMs = 0L;

    private final Map<String, LinkedHashMap<String, Long>> lruByPackage = new HashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable settleRunnable = new Runnable() {
        @Override
        public void run() {
            evaluateSettledCandidate();
        }
    };

    private final Runnable dwellRunnable = new Runnable() {
        @Override
        public void run() {
            commitCandidateIfEligible();
        }
    };

    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            onHeartbeatTick();
            if (isWatchingState(state)) {
                handler.postDelayed(this, HEARTBEAT_TICK_MS);
            }
        }
    };

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        long now = SystemClock.elapsedRealtime();

        if ("com.android.systemui".equals(pkg)) return;

        if (!SUPPORTED_PACKAGES.contains(pkg)) {
            if (state != State.INACTIVE) {
                flushWatchDelta(now);
                transitionTo(State.INACTIVE, now);
            }
            return;
        }

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        try {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            boolean isShortForm = isShortFormSurfaceActive(root, pkg, dm.widthPixels, dm.heightPixels);
            if (!isShortForm) {
                if (state != State.INACTIVE) {
                    flushWatchDelta(now);
                    transitionTo(State.INACTIVE, now);
                }
                return;
            }

            if (hasBlockingOverlaySheet(root, dm.heightPixels)) {
                if (isWatchingState(state)) {
                    accumulatedCandidateDwellMs += Math.max(0L, now - candidateEnteredElapsedMs);
                    flushWatchDelta(now);
                    transitionTo(State.PAUSED_OVERLAY, now);
                }
                return;
            } else if (state == State.PAUSED_OVERLAY) {
                candidateEnteredElapsedMs = now;
                lastTickElapsedMs = now;
                long remaining = Math.max(0L, MIN_REEL_DWELL_MS - accumulatedCandidateDwellMs);
                transitionTo(State.REEL_CANDIDATE, now);
                handler.postDelayed(dwellRunnable, remaining);
            }

            activePackage = pkg;
            lastUserInteractionElapsedMs = now;

            if (state == State.INACTIVE) {
                transitionTo(State.SURFACE_ACTIVE, now);
            }

            int eventType = event.getEventType();
            if (eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED ||
                eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
                eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
                if (event.getToIndex() >= 0) {
                    candidateScrollIdx = event.getToIndex();
                }
                handler.removeCallbacks(settleRunnable);
                handler.postDelayed(settleRunnable, SCROLL_SETTLE_DEBOUNCE_MS);
            }
        } finally {
            root.recycle();
        }
    }

    @Override
    public void onInterrupt() {
        flushWatchDelta(SystemClock.elapsedRealtime());
    }

    private void evaluateSettledCandidate() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || activePackage == null) return;
        try {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            String sig = extractReelSignature(root, activePackage, candidateScrollIdx, dm.widthPixels, dm.heightPixels);
            if (sig == null || sig.equals(candidateSignature)) {
                return;
            }
            long now = SystemClock.elapsedRealtime();
            flushWatchDelta(now);
            candidateSignature = sig;
            candidateEnteredElapsedMs = now;
            accumulatedCandidateDwellMs = 0L;
            lastTickElapsedMs = now;
            transitionTo(State.REEL_CANDIDATE, now);
            handler.removeCallbacks(dwellRunnable);
            handler.postDelayed(dwellRunnable, MIN_REEL_DWELL_MS);
        } finally {
            root.recycle();
        }
    }

    private void commitCandidateIfEligible() {
        if (state != State.REEL_CANDIDATE || candidateSignature == null || activePackage == null) return;
        long now = SystemClock.elapsedRealtime();
        long totalDwell = accumulatedCandidateDwellMs + Math.max(0L, now - candidateEnteredElapsedMs);
        if (totalDwell < MIN_REEL_DWELL_MS) return;

        LinkedHashMap<String, Long> pkgCache = getPackageLru(activePackage);
        boolean isSeen = pkgCache.containsKey(candidateSignature);
        boolean isForwardProgress = (candidateScrollIdx == -1) || (candidateScrollIdx > lastCountedScrollIdx);

        if (!isSeen && isForwardProgress) {
            pkgCache.put(candidateSignature, now);
            if (candidateScrollIdx >= 0) {
                lastCountedScrollIdx = candidateScrollIdx;
            }
            incrementPersistedReelCount(activePackage);
        }
        transitionTo(State.REEL_COUNTED, now);
    }

    private void onHeartbeatTick() {
        long now = SystemClock.elapsedRealtime();
        flushWatchDelta(now);
    }

    private void flushWatchDelta(long nowElapsedMs) {
        if (!isWatchingState(state) || lastTickElapsedMs <= 0L) {
            lastTickElapsedMs = nowElapsedMs;
            return;
        }
        long deltaMs = nowElapsedMs - lastTickElapsedMs;
        lastTickElapsedMs = nowElapsedMs;
        if (deltaMs <= 0L) return;

        long timeSinceInteraction = nowElapsedMs - lastUserInteractionElapsedMs;
        if (timeSinceInteraction > MAX_IDLE_GAP_MS && deltaMs > IDLE_CLAMP_CREDIT_MS) {
            deltaMs = IDLE_CLAMP_CREDIT_MS;
        }
        addPersistedWatchDurationMs(deltaMs);
    }

    private void transitionTo(State next, long nowElapsedMs) {
        state = next;
        if (isWatchingState(next)) {
            lastTickElapsedMs = nowElapsedMs;
            handler.removeCallbacks(heartbeatRunnable);
            handler.postDelayed(heartbeatRunnable, HEARTBEAT_TICK_MS);
        } else {
            handler.removeCallbacks(heartbeatRunnable);
            handler.removeCallbacks(dwellRunnable);
            handler.removeCallbacks(settleRunnable);
        }
    }

    private boolean isWatchingState(State s) {
        return s == State.SURFACE_ACTIVE || s == State.REEL_CANDIDATE || s == State.REEL_COUNTED;
    }

    private LinkedHashMap<String, Long> getPackageLru(String pkg) {
        LinkedHashMap<String, Long> cache = lruByPackage.get(pkg);
        if (cache == null) {
            cache = new LinkedHashMap<String, Long>(RECENT_SIGNATURE_LRU_SIZE + 4, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
                    return size() > RECENT_SIGNATURE_LRU_SIZE;
                }
            };
            lruByPackage.put(pkg, cache);
        }
        return cache;
    }

    private boolean isShortFormSurfaceActive(AccessibilityNodeInfo root, String pkg, int screenW, int screenH) {
        Set<String> tier1 = TIER1_VIEW_IDS.get(pkg);
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        boolean hasFullViewportVerticalPager = false;
        boolean hasPositiveMarker = false;
        boolean hasNegativeMarker = false;
        Rect bounds = new Rect();

        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null || !node.isVisibleToUser()) continue;

            String viewId = node.getViewIdResourceName();
            if (viewId != null && tier1 != null && tier1.contains(viewId)) {
                return true;
            }

            CharSequence cls = node.getClassName();
            String clsName = cls != null ? cls.toString() : "";
            node.getBoundsInScreen(bounds);

            if ((clsName.contains("ViewPager") || clsName.contains("RecyclerView")) && node.isScrollable()) {
                if (bounds.width() >= screenW * 0.85f && bounds.height() >= screenH * 0.75f) {
                    hasFullViewportVerticalPager = true;
                }
            }

            String text = ((node.getText() != null ? node.getText().toString() : "") + " " +
                           (node.getContentDescription() != null ? node.getContentDescription().toString() : "")).toLowerCase(Locale.US);
            if (text.contains("reels") || text.contains("shorts") || text.contains("for you") || text.contains("original audio")) {
                hasPositiveMarker = true;
            }
            if ((text.contains("direct") || text.contains("messages") || text.contains("settings")) && bounds.top < screenH * 0.2f) {
                hasNegativeMarker = true;
            }

            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return hasFullViewportVerticalPager && hasPositiveMarker && !hasNegativeMarker;
    }

    private boolean hasBlockingOverlaySheet(AccessibilityNodeInfo root, int screenH) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        Rect bounds = new Rect();
        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null || !node.isVisibleToUser()) continue;
            String viewId = node.getViewIdResourceName();
            if (viewId != null) {
                String lowerId = viewId.toLowerCase(Locale.US);
                if (lowerId.contains("comment") || lowerId.contains("bottom_sheet") || lowerId.contains("share_sheet")) {
                    node.getBoundsInScreen(bounds);
                    if (bounds.height() >= screenH * 0.35f) {
                        return true;
                    }
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        return false;
    }

    private String extractReelSignature(AccessibilityNodeInfo root, String pkg, int scrollIdx, int screenW, int screenH) {
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        Rect bounds = new Rect();
        String authorOrDesc = "";
        String audioOrCaption = "";

        while (!queue.isEmpty()) {
            AccessibilityNodeInfo node = queue.poll();
            if (node == null || !node.isVisibleToUser()) continue;
            node.getBoundsInScreen(bounds);
            int cy = bounds.centerY();
            if (cy >= screenH * 0.15f && cy <= screenH * 0.90f) {
                String raw = node.getText() != null ? node.getText().toString().trim()
                    : (node.getContentDescription() != null ? node.getContentDescription().toString().trim() : "");
                if (!raw.isEmpty() && !VOLATILE_METRIC_REGEX.matcher(raw).matches()) {
                    String norm = raw.toLowerCase(Locale.US).replaceAll("\\s+", " ");
                    if (authorOrDesc.isEmpty()) authorOrDesc = norm;
                    else if (audioOrCaption.isEmpty() && !norm.equals(authorOrDesc)) audioOrCaption = norm;
                }
            }
            int count = node.getChildCount();
            for (int i = 0; i < count; i++) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) queue.add(child);
            }
        }
        if (authorOrDesc.isEmpty() && audioOrCaption.isEmpty() && scrollIdx < 0) return null;
        return pkg + "|" + authorOrDesc + "|" + audioOrCaption + "|" + scrollIdx;
    }

    private void incrementPersistedReelCount(String pkg) {
        SharedPreferences prefs = getSharedPreferences("screensync_brainpal_store", MODE_PRIVATE);
        ensureTodayKey(prefs);
        int nextTotal = prefs.getInt("daily_reel_count", 0) + 1;
        int nextPkg = prefs.getInt("pkg_count_" + pkg, 0) + 1;
        prefs.edit()
            .putInt("daily_reel_count", nextTotal)
            .putInt("pkg_count_" + pkg, nextPkg)
            .apply();
        MainActivity active = MainActivity.getActiveInstance();
        if (active != null) {
            String surface = "com.google.android.youtube".equals(pkg) ? "SHORT"
                : ("com.facebook.orca".equals(pkg) || "com.whatsapp".equals(pkg)) ? "STORY"
                : ("com.zhiliaoapp.musically".equals(pkg) || "com.ss.android.ugc.trill".equals(pkg)) ? "TIKTOK"
                : "REEL";
            active.dispatchAccessibilityContextUpdate(pkg, surface, true);
        }
    }

    private void addPersistedWatchDurationMs(long deltaMs) {
        SharedPreferences prefs = getSharedPreferences("screensync_brainpal_store", MODE_PRIVATE);
        ensureTodayKey(prefs);
        long nextMs = prefs.getLong("daily_watch_duration_ms", 0L) + deltaMs;
        prefs.edit().putLong("daily_watch_duration_ms", nextMs).apply();
    }

    private void ensureTodayKey(SharedPreferences prefs) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String saved = prefs.getString("current_day_key", "");
        if (!today.equals(saved)) {
            prefs.edit()
                .putString("current_day_key", today)
                .putInt("daily_reel_count", 0)
                .putLong("daily_watch_duration_ms", 0L)
                .apply();
            lruByPackage.clear();
        }
    }
}
