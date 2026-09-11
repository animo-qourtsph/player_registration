# Animo Player Registration — Production 1.0

API contract: 2026.09.11.1
Required database schema version: 2026.09.11.1

Production safeguards:
- Live Supabase tournament configuration and registration gate.
- Registration fails closed if dates/waiver are not configured.
- Pair-only registration.
- Required payment metadata + proof.
- Payment images and DUPR screenshots are compressed client-side before upload.
- Saved drafts expire after 24 hours and never persist file contents.
- Clear Saved Draft control is available.
- Status tracker polls only while visible, once per 60 seconds.
- Public lookup is scoped to one registration.
- No broad Realtime subscription and no full-table polling.
