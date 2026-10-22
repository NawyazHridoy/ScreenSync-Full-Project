-- ============================================================================
-- ScreenSync Production Database Migration 004: Schema & RPC Reconciliation
-- Supabase Project: https://ldephpgydnsovhlkuzbe.supabase.co
-- Migration File: supabase/migrations/20261022000004_reconcile_schema_and_rpcs.sql
-- ============================================================================
-- Safely reconciles schema and RPC differences between the live migrations
-- (001 & 002), client sync code (SupabaseSyncEngine / DeviceSecurityManager),
-- and cross-platform DigitalWellbeingPC telemetry tables:
--   1. Reconciles public.user_profiles columns (adds avatar_initials and
--      generated id alias column if missing while preserving user_id PK).
--   2. Reconciles public.security_alerts alongside public.sync_metadata with
--      strict RLS + FORCE RLS and per-owner policies (auth.uid() = user_id).
--   3. Reconciles public.get_account_usage_summary(DATE) as a backward-compatible
--      SECURITY INVOKER wrapper around public.get_account_daily_aggregates(DATE).
--   4. Adds optional cross-platform telemetry tables (app_category_rules,
--      website_usage_sessions, sound_usage_sessions, tracker_heartbeats) with
--      strict RLS + FORCE RLS.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Reconcile public.user_profiles Columns (user_id PK + id alias + avatar_initials)
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_initials TEXT NOT NULL DEFAULT 'SS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD COLUMN id UUID GENERATED ALWAYS AS (user_id) STORED UNIQUE;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Reconcile public.security_alerts Alongside public.sync_metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL CHECK (char_length(btrim(alert_id)) >= 1 AND char_length(alert_id) <= 160),
  installation_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'ScreenSync Device',
  device_category TEXT NOT NULL DEFAULT 'Device',
  message TEXT NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_security_alerts_user_alert UNIQUE (user_id, alert_id)
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_user_dismissed
  ON public.security_alerts (user_id, dismissed, created_at DESC);

DROP TRIGGER IF EXISTS trg_security_alerts_updated_at ON public.security_alerts;
CREATE TRIGGER trg_security_alerts_updated_at
  BEFORE UPDATE ON public.security_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_row_updated_at();

ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.security_alerts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_alerts TO authenticated;

DROP POLICY IF EXISTS security_alerts_select_own ON public.security_alerts;
CREATE POLICY security_alerts_select_own
  ON public.security_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS security_alerts_insert_own ON public.security_alerts;
CREATE POLICY security_alerts_insert_own
  ON public.security_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS security_alerts_update_own ON public.security_alerts;
CREATE POLICY security_alerts_update_own
  ON public.security_alerts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS security_alerts_delete_own ON public.security_alerts;
CREATE POLICY security_alerts_delete_own
  ON public.security_alerts
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. Reconcile RPC Function Names:
--    get_account_usage_summary(DATE) <-> get_account_daily_aggregates(DATE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_account_usage_summary(p_local_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN public.get_account_daily_aggregates(p_local_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_usage_summary(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_usage_summary(DATE) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Cross-Platform Telemetry Tables (DigitalWellbeingPC Integration) Under RLS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_identifier TEXT NOT NULL CHECK (char_length(btrim(app_identifier)) >= 1 AND char_length(app_identifier) <= 160),
  app_name TEXT NOT NULL DEFAULT '',
  executable_path TEXT NULL,
  category TEXT NOT NULL DEFAULT 'Uncategorized' CHECK (category IN ('Work', 'Entertainment', 'Neutral', 'Uncategorized')),
  screensync_category TEXT NOT NULL DEFAULT 'Other',
  source TEXT NOT NULL DEFAULT 'AutoSuggested' CHECK (source IN ('Manual', 'AutoSuggested')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_app_category_rules_user_app UNIQUE (user_id, app_identifier)
);

CREATE TABLE IF NOT EXISTS public.website_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (char_length(btrim(session_id)) >= 1 AND char_length(session_id) <= 160),
  installation_key TEXT NOT NULL DEFAULT 'windows_pc',
  browser_process_name TEXT NOT NULL DEFAULT 'chrome',
  hostname TEXT NOT NULL CHECK (position('/' in hostname) = 0 AND position('?' in hostname) = 0),
  local_date DATE NOT NULL,
  start_epoch_sec BIGINT NOT NULL,
  end_epoch_sec BIGINT NOT NULL CHECK (end_epoch_sec >= start_epoch_sec),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 7 AND duration_seconds <= 86400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_website_usage_sessions_user_sess UNIQUE (user_id, session_id)
);

CREATE TABLE IF NOT EXISTS public.sound_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_key TEXT NOT NULL DEFAULT 'windows_pc',
  device_name TEXT NOT NULL DEFAULT 'Default Audio',
  device_type TEXT NOT NULL DEFAULT 'Headphones',
  local_date DATE NOT NULL,
  start_epoch_sec BIGINT NOT NULL,
  end_epoch_sec BIGINT NOT NULL CHECK (end_epoch_sec >= start_epoch_sec),
  avg_volume REAL NOT NULL DEFAULT 0.0 CHECK (avg_volume >= 0.0 AND avg_volume <= 1.0),
  estimated_max_spl REAL NOT NULL DEFAULT 0.0,
  was_harmful BOOLEAN NOT NULL DEFAULT FALSE,
  actual_listening_seconds INTEGER NOT NULL DEFAULT 0 CHECK (actual_listening_seconds >= 0),
  harmful_seconds INTEGER NOT NULL DEFAULT 0 CHECK (harmful_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tracker_heartbeats (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL,
  tracker_name TEXT NOT NULL,
  last_seen_utc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tick_count BIGINT NOT NULL DEFAULT 0 CHECK (tick_count >= 0),
  last_error TEXT NULL,
  PRIMARY KEY (user_id, installation_id, tracker_name)
);

ALTER TABLE public.app_category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_category_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_usage_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sound_usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sound_usage_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_heartbeats FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_category_rules FROM PUBLIC, anon;
REVOKE ALL ON public.website_usage_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.sound_usage_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.tracker_heartbeats FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_category_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_usage_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sound_usage_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracker_heartbeats TO authenticated;

DROP POLICY IF EXISTS app_category_rules_own ON public.app_category_rules;
CREATE POLICY app_category_rules_own
  ON public.app_category_rules
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS website_usage_sessions_own ON public.website_usage_sessions;
CREATE POLICY website_usage_sessions_own
  ON public.website_usage_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS sound_usage_sessions_own ON public.sound_usage_sessions;
CREATE POLICY sound_usage_sessions_own
  ON public.sound_usage_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS tracker_heartbeats_own ON public.tracker_heartbeats;
CREATE POLICY tracker_heartbeats_own
  ON public.tracker_heartbeats
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

COMMIT;
