# ParkAhead — short hackathon presentation

**1. Problem (about 20 seconds)**

“Our hypotheses are that visitors want more confidence before arriving, that an available zone may not suit their destination or walking needs, and that unused reservations can block scheduled availability. We have not validated these through user research yet.”

**2. User voice (10 seconds)**

“An illustrative statement, not an interview quote: ‘I want to know where I’m parking before I arrive, especially when I’m heading to a specific place.’” Show the clearly labelled statement on `/demo-story`. Use the saved wording if the admin has edited it; do not invent a participant.

**3. Successful journey (about 60 seconds)**

Choose Cinema and verified step-free route. Show available standard bays, the verified fictional route and explicit booking review. Confirm; point out the assigned bay and stored arrival deadline. Show the separate driving and walking guidance, then the QR/non-QR arrival link. Advance the server demo clock to start, refresh and explicitly simulate check-in. Show Parking in progress, then simulate departure and the completed state. “No physical presence or empty bay was verified.”

**4. No-show and late arrival (about 45 seconds)**

From a confirmed fixture show overlapping scheduled availability. Advance past its arrival deadline. Explain that PostgreSQL runs cleanup every minute even with no browser open; use Run cleanup only to avoid waiting during the pitch. Show the no-show event and capacity change. Create the explicit subsequent booking for the remaining interval. Open the old arrival URL: it is released and cannot be checked in. “A released reservation is not proof that a real bay is empty.”

**5. Demonstrated results (20 seconds)**

Refresh the actual event-based metrics on the story/dashboard. Read only the values currently displayed. Explain “Scheduled minutes released in simulation” as the remaining original interval at release, counted once. Do not quote a canned number, percentage, rebooking claim, time-saving or environmental benefit.

**6. Limits and next steps (20 seconds)**

“This demonstrates transactional software allocation, route-aware recommendations, authorized lifecycle changes and automated release. It does not prove physical availability, real search-time improvements, customer demand or commercial viability. Next: user testing, a mall-operator pilot, real occupancy/access integration and verification of actual route information.”

Before presenting: use a dedicated demo project, verify the cron job, enable database demo mode, sign in as an authorized admin and confirm RESET. Reset touches only your scenario fixtures; the shared demo clock still affects all demo records. No production data or default admin credentials are used.
