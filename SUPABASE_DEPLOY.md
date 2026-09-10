# Animo Supabase Player Backend — Deploy Guide

This package connects the Player Registration portal to the live Supabase project:

`https://miavgvlffiloxsardwxl.supabase.co`

The browser contains only the publishable key. The Edge Function uses Supabase's server-side secret environment to access the locked registration tables.

## A. Run the database migration

Open **Supabase → SQL Editor → New query**.

Paste and run:

`supabase/migrations/20260910_player_registration_backend.sql`

Expected result:

- Player display name — READY
- Registration consent payload — READY
- Payment metadata — READY
- Private registration tables — READY

## B. Deploy the Edge Function

Open **Supabase → Edge Functions**.

1. Click **Deploy a new function**.
2. Choose **Via Editor**.
3. Name the function exactly:

   `registration-api`

4. Replace the template code with:

   `supabase/functions/registration-api/index.ts`

5. For this public Player portal function, disable JWT verification / set `verify_jwt = false`.
   The function itself authenticates the browser's Supabase publishable key.
6. Click **Deploy function**.

The same setting is represented in `supabase/config.toml`.

## C. Test the Edge Function

In the Supabase function tester send a POST request with JSON:

```json
{"action":"health"}
```

The response should contain:

```json
{
  "ok": true,
  "service": "registration-api",
  "tournament": "animo-pickleball-cup-2026",
  "active": true
}
```

## D. Deploy Player v26

Upload the contents of this package to the Player Registration GitHub Pages repository.

Player v26 now sends new registrations to Supabase and uses Supabase for **Already Registered?** lookups.

## What changes after deployment

A registration submitted in Chrome can be looked up from:
- Chrome Incognito
- Edge
- Firefox
- another computer
- another phone

Either Player 1 or Player 2 can verify the registration using:

**Registration Reference + their own Email or Mobile**

## Private files

DUPR screenshots and payment proof are uploaded by the Edge Function into the existing private bucket:

`animo-registration-documents`

They are never exposed as public URLs.

## Important

Do not put a Supabase secret key or service-role key into the Player portal or GitHub repository.
