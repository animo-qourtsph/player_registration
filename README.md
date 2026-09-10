# Animo Pickleball Cup 2026 — Player Registration v21

## v21 — One registration method: Team / Partner

The obsolete **How are you registering?** screen has been removed.

There is now only one public registration method:

**Player 1 + Player 2 = one Team / Partner Registration**

### New registration flow

1. Player 1
2. Partner
3. Division
4. Payment
5. Consent
6. Review

Clicking **Register** now opens Player 1 immediately.

### Removed from the public flow
- Register with My Partner choice screen
- Invite My Partner
- Link Existing Registration
- Individual registration

The underlying registration record remains `registrationType: "pair"` for compatibility with the current Admin interface and upcoming Supabase integration.

### Partner requirement
Player 2 is now always required and receives the same full profile, DUPR/no-DUPR eligibility, personalized jersey, and contact-information workflow as Player 1.

### Email behavior
A submitted team registration triggers Registration Received notification events for both Player 1 and Player 2 when email addresses are available.

All current DUPR matching, automatic gender category, same-tier rule, personalized jersey, status lookup, and email-update interfaces remain intact.
