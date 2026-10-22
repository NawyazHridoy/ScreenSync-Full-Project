package io.screensync.wellness;

import android.annotation.SuppressLint;
import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.provider.Settings;
import android.graphics.Rect;
import android.view.DisplayCutout;
import android.view.WindowInsets;
import java.util.List;

import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class MainActivity extends AppCompatActivity {
    private static MainActivity activeInstance;
    private WebView webView;
    private AppUsageDatabaseHelper usageDbHelper;
    private UsageEventIngestionEngine usageIngestionEngine;
    private ScreenTimeSessionCalculator sessionCalculator;

    public static MainActivity getActiveInstance() {
        return activeInstance;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        usageDbHelper = new AppUsageDatabaseHelper(this);
        usageIngestionEngine = new UsageEventIngestionEngine(this, usageDbHelper);
        sessionCalculator = new ScreenTimeSessionCalculator();

        // Preserve genuine device-native status bar (clock, network/Wi-Fi, battery)
        Window window = getWindow();
        if (window != null) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.setStatusBarColor(0xFF000000);
            window.setNavigationBarColor(0xFF000000);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && window.getInsetsController() != null) {
                window.getInsetsController().show(WindowInsets.Type.statusBars());
            } else {
                View decorView = window.getDecorView();
                int flags = decorView.getSystemUiVisibility();
                flags &= ~View.SYSTEM_UI_FLAG_FULLSCREEN;
                decorView.setSystemUiVisibility(flags);
            }
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new ScreenSyncAndroidBridge(), "ScreenSyncNativeBridge");
        webView.setBackgroundColor(0xFF000000);
        webView.setWebViewClient(new WebViewClient());
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    public void dispatchAccessibilityContextUpdate(final String pkg, final String surface, final boolean scrolled) {
        if (webView == null) return;
        webView.post(() -> {
            final String safePkg = pkg == null ? "" : pkg.replace("\"", "");
            final String safeSurf = surface == null ? "" : surface.replace("\"", "");
            if (scrolled && ("REEL".equals(safeSurf) || "SHORT".equals(safeSurf) || "TIKTOK".equals(safeSurf) || "STORY".equals(safeSurf) || "MESSENGER_STORY".equals(safeSurf))) {
                webView.evaluateJavascript(
                    "if (window.ScreenSyncApp && window.ScreenSyncApp.CrossPlatformScreenAccessManager) { " +
                    "window.ScreenSyncApp.CrossPlatformScreenAccessManager.processAuthorizedScreenActivity({ " +
                    "packageName: \"" + safePkg + "\", activityType: \"" + safeSurf + "\", direction: \"FORWARD\" }); }",
                    null
                );
            } else {
                webView.evaluateJavascript(
                    "if (window.ScreenSyncApp) { window.ScreenSyncApp.handleAutomaticAppContextChange(\"" + safePkg + "\", \"" + safeSurf + "\", { triggerRender: true, externalOsContext: true }); }",
                    null
                );
            }
        });
    }

    private boolean hasUsageStatsPermission() {
        AppOpsManager appOps = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private boolean isAccessibilityServiceEnabled() {
        String enabledServices = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabledServices == null) return false;
        return enabledServices.contains(getPackageName() + "/" + ScreenSyncAccessibilityService.class.getName()) ||
               enabledServices.contains(getPackageName() + "/.ScreenSyncAccessibilityService");
    }

    private String encodeDrawableToDataUri(Drawable drawable) {
        if (drawable == null) return null;
        try {
            int w = Math.max(48, Math.min(96, drawable.getIntrinsicWidth() > 0 ? drawable.getIntrinsicWidth() : 64));
            int h = Math.max(48, Math.min(96, drawable.getIntrinsicHeight() > 0 ? drawable.getIntrinsicHeight() : 64));
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            drawable.draw(canvas);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 90, baos);
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            return "data:image/png;base64," + b64;
        } catch (Exception e) {
            return null;
        }
    }

    public class ScreenSyncAndroidBridge {
        @JavascriptInterface
        public boolean canDrawOverlays() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return Settings.canDrawOverlays(MainActivity.this);
            }
            return true;
        }

        @JavascriptInterface
        public String checkPermissionStatus(String permissionId) {
            if ("usage_stats".equals(permissionId)) {
                return hasUsageStatsPermission() ? "GRANTED" : "DENIED";
            }
            if ("accessibility".equals(permissionId)) {
                return isAccessibilityServiceEnabled() ? "GRANTED" : "DENIED";
            }
            if ("overlay".equals(permissionId)) {
                return canDrawOverlays() ? "GRANTED" : "DENIED";
            }
            return "PENDING";
        }

        
        @JavascriptInterface
        public String getDisplayCutoutJson() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && getWindow() != null && getWindow().getDecorView() != null) {
                    WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
                    if (insets != null) {
                        DisplayCutout cutout = insets.getDisplayCutout();
                        if (cutout != null) {
                            List<Rect> rects = cutout.getBoundingRects();
                            JSONArray arr = new JSONArray();
                            int firstLeft = 0, firstTop = 0, firstRight = 0, firstBottom = 0;
                            for (int i = 0; i < rects.size(); i++) {
                                Rect r = rects.get(i);
                                JSONObject ro = new JSONObject();
                                ro.put("left", r.left);
                                ro.put("top", r.top);
                                ro.put("right", r.right);
                                ro.put("bottom", r.bottom);
                                ro.put("width", r.width());
                                ro.put("height", r.height());
                                arr.put(ro);
                                if (i == 0) {
                                    firstLeft = r.left;
                                    firstTop = r.top;
                                    firstRight = r.right;
                                    firstBottom = r.bottom;
                                }
                            }
                            JSONObject out = new JSONObject();
                            out.put("hasCutout", !rects.isEmpty());
                            out.put("safeInsetTop", cutout.getSafeInsetTop());
                            out.put("safeInsetBottom", cutout.getSafeInsetBottom());
                            out.put("safeInsetLeft", cutout.getSafeInsetLeft());
                            out.put("safeInsetLeftPx", cutout.getSafeInsetLeft());
                            out.put("safeInsetRight", cutout.getSafeInsetRight());
                            out.put("left", firstLeft);
                            out.put("top", firstTop);
                            out.put("right", firstRight);
                            out.put("bottom", firstBottom);
                            out.put("width", Math.max(0, firstRight - firstLeft));
                            out.put("height", Math.max(0, firstBottom - firstTop));
                            out.put("boundingRects", arr);
                            return out.toString();
                        }
                    }
                }
            } catch (Exception ignored) {}
            return "{\"hasCutout\":false}";
        }

        @JavascriptInterface
        public String getBrainpalCountersJson() {
            try {
                android.content.SharedPreferences prefs = getSharedPreferences("screensync_brainpal_store", Context.MODE_PRIVATE);
                JSONObject out = new JSONObject();
                out.put("dayKey", prefs.getString("current_day_key", ""));
                out.put("dailyReelCount", prefs.getInt("daily_reel_count", 0));
                out.put("dailyWatchDurationMs", prefs.getLong("daily_watch_duration_ms", 0L));
                return out.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String getInstalledAppsJson() {
            JSONArray arr = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
                mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> resolved = pm.queryIntentActivities(mainIntent, 0);
                Set<String> seenPackages = new HashSet<>();
                for (ResolveInfo ri : resolved) {
                    if (ri.activityInfo == null || ri.activityInfo.packageName == null) continue;
                    String pkgName = ri.activityInfo.packageName;
                    if (seenPackages.contains(pkgName)) continue;
                    seenPackages.add(pkgName);
                    CharSequence labelSeq = ri.loadLabel(pm);
                    String appLabel = labelSeq != null ? labelSeq.toString() : pkgName;
                    String iconDataUri = encodeDrawableToDataUri(ri.loadIcon(pm));
                    JSONObject obj = new JSONObject();
                    obj.put("packageId", pkgName);
                    obj.put("name", appLabel);
                    if (iconDataUri != null) {
                        obj.put("iconDataUri", iconDataUri);
                    }
                    arr.put(obj);
                }
            } catch (Exception ignored) {
            }
            return arr.toString();
        }

        @JavascriptInterface
        public String getNativeUsageStatsJson(long startEpochMs, long endEpochMs) {
            JSONObject result = new JSONObject();
            try {
                if (!hasUsageStatsPermission()) {
                    result.put("ok", false);
                    result.put("status", "PERMISSION_DENIED");
                    return result.toString();
                }
                if (usageIngestionEngine != null) {
                    usageIngestionEngine.ingestIncrementalEvents(System.currentTimeMillis());
                }
                JSONArray rawEventsJson = new JSONArray();
                if (usageDbHelper != null) {
                    List<AppUsageDatabaseHelper.RawEventRecord> dbEvents = usageDbHelper.queryEventsInWindow(startEpochMs, endEpochMs);
                    for (AppUsageDatabaseHelper.RawEventRecord ev : dbEvents) {
                        JSONObject evObj = new JSONObject();
                        evObj.put("rowId", ev.id);
                        evObj.put("packageName", ev.packageName);
                        evObj.put("timestampMs", ev.timestampMs);
                        evObj.put("eventType", ev.eventType);
                        rawEventsJson.put(evObj);
                    }
                }
                result.put("rawEvents", rawEventsJson);
                UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
                PackageManager pm = getPackageManager();
                Map<String, UsageStats> aggMap = usm.queryAndAggregateUsageStats(startEpochMs, endEpochMs);
                JSONArray entries = new JSONArray();
                if (aggMap != null) {
                    for (Map.Entry<String, UsageStats> entry : aggMap.entrySet()) {
                        UsageStats st = entry.getValue();
                        if (st == null) continue;
                        long fgMs = st.getTotalTimeInForeground();
                        if (fgMs < 60000L) continue;
                        String pkg = st.getPackageName();
                        String appLabel = pkg;
                        try {
                            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                            CharSequence cs = pm.getApplicationLabel(ai);
                            if (cs != null) appLabel = cs.toString();
                        } catch (Exception ignored) {
                        }
                        JSONObject item = new JSONObject();
                        item.put("packageId", pkg);
                        item.put("appName", appLabel);
                        item.put("durationMinutes", Math.round(fgMs / 60000.0));
                        item.put("aggregateOnly", true);
                        item.put("hasVerifiedReelSessions", false);
                        entries.put(item);
                    }
                }
                result.put("ok", true);
                result.put("osCategory", "Android");
                result.put("aggregateOnly", true);
                result.put("entries", entries);
            } catch (Exception e) {
                try {
                    result.put("ok", false);
                    result.put("status", "ERROR");
                } catch (Exception ignored) {
                }
            }
            return result.toString();
        }

        @JavascriptInterface
        public void openPermissionSettings(String permissionId, String actionTarget, String uriStr) {
            try {
                Intent intent;
                if ("overlay".equals(permissionId) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName())
                    );
                } else if ("usage_stats".equals(permissionId)) {
                    intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                } else if ("accessibility".equals(permissionId)) {
                    intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                } else if ("notifications".equals(permissionId) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void updateCompactPill(String jsonPayload) {
            // Native compact overlay hook (respects Settings.canDrawOverlays, preserves genuine status bar,
            // and enforces unified visibility: visible only in ScreenSync app or active Reel/Short/Story/Messenger Story activity)
        }

        @JavascriptInterface
        public void onActivityContextChanged(String appKey, String activityType) {
            if (webView != null) {
                final String safeApp = appKey == null ? "" : appKey.replace("\"", "");
                final String safeAct = activityType == null ? "" : activityType.replace("\"", "");
                webView.post(() -> webView.evaluateJavascript(
                    "if (window.ScreenSyncApp) { window.ScreenSyncApp.handleAutomaticAppContextChange(\"" + safeApp + "\", \"" + safeAct + "\", { triggerRender: true, externalOsContext: true }); }",
                    null
                ));
            }
        }

        @JavascriptInterface
        public void presentSystemGoalAlert(String jsonPayload) {
            // Dispatches system-level overlay or NotificationCompat alert
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.evaluateJavascript(
                "if (window.ScreenSyncApp && window.ScreenSyncApp.ReelTrackingEngine) { window.ScreenSyncApp.ReelTrackingEngine.onAppBackgrounded(); }",
                null
            );
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.evaluateJavascript(
                "if (window.ScreenSyncApp) { window.ScreenSyncApp.ReelTrackingEngine.onAppForegrounded(); window.ScreenSyncApp.AutoSyncService.syncWithBackend(); }",
                null
            );
        }
    }

    @Override
    protected void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
