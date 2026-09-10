# Animo Pickleball Cup 2026 — Gmail SMTP + Google App Password

This version sends real registration emails from:

`qourtsph@gmail.com`

No custom domain and no Google OAuth client are required.

## Architecture

Player Registration → Supabase Edge Function → Gmail SMTP (TLS, port 465) → Player 1 / Player 2

The Gmail App Password exists only inside Supabase Edge Function Secrets.

## Step 1 — Enable 2-Step Verification

Sign in to the Google Account for:

`qourtsph@gmail.com`

Open Google Account → Security & sign-in.

Under **How you sign in to Google**, enable **2-Step Verification**.

Google requires 2-Step Verification before App Passwords can be created.

## Step 2 — Create an App Password

After 2-Step Verification is active, open the Google Account App Passwords page.

Create an app password with a label such as:

`Animo Supabase Email`

Google will show a 16-character app password once.

Copy it somewhere private.

Do NOT:
- paste it into ChatGPT
- put it in GitHub
- put it in player-app.js
- use your normal Gmail password

If App Passwords is unavailable, common causes include Advanced Protection, a security-key-only 2-Step setup, or an organization-managed account.

## Step 3 — Add Supabase Edge Function Secrets

Supabase → Edge Functions → Secrets

Add:

`GMAIL_SMTP_HOST`
= `smtp.gmail.com`

`GMAIL_SMTP_PORT`
= `465`

`GMAIL_SMTP_SECURE`
= `true`

`GMAIL_SMTP_USER`
= `qourtsph@gmail.com`

`GMAIL_SMTP_APP_PASSWORD`
= the 16-character Google App Password

`GMAIL_SENDER_NAME`
= `Animo Pickleball Cup 2026`

`GMAIL_REPLY_TO`
= `qourtsph@gmail.com`

`ANIMO_PLAYER_PORTAL_URL`
= `https://animo-qourtsph.github.io/player_registration/`

## Step 4 — Deploy registration-api v6 SMTP

Supabase → Edge Functions → registration-api → Code

Replace the existing `index.ts` with:

`animo-registration-api-edge-function-v6-gmail-smtp.ts`

Deploy the update.

Keep:

**Verify JWT with legacy secret = OFF**

## Step 5 — Health test

Run the existing PowerShell health check.

Expected additions:

`emailConfigured : True`
`emailProvider   : gmail-smtp`
`emailSender     : qourtsph@gmail.com`
`smtpPort        : 465`

## Step 6 — End-to-end test

Deploy Player v29.

Submit a brand-new team registration using two email addresses you can access.

Expected:

1. Registration is stored in Supabase.
2. Player 1 receives a confirmation from `qourtsph@gmail.com`.
3. Player 2 receives a confirmation from `qourtsph@gmail.com`.
4. The sends are visible in Gmail Sent.
5. Two `email_events` rows are created.
6. Gmail Message-IDs are stored in `provider_message_id`.
7. A failed email does not delete a valid registration.

## Security

Treat the App Password like a password.

If it is ever exposed, revoke it in your Google Account immediately and create a new one.

Google also revokes App Passwords when the main Google Account password is changed, so a new App Password may be required after a password change.
