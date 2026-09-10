# Animo Pickleball Cup 2026 — Player Registration v31

## v31 — Navigation hotfix

The v30 live tracker update introduced references to `trackerRefreshTimer` and
`lastLookupCredentials` without declaring them. Because the script runs in strict
mode, clicking any navigation action that called `showView()` threw a
`ReferenceError`, making Tournament Details, Already Registered?, Register Now,
and Return to Tournament Page appear unresponsive.

v31:
- declares the tracker polling variables correctly;
- keeps the 15-second live status refresh;
- hardens `showView()` against missing optional elements;
- hardens global event binding so one missing control cannot disable navigation;
- preserves Supabase submission, cross-browser lookup, and Gmail email behavior.
