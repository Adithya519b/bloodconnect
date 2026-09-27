import { buildInlineKeyboard, sendMessage } from "./telegramService.js";

/**
 * Donor-found messages are sent with parse_mode: "HTML" so the contact line
 * can be a real t.me deep link. Escape every dynamic value — user-controlled
 * strings (usernames, names) must never be able to inject markup.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The notification abstraction (Step 10, spec section 27).
 *
 * The matching engine (Step 9) calls notifyMatchedDonors() and never needs to
 * know HOW a donor is reached. Today the only channel is Telegram; a
 * WhatsAppNotificationService or SMSNotificationService can be added later
 * with zero changes to the matching engine — just another channel object.
 *
 * Message builders are exported separately so tests can verify the text
 * without sending anything.
 */

const HEALTH_DISCLAIMER = "⚠️ Prototype: eligibility and medical suitability must be verified by medical professionals.";

/**
 * Builds the 🚨 alert sent to a matched donor.
 * distanceKm is optional (e.g. live locations are excluded from matching,
 * so this only happens in edge cases).
 */
export function buildDonorAlertMessage(request, donor) {
  const distanceText = donor.distanceKm != null ? `\nApproximate Distance: ${donor.distanceKm} KM` : "";
  return (
    "🚨 EMERGENCY BLOOD REQUEST\n" +
    "\n" +
    `Blood Group: ${request.bloodGroup}\n` +
    `Units Required: ${request.unitsRequired}\n` +
    distanceText +
    "\n" +
    "\n" +
    "Please help if you are available.\n" +
    "\n" +
    HEALTH_DISCLAIMER
  );
}

/** The inline buttons on the donor alert. Codes follow the "<action>:<value>" style. */
export function buildDonorAlertKeyboard(requestId) {
  return buildInlineKeyboard([
    [
      { text: "🩸 I CAN DONATE", callbackData: `respond:yes:${requestId}` },
      { text: "❌ NOT AVAILABLE", callbackData: `respond:no:${requestId}` },
    ],
  ]);
}

/**
 * Builds the 🎉 message the requester receives when a donor accepts.
 *
 * Contact info, best-effort in order:
 * 1. @username            -> a t.me/<username> deep link: one tap opens the
 *                            donor's chat even though requesters cannot
 *                            search a donor by telegramId.
 * 2. Name only            -> a ⚠️ call to share the donor's phone number
 *                            (the donor gets that prompt in the same moment).
 *
 * Sent with parse_mode: "HTML" (see notifyRequester) — a plain-text fallback
 * builder (buildDonorFoundTextMessage) exists for the tests and for failure
 * paths where markup must be avoided.
 */
export function buildDonorFoundMessage(request, donor) {
  if (donor?.username) {
    const username = escapeHtml(donor.username);
    return (
      "🎉 DONOR FOUND!\n" +
      "\n" +
      `Blood Group: ${escapeHtml(request.bloodGroup)}\n` +
      `Required Units: ${request.unitsRequired}\n` +
      "\n" +
      `👤 Donor: <a href="https://t.me/${donor.username}">@${username}</a>\n` +
      "Tap the name to open their chat and coordinate directly.\n" +
      "\n" +
      `Request ID: ${request._id}\n` +
      "\n" +
      HEALTH_DISCLAIMER
    );
  }

  const nameLine = donor?.name ? escapeHtml(donor.name) : "a registered donor";
  return (
    "🎉 DONOR FOUND!\n" +
    "\n" +
    `Blood Group: ${escapeHtml(request.bloodGroup)}\n` +
    `Required Units: ${request.unitsRequired}\n` +
    "\n" +
    `👤 Donor: ${nameLine}\n` +
    "⚠️ The donor has no Telegram username.\n" +
    "They have been asked to share their phone number — you will get it here\n" +
    "in a moment.\n" +
    "\n" +
    `Request ID: ${request._id}\n` +
    "\n" +
    HEALTH_DISCLAIMER
  );
}

/** Plain-text variant of the donor-found message (no HTML, no deep link). */
export function buildDonorFoundTextMessage(request, donor) {
  const donorLine = donor?.username ? `@${donor.username}` : donor?.name || "a registered donor";
  return (
    "🎉 DONOR FOUND!\n" +
    "\n" +
    `Blood Group: ${request.bloodGroup}\n` +
    `Required Units: ${request.unitsRequired}\n` +
    "\n" +
    `A donor (${donorLine}) has accepted your request.\n` +
    "Please contact the donor through Telegram and coordinate safely.\n" +
    "\n" +
    `Request ID: ${request._id}\n` +
    "\n" +
    HEALTH_DISCLAIMER
  );
}

/**
 * Shown to the DONOR right after they accept when they have no @username.
 * Without it the requester would have no way to reach them at all.
 */
export function buildShareContactRequestMessage() {
  return (
    "📱 One more step — please share a contact number.\n" +
    "\n" +
    "You do not have a public Telegram username, so the requester cannot\n" +
    "open a chat with you by themselves.\n" +
    "\n" +
    "Tap the button below to send your phone number. It goes ONLY to the\n" +
    "requester of this request.\n"
  );
}

/**
 * The 📞 message the requester receives after the donor shares their phone
 * number. Telegram deep links also work for plain numbers: the requester can
 * open the donor's chat even without a username.
 */
export function buildDonorPhoneMessage(request, donor, phone) {
  const nameLine = donor?.name ? escapeHtml(donor.name) : "The donor";
  return (
    "📞 DONOR CONTACT INFO\n" +
    "\n" +
    `Blood Group: ${escapeHtml(request.bloodGroup)}\n` +
    `Required Units: ${request.unitsRequired}\n` +
    "\n" +
    `${nameLine} shared a contact number for your request:\n` +
    `<a href="tel:${phone}">${escapeHtml(phone)}</a>\n` +
    "\n" +
    "Please coordinate safely and verify eligibility.\n" +
    "\n" +
    HEALTH_DISCLAIMER
  );
}

/**
 * Sends one donor alert. Returns { ok, blocked }:
 * - ok:        Telegram accepted the message
 * - blocked:   the donor blocked the bot (Telegram error 403) — they should
 *              not stay on the matched list, but this is NOT a failure of the
 *              request itself
 */
export async function notifyDonor(donor, request) {
  try {
    await sendMessage(donor.chatId, buildDonorAlertMessage(request, donor), {
      reply_markup: buildDonorAlertKeyboard(request._id),
    });
    return { ok: true, blocked: false };
  } catch (error) {
    const blocked = /403|blocked/i.test(error.message);
    console.error(
      `[notify] Could not alert donor ${donor.telegramId}: ${error.message}`
    );
    return { ok: false, blocked };
  }
}

/**
 * Alerts every matched donor, one by one, and reports the outcome.
 * Per-donor failures never abort the loop — one blocked bot user must not
 * silence the alert for everyone else.
 *
 * Returns the tally the bot shows to the requester.
 */
export async function notifyMatchedDonors(request, donors) {
  let notified = 0;
  let failed = 0;

  for (const donor of donors) {
    const result = await notifyDonor(donor, request);
    if (result.ok) {
      notified += 1;
    } else {
      failed += 1;
    }
  }

  return { notified, failed, total: donors.length };
}

/**
 * Sends the 🎉 "DONOR FOUND" message to the requester (Step 11).
 * In a private chat, chatId === telegramId. HTML mode powers the t.me link.
 */
export async function notifyRequester(request, donor) {
  await sendMessage(request.requesterId, buildDonorFoundMessage(request, donor), {
    parse_mode: "HTML",
  });
}

/**
 * Forwards the donor's shared phone number to the requester as a clean
 * 📞 contact card. HTML mode powers the tel: link.
 */
export async function notifyRequesterWithPhone(request, donor, phone) {
  await sendMessage(request.requesterId, buildDonorPhoneMessage(request, donor, phone), {
    parse_mode: "HTML",
  });
}
