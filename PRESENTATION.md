# ParkAhead demonstration

1. Open `/parking`. Select a fictional mall, a future interval of at least one hour, and a destination. Show B1 and B2: both contain Zone A, with different full labels and IDs. Change malls to show distinct layouts.
2. Switch map/list view, inspect one standard bay and select it explicitly. Add nice-to-haves and must-haves. Show that unknown route measurements cannot satisfy a required step-free route. Software availability is reservation-based.
3. Filter OKU bays. Inspect the category symbol and restriction notice. A nonapproved customer can see the bay but cannot select it for booking. Standard alternatives remain available.
4. Sign in and open `/eligibility`, select the same mall and request review. Explain: “Demo eligibility review. This does not implement a real-world verification process.” No documents or sensitive identifiers are requested.
5. As an admin, open `/admin/eligibility`, approve the request, then refresh the customer's eligibility/parking view. Book the exact OKU bay with a plate. Approval at another mall would not apply. Step-free requirements still apply independently.
6. Open booking details, confirm the plate and full location, and show the numbered read-only floor map. Booking-time preference, location and approval snapshots are retained.
7. In local demo mode, use `/admin/demo` to create the current admin's fixtures. Open fixture A's manual arrival screen. Before its start, check-in is disabled. Advance five minutes, refresh, check in, then complete parking. No QR, gate simulator, camera or barrier control exists.
8. Reset the current admin's fixtures, advance past the arrival deadline and run cleanup for a quick demonstration. Show no-show release and the reusable bay. Separately, integration checks verify automatic pg_cron release without a browser.

Use the shared green ParkAhead wordmark, navigation and typography as visual continuity across booking, auth, admin and error screens. Layouts and routes are fictional; reservation status does not establish physical occupancy. The software is a prototype, and eligibility review does not claim real verification.
