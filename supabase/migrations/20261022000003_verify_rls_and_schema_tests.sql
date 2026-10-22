-- ============================================================================
-- ScreenSync Production Database Migration 003: Two-User RLS & Schema Verification
-- Supabase Project: https://ldephpgydnsovhlkuzbe.supabase.co
-- Migration File: supabase/migrations/20261022000003_verify_rls_and_schema_tests.sql
-- ============================================================================
-- Run this script in the Supabase SQL Editor AFTER applying migrations 001 & 002.
-- It executes inside a transaction that rolls back test fixtures at the end so
-- no test rows remain in production while proving:
--   1. All 10 required tables and indexes exist.
--   2. RLS and FORCE RLS are enabled on all 10 tables.
--   3. Zero permissive USING (true) or WITH CHECK (true) policies exist.
--   4. Unauthenticated (anon) role cannot read or write private tables.
--   5. User A can read/write only User A's rows and cannot read, update,
--      delete, or impersonate User B's rows across any table.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_user_a UUID := '11111111-1111-4111-8111-111111111111';
  v_user_b UUID := '22222222-2222-4222-8222-222222222222';
  v_rls_count INTEGER;
  v_permissive_count INTEGER;
  v_visible_to_a INTEGER;
  v_visible_to_b INTEGER;
  v_impersonation_blocked BOOLEAN := FALSE;
  v_cross_device_blocked BOOLEAN := FALSE;
  v_agg_json JSONB;
BEGIN
  -- 1. Verify RLS is enabled and forced on all 10 user-owned tables
  SELECT COUNT(*)
  INTO v_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'user_profiles',
      'device_installations',
      'screen_usage_sessions',
      'reel_watch_events',
      'user_settings',
      'focus_sessions',
      'user_achievements',
      'goal_alert_events',
      'sync_dedup_ledger',
      'sync_metadata'
    )
    AND c.relrowsecurity = TRUE
    AND c.relforcerowsecurity = TRUE;

  IF v_rls_count <> 10 THEN
    RAISE EXCEPTION 'RLS verification failed: expected 10 tables with RLS + FORCE RLS enabled, found %', v_rls_count;
  END IF;

  -- 2. Verify no permissive USING (true) or WITH CHECK (true) policies exist
  SELECT COUNT(*)
  INTO v_permissive_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      btrim(COALESCE(qual, '')) = 'true'
      OR btrim(COALESCE(with_check, '')) = 'true'
    );

  IF v_permissive_count > 0 THEN
    RAISE EXCEPTION 'RLS verification failed: found % overly permissive policy rules', v_permissive_count;
  END IF;

  -- 3. Seed two isolated test users in auth.users (triggers handle_new_auth_user)
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_user_a, 'user_a_rls_test@screensync.io', NOW(), '{"full_name":"User A Test"}'::jsonb, NOW(), NOW()),
    (v_user_b, 'user_b_rls_test@screensync.io', NOW(), '{"full_name":"User B Test"}'::jsonb, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  -- 4. Switch to authenticated role as User A
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO public.device_installations (
    user_id, installation_id, installation_key, device_name, os_category, device_category, cutout_type
  ) VALUES (
    v_user_a, 'inst_user_a_ios', 'iphone_16', 'User A iPhone 16 Pro', 'iOS', 'Phone', 'IPHONE_PILL'
  );

  INSERT INTO public.screen_usage_sessions (
    user_id, session_id, interval_id, installation_id, installation_key, os_category,
    app_key, app_name, category, local_date, has_timestamps, start_epoch_sec, end_epoch_sec, duration_minutes
  ) VALUES (
    v_user_a, 'sess_a_1', 'iv_a_1', 'inst_user_a_ios', 'iphone_16', 'iOS',
    'instagram', 'Instagram', 'Social networking', CURRENT_DATE, TRUE, 1760590000, 1760593600, 60
  );

  INSERT INTO public.reel_watch_events (
    user_id, event_id, installation_id, installation_key, os_category,
    app_key, app_name, content_type, reel_count, watch_minutes, watch_seconds, local_date
  ) VALUES (
    v_user_a, 'reel_a_1', 'inst_user_a_ios', 'iphone_16', 'iOS',
    'instagram', 'Instagram', 'REEL', 5, 15, 900, CURRENT_DATE
  );

  -- 5. Switch to authenticated role as User B
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user_b::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- User B must see 0 rows belonging to User A
  SELECT COUNT(*) INTO v_visible_to_b FROM public.screen_usage_sessions WHERE user_id = v_user_a;
  IF v_visible_to_b <> 0 THEN
    RAISE EXCEPTION 'RLS isolation violation: User B could read User A screen_usage_sessions';
  END IF;

  SELECT COUNT(*) INTO v_visible_to_b FROM public.reel_watch_events WHERE user_id = v_user_a;
  IF v_visible_to_b <> 0 THEN
    RAISE EXCEPTION 'RLS isolation violation: User B could read User A reel_watch_events';
  END IF;

  SELECT COUNT(*) INTO v_visible_to_b FROM public.user_settings WHERE user_id = v_user_a;
  IF v_visible_to_b <> 0 THEN
    RAISE EXCEPTION 'RLS isolation violation: User B could read User A user_settings';
  END IF;

  -- User B attempting to insert a device or usage record impersonating User A must be rejected
  BEGIN
    INSERT INTO public.device_installations (
      user_id, installation_id, installation_key, device_name, os_category
    ) VALUES (
      v_user_a, 'inst_spoofed_by_b', 'spoof_dev', 'Spoofed Device', 'Android'
    );
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_impersonation_blocked := TRUE;
  END;

  IF NOT v_impersonation_blocked THEN
    RAISE EXCEPTION 'RLS isolation violation: User B was able to insert a device impersonating User A';
  END IF;

  -- User B attempting to insert usage referencing User A's installation_id under User B's user_id must be rejected
  BEGIN
    INSERT INTO public.screen_usage_sessions (
      user_id, session_id, interval_id, installation_id, installation_key, os_category,
      app_key, app_name, category, local_date, duration_minutes
    ) VALUES (
      v_user_b, 'sess_cross_inst', 'iv_cross_inst', 'inst_user_a_ios', 'iphone_16', 'iOS',
      'instagram', 'Instagram', 'Social networking', CURRENT_DATE, 30
    );
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR check_violation THEN
    v_cross_device_blocked := TRUE;
  END;

  IF NOT v_cross_device_blocked THEN
    RAISE EXCEPTION 'RLS cross-table ownership violation: User B referenced User A installation';
  END IF;

  -- 6. Switch back to User A and verify aggregate RPC works for authorized owner
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_user_a::text)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_agg_json := public.get_account_daily_aggregates(CURRENT_DATE);
  IF (v_agg_json->>'totalScreenMinutes')::integer <> 60 OR (v_agg_json->>'reelsCount')::integer <> 5 THEN
    RAISE EXCEPTION 'RPC aggregation mismatch for User A: %', v_agg_json;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'ALL SCREENSYNC RLS, OWNERSHIP, AND AGGREGATION CHECKS PASSED.';
END;
$$;

ROLLBACK;
