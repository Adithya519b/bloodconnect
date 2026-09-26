import { buildInlineKeyboard, sendMessage } from "./telegramService.js";

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
 * Builds the 🎉 message the requester receives when a donor accepts (Step 11
 * will call this). Only the donor's Telegram @username is shared — never the
 * phone number or any other private data.
 */
export function buildDonorFoundMessage(request, donor) {
  const donorLine = donor.username ? `@${donor.username}` : "a registered donor";
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
 * Sends the 🎉 "DONOR FOUND" message to the requester (used from Step 11).
 * In a private chat, chatId === telegramId.
 */
export async function notifyRequester(request, donor) {
  await sendMessage(request.requesterId, buildDonorFoundMessage(request, donor));
}
