/*
 * PROVENANCE LABEL: [RECONSTRUCTED BACKGROUND REFRESH, BOOT RECOVERY & TIMEZONE HANDLER]
 * Package: com.google.android.apps.wellbeing.sync
 * Handles event-driven and JobScheduler-driven ingestion of UsageEvents, plus recovery after
 * device reboots (BOOT_COMPLETED / LOCKED_BOOT_COMPLETED), package uninstalls (PACKAGE_REMOVED),
 * and clock/timezone shifts (TIME_SET / TIMEZONE_CHANGED).
 */
package io.screensync.wellness;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
// Same-package: UsageEventIngestionEngine
// Same-package: AppUsageDatabaseHelper

public class WellbeingRefreshScheduler {
    public static final int JOB_ID_PERIODIC_EVENT_SYNC = 1001;
    public static final int JOB_ID_DAILY_DB_MAINTENANCE = 1002;
    // JobScheduler periodic interval (6 hours = 21,600,000 ms for background catch-up;
    // UI opening triggers immediate on-demand ingestion)
    public static final long PERIODIC_SYNC_INTERVAL_MS = 6L * 60L * 60L * 1000L;

    public static void schedulePeriodicSyncJobs(Context context, Class<? extends JobService> serviceClass) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;

        JobInfo syncJob = new JobInfo.Builder(
                JOB_ID_PERIODIC_EVENT_SYNC,
                new ComponentName(context, serviceClass))
                .setPeriodic(PERIODIC_SYNC_INTERVAL_MS)
                .setPersisted(true) // Requires RECEIVE_BOOT_COMPLETED
                .build();
        scheduler.schedule(syncJob);
    }

    public static class WellbeingSystemEventReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String action = intent.getAction();
            AppUsageDatabaseHelper dbHelper = new AppUsageDatabaseHelper(context);
            UsageEventIngestionEngine engine = new UsageEventIngestionEngine(context, dbHelper);

            switch (action) {
                case Intent.ACTION_BOOT_COMPLETED:
                case Intent.ACTION_LOCKED_BOOT_COMPLETED:
                case Intent.ACTION_MY_PACKAGE_REPLACED:
                    // Re-ingest events since pre-shutdown and re-register AppUsageObservers
                    // (UsageStatsManager observers are cleared in system_server on reboot)
                    engine.ingestIncrementalEvents(System.currentTimeMillis());
                    break;

                case Intent.ACTION_TIME_CHANGED:
                case Intent.ACTION_TIMEZONE_CHANGED:
                    // Invalidate cached daily aggregations and re-slice UTC epoch events
                    // against the updated local ZoneId
                    engine.ingestIncrementalEvents(System.currentTimeMillis());
                    break;

                case Intent.ACTION_PACKAGE_REMOVED:
                    boolean replacing = intent.getBooleanExtra(Intent.EXTRA_REPLACING, false);
                    Uri data = intent.getData();
                    if (!replacing && data != null) {
                        String removedPkg = data.getSchemeSpecificPart();
                        if (removedPkg != null && !removedPkg.isEmpty()) {
                            dbHelper.deletePackageData(removedPkg);
                        }
                    }
                    break;

                default:
                    break;
            }
        }
    }
}
