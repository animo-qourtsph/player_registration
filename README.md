# Animo Pickleball Cup 2026 — Player Registration v32 Clean

## Navigation reliability
This build fixes the navigation issue by removing the obsolete embedded Admin/configuration code
that could read stale browser localStorage from older Player builds before navigation was bound.

### Changes
- Tournament Details navigation fixed.
- Register Now navigation fixed.
- Already Registered and Home navigation retained.
- Navigation is bound before landing-page rendering.
- Tournament Details safely scrolls only when its section exists.
- New JavaScript filenames (`tournament-config-v32.js`, `player-app-v32.js`) force browsers and
  GitHub Pages to fetch the current code instead of reusing cached v30/v31 scripts.
- Old Player-side Admin editor removed.
- Old local registration cache removed.
- Old client-side duplicate checker removed; Supabase is authoritative.
- Old fake/local email-trigger workflow removed; Gmail delivery is server-side.
- Old local Admin configuration loader removed.
- Live 15-second registration tracker refresh retained.
- Supabase submission and lookup retained.
- Gmail-backed registration notifications retained through the existing Edge Function.

The Player portal is now a Player-only application.
