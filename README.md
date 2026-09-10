# Animo Pickleball Cup 2026 — Player Registration v14

GitHub-ready static build of the public player registration portal.

## v14 registration logic

- Gender is limited to **Male** and **Female** only.
- Gender automatically determines doubles category:
  - Male + Male → Men's Doubles
  - Female + Female → Women's Doubles
  - Male + Female → Mixed Doubles
- DUPR players enter their current numeric rating and upload screenshot proof.
- No-DUPR players may request a playing level, subject to organizer validation.
- If **Player 2 selects No DUPR**, the system preselects Player 1's current tournament level by default.
- A note below Player 2's level explains that both partners must remain in the same tournament tier.
- No-DUPR players must provide Club Affiliation, a **Club DUPR or official Facebook Page Link**, and Playing Background & Recent Tournament History.
- The club reference field only accepts valid DUPR/Facebook URLs.
- Both partners must remain in the same tournament level. A mismatch blocks placement.
- Exact division is assigned automatically from level + gender combination.
- Double entry remains disabled.
- Registration fee remains PHP 1,800 per player.

## Files

- `index.html` — public portal
- `styles.css` — portal styles
- `player-app.js` — registration logic and UI
- `tournament-config.js` — tournament configuration
- `assets/official-event-poster.png` — event poster
- `QA.md` — build checks

## Deployment note

This remains a static preview using browser `localStorage`. Connect Player and Admin to the same production backend before live registration.


## v14 UX improvement
The Division step now shows a concise two-player summary with:
- Player name
- Gender
- Club
- DUPR / no-DUPR basis
- Current tournament level
- Verification status
- Level-match result
- Gender-to-category result

This makes the automatic division assignment transparent before the player continues to payment.


## v14 review UX
The final Review step was redesigned into a clearer pre-submission dashboard:
- Ready-to-submit / ready-for-organizer-review status banner
- At-a-glance registration, level, category, and fee summary
- Side-by-side Player 1 / Player 2 cards with Edit actions
- Transparent level and gender-to-category placement logic
- Cleaner Payment and Consent summary cards
- Final organizer-validation notice before submission
- Final CTA changes to “Submit for Review” when organizer validation is still required
