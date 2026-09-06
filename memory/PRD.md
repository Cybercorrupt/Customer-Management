# Customer Management — PRD

## Original Problem Statement
Import existing project from GitHub: https://github.com/Cybercorrupt/Customer-Management.git

## Architecture
- **Frontend**: Expo Router (React Native), TanStack Query, react-native-gifted-charts. Indonesian-language UI.
- **Backend**: FastAPI + MongoDB (motor), JWT auth (bcrypt), Fernet-encrypted credential storage.
- **Storage**: Emergent Managed Object Storage (logo uploads).
- **Optional Sync**: Supabase two-way sync engine (configurable in-app; disabled by default).
- **Data I/O**: Excel/CSV import-export (openpyxl/pandas).

## Import Work Done (2026-09-06)
- Cloned repo and copied into /app, preserving protected `.env` files, `metro.config.js`, `node_modules`, scripts.
- Regenerated lost secrets (gitignored): `JWT_SECRET`, `CREDENTIAL_MASTER_KEY` (Fernet), added `EMERGENT_LLM_KEY` for object storage.
- Installed backend (pip) and frontend (yarn) dependencies.
- Verified end-to-end: user & admin login (curl + UI), dashboard renders with 48 seeded customers, KPIs, charts, bad-debt summary.

## Seeded Accounts
- User: `user` / `user123` (`POST /api/login`)
- Admin: `admin` / `admin123` (`POST /api/admin/login`)

## Core Features (existing)
- Auth (user + admin roles), change/forgot password.
- Customer directory: list, search, detail, edit profile.
- Dashboard: totals, active/inactive, bad-debt nominal, status donut chart.
- Admin: customer CRUD, users, master data, import/export (Excel), trash, conflicts, Supabase sync config.
- Offline-aware UI with sync trigger.

## Backlog / Next
- P1: Verify admin import/export flows and Supabase sync in-app.
- P2: Broader automated test pass across all screens.

## 2026-09-06 (later) — Supabase + Branding
- Migrated photo/logo storage from Emergent to Supabase Storage (backend/object_storage.py); bucket `customer-photos`.
- Seeded default Supabase sync connection via env (SUPABASE_DEFAULT_URL/KEY) so the deployed app is connected out of the box (sync status = synced, pull-now works).
- Fixed User search/filter staleness (useFocusEffect refetch + SyncBar invalidations + stale-filter reset).
- Replaced bundled default logo + app launcher icons with user-provided brand image.
