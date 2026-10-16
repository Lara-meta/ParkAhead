# Verification — ParkAhead arrival extension, 15 October 2026

The existing Next.js/Supabase implementation was extended incrementally. The original migration, seed data, Auth model, RLS policies, idempotent allocation and exclusion constraint were retained. Additive migrations 002–006 were applied transactionally to the configured **local** Supabase database at 127.0.0.1. The pre-existing cancelled reservation and existing auth accounts were preserved. No external deployment was performed.

| Check                                            | Actual result                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| TypeScript                                       | Passed                                                                                                            |
| ESLint                                           | Passed, no warnings                                                                                               |
| Unit tests                                       | **33 passed**                                                                                                     |
| PostgreSQL/Supabase integration                  | **16 passed**, no skipped tests                                                                                   |
| Authenticated Playwright desktop and phone suite | **16 passed**, no skipped tests                                                                                   |
| Production build                                 | Passed on final implementation (Next 15.5.28)                                                                     |
| pg_cron scheduling                               | Installed and active, every minute                                                                                |
| Automatic release without a browser              | Passed in a real-clock integration fixture; the scheduler released it with one event, without any cleanup request |

Commands executed:

```powershell
npm run typecheck
npm run lint
npm test
$env:RUN_LOCAL_DB_TESTS='1'
$env:RUN_DEMO_DB_TESTS='1'
node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
node scripts/test-journey.mjs
npm run build
```

Integration tests exercised exact start/deadline boundaries, grace-period snapshots and duration rejection, check-in/cleanup concurrency, idempotent check-in/completion/cleanup, terminal states, completion releasing the remaining interval, original requested times, restored capacity and actual subsequent bookings, private token lookup, anonymous/foreign mutations, admin-only time/reset, clock isolation, reset scope, overlap protection and database-scheduled execution. The final full integration run took about 48 seconds, mostly waiting for the next cron tick.

The full browser run exercised the original booking/cancellation flow, empty states and conflict handling, plus Cinema + step-free recommendation → allocation → zone guidance → authenticated arrival → simulated check-in → departure; no-show/focus refresh/rebooking; late-arrival rejection; and honest public story content on desktop and phone. The original empty-state and allocation-conflict tests use explicit stubs. The new lifecycle journeys use actual local PostgreSQL persistence; late-arrival rejection includes a real API call containing an ignored client-supplied time.

Temporary test admins/customers, test inventory, scenario fixtures and rebookings were removed after each suite. Clock settings were restored. The application uses no service-role client; local test tooling uses the key only in process memory. No default admin credentials were added. Demo mode remains an explicit operator configuration rather than being silently enabled for existing users.

The first browser run exposed a stale real-clock response initializing the demo mall search form; clock responses are now tied to the selected mall before form initialization. An ambiguous alert assertion was also corrected to avoid Next.js's route announcer. The clean full rerun passed all 16 cases.

Added dependencies: qrcode **1.5.4**, @types/qrcode **1.5.6**. Retained versions: Next **15.5.28**, React/React DOM **19.3.1**, TypeScript **5.9.3**, Tailwind **4.3.3**, Supabase JS **2.117.3**, Supabase SSR **0.7.0**, Zod **4.6.7**, Vitest **3.2.7**, Playwright **1.64.1**. The complete dependency graph is in package-lock.json.

Remaining limits: physical presence/bay clearance and real navigation are unverified; maps/routes are fictional. QR phone scanning requires a reachable app and Supabase origin; localhost QR URLs work only on that machine. The demo clock is shared among demo records and should be used in a dedicated environment. Scheduler cleanup can lag by roughly one minute plus execution time. No measured real-world impact or external hosting deployment is claimed.

Visual review: a focused authenticated rerun passed 2 additional desktop/phone journey cases with horizontal-overflow assertions. Captured and inspected artifacts/arrival-mobile.png and artifacts/zone-mobile.png (plus desktop variants). These screenshots use temporary fictional test bookings whose tokens are invalid after test cleanup.

Final database inspection confirmed migrations 001–006 recorded, parkahead-no-shows active every minute, demo_mode=false and grace_minutes=15 restored, the original one cancelled reservation preserved, and zero temporary E2E/journey test accounts remaining.
