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


## 2026-06 — Re-import from GitHub (fresh workspace)
- Cloned https://github.com/Cybercorrupt/Customer-Management.git and copied into /app, preserving protected `.env` files and `metro.config.js`.
- Regenerated gitignored secrets: `JWT_SECRET`, `CREDENTIAL_MASTER_KEY` (Fernet), plus `JWT_EXPIRE_MINUTES=720`.
- Removed unused `emergentintegrations` + pinned `litellm` from requirements.txt (not imported anywhere; caused a pip resolution conflict). App uses no LLM.
- Installed backend (pip) + frontend (yarn) deps; both services healthy.
- User choice: Supabase left UNCONFIGURED — photo/logo uploads + two-way sync are intentionally OFF (object storage logs a startup warning, app runs fine).
- Testing agent: 20/20 backend pytest + full frontend flow pass. Dashboard shows 48 customers, active 32 / inactive 8, bad-debt Rp 1.831.000.000, donut chart. User + admin login, customer list/search/detail, admin screens all verified.

## 2026-06 — Location fields, Google Maps, region cascade, no-dummy-data
- Removed MapView (dropped react-native-maps); customer coordinates now open via a "Buka di Google Maps" button.
- Added Address & Location fields at the bottom of Form + Detail: address, village, district, city_regency, province, postal_code, country, latitude, longitude, location_accuracy, location_updated_at (auto), location_updated_by (auto = admin username / "import").
- Fields wired through Customer model + CustomerInput, create/update CRUD, list search, CSV + XLSX import/export (headers + validation + round-trip), MongoDB, Sync Queue, and Supabase (schema DDL + CUSTOMER_SYNC_FIELDS + pull mapping).
- Region cascade filter Province -> City/Regency -> District -> Village on user Customers screen and Admin filter sheet (src/utils/region.ts), derived live from customer data. Area stays a separate master.
- Master Data = single source of truth: removed hard-coded master lists from frontend (only STATUSES enum kept); dropdowns/filters pull from DB.
- Removed ALL dummy/sample data from the offline DB and disabled seed_customers + seed_master (only user/admin accounts seed). Offline holds only real user data.
- Verified: testing agent iteration_2 all pass (16/16 backend pytest + full frontend flow).

## 2026-06 — Form consistency, regional dashboard, drop location_accuracy
- Removed `location_accuracy` field end-to-end (model, CustomerInput, CRUD, CSV+XLSX headers/validation/round-trip, _COMPARE_FIELDS, Supabase schema, CUSTOMER_SYNC_FIELDS, pull mapping, client types, admin form, detail).
- Admin customer CRUD form's "Alamat & Lokasi" section now mirrors the customer detail (same fields, labels, order).
- Dashboard: added "Customer per Provinsi" + "Customer per Kota/Kabupaten" summary cards, backed by new dashboard stats by_province / by_city (region_counts skips blanks, top 6 + "Lainnya").
- Verified: testing agent iteration_3 all pass; offline DB re-cleared to hold only real user data.
