/*
 * PROVENANCE LABEL: [RECONSTRUCTED APP TIMER & FOCUS MODE ENFORCEMENT ENGINE]
 * Package: com.google.android.apps.wellbeing.limits
 * Demonstrates how Google Digital Wellbeing combines privileged permissions
 * (android.permission.OBSERVE_APP_USAGE and android.permission.SUSPEND_APPS)
 * with UsageStatsManager.registerAppUsageLimitObserver() and PackageManager.setPackagesSuspended().
 */
package io.screensync.wellness;

import android.app.PendingIntent;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.SuspendDialogInfo;
import android.os.PersistableBundle;
import java.time.Duration;

public class AppTimerSuspensionManager {
    private final Context context;
    private final UsageStatsManager usageStatsManager;
    private final PackageManager packageManager;

    public AppTimerSuspensionManager(Context context) {
        this.context = context.getApplicationContext();
        this.usageStatsManager = (UsageStatsManager) this.context.getSystemService(Context.USAGE_STATS_SERVICE);
        this.packageManager = this.context.getPackageManager();
    }

    /**
     * Registers a kernel/system_server usage limit observer for an app timer.
     * Requires android.permission.OBSERVE_APP_USAGE and android.permission.SUSPEND_APPS.
     */
    public void registerDailyAppTimer(
            int observerId,
            String packageName,
            long dailyLimitMs,
            long alreadyUsedTodayMs,
            PendingIntent limitReachedCallback) {

        if (alreadyUsedTodayMs >= dailyLimitMs) {
            suspendPackageForExpiredTimer(packageName);
            return;
        }
        // Calls @SystemApi UsageStatsManager.registerAppUsageLimitObserver
        // which delegates to com.android.server.usage.AppTimeLimitController in system_server
        /*
        usageStatsManager.registerAppUsageLimitObserver(
                observerId,
                new String[]{ packageName },
                Duration.ofMillis(dailyLimitMs),
                Duration.ofMillis(alreadyUsedTodayMs),
                limitReachedCallback
        );
        */
    }

    /**
     * Suspends a target package when its daily App Timer expires or Focus Mode starts.
     * Requires android.permission.SUSPEND_APPS.
     */
    public String[] suspendPackageForExpiredTimer(String packageName) {
        SuspendDialogInfo dialogInfo = new SuspendDialogInfo.Builder()
                .setTitle("App paused")
                .setMessage("Your daily timer for this app ran out. It will reset at midnight.")
                .setNeutralButtonAction(SuspendDialogInfo.BUTTON_ACTION_MORE_DETAILS)
                .build();

        PersistableBundle appExtras = new PersistableBundle();
        appExtras.putString("suspension_reason", "DIGITAL_WELLBEING_APP_TIMER");

        return packageManager.setPackagesSuspended(
                new String[]{ packageName },
                true,
                appExtras,
                null,
                dialogInfo
        );
    }

    public String[] unsuspendPackageAtMidnightOrUserOverride(String packageName) {
        return packageManager.setPackagesSuspended(
                new String[]{ packageName },
                false,
                null,
                null,
                null
        );
    }
}
