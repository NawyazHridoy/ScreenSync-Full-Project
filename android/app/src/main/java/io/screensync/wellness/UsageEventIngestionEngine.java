/*
 * PROVENANCE LABEL: [RECONSTRUCTED SOURCE CODE BASED ON UsageStatsManager.queryEvents() & app_usage.events]
 * Package: com.google.android.apps.wellbeing.collector
 * Queries Android's UsageStatsManager for raw UsageEvents since the last high-water mark timestamp,
 * filters to the relevant event types stored in app_usage.events, deduplicates boundary events,
 * and persists them into the local SQLite database.
 */
package io.screensync.wellness;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.sqlite.SQLiteDatabase;
import android.os.Process;
import android.os.UserManager;
// Same-package: AppUsageDatabaseHelper

public class UsageEventIngestionEngine {
    private static final String PREFS_NAME = "wellbeing_sync_prefs";
    private static final String KEY_LAST_SYNC_MS = "last_ingested_event_timestamp_ms";
    private static final long INITIAL_BACKFILL_WINDOW_MS = 10L * 24L * 60L * 60L * 1000L; // 10 days backfill when enabled
    private static final String DEVICE_PACKAGE_ANDROID = "android";

    // Event types persisted in Digital Wellbeing's app_usage.events table
    public static final int EVENT_ACTIVITY_RESUMED = UsageEvents.Event.ACTIVITY_RESUMED;               // 1
    public static final int EVENT_ACTIVITY_PAUSED = UsageEvents.Event.ACTIVITY_PAUSED;                 // 2
    public static final int EVENT_NOTIFICATION_INTERRUPTION = 12;                                      // 12 (@SystemApi)
    public static final int EVENT_SCREEN_INTERACTIVE = UsageEvents.Event.SCREEN_INTERACTIVE;           // 15
    public static final int EVENT_SCREEN_NON_INTERACTIVE = UsageEvents.Event.SCREEN_NON_INTERACTIVE;   // 16
    public static final int EVENT_KEYGUARD_SHOWN = UsageEvents.Event.KEYGUARD_SHOWN;                   // 17
    public static final int EVENT_KEYGUARD_HIDDEN = UsageEvents.Event.KEYGUARD_HIDDEN;                 // 18
    public static final int EVENT_FOREGROUND_SERVICE_START = UsageEvents.Event.FOREGROUND_SERVICE_START; // 19
    public static final int EVENT_FOREGROUND_SERVICE_STOP = UsageEvents.Event.FOREGROUND_SERVICE_STOP;   // 20
    public static final int EVENT_ACTIVITY_STOPPED = UsageEvents.Event.ACTIVITY_STOPPED;               // 23
    public static final int EVENT_DEVICE_SHUTDOWN = UsageEvents.Event.DEVICE_SHUTDOWN;                 // 26
    public static final int EVENT_DEVICE_STARTUP = UsageEvents.Event.DEVICE_STARTUP;                   // 27

    private final Context context;
    private final UsageStatsManager usageStatsManager;
    private final AppUsageDatabaseHelper dbHelper;
    private final SharedPreferences syncPrefs;

    public UsageEventIngestionEngine(Context context, AppUsageDatabaseHelper dbHelper) {
        this.context = context.getApplicationContext();
        this.usageStatsManager = (UsageStatsManager) this.context.getSystemService(Context.USAGE_STATS_SERVICE);
        this.dbHelper = dbHelper;
        this.syncPrefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public boolean hasUsageStatsPermission() {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.getPackageName()
        );
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    public static boolean isTrackedEventType(int type) {
        switch (type) {
            case EVENT_ACTIVITY_RESUMED:
            case EVENT_ACTIVITY_PAUSED:
            case EVENT_NOTIFICATION_INTERRUPTION:
            case EVENT_SCREEN_INTERACTIVE:
            case EVENT_SCREEN_NON_INTERACTIVE:
            case EVENT_KEYGUARD_SHOWN:
            case EVENT_KEYGUARD_HIDDEN:
            case EVENT_FOREGROUND_SERVICE_START:
            case EVENT_FOREGROUND_SERVICE_STOP:
            case EVENT_ACTIVITY_STOPPED:
            case EVENT_DEVICE_SHUTDOWN:
            case EVENT_DEVICE_STARTUP:
                return true;
            default:
                return false;
        }
    }

    /**
     * Queries UsageStatsManager.queryEvents(beginTime, endTime) incrementally and persists
     * new events into app_usage.events.
     */
    public synchronized int ingestIncrementalEvents(long nowMs) {
        UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
        if (um != null && !um.isUserUnlocked()) {
            // Android R+ (API 30+): UsageStatsManager returns null/empty before Direct Boot unlock
            return 0;
        }
        if (!hasUsageStatsPermission()) {
            dbHelper.flushAllTables();
            return 0;
        }

        long lastSyncMs = syncPrefs.getLong(KEY_LAST_SYNC_MS, -1L);
        long beginTimeMs = (lastSyncMs <= 0L || lastSyncMs > nowMs)
                ? (nowMs - INITIAL_BACKFILL_WINDOW_MS)
                : (lastSyncMs + 1L);

        UsageEvents usageEvents = usageStatsManager.queryEvents(beginTimeMs, nowMs);
        if (usageEvents == null) {
            return 0;
        }

        SQLiteDatabase db = dbHelper.getWritableDatabase();
        UsageEvents.Event eventOut = new UsageEvents.Event();
        int insertedCount = 0;
        long maxObservedTimestamp = lastSyncMs;

        db.beginTransaction();
        try {
            while (usageEvents.hasNextEvent()) {
                usageEvents.getNextEvent(eventOut);
                int eventType = eventOut.getEventType();
                if (!isTrackedEventType(eventType)) {
                    continue;
                }
                long ts = eventOut.getTimeStamp();
                String pkg = eventOut.getPackageName();
                if (pkg == null || pkg.isEmpty()) {
                    pkg = DEVICE_PACKAGE_ANDROID;
                }
                long pkgId = dbHelper.getOrCreatePackageId(db, pkg);
                ContentValues cv = new ContentValues();
                cv.put("package_id", pkgId);
                cv.put("timestamp", ts);
                cv.put("type", eventType);
                db.insert("events", null, cv);
                insertedCount++;
                if (ts > maxObservedTimestamp) {
                    maxObservedTimestamp = ts;
                }
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }

        if (maxObservedTimestamp > lastSyncMs) {
            syncPrefs.edit().putLong(KEY_LAST_SYNC_MS, maxObservedTimestamp).apply();
        }
        return insertedCount;
    }
}
