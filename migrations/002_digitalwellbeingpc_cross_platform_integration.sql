-- ============================================================================
-- ScreenSync Database Migration 002
-- Integrates DigitalWellbeingPC (Pulse) persistence tables & columns
-- Backward-compatible & idempotent: preserves all existing user records
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Canonical Application Categories (Manual vs AutoSuggested from CategoryRuleService)
CREATE TABLE IF NOT EXISTS app_category_rules (
    app_identifier TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL DEFAULT 'usr_rahim_01',
    app_name TEXT NOT NULL,
    executable_path TEXT,
    category TEXT NOT NULL DEFAULT 'Uncategorized',
    screensync_category TEXT NOT NULL DEFAULT 'Other',
    source TEXT NOT NULL DEFAULT 'AutoSuggested', -- 'Manual' | 'AutoSuggested'
    last_updated_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_category_user ON app_category_rules(user_id, app_identifier);

-- 2. Privacy-Safe Website Usage Sessions (Registrable eTLD+1 Hostname Only — No Raw URLs/Paths)
CREATE TABLE IF NOT EXISTS website_usage_sessions (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    installation_key TEXT NOT NULL,
    browser_process_name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    local_date TEXT NOT NULL,
    start_epoch_sec INTEGER NOT NULL,
    end_epoch_sec INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds <= 86400)
);
CREATE INDEX IF NOT EXISTS idx_website_hostname_start ON website_usage_sessions(hostname, start_epoch_sec);
CREATE INDEX IF NOT EXISTS idx_website_user_date ON website_usage_sessions(user_id, local_date);

-- 3. Sound / Audio Exposure Sessions (SoundExposureManager SPL & Harmful Listening Tracking)
CREATE TABLE IF NOT EXISTS sound_usage_sessions (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    installation_key TEXT NOT NULL,
    local_date TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT NOT NULL,
    actual_listening_seconds INTEGER NOT NULL DEFAULT 0,
    harmful_seconds INTEGER NOT NULL DEFAULT 0,
    avg_volume REAL NOT NULL DEFAULT 0.0,
    estimated_max_spl REAL NOT NULL DEFAULT 0.0,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    was_harmful INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sound_user_date ON sound_usage_sessions(user_id, local_date);

-- 4. Tracker Liveness Heartbeats (TrackingHealthService Traffic-Light Diagnostics)
CREATE TABLE IF NOT EXISTS tracker_heartbeats (
    tracker_name TEXT PRIMARY KEY NOT NULL,
    last_seen_utc TEXT NOT NULL,
    last_seen_epoch_ms INTEGER NOT NULL,
    tick_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

-- 5. Focus Sessions Crash-Recovery & Distraction Telemetry
CREATE TABLE IF NOT EXISTS focus_sessions (
    session_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT,
    last_seen_utc TEXT NOT NULL,
    planned_duration_minutes INTEGER NOT NULL,
    completed_minutes INTEGER NOT NULL DEFAULT 0,
    enforcement_level TEXT NOT NULL DEFAULT 'WARN',
    completed INTEGER NOT NULL DEFAULT 0,
    distraction_warnings INTEGER NOT NULL DEFAULT 0,
    distraction_overrides INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
);
CREATE INDEX IF NOT EXISTS idx_focus_user_date ON focus_sessions(user_id, local_date);
