# ParkAhead.

ParkAhead is a mobile-friendly Next.js / Supabase prototype for selecting an exact parking bay at four fictional malls. Software availability reflects reservation intervals, not physical sensors. All layouts, distances and routes are fictional.

## Run locally

Install dependencies with `npm install`. Start local Supabase with the Supabase CLI, apply versioned migrations using `supabase migration up`, and copy `.env.example` to `.env.local` with the local URL and keys. Keep the service role key server-only. Run `npm run dev`, then open http://localhost:3000. Build with `npm run build` and serve with `npm start`.

For a new database, apply every migration in order. For an existing database, apply only missing migrations. **Do not reset a database containing bookings.** The final seed verifies the existing versioned catalog; it does not recreate inventory, reclassify bays, overwrite user edits or replace stable IDs. Restore missing catalog objects through a reviewed additive migration. Versions 023–027 add floor identity, eligibility, simulator retirement, private projections and manual audit names; earlier applied migrations remain unchanged.

Create a confirmed local Auth account to sign in. New accounts receive the customer role. For a separate local review administrator, a trusted operator can run the following in the local SQL editor, replacing the example email. This is an operator setup step; customers have no role-management API.

```sql
update public.user_roles set role='admin'
where user_id=(select id from auth.users where email='your-local-admin@example.test');
```

Eligibility review works with either server clock. Fixture reset/clock controls require demo mode. On a disposable local database with no active demo bookings, a trusted operator can enable it with:

```sql
update public.runtime_settings set demo_mode=true,demo_now=clock_timestamp()
where singleton and not exists (
  select 1 from public.reservations
  where is_demo and status in ('confirmed','checked_in')
);
```

Then explicitly confirm RESET in `/admin/demo`. Do not rewind the clock around active bookings or reset another customer's data. Complete/cancel fixture bookings before disabling demo mode. The browser test runner manages and restores these settings automatically.

## Customer journey

Open `/parking` (also the home screen), search or select a mall with the compact selector, then choose a visit interval and optional destination/preferences. Search matches loaded mall names locally and changes selection only when a result is chosen. The compact summary shows floors, destinations and timezone. Switch B1/B2 or list/map view. Inspect full bay labels such as B1-A01 and B2-A01. A reservation always uses the chosen stable bay ID; conflicts never silently substitute another bay. `/legacy` retains the explicitly standard-only automatic allocator.

A plate is required for new reservations. Plates normalize server-side to uppercase letters/digits, ignoring spaces and hyphens. Reservations last at least one hour. Plate and bay interval exclusions, idempotency, active inventory, preference requirements and eligibility are rechecked inside the database. New arrival deadlines use a 30-minute grace period; stored older deadlines remain unchanged. Existing NULL-plate bookings remain visible and require admin assistance for manual arrival.

`/bookings/:id` shows the booking, plate, interval, status, current numbered floor map and booking-time preference explanation. Old location snapshots remain visible when labels have changed. `/bookings/:id/arrival` provides authenticated simulated manual check-in during the arrival window, followed by simulated completion. Customers can cancel their own confirmed booking before the start. No-shows are released by the server scheduler and refresh safely without duplicate events. `/admin/demo` provides protected fixture/clock controls; reset affects the current admin's fictional scenario bookings only.

## OKU policy and privacy

The independent inventory fields are `bay_type` (standard/oku), `is_active` (operational state), `inventory_class` (reservable/walk-in), and computed interval status (available/reserved/unavailable/unknown). The map labels OKU bays with text and an accessibility symbol; availability colors retain their original meaning. The category filter is shared by map/list/recommendations. Anonymous and unapproved customers can inspect OKU bays; they cannot book them. Standard parking remains available without an eligibility declaration.

`/eligibility` lets the signed-in customer request a simulated review for one mall. Status is not_declared, pending, approved or rejected. `/admin/eligibility` allows admins to approve/reject. Approval can have an optional server-enforced expiry via the review API. An expired/rejected request can be submitted again. Approval is checked at reservation creation against that mall's policy and server clock; an immutable decision snapshot records it. Later expiry or rejection does not silently cancel an existing booking. Approval at another mall does not apply.

**Demo eligibility review. This does not implement a real-world verification process.** No medical evidence, identity numbers, permit numbers or uploads are collected. Requests and audit events are owner/admin readable through RLS; customers cannot write decisions, forge another user, or approve themselves. Public inventory exposes no eligibility records or plates. Personalized recommendations and account endpoints are not publicly cached. Only safe customer reference labels appear in the admin review screen.

OKU eligibility is independent of step-free routing. A standard bay can have a verified step-free route; OKU bays can have unknown routes. Unknown or unverified values fail required step-free preferences. Approval cannot bypass interval conflicts, maintenance, required preferences or cross-mall validation.

## Hierarchy and templates

The hierarchy is mall → parking floor → zone → bay. Zone name/code uniqueness is per floor; Zone A can appear on both B1 and B2. Bay code uniqueness is per zone; public labels include the floor. Compound foreign keys prevent cross-mall floor/zone/bay references. Booking-time location snapshots preserve original display references while existing foreign keys and bay UUIDs remain stable.

Four versioned, mall-scoped layout templates hold shared structure. B1/B2 materialize independent feature and bay rows with distinct IDs, availability, type, maintenance, routes, destinations and guidance. Geometry reuse does not merge inventory. Mall silhouettes remain distinct. Templates are public-readable structural data and have no customer mutation permissions; trusted migrations create new versions. Actual floor inventory is authoritative, never dynamically rebuilt when a template is read.

## Removed simulator and retained history

The gate simulator UI, navigation, `/admin/gate`, API handlers and `simulate_gate`/`parking_access_dashboard` RPCs are removed. Old gates are inactive, inaccessible to customer/admin application roles, and no longer seeded. No camera, barrier or recognition simulator is available. Database `gates`, `access_events` and `parking_sessions` retain useful historical references. Audit/session tables have no authenticated direct mutation grants; existing admin RLS permits historical reads. Shared trusted functions still support manual booking lifecycle, historical session closure and maintenance. New manual completions record `manual_departure`; older event names remain unchanged. The original scheduler continues no-show releases and session maintenance without a simulator.

QR display and generation were already removed before this change and remain absent. No QR or token-based check-in was restored. Legacy token-only lookup remains disabled; its compatibility API returns 410. Historical inert token columns are not authentication.

## HTTP surface

- Public: GET `/api/malls`, floor-map and availability; POST `/api/recommendations` with interval/preferences.
- Authenticated: POST `/api/reservations`; own booking details, plate edit, cancellation, manual check-in and completion.
- GET `/api/me/eligibility?mallId=UUID`; POST the same route with `{mallId}` to request review. User ID and decision fields are never accepted.
- Admin: GET `/api/admin/eligibility`; POST `/api/admin/eligibility/:id/review` with `{status:"approved"|"rejected",expiresAt?:ISO|null}`. Protected demo controls remain.
- Removed simulator routes return 404 for authorized callers; `simulate_gate` is absent from the RPC schema.

## Validation

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

For a **disposable local** Supabase database only, set `RUN_LOCAL_DB_TESTS=1` and `RUN_DEMO_DB_TESTS=1`, then run `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`. Tests create isolated users and clean their own data; the lifecycle suite temporarily controls and restores the demo clock. Never run this against production.

For desktop/mobile browser checks, build first, set `RUN_LOCAL_DB_TESTS=1`, `E2E_PRODUCTION=1`, `E2E_BASE_URL=http://localhost:3001`, then run `node scripts/test-journey.mjs`. It creates and removes a temporary admin, starts an isolated production server, and restores the demo settings. Use canonical localhost for the Origin checks. See VERIFICATION.md for actual results.

Shared branding lives in components/brand-logo.tsx, components/page-shell.tsx, components/ui/button.tsx and components/ui/page-elements.tsx. app/globals.css defines the inherited system font, semantic brand/surface/text/status/map tokens and focus styles; app/icon.svg and app/layout.tsx provide the matching favicon and metadata. SVG map labels inherit the same font. No remote font service is required.
