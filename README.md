# ScreenSync — Cross-Platform Healthy Device Usage & Reel Tracker (v2.5.0)

This repository contains the complete **ScreenSync** application across **Android, iOS, Windows, macOS, and ChromeOS (Chromebook)**, integrating:
1. **Latest Cross-Platform Tracking & UI Foundation**: DigitalWellbeingPC cross-platform algorithms (`CrossPlatformAppIdentityResolver`, `BrowserAndWebShortFormInspector`, `CrossPlatformIdleAndSessionTracker`, `SoundExposureAndHealthService`), Brainpal 6-state short-form dwell FSM (`ReelTrackingEngine`), interval-union `ScreenTimeAggregator`, 5-mode adaptive Dynamic/Floating Island, 6-box OTP UI, live 5-rule password validation, Liquid/Soft Glass design styles, 3-mode theme engine, Focus Mode, dual daily goals, and Help & Support / Verification Suite (`#viewFaqVerificationSuite`).
2. **Real Supabase Authentication, Cloud Sync & RLS**: Official `@supabase/supabase-js` v2 client (`SupabaseClientManager`), real email/password signup, 6-digit email OTP verification (`verifyOtp`), password recovery (`resetPasswordForEmail` + `updateUser`), explicit logout guard (`AUTH_LOGOUT_FLAG_KEY`) preventing auto-login on page refresh, `SupabaseSyncEngine` bidirectional cloud synchronization, safe local-to-account migration (`migrateLocalDataToAuthenticatedAccount`), and PostgreSQL Row-Level Security (RLS) migrations (`supabase/migrations/20261022000001..004*.sql`) alongside the local desktop/extension synchronization bridge (`server/sync_server.js`).

## 1. Project Structure

```text
ScreenSync-Full-Project/
├── .env.example                                              # Environment variable & threshold template (no secrets)
├── .vscode/                                                  # VS Code tasks & launch configurations
├── www/
│   └── index.html                                            # Production self-contained ScreenSync HTML bundle
├── src/
│   ├── index.html                                            # Development entry point (synced with www/index.html)
│   ├── styles/
│   │   └── main.css                                          # Authoritative Liquid/Soft Glass & Dynamic Island CSS
│   └── js/
│       └── app.js                                            # Core application, Supabase Auth/Sync & 9-layer tracking engine
├── supabase/
│   ├── config.toml                                           # Supabase project configuration (6-digit OTP, 3600s expiry)
│   ├── email-templates/
│   │   ├── confirm-signup.html                               # Brevo / Supabase Auth 6-digit signup OTP template ({{ .Token }})
│   │   └── reset-password.html                               # Brevo / Supabase Auth 6-digit recovery OTP template ({{ .Token }})
│   └── migrations/
│       ├── 20261022000001_create_screensync_schema.sql       # Core 10-table schema, triggers & get_account_daily_aggregates()
│       ├── 20261022000002_enable_rls_and_policies.sql        # ENABLE + FORCE RLS and per-user/per-device ownership policies
│       ├── 20261022000003_verify_rls_and_schema_tests.sql    # Transactional RLS verification (rolls back test fixtures)
│       └── 20261022000004_reconcile_schema_and_rpcs.sql      # Reconciles user_profiles(id/user_id), security_alerts & RPC alias
├── migrations/
│   └── 002_digitalwellbeingpc_cross_platform_integration.sql # Local SQLite / companion cross-platform migration
├── server/
│   └── sync_server.js                                        # Local desktop & browser-extension HTTP synchronization bridge
├── platforms/
│   ├── windows/
│   │   └── ScreenSyncWindowsCompanion.cs                     # Native Windows Win32 + UIAutomation + WASAPI bridge
│   ├── macos/
│   │   └── ScreenSyncMacCompanion.swift                      # Native macOS NSWorkspace + AXUIElement + NSPanel companion
│   └── browser-extension/
│       ├── manifest.json                                     # Manifest V3 Chrome/Edge/Brave/ChromeOS extension
│       ├── background_collector.js                           # Tab & short-form video session collector
│       └── content_shortform_observer.js                     # DOM short-form video dwell observer
├── android/                                                  # Native Android Studio project (Java UsageStats + Accessibility)
├── ios/                                                      # Native Xcode iOS project (Swift FamilyControls + ActivityKit)
├── scripts/
│   └── sync-web-assets.js                                    # Synchronizes src/js/app.js & src/styles/main.css -> bundles
├── tests/
│   └── run_all_tests.js                                      # 42 automated verification suites (100% passing)
├── capacitor.config.json                                     # Capacitor cross-platform configuration
└── package.json                                              # Build, sync, local bridge, and test scripts
```

## 2. Supabase Authentication, Email Delivery & Database Migrations

### A. Supabase Client Configuration
- **Project URL**: `https://ldephpgydnsovhlkuzbe.supabase.co`
- **Project ID**: `ldephpgydnsovhlkuzbe`
- **Publishable Key**: `sb_publishable_8mgpzcakPnNv8Z3g5lB_fg_86vpH-_q`
- **Email Delivery (Brevo Custom SMTP)**: Configured in Supabase Dashboard (`smtp-relay.brevo.com:587`, sender `ScreenSync <nawyazahammedhridoy2003@gmail.com>`). Templates in `supabase/email-templates/confirm-signup.html` and `supabase/email-templates/reset-password.html` use `{{ .Token }}` to deliver the 6-digit OTP code. No SMTP passwords, API keys, or `service_role` keys are ever stored in source code.

### B. SQL Migrations & Schema Reconciliation
- `20261022000001_create_screensync_schema.sql` (applied on live project): Creates `user_profiles`, `device_installations`, `screen_usage_sessions`, `reel_watch_events`, `user_settings`, `focus_sessions`, `user_achievements`, `goal_alert_events`, `sync_dedup_ledger`, `sync_metadata`, `handle_new_auth_user()`, and `get_account_daily_aggregates(DATE)`.
- `20261022000002_enable_rls_and_policies.sql` (applied on live project): Enables `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on all 10 tables, revokes `PUBLIC`/`anon` privileges, and enforces `auth.uid() = user_id` plus `user_owns_active_installation(installation_id)`.
- `20261022000003_verify_rls_and_schema_tests.sql`: Transactional verification script (`BEGIN ... ROLLBACK`) testing two-user RLS isolation and cross-installation spoofing rejection.
- `20261022000004_reconcile_schema_and_rpcs.sql`: Non-destructive reconciliation migration that adds generated column `id` and `avatar_initials` to `public.user_profiles`, creates `public.security_alerts` (with RLS + `FORCE RLS`) alongside `public.sync_metadata`, creates `public.get_account_usage_summary(DATE)` as a backward-compatible `SECURITY INVOKER` wrapper around `public.get_account_daily_aggregates(DATE)`, and adds RLS-protected cross-platform telemetry tables (`app_category_rules`, `website_usage_sessions`, `sound_usage_sessions`, `tracker_heartbeats`).

## 3. Building, Running & Testing

```bash
# Synchronize src/styles/main.css and src/js/app.js into all platform bundles
npm run sync:assets

# Run all 42 automated verification suites
npm test

# Start the local desktop/extension synchronization bridge on port 43110
npm run sync:server

# Serve the web application locally on port 3000
npm start
```
