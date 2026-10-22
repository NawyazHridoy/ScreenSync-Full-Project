/*
 * PROVENANCE LABEL: [RECONSTRUCTED SOURCE CODE BASED ON VERIFIED app_usage SQLITE SCHEMA]
 * Package: com.google.android.apps.wellbeing.data
 * Represents the SQLiteOpenHelper & DAO layer managing /data/data/com.google.android.apps.wellbeing/databases/app_usage.
 */
package io.screensync.wellness;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class AppUsageDatabaseHelper extends SQLiteOpenHelper {
    public static final String DATABASE_NAME = "app_usage";
    public static final int DATABASE_VERSION = 4;

    public static final class RawEventRecord {
        public final long id;
        public final long packageId;
        public final String packageName;
        public final long timestampMs;
        public final int eventType;

        public RawEventRecord(long id, long packageId, String packageName, long timestampMs, int eventType) {
            this.id = id;
            this.packageId = packageId;
            this.packageName = packageName;
            this.timestampMs = timestampMs;
            this.eventType = eventType;
        }
    }

    private final Map<String, Long> packageIdCache = new HashMap<>();

    public AppUsageDatabaseHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        super.onConfigure(db);
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS packages (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_name TEXT NOT NULL UNIQUE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS events (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_id INTEGER NOT NULL, " +
                "timestamp INTEGER NOT NULL, " +
                "type INTEGER NOT NULL, " +
                "FOREIGN KEY(package_id) REFERENCES packages(_id) ON DELETE CASCADE)");
        db.execSQL("CREATE TABLE IF NOT EXISTS components (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "package_id INTEGER NOT NULL, " +
                "component_name TEXT NOT NULL, " +
                "FOREIGN KEY(package_id) REFERENCES packages(_id) ON DELETE CASCADE, " +
                "UNIQUE(package_id, component_name))");
        db.execSQL("CREATE TABLE IF NOT EXISTS component_events (" +
                "_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "component_id INTEGER NOT NULL, " +
                "timestamp INTEGER NOT NULL, " +
                "type INTEGER NOT NULL, " +
                "FOREIGN KEY(component_id) REFERENCES components(_id) ON DELETE CASCADE)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_events_pkg_time ON events(package_id, timestamp)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
    }

    public synchronized long getOrCreatePackageId(SQLiteDatabase db, String packageName) {
        Long cached = packageIdCache.get(packageName);
        if (cached != null) {
            return cached;
        }
        try (Cursor c = db.query("packages", new String[]{"_id"}, "package_name = ?",
                new String[]{packageName}, null, null, null)) {
            if (c.moveToFirst()) {
                long id = c.getLong(0);
                packageIdCache.put(packageName, id);
                return id;
            }
        }
        ContentValues cv = new ContentValues();
        cv.put("package_name", packageName);
        long id = db.insertWithOnConflict("packages", null, cv, SQLiteDatabase.CONFLICT_IGNORE);
        if (id != -1) {
            packageIdCache.put(packageName, id);
        }
        return id;
    }

    /**
     * Deletes all usage history for an uninstalled package (verified forensic behavior:
     * uninstalled packages have their entries removed from packages and events).
     */
    public synchronized void deletePackageData(String packageName) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("packages", "package_name = ?", new String[]{packageName});
            packageIdCache.remove(packageName);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Flushes all tables when Digital Wellbeing Usage Access is disabled by the user
     * (verified forensic behavior: all tables in app_usage are emptied within 24 hours).
     */
    public synchronized void flushAllTables() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("component_events", null, null);
            db.delete("components", null, null);
            db.delete("events", null, null);
            db.delete("packages", null, null);
            packageIdCache.clear();
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public List<RawEventRecord> queryEventsInWindow(long startTimeMs, long endTimeMs) {
        List<RawEventRecord> result = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        String sql = "SELECT events._id, events.package_id, packages.package_name, " +
                     "events.timestamp, events.type " +
                     "FROM events INNER JOIN packages ON events.package_id = packages._id " +
                     "WHERE events.timestamp >= ? AND events.timestamp <= ? " +
                     "ORDER BY events.timestamp ASC, events._id ASC";
        try (Cursor c = db.rawQuery(sql, new String[]{String.valueOf(startTimeMs), String.valueOf(endTimeMs)})) {
            while (c.moveToNext()) {
                result.add(new RawEventRecord(
                        c.getLong(0),
                        c.getLong(1),
                        c.getString(2),
                        c.getLong(3),
                        c.getInt(4)
                ));
            }
        }
        return result;
    }
}
