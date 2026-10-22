-- ============================================================================
-- ScreenSync Production Database Migration 001: Core Schema, Tables & Triggers
-- Supabase Project: https://ldephpgydnsovhlkuzbe.supabase.co
-- Migration File: supabase/migrations/20261022000001_create_screensync_schema.sql
-- ============================================================================

BEGIN;

-- Ensure required UUID / crypto extension is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Automatic updated_at Timestamp Trigger Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Table A: User Profiles (public.user_profiles)
--    Uses auth.users(id) as the authoritative owner identifier.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) >= 1 AND char_length(display_name) <= 120),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles (lower(email));

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Table B: Registered Devices and Installations (public.device_installations)
--    Supports multiple installations per authenticated user account.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL CHECK (char_length(btrim(installation_id)) >= 2 AND char_length(installation_id) <= 128),
  installation_key TEXT NOT NULL CHECK (char_length(btrim(installation_key)) >= 1 AND char_length(installation_key) <= 128),
  device_name TEXT NOT NULL CHECK (char_length(btrim(device_name)) >= 1 AND char_length(device_name) <= 80),
  device_model TEXT NOT NULL DEFAULT '',
  os_category TEXT NOT NULL CHECK (os_category IN ('Android', 'iOS', 'Windows', 'macOS', 'ChromeOS')),
  device_category TEXT NOT NULL DEFAULT 'Phone' CHECK (char_length(device_category) <= 40),
  os_version TEXT NOT NULL DEFAULT '',
  cutout_type TEXT NOT NULL DEFAULT 'FULLSCREEN' CHECK (
    cutout_type IN (
      'IPHONE_PILL',
      'PUNCH_HOLE',
      'TRUEDEPTH_NOTCH',
      'WATERDROP',
      'FULLSCREEN',
      'CORNER_LEFT',
      'CORNER_RIGHT',
      'ASYMMETRIC'
    )
  ),
  has_true_depth BOOLEAN NOT NULL DEFAULT FALSE,
  tracking_permitted BOOLEAN NOT NULL DEFAULT TRUE,
  permission_status TEXT NOT NULL DEFAULT 'Authorized',
  sync_status TEXT NOT NULL DEFAULT 'Synced Live',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_device_installations_user_inst_id UNIQUE (user_id, installation_id),
  CONSTRAINT uq_device_installations_user_inst_key UNIQUE (user_id, installation_key)
);

CREATE INDEX IF NOT EXISTS idx_device_installations_user_active
  ON public.device_installations (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_device_installations_user_inst_id
  ON public.device_installations (user_id, installation_id);

DROP TRIGGER IF EXISTS trg_device_installations_updated_at ON public.device_installations;
CREATE TRIGGER trg_device_installations_updated_at
  BEFORE UPDATE ON public.device_installations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Table C1: ScreenSync Screen-Time Sessions (public.screen_usage_sessions)
--    Stores per-device foreground app usage sessions and interval bounds
--    for cross-device interval-union calculation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.screen_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (char_length(btrim(session_id)) >= 1 AND char_length(session_id) <= 160),
  interval_id TEXT NOT NULL CHECK (char_length(btrim(interval_id)) >= 1 AND char_length(interval_id) <= 160),
  installation_id TEXT NOT NULL,
  installation_key TEXT NOT NULL,
  os_category TEXT NOT NULL CHECK (os_category IN ('Android', 'iOS', 'Windows', 'macOS', 'ChromeOS')),
  app_key TEXT NOT NULL CHECK (char_length(btrim(app_key)) >= 1 AND char_length(app_key) <= 80),
  app_name TEXT NOT NULL CHECK (char_length(btrim(app_name)) >= 1 AND char_length(app_name) <= 120),
  category TEXT NOT NULL DEFAULT 'Social networking',
  local_date DATE NOT NULL,
  has_timestamps BOOLEAN NOT NULL DEFAULT TRUE,
  start_epoch_sec BIGINT NULL,
  end_epoch_sec BIGINT NULL,
  sub_intervals JSONB NULL,
  tz_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (tz_offset_minutes >= -840 AND tz_offset_minutes <= 840),
  duration_minutes NUMERIC(10, 2) NOT NULL CHECK (duration_minutes >= 0 AND duration_minutes <= 1440),
  unlocks INTEGER NOT NULL DEFAULT 0 CHECK (unlocks >= 0),
  opens INTEGER NOT NULL DEFAULT 0 CHECK (opens >= 0),
  notifs INTEGER NOT NULL DEFAULT 0 CHECK (notifs >= 0),
  is_background BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_screen_session_epoch_order CHECK (
    start_epoch_sec IS NULL OR end_epoch_sec IS NULL OR end_epoch_sec > start_epoch_sec
  ),
  CONSTRAINT uq_screen_usage_sessions_dedup UNIQUE (user_id, installation_key, session_id),
  CONSTRAINT fk_screen_usage_installation
    FOREIGN KEY (user_id, installation_id)
    REFERENCES public.device_installations (user_id, installation_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_screen_usage_user_date
  ON public.screen_usage_sessions (user_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_screen_usage_user_inst_date
  ON public.screen_usage_sessions (user_id, installation_key, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_screen_usage_user_app_date
  ON public.screen_usage_sessions (user_id, app_key, local_date DESC);

DROP TRIGGER IF EXISTS trg_screen_usage_sessions_updated_at ON public.screen_usage_sessions;
CREATE TRIGGER trg_screen_usage_sessions_updated_at
  BEFORE UPDATE ON public.screen_usage_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Table C2: ScreenSync Reel, Short & Story Watch Events (public.reel_watch_events)
--    Stores validated short-form video navigations and monotonic watch durations.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reel_watch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL CHECK (char_length(btrim(event_id)) >= 1 AND char_length(event_id) <= 160),
  raw_event_id TEXT NULL,
  installation_id TEXT NOT NULL,
  installation_key TEXT NOT NULL,
  os_category TEXT NOT NULL CHECK (os_category IN ('Android', 'iOS', 'Windows', 'macOS', 'ChromeOS')),
  app_key TEXT NOT NULL CHECK (char_length(btrim(app_key)) >= 1 AND char_length(app_key) <= 80),
  app_name TEXT NOT NULL CHECK (char_length(btrim(app_name)) >= 1 AND char_length(app_name) <= 120),
  content_type TEXT NOT NULL DEFAULT 'REEL' CHECK (
    content_type IN ('REEL', 'SHORT', 'TIKTOK', 'STORY', 'STATUS', 'SPOTLIGHT')
  ),
  navigation_direction TEXT NULL CHECK (
    navigation_direction IS NULL OR navigation_direction IN ('FORWARD', 'BACKWARD')
  ),
  item_id TEXT NULL,
  reel_count INTEGER NOT NULL DEFAULT 0 CHECK (reel_count >= 0 AND reel_count <= 500),
  watch_minutes NUMERIC(10, 4) NOT NULL DEFAULT 0 CHECK (watch_minutes >= 0 AND watch_minutes <= 1440),
  watch_seconds NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0 AND watch_seconds <= 86400),
  start_epoch_ms BIGINT NULL,
  end_epoch_ms BIGINT NULL,
  local_date DATE NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reel_watch_events_dedup UNIQUE (user_id, installation_key, event_id),
  CONSTRAINT fk_reel_events_installation
    FOREIGN KEY (user_id, installation_id)
    REFERENCES public.device_installations (user_id, installation_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reel_events_user_date
  ON public.reel_watch_events (user_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_reel_events_user_inst_date
  ON public.reel_watch_events (user_id, installation_key, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_reel_events_user_app_date
  ON public.reel_watch_events (user_id, app_key, local_date DESC);

DROP TRIGGER IF EXISTS trg_reel_watch_events_updated_at ON public.reel_watch_events;
CREATE TRIGGER trg_reel_watch_events_updated_at
  BEFORE UPDATE ON public.reel_watch_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Table D: User Settings and Goals (public.user_settings)
--    Stores account-owned screen-time goals, reel-watch goals, focus settings,
--    per-app timers, notification schedules, and visual preferences.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  screen_goal_minutes INTEGER NOT NULL DEFAULT 200 CHECK (screen_goal_minutes >= 1 AND screen_goal_minutes <= 1439),
  screen_goal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  screen_goal_ignored_today BOOLEAN NOT NULL DEFAULT FALSE,
  daily_reel_goal_minutes INTEGER NOT NULL DEFAULT 60 CHECK (daily_reel_goal_minutes >= 1 AND daily_reel_goal_minutes <= 1439),
  reel_goal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reel_goal_ignored_today BOOLEAN NOT NULL DEFAULT FALSE,
  app_timers JSONB NOT NULL DEFAULT '{"facebook": {"schedule": "Everyday", "minutes": 90}}'::jsonb,
  focus_selected_minutes INTEGER NOT NULL DEFAULT 30 CHECK (focus_selected_minutes >= 20 AND focus_selected_minutes <= 180),
  focus_total_minutes INTEGER NOT NULL DEFAULT 0 CHECK (focus_total_minutes >= 0),
  focus_total_sessions INTEGER NOT NULL DEFAULT 0 CHECK (focus_total_sessions >= 0),
  design_style TEXT NOT NULL DEFAULT 'LIQUID' CHECK (design_style IN ('LIQUID', 'SOFT')),
  graph_display_style TEXT NOT NULL DEFAULT 'DETAILED' CHECK (graph_display_style IN ('DETAILED', 'SIMPLE')),
  app_theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (app_theme IN ('LIGHT', 'DARK', 'SYSTEM')),
  notification_schedule JSONB NOT NULL DEFAULT '{
    "dailySummaryEnabled": true,
    "dailySummaryTime": "21:00",
    "goalRemindersEnabled": true,
    "breakRemindersEnabled": true,
    "breakIntervalMinutes": 45,
    "quietHoursEnabled": true,
    "quietHoursStart": "22:30",
    "quietHoursEnd": "07:00"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Table D2: Focus Sessions & User Achievements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.focus_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (char_length(btrim(session_id)) >= 1 AND char_length(session_id) <= 160),
  installation_id TEXT NULL,
  local_date DATE NOT NULL,
  date_display TEXT NOT NULL DEFAULT '',
  start_time_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  time_range_label TEXT NOT NULL DEFAULT '',
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 20 AND planned_minutes <= 180),
  completed_minutes INTEGER NOT NULL CHECK (completed_minutes >= 0 AND completed_minutes <= 180),
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'INTERRUPTED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_focus_sessions_user_session UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_date
  ON public.focus_sessions (user_id, local_date DESC);

DROP TRIGGER IF EXISTS trg_focus_sessions_updated_at ON public.focus_sessions;
CREATE TRIGGER trg_focus_sessions_updated_at
  BEFORE UPDATE ON public.focus_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

CREATE TABLE IF NOT EXISTS public.user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL CHECK (char_length(btrim(achievement_id)) >= 1 AND char_length(achievement_id) <= 80),
  title TEXT NOT NULL,
  unlocked_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_achievements_user_ach UNIQUE (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user
  ON public.user_achievements (user_id);

-- ----------------------------------------------------------------------------
-- 8. Table E1: Goal-Reached Alert Events (public.goal_alert_events)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goal_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL CHECK (char_length(btrim(event_id)) >= 1 AND char_length(event_id) <= 160),
  goal_type TEXT NOT NULL CHECK (goal_type IN ('SCREEN_TIME_GOAL', 'REEL_WATCH_GOAL')),
  goal_period_date DATE NOT NULL,
  used_minutes INTEGER NOT NULL CHECK (used_minutes >= 0),
  goal_minutes INTEGER NOT NULL CHECK (goal_minutes >= 1),
  reels_count INTEGER NOT NULL DEFAULT 0 CHECK (reels_count >= 0),
  created_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  deliveries_by_installation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_goal_alert_events_user_event UNIQUE (user_id, event_id),
  CONSTRAINT uq_goal_alert_events_period UNIQUE (user_id, goal_type, goal_period_date)
);

CREATE INDEX IF NOT EXISTS idx_goal_alert_events_user_date
  ON public.goal_alert_events (user_id, goal_period_date DESC);

DROP TRIGGER IF EXISTS trg_goal_alert_events_updated_at ON public.goal_alert_events;
CREATE TRIGGER trg_goal_alert_events_updated_at
  BEFORE UPDATE ON public.goal_alert_events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 9. Table E2: Synchronization Deduplication Ledger & Metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_dedup_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scoped_dedup_key TEXT NOT NULL CHECK (char_length(btrim(scoped_dedup_key)) >= 1 AND char_length(scoped_dedup_key) <= 255),
  event_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  installation_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('SCREEN_SESSION', 'REEL_EVENT', 'FOCUS_SESSION', 'GOAL_ALERT')),
  status TEXT NOT NULL DEFAULT 'PROCESSED',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sync_dedup_ledger_scoped UNIQUE (user_id, scoped_dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_dedup_user_event
  ON public.sync_dedup_ledger (user_id, event_id);

CREATE TABLE IF NOT EXISTS public.sync_metadata (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  installation_key TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_version BIGINT NOT NULL DEFAULT 1 CHECK (sync_version >= 1),
  last_migrated_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, installation_id),
  CONSTRAINT fk_sync_metadata_installation
    FOREIGN KEY (user_id, installation_id)
    REFERENCES public.device_installations (user_id, installation_id)
    ON DELETE CASCADE
);

DROP TRIGGER IF EXISTS trg_sync_metadata_updated_at ON public.sync_metadata;
CREATE TRIGGER trg_sync_metadata_updated_at
  BEFORE UPDATE ON public.sync_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

-- ----------------------------------------------------------------------------
-- 10. Auth User Lifecycle Trigger: Automatically Provision Profile & Settings
--     When a user signs up or confirms their email in auth.users.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name TEXT;
  v_verified BOOLEAN;
BEGIN
  v_display_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
    split_part(COALESCE(NEW.email, 'User'), '@', 1)
  );
  v_verified := (NEW.email_confirmed_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL);

  INSERT INTO public.user_profiles (user_id, email, display_name, email_verified)
  VALUES (NEW.id, COALESCE(NEW.email, ''), v_display_name, v_verified)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = COALESCE(NULLIF(public.user_profiles.display_name, ''), EXCLUDED.display_name),
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW();

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_or_updated ON auth.users;
CREATE TRIGGER on_auth_user_created_or_updated
  AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 11. Authenticated Account-Wide Daily Aggregation RPC Function
--     Computes non-overlapping interval union screen time, cumulative device
--     screen time, reel count, and reel watch duration strictly for auth.uid().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_account_daily_aggregates(p_local_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_union_seconds BIGINT := 0;
  v_max_unbounded_minutes NUMERIC := 0;
  v_cumulative_minutes NUMERIC := 0;
  v_reconciled_minutes INTEGER := 0;
  v_total_reels BIGINT := 0;
  v_total_watch_seconds NUMERIC := 0;
  v_per_device JSONB := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to compute account aggregates' USING ERRCODE = '42501';
  END IF;

  -- 1. Compute interval union across all active timestamped foreground sessions for auth.uid()
  WITH raw_intervals AS (
    SELECT
      GREATEST(s.start_epoch_sec, EXTRACT(EPOCH FROM p_local_date::timestamp)::bigint - 86400) AS s_sec,
      LEAST(s.end_epoch_sec, EXTRACT(EPOCH FROM (p_local_date + 2)::timestamp)::bigint) AS e_sec
    FROM public.screen_usage_sessions s
    WHERE s.user_id = v_uid
      AND s.local_date = p_local_date
      AND s.is_background = FALSE
      AND s.has_timestamps = TRUE
      AND s.start_epoch_sec IS NOT NULL
      AND s.end_epoch_sec IS NOT NULL
      AND s.end_epoch_sec > s.start_epoch_sec
  ),
  ordered_intervals AS (
    SELECT
      s_sec,
      e_sec,
      MAX(e_sec) OVER (ORDER BY s_sec, e_sec ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_max_end
    FROM raw_intervals
  ),
  island_groups AS (
    SELECT
      s_sec,
      e_sec,
      SUM(CASE WHEN prev_max_end IS NULL OR s_sec > prev_max_end THEN 1 ELSE 0 END)
        OVER (ORDER BY s_sec, e_sec) AS grp_id
    FROM ordered_intervals
  ),
  merged_islands AS (
    SELECT grp_id, MIN(s_sec) AS island_start, MAX(e_sec) AS island_end
    FROM island_groups
    GROUP BY grp_id
  )
  SELECT COALESCE(SUM(GREATEST(0, island_end - island_start)), 0)
  INTO v_union_seconds
  FROM merged_islands;

  -- 2. Handle legacy untimestamped sessions safely without double-counting across devices
  SELECT COALESCE(MAX(dev_sum), 0)
  INTO v_max_unbounded_minutes
  FROM (
    SELECT installation_key, SUM(duration_minutes) AS dev_sum
    FROM public.screen_usage_sessions
    WHERE user_id = v_uid
      AND local_date = p_local_date
      AND is_background = FALSE
      AND has_timestamps = FALSE
    GROUP BY installation_key
  ) sub;

  SELECT COALESCE(SUM(duration_minutes), 0)
  INTO v_cumulative_minutes
  FROM public.screen_usage_sessions
  WHERE user_id = v_uid
    AND local_date = p_local_date
    AND is_background = FALSE;

  v_reconciled_minutes := GREATEST(ROUND(v_union_seconds / 60.0)::integer, ROUND(v_max_unbounded_minutes)::integer);

  -- 3. Sum deduplicated reel counts and watch durations for auth.uid()
  SELECT
    COALESCE(SUM(r.reel_count), 0),
    COALESCE(SUM(CASE WHEN r.watch_seconds > 0 THEN r.watch_seconds ELSE r.watch_minutes * 60.0 END), 0)
  INTO v_total_reels, v_total_watch_seconds
  FROM public.reel_watch_events r
  WHERE r.user_id = v_uid
    AND r.local_date = p_local_date;

  -- 4. Per-device summary
  SELECT COALESCE(jsonb_object_agg(installation_key, dev_obj), '{}'::jsonb)
  INTO v_per_device
  FROM (
    SELECT
      di.installation_key,
      jsonb_build_object(
        'installationId', di.installation_id,
        'deviceName', di.device_name,
        'osCategory', di.os_category,
        'screenMinutes', COALESCE((
          SELECT ROUND(SUM(s.duration_minutes))::integer
          FROM public.screen_usage_sessions s
          WHERE s.user_id = v_uid
            AND s.installation_key = di.installation_key
            AND s.local_date = p_local_date
            AND s.is_background = FALSE
        ), 0),
        'reelsCount', COALESCE((
          SELECT SUM(r.reel_count)::integer
          FROM public.reel_watch_events r
          WHERE r.user_id = v_uid
            AND r.installation_key = di.installation_key
            AND r.local_date = p_local_date
        ), 0),
        'watchMinutes', COALESCE((
          SELECT ROUND(SUM(CASE WHEN r.watch_seconds > 0 THEN r.watch_seconds / 60.0 ELSE r.watch_minutes END))::integer
          FROM public.reel_watch_events r
          WHERE r.user_id = v_uid
            AND r.installation_key = di.installation_key
            AND r.local_date = p_local_date
        ), 0)
      ) AS dev_obj
    FROM public.device_installations di
    WHERE di.user_id = v_uid AND di.is_active = TRUE
  ) dev_rows;

  RETURN jsonb_build_object(
    'userId', v_uid,
    'localDate', p_local_date,
    'totalScreenMinutes', v_reconciled_minutes,
    'cumulativeScreenMinutes', ROUND(v_cumulative_minutes)::integer,
    'overlapMinutes', GREATEST(0, ROUND(v_cumulative_minutes)::integer - v_reconciled_minutes),
    'reelsCount', v_total_reels,
    'watchSeconds', ROUND(v_total_watch_seconds)::bigint,
    'watchMinutes', ROUND(v_total_watch_seconds / 60.0)::integer,
    'perDevice', v_per_device
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_daily_aggregates(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_daily_aggregates(DATE) TO authenticated;

COMMIT;
