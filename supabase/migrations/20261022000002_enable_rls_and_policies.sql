-- ============================================================================
-- ScreenSync Production Database Migration 002: Row Level Security (RLS) Policies
-- Supabase Project: https://ldephpgydnsovhlkuzbe.supabase.co
-- Migration File: supabase/migrations/20261022000002_enable_rls_and_policies.sql
-- ============================================================================
-- Enforces strict per-account isolation across all user-owned tables:
--   1. Unauthenticated (anon/public) users cannot read or modify any private data.
--   2. Authenticated users can access ONLY rows where user_id = auth.uid().
--   3. Cross-table ownership checks verify that usage sessions, reel events,
--      and sync metadata reference an active installation owned by auth.uid().
--   4. No unrestricted permissive boolean policies exist.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Enable and Force Row Level Security on All User-Owned Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.device_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_installations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.screen_usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_usage_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reel_watch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_watch_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.goal_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_alert_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sync_dedup_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_dedup_ledger FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sync_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_metadata FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. Revoke All Anonymous / Public Privileges & Grant Explicit Authenticated Access
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.user_profiles FROM PUBLIC, anon;
REVOKE ALL ON public.device_installations FROM PUBLIC, anon;
REVOKE ALL ON public.screen_usage_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.reel_watch_events FROM PUBLIC, anon;
REVOKE ALL ON public.user_settings FROM PUBLIC, anon;
REVOKE ALL ON public.focus_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.user_achievements FROM PUBLIC, anon;
REVOKE ALL ON public.goal_alert_events FROM PUBLIC, anon;
REVOKE ALL ON public.sync_dedup_ledger FROM PUBLIC, anon;
REVOKE ALL ON public.sync_metadata FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_installations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screen_usage_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reel_watch_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.focus_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_achievements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_alert_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_dedup_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_metadata TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Helper Function for Cross-Table Device Ownership Verification
--    Verifies that a given installation_id belongs to auth.uid() and is active.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_owns_active_installation(
  p_user_id UUID,
  p_installation_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR p_user_id IS NULL OR auth.uid() <> p_user_id THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.device_installations di
      WHERE di.user_id = auth.uid()
        AND di.installation_id = p_installation_id
        AND di.is_active = TRUE
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.user_owns_active_installation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_owns_active_installation(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. RLS Policies: public.user_profiles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
CREATE POLICY user_profiles_select_own
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_profiles_insert_own ON public.user_profiles;
CREATE POLICY user_profiles_insert_own
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_profiles_delete_own ON public.user_profiles;
CREATE POLICY user_profiles_delete_own
  ON public.user_profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 5. RLS Policies: public.device_installations
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS device_installations_select_own ON public.device_installations;
CREATE POLICY device_installations_select_own
  ON public.device_installations
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS device_installations_insert_own ON public.device_installations;
CREATE POLICY device_installations_insert_own
  ON public.device_installations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS device_installations_update_own ON public.device_installations;
CREATE POLICY device_installations_update_own
  ON public.device_installations
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS device_installations_delete_own ON public.device_installations;
CREATE POLICY device_installations_delete_own
  ON public.device_installations
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 6. RLS Policies: public.screen_usage_sessions
--    Enforces both account ownership (auth.uid() = user_id) and cross-table
--    device ownership (public.user_owns_active_installation).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS screen_usage_sessions_select_own ON public.screen_usage_sessions;
CREATE POLICY screen_usage_sessions_select_own
  ON public.screen_usage_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS screen_usage_sessions_insert_own ON public.screen_usage_sessions;
CREATE POLICY screen_usage_sessions_insert_own
  ON public.screen_usage_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS screen_usage_sessions_update_own ON public.screen_usage_sessions;
CREATE POLICY screen_usage_sessions_update_own
  ON public.screen_usage_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS screen_usage_sessions_delete_own ON public.screen_usage_sessions;
CREATE POLICY screen_usage_sessions_delete_own
  ON public.screen_usage_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 7. RLS Policies: public.reel_watch_events
--    Enforces both account ownership and cross-table device installation ownership.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS reel_watch_events_select_own ON public.reel_watch_events;
CREATE POLICY reel_watch_events_select_own
  ON public.reel_watch_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS reel_watch_events_insert_own ON public.reel_watch_events;
CREATE POLICY reel_watch_events_insert_own
  ON public.reel_watch_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS reel_watch_events_update_own ON public.reel_watch_events;
CREATE POLICY reel_watch_events_update_own
  ON public.reel_watch_events
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS reel_watch_events_delete_own ON public.reel_watch_events;
CREATE POLICY reel_watch_events_delete_own
  ON public.reel_watch_events
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 8. RLS Policies: public.user_settings
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own
  ON public.user_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_insert_own ON public.user_settings;
CREATE POLICY user_settings_insert_own
  ON public.user_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own
  ON public.user_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_settings_delete_own ON public.user_settings;
CREATE POLICY user_settings_delete_own
  ON public.user_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 9. RLS Policies: public.focus_sessions & public.user_achievements
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS focus_sessions_select_own ON public.focus_sessions;
CREATE POLICY focus_sessions_select_own
  ON public.focus_sessions
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS focus_sessions_insert_own ON public.focus_sessions;
CREATE POLICY focus_sessions_insert_own
  ON public.focus_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND (
      installation_id IS NULL
      OR public.user_owns_active_installation(user_id, installation_id)
    )
  );

DROP POLICY IF EXISTS focus_sessions_update_own ON public.focus_sessions;
CREATE POLICY focus_sessions_update_own
  ON public.focus_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND (
      installation_id IS NULL
      OR public.user_owns_active_installation(user_id, installation_id)
    )
  );

DROP POLICY IF EXISTS focus_sessions_delete_own ON public.focus_sessions;
CREATE POLICY focus_sessions_delete_own
  ON public.focus_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_achievements_select_own ON public.user_achievements;
CREATE POLICY user_achievements_select_own
  ON public.user_achievements
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_achievements_insert_own ON public.user_achievements;
CREATE POLICY user_achievements_insert_own
  ON public.user_achievements
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_achievements_update_own ON public.user_achievements;
CREATE POLICY user_achievements_update_own
  ON public.user_achievements
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS user_achievements_delete_own ON public.user_achievements;
CREATE POLICY user_achievements_delete_own
  ON public.user_achievements
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 10. RLS Policies: public.goal_alert_events
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS goal_alert_events_select_own ON public.goal_alert_events;
CREATE POLICY goal_alert_events_select_own
  ON public.goal_alert_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS goal_alert_events_insert_own ON public.goal_alert_events;
CREATE POLICY goal_alert_events_insert_own
  ON public.goal_alert_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS goal_alert_events_update_own ON public.goal_alert_events;
CREATE POLICY goal_alert_events_update_own
  ON public.goal_alert_events
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS goal_alert_events_delete_own ON public.goal_alert_events;
CREATE POLICY goal_alert_events_delete_own
  ON public.goal_alert_events
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 11. RLS Policies: public.sync_dedup_ledger & public.sync_metadata
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS sync_dedup_ledger_select_own ON public.sync_dedup_ledger;
CREATE POLICY sync_dedup_ledger_select_own
  ON public.sync_dedup_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS sync_dedup_ledger_insert_own ON public.sync_dedup_ledger;
CREATE POLICY sync_dedup_ledger_insert_own
  ON public.sync_dedup_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS sync_dedup_ledger_update_own ON public.sync_dedup_ledger;
CREATE POLICY sync_dedup_ledger_update_own
  ON public.sync_dedup_ledger
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS sync_dedup_ledger_delete_own ON public.sync_dedup_ledger;
CREATE POLICY sync_dedup_ledger_delete_own
  ON public.sync_dedup_ledger
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS sync_metadata_select_own ON public.sync_metadata;
CREATE POLICY sync_metadata_select_own
  ON public.sync_metadata
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS sync_metadata_insert_own ON public.sync_metadata;
CREATE POLICY sync_metadata_insert_own
  ON public.sync_metadata
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS sync_metadata_update_own ON public.sync_metadata;
CREATE POLICY sync_metadata_update_own
  ON public.sync_metadata
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND public.user_owns_active_installation(user_id, installation_id)
  );

DROP POLICY IF EXISTS sync_metadata_delete_own ON public.sync_metadata;
CREATE POLICY sync_metadata_delete_own
  ON public.sync_metadata
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

COMMIT;
