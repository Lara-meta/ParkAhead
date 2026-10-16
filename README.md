# ParkAhead

A mobile-friendly parking reservation prototype for fictional **Demo Central Mall**. Availability comes from PostgreSQL reservations and simulated inventory. Physical bay availability is not verified. Confirmed means allocated in software; physical access is not guaranteed.

## Architecture

One Next.js App Router application, React, strict TypeScript, Tailwind CSS 4, a shadcn-style Radix Slot/CVA Button, Supabase Auth and PostgreSQL, Zod validation, SVG map, Vitest and Playwright. Route handlers live in `app/api/[...path]/route.ts`; customer and admin screens share the application shell. Business rules live in `lib/rules.ts` and `lib/lifecycle.ts`, with authoritative reservation validation in SQL. No application service-role client or browser-storage inventory fallback exists. The service-role key is used only by explicitly enabled local integration and E2E test tooling.

Database functions allocate bays, cancel and transition bookings, and disable bays. The GiST exclusion constraint protects half-open intervals for confirmed and checked-in bookings. A per-user/key transaction advisory lock serializes idempotent attempts. Bay row locks serialize inventory changes. Allocation and audit event creation commit together. Replays return the original result without adding an event. Direct customer writes to roles, reservations and events are denied. Safe inventory and aggregate availability are public; booking details use ownership/admin RLS. Mutation handlers require the same Origin as the request URL. Deploy behind a proxy that preserves the canonical host/origin.

## Requirements and local setup

Use Node.js 22 LTS and npm, Docker Desktop, and the Supabase CLI. The implementation environment has Node 25.2.1/npm 11.6.2; use LTS for deployment.

```powershell
npm install
supabase start
supabase db reset
Copy-Item .env.example .env.local
supabase status
```

Copy the local API URL and anon key shown by `supabase status` into `.env.local`. Never commit credentials. Then:

```powershell
npm run dev
```

Open http://localhost:3000. Missing credentials produce a visible setup error, not simulated successful persistence. `supabase db reset` is destructive to the selected LOCAL database; do not use against a production database. The seed is idempotent and creates one mall, three zones, ten standard bays per zone, Cinema/Supermarket/Food Court, varied demo routes and one inactive bay. Unverified Zone C routes display unknown distance. All verified routes are fictional dataset assertions.

For hosted Supabase, create a dedicated project and apply migrations with `supabase link --project-ref YOUR_REF` then `supabase db push`. Apply `supabase/seed.sql` in its SQL editor for a demo project only. Set the project URL/anon key in your deployment environment.

## Authentication and test admin

Register in the app. Local configuration disables email confirmation for development only. For hosted use, enable confirmation, configure Site URL and allowed redirect URLs to the deployed origin, and configure email delivery. The UI asks users to verify email and sign in after confirmation; it never automatically confirms a booking after authentication. Password minimum in the UI is eight characters; configure equivalent server Auth policy.

Create a normal account, then promote its specific UUID from a trusted SQL editor:

```sql
update public.user_roles set role = 'admin'
where user_id = 'REPLACE_WITH_AUTH_USER_UUID';
```

Do not expose this SQL operation to customers. No default admin account/password is provided. Admin is visible in navigation but all data/actions require a verified session and database role; unauthorised requests fail. Customers can register/sign in/out, search and review before confirming, view private bookings and cancel eligible bookings. Admins can filter bookings by time/status, inspect bays/routes and simulate allowed transitions. Disabling a bay reports affected reservation counts and retains existing bookings.

## Defaults

Mall timezone Asia/Kuala_Lumpur (UTC+8). Input is interpreted explicitly at +08:00, and display uses the named mall timezone regardless of browser timezone. Start must be future and at most 30 days ahead. Duration 30 minutes through 8 hours. Change the authoritative defaults in the `validate_booking_interval` database function through a new migration and align `lib/rules.ts` and UI labels when configuring different limits. Same-day start/end UI; overnight bookings are a current UI limitation. No turnover buffer. Intervals are `[start_at,end_at)`, so adjacent bookings are allowed. Customers can cancel only their own confirmed reservation before start, with no fee. No payments, vehicle plates, mandatory QR scanning, barriers, sensors, guards, fines, ML, native app or turn-by-turn navigation.

Recommendations exclude full zones. No preference orders alphabetically by zone name, including with a destination. Shorter-walk ranks verified known routes ascending by distance, then unknown/unverified routes; ties sort by name. Step-free requires a destination and a verified route with true step-free status; it never substitutes another zone. Restricted accessible bays are not allocated. Counts are advisory and revalidated during allocation.

## API

All APIs return `{data: ...}` or `{error:{code,message,fieldErrors?}}`. Endpoints: GET `/api/malls`, `/api/malls/:id/destinations`, `/api/availability`, `/api/recommendations`; POST `/api/reservations`; GET `/api/reservations/:id`, `/api/me/reservations`; POST `/api/reservations/:id/cancel`; GET `/api/admin/reservations` (optional status), `/api/admin/bays`, `/api/admin/routes`; PATCH `/api/admin/bays/:id`; POST `/api/admin/reservations/:id/check-in`, `/complete`, `/no-show`.

Search query/body fields: `mallId,startAt,endAt,destinationId?,preference`. Reserve also requires `zoneId,idempotencyKey` UUID. Bay PATCH accepts `{isActive:boolean}`. Check-in/completion are explicitly simulated; no-show release is permitted at or after the stored arrival deadline. SQL errors are mapped to safe messages and HTTP 400/401/403/404/409/500, or 503 when unconfigured.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests require a disposable **local** Supabase with the migration applied. Set environment variables in the shell (`.env.local` is loaded by Next, not automatically by Vitest):

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='LOCAL_ANON_KEY'
$env:SUPABASE_SERVICE_ROLE_KEY='LOCAL_SERVICE_ROLE_KEY'
$env:RUN_LOCAL_DB_TESTS='1'
npm run test:integration
```

Tests create isolated users/mall/zone/bay, verify conflicts/containment/adjacency/cancellation/idempotency/concurrency/RLS/inactive inventory and clean up only their own records. Without opt-in they skip. Never supply a production service key. For full authenticated Playwright flow set `E2E_EMAIL` and `E2E_PASSWORD` to an existing confirmed LOCAL customer. E2E booking tests create and cancel reservations; use a disposable local project. Desktop and phone projects cover the main flow. Empty-state tests stub responses explicitly; these are UI tests, not persistence tests.

## Dependency versions

Declared compatible ranges: Next 15.5, React/React DOM 19.1, TypeScript 5.9, Tailwind 4.1, Supabase JS 2.57, Supabase SSR 0.7, Zod 4.1, Radix Slot 1.2, CVA 0.7, Lucide 1.57, Vitest 3.2, Playwright 1.55, ESLint 9 with Next config 15.5. See `package-lock.json` and `VERIFICATION.md` for resolved installed versions and actual verification results. Install reproducibly with `npm ci`.

Framework references: [Next App Router](https://nextjs.org/docs/app/getting-started/installation), [Supabase SSR cookie clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Deployment

Deploy to a Node-compatible Next.js host such as Vercel. Build command `npm run build`; self-host with `npm start`. Configure only the public Supabase URL and anon key for application runtime, apply database migrations before release, configure Auth origin/redirect URLs, use HTTPS and verify same-origin mutation checks through your host. No server-only key is required by the deployed app. This repository does not provision external hosting or a Supabase project.

## Demo walkthrough

1. Start local Supabase, migrate/seed, configure environment and register/sign in.
2. Choose tomorrow, 10:00–12:00 MYT, Cinema and shorter walk. Find parking; inspect count, distance and map.
3. Choose a zone, review the visit, explicitly confirm. Observe the PostgreSQL-assigned bay/reference.
4. Open My bookings, inspect details, cancel before start. Repeat search to see restored availability.
5. Use a promoted admin to disable a bay or simulate check-in/completion. Review route records; no physical verification is implied.
6. Run the isolated database suite to demonstrate races, RLS and idempotency.

## Remaining limitations

Supabase must remain configured and running. No physical occupancy verification or access guarantee. No-show cleanup may lag the deadline by one scheduler interval. Demo clock changes require a dedicated demo environment; switching mode during active demo sessions is unsupported. The search UI supports the seeded UTC+8 mall and same-day intervals. Booking details, arrival and zone guidance have authorized deep links. No email/SMS/push reminders, live navigation, pagination, rate limiting, password reset or account-management screens are included. No external deployment or real mall pilot was performed. See VERIFICATION.md for the actual local checks.

## Arrival lifecycle extension

Apply the additive migrations `202610150002` through `202610150006` with `supabase migration up` locally or `supabase db push` for the intended hosted project. Do not reset an existing database to upgrade. Migration 002 backfills stored deadlines as `least(end_at,start_at + 15 minutes)` and securely generates opaque tokens. Existing reservations remain `is_demo=false`, preserving real-clock semantics; it does not release them in the migration transaction. Migration 003 activates the scheduler: **on its first tick, any existing confirmed record already past its backfilled deadline is intentionally eligible for release**. Review affected confirmed bookings before enabling that migration on an existing project. The original exclusion constraint and idempotency keys are preserved.

Arrival grace defaults to 15 minutes. Configure it only as a trusted database operator:

```sql
update public.runtime_settings set grace_minutes = 15 where singleton;
```

New booking duration must exceed that grace period as well as satisfy the original 30-minute to eight-hour limits. Each new reservation snapshots `arrival_deadline = start_at + grace`; later setting changes never alter stored deadlines. Arrival is allowed only at `start_at <= database time < arrival_deadline`. At the exact deadline, check-in is denied and release becomes eligible. No client-provided time is trusted. Simulated check-in and departure are permitted only for the owner or an admin; retries create no duplicate lifecycle events. Final states never return to checked-in. Checked-in bookings are never automatically completed or marked no-show. After scheduled end they display **Overdue — simulated occupancy not cleared**. Original requested intervals remain intact for audit.

### Scheduler

Migration 003 installs Supabase-supported `pg_cron` and schedules `public.release_due_no_shows()` every minute. It works with no customer browser open. Cleanup locks rows, rechecks time after the lock, updates only still-confirmed rows, records `released_at` and exactly one `no_show_released` event. Availability, allocation and authorized booking refresh paths also perform safe cleanup. Expected scheduler delay is zero to about 60 seconds plus job execution time; arrival authorization rejects late check-in immediately, even between ticks. Skipped locked rows are retried by a later run. Checked-in occupancy is a simulation and the model only blocks the original scheduled interval; an overdue checked-in warning is not a physical availability guarantee.

Inspect the scheduler using a trusted SQL connection:

```sql
select jobname, schedule, active from cron.job where jobname = 'parkahead-no-shows';
select status, start_time, end_time, return_message
from cron.job_run_details order by start_time desc limit 10;
select public.release_due_no_shows(); -- operator/service-role execution only
```

The cleanup function is not executable by ordinary customers. The authenticated list-refresh wrapper exposes no private bookings or release counts; the admin manual cleanup action checks the admin role. Public availability may invoke internal cleanup as part of calculating safe aggregate availability. If your PostgreSQL installation lacks pg_cron, migration 003 cannot be applied until that extension is installed/configured. Do not claim scheduling is active based solely on deploying the web app. [Supabase Cron setup](https://supabase.com/docs/guides/cron/quickstart).

### Demo clock and isolation

`runtime_settings.demo_mode` is the explicit **DEMO_MODE** configuration, stored in the database as the single source of truth rather than duplicated in an environment variable. Default is false. Only a trusted operator can enable it; the admin panel cannot toggle the mode or change grace settings. For a dedicated disposable demo Supabase project:

```sql
update public.runtime_settings
set demo_mode=true, demo_now='2030-01-15 02:00:00+00'
where singleton;
```

Reload the app after changing mode. A persistent DEMO MODE indicator appears. The seed mall is flagged fictional (`malls.is_demo=true`). New bookings become demo-clock records only when that mall flag and demo mode are both true. Existing/non-demo reservations always use `clock_timestamp()`, even when the demo clock is moved. Each reservation snapshots `is_demo`. Demo records continue using the controlled clock until finished; do not toggle mode while demo sessions are active. The clock is frozen between admin advances. Booking validation, arrival, cancellation, cleanup, countdowns, filtering, and metrics use this shared authoritative clock. Real countdowns interpolate only from a server-time snapshot using elapsed monotonic time, never the computer's wall clock. Clock writes take an exclusive lock; booking operations take a shared clock lock before reservation locks, preventing half-applied time changes.

Use a **dedicated demo database/project**. Resetting the shared demo clock affects the perceived time of every demo-clock record in that project. Non-demo records retain real time. The admin panel requires typing RESET and the server requires the literal confirmation. It deletes only the invoking admin's `is_demo` scenario fixtures and their explicit fixture rebookings/events. It never deletes authentication users, normal bookings, another user's fixtures or ordinary customer bookings. Other demo bookings keep their data and share the reset clock. An inventory conflict aborts the entire reset transaction. Resolve such conflicts or use a clean dedicated demo project; unrelated data is never silently cancelled.

### QR, reminders, and zone guidance

Open `/bookings/<id>`, `/arrival/<opaque-token>`, or `/bookings/<id>/zone`. A booking QR encodes only the application arrival URL with a random UUID token. It contains no customer identity, trusted paid/confirmed assertion or key. The owner/admin must still authenticate; token possession alone grants no read or mutation access. Use **Open arrival screen** as the equally supported non-QR path. Opening the page never checks in automatically. The app's sign-in page preserves the intended local booking URL but requires explicit action afterward. Treat arrival URLs as private; avoid logging or sharing them publicly. Booking responses are not cached and the app uses a no-referrer policy.

A phone must be able to reach the app and Supabase URL. A QR generated on localhost is usable only on that computer. For phone scanning use a reachable deployment or properly configured LAN origin and Supabase/Auth URLs; there is no physical scanner integration. No email/SMS/push reminder is sent. In-app reminders show the absolute deadline and countdown; active bookings refresh every 30 seconds while visible and on focus/visibility return. Final statuses stop interval polling. Failed refreshes explicitly mark the state stale and pause actions.

Driving guidance (vehicle entrance → zone) is visually and textually separate from walking guidance (lift lobby → destination). Additive fictional guidance exists for Zones A and B; Zone C intentionally demonstrates a missing-driving-route fallback. Unverified/missing pedestrian routes never receive invented walking instructions. The map always identifies the stored zone/floor/bay, but shows only an approximate bay area. No GPS, live location, real physical positioning or turn-by-turn navigation exists. Route verification refers only to fictional seed data.

### Repeatable scenarios and presentation

Sign in as an authorized local demo admin and open `/admin/demo`. Confirm RESET to load A and B; scenario C uses B's released arrival link.

- **A — successful journey:** Cinema + step-free in Zone B; the fixture starts at 10:05 MYT. Open zone guidance and arrival, advance demo time five minutes, refresh, simulate check-in, then simulate departure. Or create a customer booking using the full search/recommendation flow; demo search defaults to five minutes ahead.
- **B — no-show:** fixture starts at 09:55, with deadline 10:10 MYT. Compare next-hour availability, advance past 10:10 and run cleanup (the same logic as pg_cron). Observe `no_show`, the count change and stored release event. **Book the remaining interval** creates an explicit subsequent reservation linked by `demo_rebooking_of`; repeated clicks return the same stored booking. Duration must still meet the normal limits. Reset also removes these admin-owned scenario rebookings so the scenario is repeatable.
- **C — late arrival:** open B's old arrival URL. It states that the booking was released, offers a new search and cannot restore/check in the old booking. A direct late mutation also returns a conflict.

`/demo-story` is public and read-only. It distinguishes product hypotheses, an illustrative non-interview user statement, solution, authorized demo links, actual simulation metrics, unproven outcomes and next steps. Admins can edit the illustrative quote in the protected panel; its public label never claims research. See `PRESENTATION.md` for a short pitch script.

Metrics join actual stored events to `is_demo` reservations: confirmed allocation, successful simulated check-in, completion and no-show release. The metric **Scheduled minutes released in simulation** sums `max(0,end_at - released_at)` in minutes once per unique release event. Cleanup retries do not increase it. Completed sessions do not count as no-shows. Rebooking is shown only when an explicit subsequent reservation exists, never inferred from availability. Resetting fixtures removes their events, so those fixtures no longer contribute to current dataset metrics. There are no claims of measured time savings, revenue, emissions, demand or commercial viability.

### Extension tests

Existing test commands remain available. For full local integration and authenticated desktop/phone E2E:

```powershell
$env:RUN_LOCAL_DB_TESTS='1'
$env:RUN_DEMO_DB_TESTS='1'
node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
node scripts/test-journey.mjs
```

The demo integration suite and browser runner refuse non-local Supabase and active unrelated demo sessions. They create temporary users/inventory, restore clock settings and remove only their own records. The browser runner generates an in-memory temporary admin credential and executes the tests sequentially; it does not use or change your existing account. Do not run these clock-changing suites concurrently. The pg_cron integration case can take up to 80 seconds and verifies release without any page or cleanup invocation. Unit tests cover exact arrival boundaries, terminal states, honest countdowns, nonnegative released minutes and navigation fallbacks. Integration tests verify ownership/token authorization, admin restrictions, races, idempotency, clock isolation, actual rebooking, safe reset and scheduled release. E2E tests exercise the real stored successful journey, release/rebooking and late-arrival rejection on desktop and phone. The original empty-state/conflict UI tests continue using explicit response stubs.

Additional dependencies: qrcode 1.5.4 and @types/qrcode 1.5.6; exact resolved versions remain in package-lock.json. See the updated verification report for commands actually run and their results.

### New API routes

GET `/api/clock?mallId=<uuid>`, `/api/demo/metrics`, `/api/demo/story`; authorized GET `/api/arrival/:token`; owner/admin POST `/api/arrival/:token/check-in`, `/api/arrival/:token/complete`, `/api/reservations/:id/check-in`, `/api/reservations/:id/complete`. Admin GET `/api/admin/demo`; admin POST `/api/admin/demo/advance` (`{minutes}`), `/cleanup` (`{}`), `/reset` (`{confirmation:"RESET"}`), `/rebook` (`{reservationId}`), `/story` (`{quote}`). Unknown client time values never become authoritative. Same-origin and role/ownership checks remain enforced.
