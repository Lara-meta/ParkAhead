# Compact mall selector verification — 18 October 2026

This frontend update replaces the large mall cards in “01 · Choose your mall” with one searchable selector and a compact summary. Mall data still comes from `/api/malls`; no database migration, reservation API or allocation rule was changed.

`components/parking/mall-selector.tsx` owns only temporary search/open/highlight state. `ParkingExplorer` still owns `mallId` and routes selection through its existing `chooseMall` handler. Same-mall selections preserve form state. Valid URL restoration remains intact; missing/inactive restored malls require a new selection. Catalog errors now have a compact retry control, and empty catalogs remain distinct from empty searches.

The selector uses native HTML popover support without a new dependency. Its top layer avoids clipping by maps/cards. Positioning chooses above/below the trigger and responds to scrolling, resizing and visual-viewport changes. Search matches names only, ignoring case and edge whitespace, against the loaded active catalog. Search never changes selection or calls a search service. Selected rows have a check mark and aria-selected; arrows, Enter, Escape, search focus and trigger-focus return are implemented. Shared font, buttons, focus and color tokens are retained.

| Check                        | Actual result                                                               |
| ---------------------------- | --------------------------------------------------------------------------- |
| TypeScript                   | Passed                                                                      |
| ESLint                       | Passed, no warnings                                                         |
| Existing unit tests          | 56 passed                                                                   |
| Production build             | Passed, Next.js 15.5.28                                                     |
| Desktop/mobile browser suite | 38 verified: 36 passed in full run; 2 search cases passed on targeted rerun |

New browser cases use explicit API fixtures for loading/retry, empty catalogs, inactive restored malls, local name search, no matches/clear, selection, same-mall preservation, valid restored fields, keyboard/focus, long names and viewport bounds. Existing authenticated cases use local Supabase and now select malls through the new control; they exercise destination/preference/bay resets, map refresh, exact booking, OKU eligibility, cancellation, manual arrival and no-show release.

Database integration tests were not rerun for this frontend-only change. Browser checks use Chromium desktop and an emulated iPhone viewport, not a physical phone or live screen-reader session. Screenshots are saved under `artifacts` with CAPTURE_JOURNEY_VISUALS=1. The runner removes its temporary accounts/data and restores demo settings.

The initial full run had two search-test assertion failures because an unscoped option locator also counted native destination/category options. The test now scopes options to the Matching malls listbox; both affected desktop/mobile cases passed on rerun (17.4 seconds). No application fix was needed. The other 36 cases passed in the full run, including every real booking journey. No backend/schema change or external deployment was made.
