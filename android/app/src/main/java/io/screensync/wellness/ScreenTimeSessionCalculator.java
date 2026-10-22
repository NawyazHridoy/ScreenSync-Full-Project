/*
 * PROVENANCE LABEL: [RECONSTRUCTED SCREEN-TIME & USAGE METRICS ALGORITHM]
 * Package: com.google.android.apps.wellbeing.calculator
 * Implements session reconstruction, screen-interactive gating, midnight boundary splitting,
 * ongoing session clamping, launch counting, unlock counting, and notification counting.
 */
package io.screensync.wellness;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class ScreenTimeSessionCalculator {

    public static final int TYPE_ACTIVITY_RESUMED = 1;
    public static final int TYPE_ACTIVITY_PAUSED = 2;
    public static final int TYPE_NOTIFICATION_INTERRUPTION = 12;
    public static final int TYPE_SCREEN_INTERACTIVE = 15;
    public static final int TYPE_SCREEN_NON_INTERACTIVE = 16;
    public static final int TYPE_KEYGUARD_SHOWN = 17;
    public static final int TYPE_KEYGUARD_HIDDEN = 18;
    public static final int TYPE_ACTIVITY_STOPPED = 23;
    public static final int TYPE_DEVICE_SHUTDOWN = 26;
    public static final int TYPE_DEVICE_STARTUP = 27;

    public static final class UsageEventInput implements Comparable<UsageEventInput> {
        public final long rowId;
        public final String packageName;
        public final String className;
        public final int instanceId;
        public final long timestampMs;
        public final int eventType;

        public UsageEventInput(long rowId, String packageName, String className,
                               int instanceId, long timestampMs, int eventType) {
            this.rowId = rowId;
            this.packageName = packageName;
            this.className = className != null ? className : "";
            this.instanceId = instanceId;
            this.timestampMs = timestampMs;
            this.eventType = eventType;
        }

        @Override
        public int compareTo(UsageEventInput other) {
            int cmp = Long.compare(this.timestampMs, other.timestampMs);
            return (cmp != 0) ? cmp : Long.compare(this.rowId, other.rowId);
        }
    }

    public static final class UsageSession {
        public final String packageName;
        public final long startTimeMs;
        public final long endTimeMs;
        public final boolean ongoing;

        public UsageSession(String packageName, long startTimeMs, long endTimeMs, boolean ongoing) {
            this.packageName = packageName;
            this.startTimeMs = startTimeMs;
            this.endTimeMs = endTimeMs;
            this.ongoing = ongoing;
        }

        public long getDurationMs() {
            return Math.max(0L, endTimeMs - startTimeMs);
        }
    }

    public static final class DailyUsageReport {
        public final LocalDate date;
        public final long windowStartMs;
        public final long windowEndMs;
        public final Map<String, Long> appScreenTimeMs = new HashMap<>();
        public final Map<String, Integer> appLaunchCounts = new HashMap<>();
        public final Map<String, Integer> appNotificationCounts = new HashMap<>();
        public final long[] hourlyScreenTimeMs = new long[24];
        public long totalDeviceScreenTimeMs = 0L;
        public int totalDeviceUnlocks = 0;
        public int totalNotifications = 0;
        public final List<UsageSession> sessions = new ArrayList<>();

        public DailyUsageReport(LocalDate date, long windowStartMs, long windowEndMs) {
            this.date = date;
            this.windowStartMs = windowStartMs;
            this.windowEndMs = windowEndMs;
        }
    }

    /**
     * Reconstructs bounded foreground sessions and usage metrics for a target local date
     * [windowStartMs, windowEndMs), given sorted raw events including a lookback margin
     * before windowStartMs to capture sessions already in-flight at midnight.
     */
    public DailyUsageReport calculateDailyReport(
            LocalDate targetDate,
            ZoneId zoneId,
            List<UsageEventInput> rawEvents,
            Set<String> excludedHomeAndSystemPackages,
            long queryEvaluationTimeMs) {

        ZonedDateTime startOfDay = targetDate.atStartOfDay(zoneId);
        ZonedDateTime startOfNextDay = targetDate.plusDays(1).atStartOfDay(zoneId);
        long windowStartMs = startOfDay.toInstant().toEpochMilli();
        long windowEndMs = Math.min(startOfNextDay.toInstant().toEpochMilli(), queryEvaluationTimeMs);

        DailyUsageReport report = new DailyUsageReport(targetDate, windowStartMs, windowEndMs);
        if (windowEndMs <= windowStartMs) {
            return report;
        }

        List<UsageEventInput> sorted = new ArrayList<>(rawEvents);
        Collections.sort(sorted);

        String activePackage = null;
        long activeSessionStartMs = -1L;
        boolean screenInteractive = true;
        String lastForegroundPackageForLaunch = null;

        // Deduplication tracking
        int prevType = -1;
        String prevPkg = null;
        long prevTs = -1L;

        for (UsageEventInput ev : sorted) {
            if (ev.timestampMs > queryEvaluationTimeMs) {
                break;
            }
            // Exact duplicate suppression
            if (ev.eventType == prevType && ev.timestampMs == prevTs
                    && ev.packageName.equals(prevPkg)) {
                continue;
            }
            prevType = ev.eventType;
            prevPkg = ev.packageName;
            prevTs = ev.timestampMs;

            switch (ev.eventType) {
                case TYPE_SCREEN_INTERACTIVE:
                    screenInteractive = true;
                    break;

                case TYPE_SCREEN_NON_INTERACTIVE:
                case TYPE_KEYGUARD_SHOWN:
                case TYPE_DEVICE_SHUTDOWN:
                    if (activePackage != null && activeSessionStartMs >= 0L) {
                        commitSessionClippedToWindow(
                                report, activePackage, activeSessionStartMs, ev.timestampMs,
                                false, excludedHomeAndSystemPackages, startOfDay, zoneId);
                        activePackage = null;
                        activeSessionStartMs = -1L;
                    }
                    if (ev.eventType == TYPE_SCREEN_NON_INTERACTIVE || ev.eventType == TYPE_DEVICE_SHUTDOWN) {
                        screenInteractive = false;
                        lastForegroundPackageForLaunch = null;
                    }
                    break;

                case TYPE_DEVICE_STARTUP:
                    // Any unclosed state prior to DEVICE_STARTUP is discarded per AOSP UsageEvents spec
                    activePackage = null;
                    activeSessionStartMs = -1L;
                    lastForegroundPackageForLaunch = null;
                    break;

                case TYPE_KEYGUARD_HIDDEN:
                    screenInteractive = true;
                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        report.totalDeviceUnlocks++;
                    }
                    break;

                case TYPE_NOTIFICATION_INTERRUPTION:
                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        report.appNotificationCounts.merge(ev.packageName, 1, Integer::sum);
                        report.totalNotifications++;
                    }
                    break;

                case TYPE_ACTIVITY_RESUMED:
                    if (!screenInteractive) {
                        // Ignore background wake/resume while screen is non-interactive
                        break;
                    }
                    if (activePackage != null && activeSessionStartMs >= 0L) {
                        if (!activePackage.equals(ev.packageName)) {
                            commitSessionClippedToWindow(
                                    report, activePackage, activeSessionStartMs, ev.timestampMs,
                                    false, excludedHomeAndSystemPackages, startOfDay, zoneId);
                            activePackage = ev.packageName;
                            activeSessionStartMs = ev.timestampMs;
                        }
                        // If same package resumed another activity immediately, continue session seamlessly
                    } else {
                        activePackage = ev.packageName;
                        activeSessionStartMs = ev.timestampMs;
                    }

                    // Count app launch (Times Opened) when transitioning into a non-launcher app
                    if (ev.timestampMs >= windowStartMs && ev.timestampMs < windowEndMs) {
                        if (!excludedHomeAndSystemPackages.contains(ev.packageName)
                                && !ev.packageName.equals(lastForegroundPackageForLaunch)) {
                            report.appLaunchCounts.merge(ev.packageName, 1, Integer::sum);
                        }
                    }
                    lastForegroundPackageForLaunch = ev.packageName;
                    break;

                case TYPE_ACTIVITY_PAUSED:
                case TYPE_ACTIVITY_STOPPED:
                    if (activePackage != null && activePackage.equals(ev.packageName) && activeSessionStartMs >= 0L) {
                        commitSessionClippedToWindow(
                                report, activePackage, activeSessionStartMs, ev.timestampMs,
                                false, excludedHomeAndSystemPackages, startOfDay, zoneId);
                        activePackage = null;
                        activeSessionStartMs = -1L;
                    }
                    break;

                default:
                    break;
            }
        }

        // Ongoing session still active at queryEvaluationTimeMs / windowEndMs
        if (activePackage != null && activeSessionStartMs >= 0L && screenInteractive) {
            if (activeSessionStartMs < windowEndMs) {
                commitSessionClippedToWindow(
                        report, activePackage, activeSessionStartMs, windowEndMs,
                        true, excludedHomeAndSystemPackages, startOfDay, zoneId);
            }
        }

        return report;
    }

    private void commitSessionClippedToWindow(
            DailyUsageReport report,
            String packageName,
            long rawStartMs,
            long rawEndMs,
            boolean ongoing,
            Set<String> excludedPackages,
            ZonedDateTime startOfDay,
            ZoneId zoneId) {

        if (rawEndMs <= rawStartMs) {
            return;
        }
        long clippedStart = Math.max(rawStartMs, report.windowStartMs);
        long clippedEnd = Math.min(rawEndMs, report.windowEndMs);
        if (clippedEnd <= clippedStart) {
            return;
        }

        UsageSession session = new UsageSession(packageName, clippedStart, clippedEnd, ongoing);
        report.sessions.add(session);

        if (excludedPackages != null && excludedPackages.contains(packageName)) {
            return;
        }

        long durationMs = clippedEnd - clippedStart;
        report.appScreenTimeMs.merge(packageName, durationMs, Long::sum);
        report.totalDeviceScreenTimeMs += durationMs;

        // Slice duration across hourly buckets [0..23]
        for (int hour = 0; hour < 24; hour++) {
            long hStart = startOfDay.plusHours(hour).toInstant().toEpochMilli();
            long hEnd = startOfDay.plusHours(hour + 1).toInstant().toEpochMilli();
            long overlapStart = Math.max(clippedStart, hStart);
            long overlapEnd = Math.min(clippedEnd, hEnd);
            if (overlapEnd > overlapStart) {
                report.hourlyScreenTimeMs[hour] += (overlapEnd - overlapStart);
            }
        }
    }
}
