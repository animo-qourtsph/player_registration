window.TOURNAMENT_CONFIG = {
  // Keep the existing internal tournament ID so previously saved standalone records remain readable.
  tournamentId: "ALSPC-2026",
  schemaVersion: 102,
  name: "Animo Pickleball Cup 2026",
  organizer: "DLSAA Pampanga",
  eventDate: "2026-10-17",
  venue: "Pampanga Pickleball Center, Pampanga, Philippines",
  registrationOpening: "[REGISTRATION_OPENING]",
  registrationDeadline: "[REGISTRATION_DEADLINE]",
  finalPlayerConfirmation: "[FINAL_PLAYER_CONFIRMATION]",
  scheduleRelease: "[SCHEDULE_RELEASE]",
  eligibilitySummary: "Open to eligible pickleball players. DUPR players submit their rating with screenshot proof. Players without DUPR may request a level and must provide their club\'s DUPR or official Facebook page link plus recent playing history; the organizer validates the request before approval.",
  formatSummary: "Doubles tournament. One division per player. Pair partners must be classified in the same level. Gender combination determines Men\'s, Women\'s, or Mixed Doubles automatically. Double entry is not allowed.",
  numberOfCourts: "[NUMBER_OF_COURTS]",
  currency: "PHP",
  publicStats: {
    confirmedParticipantsOverride: null
  },
  registrationTypes: [
    { id: "pair", label: "Team / Partner Registration", description: "Register Player 1 and Player 2 together as one tournament entry.", enabled: true }
  ],
  multipleDivisionRules: {
    allowed: false,
    maxDivisionsPerPlayer: 1,
    incompatibleCombinations: [],
    note: "Players with DUPR enter their current rating and upload screenshot proof. Players without DUPR request a level and provide their club\'s DUPR or official Facebook page link plus recent playing history for organizer validation. Pair partners must be in the same level. Gender is limited to Male/Female and determines the category automatically. Double entry is not allowed."
  },

  duprEligibility: {
    enabled: true,
    requireRatingWhenProfile: true,
    manualVerificationAllowed: true,
    teamRule: "same_level_required",
    thresholds: {
      lowIntermediateMin: 3.00,
      highIntermediateMin: 3.50,
      advancedMin: 4.00
    },
    labels: {
      beginner: "Beginner",
      lowIntermediate: "Low Intermediate",
      highIntermediate: "High Intermediate",
      advanced: "Advanced"
    }
  },
  // Registration fee is PHP 1,800 per player. Team/pair total is calculated from participant count.
  divisions: [
    { id:"beginner-men", levelKey:"beginner", name:"Beginner — Men's Doubles", classification:"Beginner · Men's", description:"Men's Doubles · Beginner", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"beginner-women", levelKey:"beginner", name:"Beginner — Women's Doubles", classification:"Beginner · Women's", description:"Women's Doubles · Beginner", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"beginner-mixed", levelKey:"beginner", name:"Beginner — Mixed Doubles", classification:"Beginner · Mixed", description:"Mixed Doubles · Beginner", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"low-inter-men", levelKey:"lowIntermediate", name:"Low Intermediate — Men's Doubles", classification:"Low Intermediate · Men's", description:"Men's Doubles · Low Intermediate", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"low-inter-women", levelKey:"lowIntermediate", name:"Low Intermediate — Women's Doubles", classification:"Low Intermediate · Women's", description:"Women's Doubles · Low Intermediate", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"low-inter-mixed", levelKey:"lowIntermediate", name:"Low Intermediate — Mixed Doubles", classification:"Low Intermediate · Mixed", description:"Mixed Doubles · Low Intermediate", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"high-inter-men", levelKey:"highIntermediate", name:"High Intermediate — Men's Doubles", classification:"High Intermediate · Men's", description:"Men's Doubles · High Intermediate", capacity:16, maxParticipants:32, slotsRemaining:16, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"high-inter-women", levelKey:"highIntermediate", name:"High Intermediate — Women's Doubles", classification:"High Intermediate · Women's", description:"Women's Doubles · High Intermediate", capacity:8, maxParticipants:16, slotsRemaining:8, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"high-inter-mixed", levelKey:"highIntermediate", name:"High Intermediate — Mixed Doubles", classification:"High Intermediate · Mixed", description:"Mixed Doubles · High Intermediate", capacity:8, maxParticipants:16, slotsRemaining:8, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"advanced-men", levelKey:"advanced", name:"Advanced — Men's Doubles", classification:"Advanced · Men's", description:"Men's Doubles · Advanced", capacity:8, maxParticipants:16, slotsRemaining:8, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true },
    { id:"advanced-mixed", levelKey:"advanced", name:"Advanced — Mixed Doubles", classification:"Advanced · Mixed", description:"Mixed Doubles · Advanced", capacity:8, maxParticipants:16, slotsRemaining:8, fee:1800, eligibility:"DUPR-based level assignment; organizer validation applies.", enabled:true, waitlistEnabled:true }
  ],
  // Legacy school-affiliation fields are intentionally disabled. Club affiliation is collected per player in Verification.
  affiliationFields: {
    enabled: false,
    schoolCampus: false,
    batchYear: false,
    alumniStatus: false,
    organizationChapter: false,
    clubAffiliation: false
  },
  paymentMethods: [],
  waiver: {
    version: "[WAIVER_VERSION]",
    summary: "By submitting, participants acknowledge the organizer-approved tournament rules, eligibility requirements, sportsmanship standards, assumption of risk, data privacy terms, and other applicable consents.",
    fullText: "[FULL_WAIVER_AND_CONSENT_TEXT]"
  },
  faq: [
    { q:"Who may join?", a:"The Animo Pickleball Cup 2026 is open to eligible pickleball players, regardless of school affiliation, subject to the requirements of the selected division and organizer approval." },
    { q:"How is my division determined?", a:"If you have DUPR, enter your current rating and upload a screenshot showing your name and rating. The portal calculates a provisional level: below 3.00 Beginner, 3.00–3.49 Low Intermediate, 3.50–3.99 High Intermediate, and 4.00+ Advanced. If you do not have DUPR, select the level you are requesting and provide your club\'s DUPR or official Facebook page link plus recent playing history. Player 2 defaults to Player 1\'s current level when Player 2 has no DUPR. The organizer validates no-DUPR requests before approval and may reclassify or reject them. Both partners must remain in the same level. Gender is limited to Male or Female: Male/Male becomes Men\'s Doubles, Female/Female becomes Women\'s Doubles, and Male/Female becomes Mixed Doubles automatically." },
    { q:"Can I enter more than one division?", a:"No. Double entry is not allowed for this tournament. Each player may participate in one division only." },
    { q:"What is the registration fee?", a:"The registration fee is PHP 1,800 per player. For a two-player doubles pair, the registration total is PHP 3,600." },
    { q:"Why do you ask for Club Affiliation and DUPR?", a:"DUPR gives the tournament committee a rating reference, while the screenshot helps verify what the player entered. For players without DUPR, Club Affiliation, the club\'s DUPR or official Facebook page link, and recent playing history give the organizer a quick basis for validating the requested level." },
    { q:"What if I do not have a DUPR rating yet?", a:"You may still register. Select No when asked about DUPR, choose your requested playing level, provide your Club Affiliation, paste the club\'s DUPR or official Facebook page link, and add your playing background or recent tournament history. Your requested level remains subject to organizer validation. For Player 2, the form defaults to Player 1\'s current level so the pair starts in the same tier." },
    { q:"What name will be printed on the jersey?", a:"Enter the exact name you want printed on the back of your official tournament jersey. Review spelling and capitalization carefully before submitting." },
    { q:"Do I need a partner?", a:"A partner is required for a completed doubles entry. You may register both players at the same time or, when enabled, submit your entry and let your partner complete the remaining information later." },
    { q:"When is my registration considered confirmed?", a:"Submitting the form or uploading proof of payment does not automatically confirm an entry. Registration is confirmed only after required player information is complete, payment is verified when applicable, and the organizer approves the entry." },
    { q:"What happens if a division becomes full?", a:"Once a division reaches its team limit, normal registration closes for that division. If a waitlist is enabled, waitlisted entries remain subject to organizer validation and available slots." },
    { q:"When will the schedule be released?", a:"The official schedule will be released after registration closes and the final participant list has been validated. Court assignments and match times may still be adjusted for operational reasons." }
  ],
  contact: {
    name: "[ORGANIZER_CONTACT_NAME]",
    email: "[ORGANIZER_CONTACT_EMAIL]",
    mobile: "[ORGANIZER_CONTACT_MOBILE]",
    privacyUrl: "[PRIVACY_URL]"
  },
  brand: {
    eventLogo: "",
    organizerLogo: "",
    eventPoster: "assets/official-event-poster.png",
    sponsorLogos: []
  },
  heroCarousel: {
    autoplayMs: 6500,
    slides: [
      { eyebrow:"Official registration portal", headline:"ANIMO PICKLEBALL\nCUP 2026", body:"October 17 · Pampanga Pickleball Center · ₱1,800 / player", image:"", imageAlt:"", imagePosition:"center", contentPosition:"center", primaryCtaLabel:"Register Now", secondaryCtaLabel:"Tournament Details", showSecondaryCta:false },
      { eyebrow:"Fair level placement", headline:"KNOW YOUR LEVEL.\nPLAY FAIR.", body:"DUPR verified or organizer validated.", image:"", imageAlt:"", imagePosition:"center", contentPosition:"center", primaryCtaLabel:"Register Now", secondaryCtaLabel:"Tournament Details", showSecondaryCta:false },
      { eyebrow:"Official tournament jersey", headline:"YOUR NAME.\nYOUR JERSEY.", body:"Set your jersey-back name during registration.", image:"", imageAlt:"", imagePosition:"center", contentPosition:"center", primaryCtaLabel:"Register Now", secondaryCtaLabel:"Tournament Details", showSecondaryCta:false }
    ]
  }
};
