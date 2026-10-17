# Verification — ParkAhead OKU and floor identity update

Checked locally on 17–18 October 2026. The existing application was extended without resetting Supabase or rewriting applied migrations. Additive migrations **202610170023–202610170027** were applied transactionally and recorded in local migration history.

| Check                                 | Actual result                                                 |
| ------------------------------------- | ------------------------------------------------------------- |
| TypeScript                            | Passed                                                        |
| ESLint                                | Passed, no warnings                                           |
| Unit tests                            | 56 passed                                                     |
| Local Supabase/PostgreSQL integration | 44 passed, no skipped tests                                   |
| Production build                      | Passed, Next.js 15.5.28                                       |
| Desktop/mobile browser suite          | 30 passed, no skipped tests (desktop and mobile; 1.6 minutes) |

Integration checks cover exact-bay races, bay/plate exclusion, adjacency, retry idempotency, RLS, required preferences, changed routes, cross-mall IDs, geometry, cancellations, manual lifecycle, no-show audit/reuse and real pg_cron release without a browser or cleanup call. The scheduler test actually waited for a minute job to execute. New eligibility cases cover undeclared/pending/rejected/approved/expired decisions, another mall's approval, denial of self review/direct writes, private requests/audit events, decision and location snapshots, public inventory privacy, required unknown routes, independent floor availability, repeated zone names, full labels, distinct mall templates and the removed simulator RPC/configuration permissions.

Browser checks use separate temporary admin and standard-customer accounts, real local persistence and an isolated production server at canonical localhost:3001. They cover standard booking, blocked OKU booking, request/admin review/approved exact OKU booking, manual check-in/completion, repeated floor labels, map/list/keyboard selection, competing claims, preferences and no-show refresh. The older automatic-flow empty/conflict UI cases use explicit stubs; actual lifecycle and eligibility journeys use Supabase. Credentials remain in child-process environment variables.

An initial browser run found nondeterministic floor order: after switching malls the default could be B2. The malls API now orders embedded floors by sort_order. A subsequent run exposed a test-isolation issue: the new customer standard booking occupied a bay later used by the admin's reset fixture. The reset correctly refused to overwrite another customer's booking. The test now cancels its customer booking after verifying creation. The next run passed 29 of 30 and exposed a same-mall selector issue: choosing the current mall cleared its loaded eligibility without triggering a new request. The panel now preserves the current selection, ignores stale responses and hides a response from a different mall. Passing results below refer to the final corrected suite.

Both original NULL-plate reservations and stored historical arrival deadlines were retained. No simulator tables containing historical references were dropped. Old gate configuration is inactive and revoked; access/session records retain admin SELECT RLS and have no direct authenticated mutation grants. Shared manual lifecycle and maintenance remain trusted database functions. New manual departures have their own event name. The two scheduled jobs remain responsible for no-shows and session maintenance.

The gate route, navigation, UI, API wrappers and simulator RPC are removed. QR generation/display was already absent and remains absent; no token-based authorization was restored. Earlier migrations intentionally remain as migration history. Historical tables are documented in README.md.

The shared logo, inherited font, semantic theme tokens, focus states, status/map styling and mobile wrapping were checked in source. Desktop and mobile eligibility/map screenshots are saved under artifacts. No physical occupancy or real-world eligibility verification is claimed. Approval validity is checked at booking creation; expiry/rejection does not cancel an existing reservation. Layout/route data are fictional, and the prototype serializes booking transactions for correctness.

The restricted network initially prevented local DB tests; those results were rerun with local access and all passed. One restricted build could not create a generated output directory; the final build passed with workspace access. One automatic approval review timed out before a browser rerun started; its permitted retry started successfully. No external site was deployed.

Repeated seed validation ran in a rolled-back transaction: both passes retained 142 bays, including 12 OKU bays and eight operationally unavailable bays, with identical identity/category/maintenance hashes. Both minute scheduler jobs remained active. Floor ordering is explicit in the embedded malls API response.

Final browser run: all 30 tests passed on the corrected production build. Temporary admin/customer accounts and their eligibility/events/bookings were removed; runtime settings were restored. The owned test server stopped through Playwright. The original local development server was not stopped or replaced (a final availability check found port 3000 was not running).
