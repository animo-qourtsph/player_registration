import { withSupabase } from "jsr:@supabase/server@^1";
import nodemailer from "npm:nodemailer@^7";

const TOURNAMENT_SLUG = "animo-pickleball-cup-2026";
const BUCKET = "animo-registration-documents";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const ALLOWED_DUPR_TYPES = new Set(["image/jpeg", "image/png"]);
const ALLOWED_PAYMENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

type Json = Record<string, any>;

function clean(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value: unknown): string {
  return clean(value, 320).toLowerCase();
}

function normalizeMobile(value: unknown): string {
  let digits = clean(value, 40).replace(/\D/g, "");
  if (/^639\d{9}$/.test(digits)) digits = "0" + digits.slice(2);
  return digits;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validMobile(value: string): boolean {
  return /^09\d{9}$/.test(value);
}

function dbLevel(value: unknown): string | null {
  const raw = clean(value, 40);
  const map: Record<string, string> = {
    beginner: "beginner",
    lowIntermediate: "low_intermediate",
    low_intermediate: "low_intermediate",
    highIntermediate: "high_intermediate",
    high_intermediate: "high_intermediate",
    advanced: "advanced",
  };
  return map[raw] ?? null;
}

function frontLevel(value: unknown): string | null {
  const raw = clean(value, 40);
  const map: Record<string, string> = {
    beginner: "beginner",
    low_intermediate: "lowIntermediate",
    high_intermediate: "highIntermediate",
    advanced: "advanced",
  };
  return map[raw] ?? null;
}

function classifyRating(value: unknown): string | null {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0 || rating > 8) return null;
  if (rating >= 4) return "advanced";
  if (rating >= 3.5) return "high_intermediate";
  if (rating >= 3) return "low_intermediate";
  return "beginner";
}

function categoryFromGenders(a: unknown, b: unknown): string | null {
  const g1 = clean(a, 20);
  const g2 = clean(b, 20);
  if (g1 === "Male" && g2 === "Male") return "mens";
  if (g1 === "Female" && g2 === "Female") return "womens";
  if ((g1 === "Male" && g2 === "Female") || (g1 === "Female" && g2 === "Male")) return "mixed";
  return null;
}

function categoryLabel(value: string | null): string {
  return value === "mens" ? "Men's Doubles"
    : value === "womens" ? "Women's Doubles"
    : value === "mixed" ? "Mixed Doubles"
    : "Pending";
}

function frontDivisionId(code: unknown): string | null {
  const map: Record<string, string> = {
    "beginner-mens": "beginner-men",
    "beginner-womens": "beginner-women",
    "beginner-mixed": "beginner-mixed",
    "low-inter-mens": "low-inter-men",
    "low-inter-womens": "low-inter-women",
    "low-inter-mixed": "low-inter-mixed",
    "high-inter-mens": "high-inter-men",
    "high-inter-womens": "high-inter-women",
    "high-inter-mixed": "high-inter-mixed",
    "advanced-mens": "advanced-men",
    "advanced-mixed": "advanced-mixed",
  };
  return map[clean(code, 80)] ?? null;
}

function levelForPlayer(verification: Json): string | null {
  const hasDupr = clean(verification?.hasDupr, 10);
  if (hasDupr === "Yes") return classifyRating(verification?.duprRating);
  if (hasDupr === "No") return dbLevel(verification?.requestedLevel);
  return null;
}

function fileExtension(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "application/pdf") return "pdf";
  return "jpg";
}

function assertFile(file: FormDataEntryValue | null, allowed: Set<string>, label: string, required: boolean): File | null {
  if (!(file instanceof File) || file.size === 0) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (!allowed.has(file.type)) throw new Error(`${label} has an unsupported file type.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${label} exceeds the 8 MB limit.`);
  return file;
}

function requireText(value: unknown, label: string, max = 500): string {
  const result = clean(value, max);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function validatePlayer(player: Json, verification: Json, label: string) {
  requireText(player?.firstName, `${label} first name`, 120);
  requireText(player?.lastName, `${label} last name`, 120);

  const gender = requireText(player?.gender, `${label} gender`, 20);
  if (!["Male", "Female"].includes(gender)) throw new Error(`${label} gender must be Male or Female.`);

  const email = normalizeEmail(player?.email);
  const mobile = normalizeMobile(player?.mobile);
  if (!validEmail(email)) throw new Error(`${label} email address is invalid.`);
  if (!validMobile(mobile)) throw new Error(`${label} mobile number must use Philippine 09XX format.`);

  requireText(player?.birthDate, `${label} birth date`, 20);
  requireText(verification?.clubAffiliation, `${label} club affiliation`, 180);
  requireText(verification?.jerseyName, `${label} jersey name`, 22);

  const hasDupr = requireText(verification?.hasDupr, `${label} DUPR status`, 10);
  if (!["Yes", "No"].includes(hasDupr)) throw new Error(`${label} DUPR status is invalid.`);

  if (hasDupr === "Yes") {
    if (!classifyRating(verification?.duprRating)) throw new Error(`${label} DUPR rating is invalid.`);
  } else {
    if (!dbLevel(verification?.requestedLevel)) throw new Error(`${label} requested level is invalid.`);
    requireText(verification?.verificationReference, `${label} club DUPR / Facebook page link`, 500);
    requireText(verification?.playingBackground, `${label} playing background`, 3000);
  }
}

function randomCode(length = 5): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

async function safeRegistrationShape(admin: any, registrationId: string) {
  const { data: reg, error } = await admin
    .from("registrations")
    .select(`
      id, reference, status, level_key, category, submitted_at, payment_status, needs_manual_review, division_id,
      divisions ( code, name ),
      players (
        player_slot, first_name, last_name, display_name, gender,
        club_affiliation, jersey_name, has_dupr, dupr_rating,
        requested_level_key, organizer_assigned_level_key,
        dupr_proof_status, eligibility_status
      ),
      payments ( status, proof_path )
    `)
    .eq("id", registrationId)
    .maybeSingle();

  if (error || !reg) throw new Error("Registration could not be loaded.");

  const players = [...(reg.players ?? [])].sort((a: any, b: any) => a.player_slot - b.player_slot);
  const p1 = players.find((p: any) => p.player_slot === 1) ?? {};
  const p2 = players.find((p: any) => p.player_slot === 2) ?? {};
  const payment = Array.isArray(reg.payments) ? reg.payments[0] : reg.payments;

  const levelKey = frontLevel(reg.level_key);
  const divisionCode = reg.divisions?.code ?? null;
  const divisionId = frontDivisionId(divisionCode);

  const verificationShape = (p: any) => ({
    clubAffiliation: p.club_affiliation ?? "",
    jerseyName: p.jersey_name ?? "",
    hasDupr: p.has_dupr ? "Yes" : "No",
    duprRating: p.dupr_rating ?? "",
    requestedLevel: frontLevel(p.requested_level_key) ?? "",
    organizerAssignedLevel: frontLevel(p.organizer_assigned_level_key) ?? "",
    manualLevelApproved: !!p.organizer_assigned_level_key,
    duprProofStatus: p.dupr_proof_status ?? "",
  });

  return {
    reference: reg.reference,
    status: reg.status,
    registrationType: "pair",
    submittedAt: reg.submitted_at,
    player1: {
      firstName: p1.first_name ?? "",
      lastName: p1.last_name ?? "",
      displayName: p1.display_name ?? "",
      gender: p1.gender ?? "",
    },
    player2: {
      firstName: p2.first_name ?? "",
      lastName: p2.last_name ?? "",
      displayName: p2.display_name ?? "",
      gender: p2.gender ?? "",
    },
    verification1: verificationShape(p1),
    verification2: verificationShape(p2),
    eligibilitySnapshot: {
      levelKey,
      levelLabel: levelKey,
      manualReview: !!reg.needs_manual_review,
      partnerPending: false,
      classificationPending: false,
      levelMismatch: false,
      categoryPending: !reg.category,
      categoryKey: reg.category,
      categoryLabel: categoryLabel(reg.category),
    },
    divisions: divisionId ? [divisionId] : [],
    paymentHeld: reg.status === "Pending Level Validation" && reg.payment_status === "Not Submitted",
    payment: {
      fileName: payment?.proof_path ? "Payment proof submitted" : "",
    },
  };
}

async function findDuplicate(admin: any, player: Json) {
  const email = normalizeEmail(player?.email);
  const mobile = normalizeMobile(player?.mobile);
  const ids = new Set<string>();

  if (email) {
    const { data } = await admin.from("players").select("registration_id").eq("email", email);
    for (const row of data ?? []) ids.add(row.registration_id);
  }
  if (mobile) {
    const { data } = await admin.from("players").select("registration_id").eq("mobile", mobile);
    for (const row of data ?? []) ids.add(row.registration_id);
  }
  if (!ids.size) return null;

  const { data } = await admin
    .from("registrations")
    .select("id,reference,status")
    .in("id", [...ids])
    .not("status", "in", '("Cancelled","Rejected")')
    .limit(1);

  return data?.[0] ?? null;
}

async function uploadPrivate(admin: any, path: string, file: File) {
  const { error } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`File upload failed: ${error.message}`);
}


function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailEnv() {
  return {
    host: Deno.env.get("GMAIL_SMTP_HOST") || "smtp.gmail.com",
    port: Number(Deno.env.get("GMAIL_SMTP_PORT") || "465"),
    secure: (Deno.env.get("GMAIL_SMTP_SECURE") || "true").toLowerCase() !== "false",
    user: Deno.env.get("GMAIL_SMTP_USER") || "",
    appPassword: Deno.env.get("GMAIL_SMTP_APP_PASSWORD") || "",
    senderName: Deno.env.get("GMAIL_SENDER_NAME") || "Animo Pickleball Cup 2026",
    replyTo: Deno.env.get("GMAIL_REPLY_TO") || "",
    playerPortalUrl: Deno.env.get("ANIMO_PLAYER_PORTAL_URL") || "https://animo-qourtsph.github.io/player_registration/",
  };
}

function gmailSmtpConfigured(env: ReturnType<typeof emailEnv>) {
  return !!(env.host && env.port && env.user && env.appPassword);
}

function interpolateTemplate(text: unknown, vars: Record<string, string>): string {
  return String(text ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => vars[key] ?? "");
}

function registrationReceivedHtml(args: {
  playerName: string;
  reference: string;
  eventName: string;
  eventDate: string;
  venue: string;
  division: string;
  status: string;
  portalUrl: string;
}) {
  const lookupUrl = `${args.portalUrl.replace(/\/+$/, "")}/#lookup`;
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f7f5;font-family:Arial,Helvetica,sans-serif;color:#173229">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7f5;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce7e1;border-radius:20px;overflow:hidden">
        <tr>
          <td style="background:#073f2f;padding:24px 28px;color:#ffffff">
            <div style="font-size:12px;letter-spacing:1.5px;font-weight:700;color:#d9ef65">ANIMO PICKLEBALL CUP 2026</div>
            <div style="font-size:28px;line-height:1.15;font-family:Georgia,'Times New Roman',serif;margin-top:8px">Registration received.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6">Hi <strong>${escapeHtml(args.playerName)}</strong>,</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#496158">
              We received your team registration for <strong>${escapeHtml(args.eventName)}</strong>.
              Your entry is now in the organizer's verification workflow.
            </p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f9f7;border:1px solid #e1e9e5;border-radius:14px">
              <tr><td style="padding:18px 20px">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#70837b">Registration reference</div>
                <div style="font-size:25px;font-weight:800;color:#073f2f;margin-top:4px">${escapeHtml(args.reference)}</div>
                <div style="margin-top:14px;font-size:13px;line-height:1.8;color:#496158">
                  <strong>Status:</strong> ${escapeHtml(args.status)}<br>
                  <strong>Division:</strong> ${escapeHtml(args.division)}<br>
                  <strong>Event:</strong> ${escapeHtml(args.eventDate)} · ${escapeHtml(args.venue)}
                </div>
              </td></tr>
            </table>

            <p style="margin:20px 0 18px;font-size:14px;line-height:1.6;color:#496158">
              Keep your registration reference. Either registered player can use the reference with their own email address or mobile number to check the latest status.
            </p>

            <table role="presentation" cellspacing="0" cellpadding="0"><tr>
              <td style="border-radius:12px;background:#0b5a42">
                <a href="${escapeHtml(lookupUrl)}" style="display:inline-block;padding:14px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Check Registration Status</a>
              </td>
            </tr></table>

            <p style="margin:24px 0 0;font-size:12px;line-height:1.55;color:#7a8b84">
              This is an automated tournament registration message.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function createEmailEvent(admin: any, values: Record<string, any>) {
  const { error: upsertError } = await admin
    .from("email_events")
    .upsert(values, { onConflict: "idempotency_key", ignoreDuplicates: true });

  if (upsertError) throw new Error(`Email event could not be created: ${upsertError.message}`);

  const { data, error } = await admin
    .from("email_events")
    .select("id,status,provider_message_id")
    .eq("idempotency_key", values.idempotency_key)
    .maybeSingle();

  if (error) throw new Error(`Email event could not be read: ${error.message}`);
  return data;
}

async function markEmailEvent(admin: any, idempotencyKey: string, patch: Record<string, any>) {
  await admin.from("email_events").update(patch).eq("idempotency_key", idempotencyKey);
}


async function sendGmailSmtpEmail(args: {
  env: ReturnType<typeof emailEnv>;
  to: string;
  subject: string;
  html: string;
}) {
  const transport = nodemailer.createTransport({
    host: args.env.host,
    port: args.env.port,
    secure: args.env.secure,
    auth: {
      user: args.env.user,
      pass: args.env.appPassword,
    },
  });

  const info = await transport.sendMail({
    from: {
      name: args.env.senderName,
      address: args.env.user,
    },
    to: args.to,
    ...(args.env.replyTo ? { replyTo: args.env.replyTo } : {}),
    subject: args.subject,
    html: args.html,
  });

  return {
    id: info?.messageId || null,
    accepted: info?.accepted || [],
    rejected: info?.rejected || [],
    response: info?.response || null,
  };
}

async function sendRegistrationReceivedEmails(admin: any, args: {
  tournament: any;
  registration: any;
  division: any;
  playerRows: any[];
}) {
  const env = emailEnv();

  const { data: template } = await admin
    .from("email_notification_templates")
    .select("enabled,subject")
    .eq("tournament_id", args.tournament.id)
    .eq("template_key", "registration_received")
    .maybeSingle();

  const results: any[] = [];

  for (const player of args.playerRows) {
    const email = normalizeEmail(player.email);
    const name = [player.first_name, player.last_name].filter(Boolean).join(" ").trim() || `Player ${player.player_slot}`;
    const idempotencyKey = `registration_received/${args.registration.id}/player-${player.player_slot}`;

    const existingEvent = await createEmailEvent(admin, {
      tournament_id: args.tournament.id,
      registration_id: args.registration.id,
      player_id: player.id,
      template_key: "registration_received",
      recipient_name: name,
      recipient_email: email,
      trigger_source: "registration.submitted",
      status: "queued",
      idempotency_key: idempotencyKey,
      payload: {
        reference: args.registration.reference,
        player_slot: player.player_slot,
        event_name: args.tournament.name,
        division: args.division.name,
        status: "Pending Level Validation",
      },
    });

    if (existingEvent?.status === "sent" && existingEvent?.provider_message_id) {
      results.push({
        playerSlot: player.player_slot,
        email,
        status: "sent",
        providerMessageId: existingEvent.provider_message_id,
        reused: true,
      });
      continue;
    }

    if (existingEvent?.status === "sending") {
      results.push({
        playerSlot: player.player_slot,
        email,
        status: "sending",
        providerMessageId: existingEvent.provider_message_id || null,
        reused: true,
      });
      continue;
    }

    if (template?.enabled === false) {
      await markEmailEvent(admin, idempotencyKey, {
        status: "suppressed",
        error_message: "Registration Received template is disabled.",
      });
      results.push({ playerSlot: player.player_slot, email, status: "suppressed" });
      continue;
    }

    if (!gmailSmtpConfigured(env)) {
      const missing = [
        !env.user ? "GMAIL_SMTP_USER" : "",
        !env.appPassword ? "GMAIL_SMTP_APP_PASSWORD" : "",
      ].filter(Boolean).join(", ");

      await markEmailEvent(admin, idempotencyKey, {
        status: "failed",
        error_message: `Gmail SMTP is not configured. Missing: ${missing}`,
      });
      results.push({ playerSlot: player.player_slot, email, status: "failed", reason: "email_not_configured" });
      continue;
    }

    const variables: Record<string, string> = {
      registration_reference: args.registration.reference,
      event_name: args.tournament.name,
      event_date: args.tournament.event_date || "October 17, 2026",
      venue: args.tournament.venue || "Pampanga Pickleball Center",
      division: args.division.name,
      player_name: name,
      status: "Pending Level Validation",
    };

    const subject = interpolateTemplate(
      template?.subject || "We received your Animo registration — {{registration_reference}}",
      variables
    );

    try {
      await markEmailEvent(admin, idempotencyKey, { status: "sending", error_message: null });

      const sent = await sendGmailSmtpEmail({
        env,
        to: email,
        subject,
        html: registrationReceivedHtml({
          playerName: name,
          reference: args.registration.reference,
          eventName: args.tournament.name,
          eventDate: variables.event_date,
          venue: variables.venue,
          division: args.division.name,
          status: variables.status,
          portalUrl: env.playerPortalUrl,
        }),
      });

      await markEmailEvent(admin, idempotencyKey, {
        status: "sent",
        provider_message_id: sent?.id || null,
        sent_at: new Date().toISOString(),
        error_message: null,
      });

      results.push({
        playerSlot: player.player_slot,
        email,
        status: "sent",
        providerMessageId: sent?.id || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await markEmailEvent(admin, idempotencyKey, {
        status: "failed",
        error_message: message.slice(0, 1000),
      });
      results.push({ playerSlot: player.player_slot, email, status: "failed", reason: message });
    }
  }

  return {
    configured: gmailSmtpConfigured(env),
    attempted: results.length,
    sent: results.filter(r => r.status === "sent").length,
    failed: results.filter(r => r.status === "failed").length,
    suppressed: results.filter(r => r.status === "suppressed").length,
    recipients: results,
  };
}

async function handleSubmit(req: Request, admin: any) {
  const form = await req.formData();
  const payloadText = clean(form.get("payload"), 100000);
  if (!payloadText) throw new Error("Registration payload is missing.");

  let payload: Json;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error("Registration payload is invalid.");
  }

  const p1 = payload.player1 ?? {};
  const p2 = payload.player2 ?? {};
  const v1 = payload.verification1 ?? {};
  const v2 = payload.verification2 ?? {};
  const payment = payload.payment ?? {};
  const consents = payload.consents ?? {};

  validatePlayer(p1, v1, "Player 1");
  validatePlayer(p2, v2, "Player 2");

  if (!(consents.rules && consents.risk && consents.privacy && consents.accuracy)) {
    throw new Error("All required acknowledgements must be accepted.");
  }

  const clientSubmissionId = requireText(payload.clientSubmissionId, "Submission ID", 60);

  // Return the original registration on a browser retry rather than creating a duplicate.
  const { data: retry } = await admin
    .from("registrations")
    .select("id")
    .eq("client_submission_id", clientSubmissionId)
    .maybeSingle();

  if (retry?.id) {
    const record = await safeRegistrationShape(admin, retry.id);
    return Response.json({ ok: true, retry: true, record });
  }

  // Server-side duplicate prevention.
  const duplicate1 = await findDuplicate(admin, p1);
  if (duplicate1) throw new Error(`Player 1 already appears in registration ${duplicate1.reference}.`);
  const duplicate2 = await findDuplicate(admin, p2);
  if (duplicate2) throw new Error(`Player 2 already appears in registration ${duplicate2.reference}.`);

  if (normalizeEmail(p1.email) === normalizeEmail(p2.email)) {
    throw new Error("Player 1 and Player 2 must use different email addresses.");
  }
  if (normalizeMobile(p1.mobile) === normalizeMobile(p2.mobile)) {
    throw new Error("Player 1 and Player 2 must use different mobile numbers.");
  }

  const level1 = levelForPlayer(v1);
  const level2 = levelForPlayer(v2);
  if (!level1 || !level2) throw new Error("Both player levels must be resolved before submission.");
  if (level1 !== level2) throw new Error("Both partners must be in the same tournament level.");

  const category = categoryFromGenders(p1.gender, p2.gender);
  if (!category) throw new Error("The doubles category could not be determined.");

  const dupr1 = assertFile(form.get("dupr_player_1"), ALLOWED_DUPR_TYPES, "Player 1 DUPR screenshot", v1.hasDupr === "Yes");
  const dupr2 = assertFile(form.get("dupr_player_2"), ALLOWED_DUPR_TYPES, "Player 2 DUPR screenshot", v2.hasDupr === "Yes");
  const paymentFile = assertFile(form.get("payment_proof"), ALLOWED_PAYMENT_TYPES, "Payment proof", false);

  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id,name,event_date,venue,fee_per_player,is_active")
    .eq("slug", TOURNAMENT_SLUG)
    .maybeSingle();

  if (tournamentError || !tournament) throw new Error("Tournament configuration is unavailable.");
  if (!tournament.is_active) throw new Error("Registration is currently closed.");

  const { data: division, error: divisionError } = await admin
    .from("divisions")
    .select("id,code,name,team_capacity,is_enabled")
    .eq("tournament_id", tournament.id)
    .eq("level_key", level1)
    .eq("category", category)
    .eq("is_enabled", true)
    .maybeSingle();

  if (divisionError || !division) throw new Error("No enabled division matches this team.");

  const { count: occupied, error: countError } = await admin
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("division_id", division.id)
    .not("status", "in", '("Cancelled","Rejected")');

  if (countError) throw new Error("Division capacity could not be checked.");
  if ((occupied ?? 0) >= division.team_capacity) throw new Error("This division is already full.");

  const uploadRoot = `submissions/${clientSubmissionId}`;
  const uploadedPaths: string[] = [];
  let dupr1Path: string | null = null;
  let dupr2Path: string | null = null;
  let paymentPath: string | null = null;

  try {
    if (dupr1) {
      dupr1Path = `${uploadRoot}/player-1-dupr-${crypto.randomUUID()}.${fileExtension(dupr1)}`;
      await uploadPrivate(admin, dupr1Path, dupr1);
      uploadedPaths.push(dupr1Path);
    }
    if (dupr2) {
      dupr2Path = `${uploadRoot}/player-2-dupr-${crypto.randomUUID()}.${fileExtension(dupr2)}`;
      await uploadPrivate(admin, dupr2Path, dupr2);
      uploadedPaths.push(dupr2Path);
    }
    if (paymentFile) {
      paymentPath = `${uploadRoot}/payment-${crypto.randomUUID()}.${fileExtension(paymentFile)}`;
      await uploadPrivate(admin, paymentPath, paymentFile);
      uploadedPaths.push(paymentPath);
    }

    const status = "Pending Level Validation";
    const paymentStatus = paymentPath ? "Submitted" : "Not Submitted";
    const now = new Date().toISOString();
    const needsManualReview = true;

    let registration: any = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = `APC26-${randomCode(5)}`;
      const { data, error } = await admin
        .from("registrations")
        .insert({
          tournament_id: tournament.id,
          reference,
          registration_type: "pair",
          status,
          level_key: level1,
          category,
          division_id: division.id,
          needs_manual_review: needsManualReview,
          payment_status: paymentStatus,
          client_submission_id: clientSubmissionId,
          consent_accepted: true,
          consent_at: now,
          consent_payload: consents,
          waiver_version: clean(payload.waiverVersion, 80) || null,
          created_via: "player_portal",
          submitted_at: now,
        })
        .select("id,reference")
        .single();

      if (!error) {
        registration = data;
        break;
      }

      lastError = error;
      if (error.code !== "23505") break;
    }

    if (!registration) throw new Error(lastError?.message || "Registration could not be created.");

    const playerRows = [
      {
        registration_id: registration.id,
        player_slot: 1,
        first_name: clean(p1.firstName, 120),
        middle_name: clean(p1.middleName, 120) || null,
        last_name: clean(p1.lastName, 120),
        display_name: clean(p1.displayName, 120) || null,
        date_of_birth: clean(p1.birthDate, 20),
        gender: clean(p1.gender, 20),
        email: normalizeEmail(p1.email),
        mobile: normalizeMobile(p1.mobile),
        club_affiliation: clean(v1.clubAffiliation, 180),
        jersey_name: clean(v1.jerseyName, 22),
        has_dupr: v1.hasDupr === "Yes",
        dupr_rating: v1.hasDupr === "Yes" ? Number(v1.duprRating) : null,
        dupr_profile_url: clean(v1.duprId, 500) || null,
        dupr_proof_path: dupr1Path,
        dupr_proof_status: dupr1Path ? "Submitted" : "Not Submitted",
        requested_level_key: v1.hasDupr === "No" ? dbLevel(v1.requestedLevel) : null,
        club_reference_url: v1.hasDupr === "No" ? clean(v1.verificationReference, 500) : null,
        playing_history: v1.hasDupr === "No" ? clean(v1.playingBackground, 3000) : null,
        eligibility_status: "Under Review",
      },
      {
        registration_id: registration.id,
        player_slot: 2,
        first_name: clean(p2.firstName, 120),
        middle_name: clean(p2.middleName, 120) || null,
        last_name: clean(p2.lastName, 120),
        display_name: clean(p2.displayName, 120) || null,
        date_of_birth: clean(p2.birthDate, 20),
        gender: clean(p2.gender, 20),
        email: normalizeEmail(p2.email),
        mobile: normalizeMobile(p2.mobile),
        club_affiliation: clean(v2.clubAffiliation, 180),
        jersey_name: clean(v2.jerseyName, 22),
        has_dupr: v2.hasDupr === "Yes",
        dupr_rating: v2.hasDupr === "Yes" ? Number(v2.duprRating) : null,
        dupr_profile_url: clean(v2.duprId, 500) || null,
        dupr_proof_path: dupr2Path,
        dupr_proof_status: dupr2Path ? "Submitted" : "Not Submitted",
        requested_level_key: v2.hasDupr === "No" ? dbLevel(v2.requestedLevel) : null,
        club_reference_url: v2.hasDupr === "No" ? clean(v2.verificationReference, 500) : null,
        playing_history: v2.hasDupr === "No" ? clean(v2.playingBackground, 3000) : null,
        eligibility_status: "Under Review",
      },
    ];

    const { data: insertedPlayers, error: playersError } = await admin
      .from("players")
      .insert(playerRows)
      .select("id,player_slot,first_name,last_name,email");

    if (playersError || !insertedPlayers?.length) {
      await admin.from("registrations").delete().eq("id", registration.id);
      throw new Error(playersError?.message || "Player records could not be created.");
    }

    const feePerPlayer = Number(tournament.fee_per_player || 0);
    const { error: paymentError } = await admin.from("payments").insert({
      registration_id: registration.id,
      method: clean(payment.method, 80) || null,
      amount_due: feePerPlayer * 2,
      amount_submitted: payment.amountPaid === "" || payment.amountPaid == null ? null : Number(payment.amountPaid),
      proof_path: paymentPath,
      status: paymentStatus,
      submitted_at: paymentPath ? now : null,
      payment_reference: clean(payment.reference, 180) || null,
      sender_name: clean(payment.senderName, 180) || null,
      payment_date: clean(payment.paymentDate, 20) || null,
    });

    if (paymentError) {
      await admin.from("registrations").delete().eq("id", registration.id);
      throw new Error(paymentError.message);
    }

    await admin.from("registration_status_history").insert({
      registration_id: registration.id,
      old_status: null,
      new_status: status,
      reason: "Player portal submission",
    });

    await admin.from("audit_logs").insert({
      tournament_id: tournament.id,
      action: "registration.submitted",
      entity_type: "registration",
      entity_id: registration.id,
      details: {
        reference: registration.reference,
        division: division.name,
        source: "player_portal",
      },
    });

    const record = await safeRegistrationShape(admin, registration.id);

    // Registration success is preserved even if email delivery fails.
    const email = await sendRegistrationReceivedEmails(admin, {
      tournament,
      registration,
      division,
      playerRows: insertedPlayers,
    });

    return Response.json({ ok: true, record, email });
  } catch (error) {
    if (uploadedPaths.length) {
      try { await admin.storage.from(BUCKET).remove(uploadedPaths); } catch {}
    }
    throw error;
  }
}

async function handleLookup(body: Json, admin: any) {
  const reference = clean(body.reference, 40).toUpperCase();
  const identity = clean(body.identity, 320);
  const email = normalizeEmail(identity);
  const mobile = normalizeMobile(identity);

  if (!reference || !identity) {
    return Response.json({ ok: true, verified: false });
  }

  const { data: reg } = await admin
    .from("registrations")
    .select("id,reference")
    .eq("reference", reference)
    .maybeSingle();

  if (!reg) return Response.json({ ok: true, verified: false });

  const { data: players } = await admin
    .from("players")
    .select("email,mobile")
    .eq("registration_id", reg.id);

  const verified = (players ?? []).some((player: any) => {
    const emailMatch = validEmail(email) && normalizeEmail(player.email) === email;
    const mobileMatch = validMobile(mobile) && normalizeMobile(player.mobile) === mobile;
    return emailMatch || mobileMatch;
  });

  if (!verified) return Response.json({ ok: true, verified: false });

  const record = await safeRegistrationShape(admin, reg.id);
  return Response.json({ ok: true, verified: true, record });
}

export default {
  fetch: withSupabase({ auth: "publishable" }, async (req, ctx) => {
    try {
      if (req.method !== "POST") {
        return Response.json({ ok: false, error: "POST required." }, { status: 405 });
      }

      const contentType = req.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        return await handleSubmit(req, ctx.supabaseAdmin);
      }

      const body = await req.json().catch(() => ({}));

      if (body.action === "health") {
        const { data } = await ctx.supabaseAdmin
          .from("tournaments")
          .select("slug,is_active")
          .eq("slug", TOURNAMENT_SLUG)
          .maybeSingle();

        const env = emailEnv();
        return Response.json({
          ok: true,
          service: "registration-api",
          tournament: data?.slug ?? null,
          active: !!data?.is_active,
          emailConfigured: gmailSmtpConfigured(env),
          emailProvider: "gmail-smtp",
          emailSender: env.user || null,
          smtpPort: env.port,
        });
      }

      if (body.action === "lookup") {
        return await handleLookup(body, ctx.supabaseAdmin);
      }

      return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Registration service failed.";
      return Response.json({ ok: false, error: message }, { status: 400 });
    }
  }),
};
