# Animo Pickleball Cup 2026 — Player Registration v30

## v30 — Live registration tracker refresh

- Player lookup continues to read the authoritative Supabase registration.
- After a successful lookup, the tracker refreshes quietly every 15 seconds.
- After a new registration is submitted, the confirmation status also refreshes quietly.
- When Admin changes Pending → Approved → Confirmed, the Player portal reflects the new server status without requiring a full browser reload.
- Gmail SMTP registration confirmation behavior from v29 is retained.
