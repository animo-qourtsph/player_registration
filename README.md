# Animo Pickleball Cup 2026 — Player Registration v29

## v29 — Gmail SMTP sender

Registration confirmation emails are now sent through Gmail SMTP using a Google App Password.

Sender:
`qourtsph@gmail.com`

### Registration flow
- Registration and both players are stored in Supabase.
- A separate email event is created for Player 1 and Player 2.
- Supabase Edge Function connects to Gmail SMTP using TLS on port 465.
- Player 1 and Player 2 each receive a confirmation email.
- Gmail Message-ID is stored in `email_events`.
- Already-sent email events are not re-sent by a duplicate submission retry.
- Email failure does not roll back the registration.
- Gmail App Password is never exposed to GitHub/browser code.

See `GMAIL_SMTP_SETUP.md`.
