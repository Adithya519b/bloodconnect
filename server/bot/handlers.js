import {
  MAIN_MENU_LABELS,
  BLOOD_GROUP_BUTTONS,
  AVAILABILITY_BUTTONS,
  AVAILABILITY_CALLBACKS,
  REQUEST_CALLBACKS,
  RADIUS_BUTTONS,
  isValidBloodGroup,
  availabilityFromLabel,
  AVAILABILITY_LABELS,
  radiusFromLabel,
  parseUnits,
} from "./commands.js";
import {
  buildReplyKeyboard,
  buildInlineKeyboard,
  buildContactRequestKeyboard,
  buildLocationRequestKeyboard,
  buildRemoveKeyboard,
  answerCallbackQuery,
  editMessageText,
  sendMessage,
} from "../services/telegramService.js";
import {
  isDatabaseReady,
  getDonorByTelegramId,
  setDonorAvailability,
  upsertDonor,
} from "../services/donorService.js";
import { BloodRequest } from "../models/BloodRequest.js";
import {
  acceptRequest,
  countActiveRequestsForRequester,
  createBloodRequest,
  deleteRequest,
  getActiveRequestForRequester,
  getRecentRequestsForRequester,
  getRequestById,
  MAX_ACTIVE_REQUESTS,
  recordDonorRejection,
} from "../services/requestService.js";
import { matchDonorsForRequest } from "../services/matchingService.js";
import {
  buildDonorFoundTextMessage,
  buildShareContactRequestMessage,
  notifyMatchedDonors,
  notifyRequester,
  notifyRequesterWithPhone,
} from "../services/notificationService.js";

const HEALTH_DISCLAIMER =
  "⚠️ Prototype: BloodConnect does not verify donor eligibility. Blood group, availability and medical suitability must be verified by qualified medical professionals or blood banks. In a real emergency, contact a hospital, blood bank or emergency service first.";

const WELCOME_MESSAGE = [
  "🩸 Welcome to BloodConnect!",
  "",
  "Emergency blood donor connection system.",
  "",
  "Choose an option:",
  "🩸 Register as Donor",
  "🚨 Emergency Blood Request",
  "❓ Help",
].join("\n");

const HELP_MESSAGE = [
  "❓ BloodConnect Help",
  "",
  "This bot connects people who need blood urgently with nearby registered blood donors.",
  "",
  "How to use:",
  "1. Tap 🩸 Register as Donor to save your name, blood group and availability.",
  "2. Manage your availability any time with /profile.",
  "3. Tap 🚨 Emergency Blood Request to search for donors around you.",
  "",
  "Commands:",
  "/start - show the main menu",
  "/help - show this help message",
  "/register - register as a blood donor",
  "/request - send an emergency blood request",
  "/profile - view your donor profile",
  "/status - check your blood requests",
  "/cancel - cancel the current operation",
  "",
  HEALTH_DISCLAIMER,
].join("\n");

// ---------------------------------------------------------------------------
// Emergency blood request wizard (Step 7)
// Flow: blood group -> units -> location -> radius -> confirmation
// The request is NOT saved here — Step 8 adds the BloodRequest model.
// ---------------------------------------------------------------------------

/**
 * Starts the emergency request wizard. Any running session is replaced —
 * starting a new flow always wins over finishing a half-typed old one.
 */
export async function startRequestWizard(telegramId, chatId) {
  const session = getSession(telegramId);
  session.step = "request:blood_group";
  session.data = { bloodGroup: null, units: null, location: null, radiusKm: null };

  await sendMessage(
    chatId,
    [
      "🚨 Emergency Blood Request",
      "",
      "We will look for available donors near the patient.",
      "Type /cancel at any time to stop.",
      "",
      "Step 1 of 4 — Which blood group is required?",
    ].join("\n"),
    { reply_markup: buildReplyKeyboard(BLOOD_GROUP_BUTTONS) }
  );
}

/** Asks how many units are needed. */
async function askUnits(chatId) {
  await sendMessage(
    chatId,
    [
      "Step 2 of 4 — How many units are required?",
      "",
      "Type a whole number between 1 and 10.",
    ].join("\n"),
    { reply_markup: buildRemoveKeyboard() }
  );
}

/** Asks WHERE the blood is needed, with Telegram's native location button. */
async function askRequestLocation(chatId) {
  await sendMessage(
    chatId,
    [
      "Step 3 of 4 — 📍 Share the location where blood is required.",
      "",
      "Use the hospital / patient location, not your home address.",
    ].join("\n"),
    { reply_markup: buildLocationRequestKeyboard() }
  );
}

/** Asks how far away a donor may be. */
async function askRadius(chatId) {
  await sendMessage(
    chatId,
    "Step 4 of 4 — How far may a donor be from this location?",
    { reply_markup: buildReplyKeyboard(RADIUS_BUTTONS) }
  );
}

/** Builds the 🚨 confirmation text shown before anything is submitted. */
function buildRequestConfirmation(data) {
  return [
    "🚨 Confirm Blood Request",
    "",
    `Blood Group: ${data.bloodGroup}`,
    `Units: ${data.units}`,
    `Radius: ${data.radiusKm} KM`,
    `Location: ✅ received (${data.location.latitude.toFixed(4)}, ${data.location.longitude.toFixed(4)})`,
    "",
    HEALTH_DISCLAIMER,
  ].join("\n");
}

/** Ends the request wizard with a clear "nothing was sent" confirmation. */
async function cancelRequestWizard(telegramId, chatId) {
  await sendWithMenu(
    chatId,
    [
      "❌ Emergency request cancelled. Nothing was sent to any donor.",
      "",
      "Send /request to start again when you are ready.",
    ].join("\n")
  );
}

/**
 * Moves the request wizard forward. Returns true when the message was
 * consumed by this flow (mirrors handleRegistrationStep).
 */
async function handleRequestStep(telegramId, chatId, text) {
  const session = getSession(telegramId);

  switch (session.step) {
    case "request:blood_group": {
      if (!isValidBloodGroup(text)) {
        await sendMessage(chatId, "⚠️ Please pick a blood group using the buttons below.", {
          reply_markup: buildReplyKeyboard(BLOOD_GROUP_BUTTONS),
        });
        return true;
      }
      session.data.bloodGroup = text;
      session.step = "request:units";
      await askUnits(chatId);
      return true;
    }

    case "request:units": {
      const units = parseUnits(text);
      if (units === null) {
        await sendMessage(chatId, "⚠️ Please type a whole number between 1 and 10 (e.g. 2).");
        return true;
      }
      session.data.units = units;
      session.step = "request:location";
      await askRequestLocation(chatId);
      return true;
    }

    case "request:radius": {
      const radiusKm = radiusFromLabel(text);
      if (radiusKm === null) {
        await sendMessage(chatId, "⚠️ Please choose a radius using the buttons below.", {
          reply_markup: buildReplyKeyboard(RADIUS_BUTTONS),
        });
        return true;
      }
      session.data.radiusKm = radiusKm;
      session.step = "request:confirm";
      await sendMessage(chatId, buildRequestConfirmation(session.data), {
        reply_markup: buildInlineKeyboard([
          [
            { text: "✅ Submit Request", callbackData: REQUEST_CALLBACKS.CONFIRM },
            { text: "❌ Cancel", callbackData: REQUEST_CALLBACKS.CANCEL },
          ],
        ]),
      });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Handles the ✅ Submit / ❌ Cancel buttons on the confirmation card.
 * A confirmed request is stored in MongoDB (Atlas) as an OPEN BloodRequest;
 * matching and donor notification arrive in Steps 9-10.
 */
export async function handleRequestConfirmation(callbackData, telegramId, chatId) {
  const session = getSession(telegramId);

  if (callbackData === REQUEST_CALLBACKS.CANCEL) {
    clearSession(telegramId);
    await cancelRequestWizard(telegramId, chatId);
    return;
  }

  // callbackData === REQUEST_CALLBACKS.CONFIRM
  if (session.step !== "request:confirm") {
    await sendWithMenu(
      chatId,
      "⚠️ This request card is no longer active. Send /request to create a fresh one."
    );
    return;
  }

  // Keep the session alive on DB-down so the user can simply re-tap Submit.
  if (!isDatabaseReady()) {
    await sendWithMenu(
      chatId,
      [
        "💾 The database is not connected, so the request was not saved.",
        "",
        "Check the server logs / MongoDB connection, then tap ✅ Submit again.",
      ].join("\n")
    );
    return;
  }

  const wizardData = { ...session.data };
  clearSession(telegramId);

  try {
    const { request, created, existingActive } = await createBloodRequest({
      requesterId: telegramId,
      bloodGroup: wizardData.bloodGroup,
      unitsRequired: wizardData.units,
      location: wizardData.location,
      radiusKm: wizardData.radiusKm,
    });

    if (!created) {
      // Cap reached — the user manages their open requests via /status.
      await sendWithMenu(
        chatId,
        [
          `⚠️ You already have ${existingActive} active blood request(s).`,
          "",
          `For this prototype you can keep up to ${MAX_ACTIVE_REQUESTS} active at once.`,
          "",
          "Open /status and use the ❌ Cancel button to remove one,",
          "then send /request again.",
        ].join("\n")
      );
      return;
    }

    // Matching runs immediately (Step 9); notifications come in Step 10.
    // A matching failure must not undo the saved request — the user keeps the
    // Request ID and matching can be retried later.
    let matchedDonors = [];
    let notifyTally = null;
    let matchFailed = false;
    try {
      const { donors } = await matchDonorsForRequest(request);
      matchedDonors = donors;

      // Step 10: alert every matched donor through the notification service.
      // One blocked bot user never silences the alert for the others.
      if (donors.length > 0) {
        notifyTally = await notifyMatchedDonors(request, donors);
      }
    } catch (error) {
      console.error(`[bot] Matching failed for request ${request._id}: ${error.message}`);
      matchFailed = true;
    }

    const resultLines = [
      "🚨 EMERGENCY REQUEST CREATED",
      "",
      `Request ID: ${request._id}`,
      `Blood Group: ${request.bloodGroup}`,
      `Units: ${request.unitsRequired}`,
      `Radius: ${request.radiusKm} KM`,
      "",
    ];

    if (notifyTally && notifyTally.notified > 0) {
      resultLines.push(
        `📨 ${notifyTally.notified} donor(s) notified.`,
        "",
        "You will receive a message here the moment a donor accepts.",
        "Check progress with /status."
      );
    } else if (matchedDonors.length > 0) {
      resultLines.push(
        `🔎 ${matchedDonors.length} donor(s) matched, but none could be messaged right now.`,
        "They may have blocked the bot — try again later."
      );
    } else {
      resultLines.push(
        "❌ No matching donors found right now.",
        "",
        "Try:",
        "• Increasing the search radius (send /request again)",
        "• Contacting a nearby blood bank / emergency service"
      );
    }

    if (matchFailed) {
      resultLines.push("", "⚠️ The donor search had a problem — it can be retried later.");
    }

    resultLines.push("", HEALTH_DISCLAIMER);

    await sendWithMenu(chatId, resultLines.join("\n"));
  } catch (error) {
    console.error(`[bot] Could not save request for ${telegramId}: ${error.message}`);
    await sendWithMenu(
      chatId,
      "❌ Something went wrong while saving your request. Please try /request again in a moment."
    );
  }
}

// ---------------------------------------------------------------------------
// Donor response handling (Step 11)
// callbackData format: "respond:<yes|no>:<requestId>"
// ---------------------------------------------------------------------------

/** Confirmation shown to the donor who won the request. */
function buildDonorAcceptedMessage(request) {
  return [
    "🩸 Thank you for accepting!",
    "",
    `Blood Group: ${request.bloodGroup}`,
    `Units Required: ${request.unitsRequired}`,
    "",
    "The requester has been notified and will contact you through Telegram.",
    "",
    HEALTH_DISCLAIMER,
  ].join("\n");
}

/**
 * Handles 🩸 I CAN DONATE / ❌ NOT AVAILABLE taps.
 * The decision is made by the atomic acceptRequest() in the service layer —
 * the button state is never trusted.
 */
export async function handleDonorResponse(callbackData, donorId, chatId) {
  const [, decision, requestId] = callbackData.split(":");

  try {
    const request = await getRequestById(requestId);

    if (!request) {
      await sendMessage(chatId, "⚠️ This request no longer exists.");
      return;
    }

    if (request.requesterId === donorId) {
      await sendMessage(chatId, "⚠️ You cannot accept your own blood request.");
      return;
    }

    if (decision === "no") {
      await recordDonorRejection(requestId, donorId);
      await sendMessage(
        chatId,
        "👍 No problem — you will not be contacted for this request."
      );
      return;
    }

    // decision === "yes": try to claim the request atomically.
    const claimed = await acceptRequest(requestId, donorId);

    if (!claimed) {
      // Re-fetch to tell the donor exactly why the claim failed.
      const current = await getRequestById(requestId);
      if (current && current.acceptedDonor !== null) {
        await sendMessage(
          chatId,
          "⚠️ This request has already been accepted by another donor."
        );
      } else {
        await sendMessage(
          chatId,
          "⚠️ This request is no longer active (cancelled or removed)."
        );
      }
      return;
    }

    // This donor won the claim — confirm to them...
    await sendMessage(chatId, buildDonorAcceptedMessage(claimed));

    // ...and notify the requester with REAL contact info (Step 16):
    // 1. The donor has a @username -> the requester gets a t.me link and can
    //    reach them immediately. Done.
    // 2. No username -> the requester only learns that a donor accepted;
    //    the donor is asked in-chat to share their phone number, and the
    //    requester receives it the moment it arrives (handleDonorContact).
    try {
      const donor = await getDonorByTelegramId(donorId);
      const shapedDonor = donor || { username: null, name: null };

      await notifyRequester(claimed, shapedDonor);

      if (!shapedDonor.username) {
        donorContactSessions.set(donorId, {
          requestId: claimed._id.toString(),
          requesterId: claimed.requesterId,
        });
        await sendMessage(chatId, buildShareContactRequestMessage(), {
          reply_markup: buildContactRequestKeyboard(),
        });
      }
    } catch (error) {
      // The claim already succeeded; a failed requester message must not
      // roll it back — log it so it can be retried manually.
      console.error(
        `[bot] Requester ${claimed.requesterId} could not be notified: ${error.message}`
      );
    }
  } catch (error) {
    console.error(`[bot] Donor response failed for ${donorId}: ${error.message}`);
    await sendMessage(
      chatId,
      "❌ Something went wrong while recording your response. Please try again."
    );
  }
}

/**
 * Handles the donor's 📱 phone-number share (message.contact) sent after
 * accepting a request without a username. The number is forwarded to the
 * requester as a 📞 contact message; the donor gets a confirmation.
 *
 * Safety notes:
 * - contact.user_id is checked against the sender — Telegram guarantees the
 *   share came from the account itself, but the check costs nothing and
 *   makes the intent explicit.
 * - The pending-session Map makes the share refuse to attach itself to a
 *   request that already moved on (donor swapped, request deleted...).
 * - Only the phone number is forwarded — never the contact's name, user_id
 *   or any other payload Telegram includes.
 */
export async function handleDonorContact(telegramId, chatId, contact) {
  const pending = donorContactSessions.get(telegramId);

  if (!pending) {
    await sendWithMenu(
      chatId,
      [
        "📱 Thanks! Right now a phone number is only needed after you accept",
        "a blood request from a donor who has no Telegram username.",
      ].join("\n")
    );
    return;
  }

  const phone = contact?.phone_number;
  if (!phone || contact.user_id !== telegramId) {
    await sendMessage(
      chatId,
      "⚠️ Please share your OWN contact with the 📱 button, or type /cancel.",
      { reply_markup: buildContactRequestKeyboard() }
    );
    return;
  }

  donorContactSessions.delete(telegramId);

  const request = await getRequestById(pending.requestId);

  // The request may have been deleted/changed since the acceptance.
  if (!request || request.acceptedDonor !== telegramId) {
    await sendWithMenu(
      chatId,
      "⚠️ The request you accepted is no longer active — the number was NOT shared with anyone."
    );
    return;
  }

  const donor = await getDonorByTelegramId(telegramId);

  try {
    await notifyRequesterWithPhone(request, donor || { name: null }, phone);
  } catch (error) {
    console.error(
      `[bot] Contact info for request ${pending.requestId} could not be delivered: ${error.message}`
    );
    await sendMessage(
      chatId,
      "❌ The number could not be delivered just now. Please tap the 📱 button again."
    );
    donorContactSessions.set(telegramId, pending); // let them retry
    return;
  }

  await sendWithMenu(
    chatId,
    [
      "✅ Done — your contact number was sent to the requester.",
      "",
      "They will call or message you to coordinate the donation.",
      "",
      HEALTH_DISCLAIMER,
    ].join("\n")
  );
}

const NOT_UNDERSTOOD_MESSAGE = [
  "🤖 I did not understand that message.",
  "",
  "Use the buttons below, or type one of these commands:",
  "/start  /help  /register  /profile",
].join("\n");

/**
 * Conversation state is kept in memory for the prototype.
 * Key = Telegram user id, value = { step, data }.
 * It resets whenever the server restarts, which is fine for a demo.
 */
const userSessions = new Map();

/**
 * Pending "please share your phone number" prompts, keyed by donor telegramId:
 * { requestId, requesterId }. Set right after a donor without a username
 * accepts a request; consumed by handleDonorContact. In-memory like the
 * wizard sessions — a restart simply means the donor can re-tap the button
 * and the requester still has the t.me path when a username exists.
 */
const donorContactSessions = new Map();

export function getSession(telegramId) {
  if (!userSessions.has(telegramId)) {
    userSessions.set(telegramId, { step: null, data: {} });
  }
  return userSessions.get(telegramId);
}

export function clearSession(telegramId) {
  userSessions.set(telegramId, { step: null, data: {} });
}

function mainMenu() {
  return buildReplyKeyboard(MAIN_MENU_LABELS);
}

async function sendWithMenu(chatId, text) {
  await sendMessage(chatId, text, { reply_markup: mainMenu() });
}


/**
 * Starts the registration wizard.
 * While a session is active the main menu keyboard is removed so that
 * typed answers (e.g. a name) are never confused with a menu tap.
 */
export async function startRegistration(telegramId, chatId) {
  const session = getSession(telegramId);
  session.step = "register:name";
  session.data = { name: null, bloodGroup: null, available: true, location: null };

  await sendMessage(
    chatId,
    [
      "🩸 Donor Registration",
      "",
      "Let's set up your donor profile. You can type /cancel at any time to stop.",
      "",
      "Step 1 of 4 — What is your name?",
      "(This is shown to requesters when you accept a request.)",
    ].join("\n"),
    { reply_markup: buildRemoveKeyboard() }
  );
}

/** Asks the blood-group question with a compact button keyboard. */
async function askBloodGroup(chatId) {
  await sendMessage(
    chatId,
    "Step 2 of 4 — What is your blood group?",
    { reply_markup: buildReplyKeyboard(BLOOD_GROUP_BUTTONS) }
  );
}

/** Asks the availability question. */
async function askAvailability(chatId) {
  await sendMessage(
    chatId,
    [
      "Step 3 of 4 — Are you available to donate?",
      "",
      "You can change this later at any time with /profile.",
      "(Only 🟢 available donors receive emergency notifications.)",
    ].join("\n"),
    { reply_markup: buildReplyKeyboard(AVAILABILITY_BUTTONS) }
  );
}

/**
 * Asks for the donor's location using Telegram's native location button.
 * Telegram shows the standard "Share your location" map dialog — the user
 * never types latitude/longitude by hand.
 */
async function askLocation(chatId) {
  await sendMessage(
    chatId,
    [
      "Step 4 of 4 — 📍 Please share your current location.",
      "",
      "Tap the button below and confirm. Telegram sends your GPS coordinates",
      "directly to the bot — nothing is typed by hand.",
      "",
      "⚠️ Used only to match you with nearby emergency requests.",
    ].join("\n"),
    { reply_markup: buildLocationRequestKeyboard() }
  );
}

/** Shows the final confirmation with what is now stored in MongoDB. */
async function sendRegistrationSummary(chatId, data) {
  const availabilityText = data.available ? "🟢 Available" : "🔴 Not Available";
  const locationText = data.location
    ? `Location: ✅ saved (${data.location.latitude.toFixed(4)}, ${data.location.longitude.toFixed(4)})`
    : "Location: not provided";

  await sendMessage(
    chatId,
    [
      "✅ Donor profile saved!",
      "",
      `Name: ${data.name}`,
      `Blood group: ${data.bloodGroup}`,
      `Availability: ${availabilityText}`,
      locationText,
      "",
      "You will now be notified when someone nearby needs your blood group.",
      "",
      HEALTH_DISCLAIMER,
    ].join("\n"),
    { reply_markup: mainMenu() }
  );
}

/**
 * Final wizard step: persists the donor to MongoDB (Atlas) and reports the
 * result. A database problem must never crash the bot or hang the user, so
 * every failure path answers with a friendly message.
 */
async function saveDonor(telegramId, chatId, data) {
  if (!isDatabaseReady()) {
    await sendWithMenu(
      chatId,
      [
        "💾 The database is not connected, so your profile was not saved.",
        "",
        "Check the server logs / MongoDB connection, then run /register again.",
      ].join("\n")
    );
    return;
  }

  try {
    const donor = await upsertDonor({
      telegramId,
      username: data.username,
      name: data.name,
      bloodGroup: data.bloodGroup,
      available: data.available,
      location: data.location,
    });

    await sendRegistrationSummary(chatId, {
      name: donor.name,
      bloodGroup: donor.bloodGroup,
      available: donor.available,
      location: data.location,
    });
  } catch (error) {
    console.error(`[bot] Could not save donor ${telegramId}: ${error.message}`);
    await sendWithMenu(
      chatId,
      [
        "❌ Something went wrong while saving your profile.",
        "Please try /register again in a moment.",
      ].join("\n")
    );
  }
}

/**
 * /cancel and the plain word "cancel" end whatever is happening: an active
 * wizard session, or simply confirm that nothing was changed.
 */
async function cancelActiveOperation(telegramId, chatId) {
  const session = getSession(telegramId);
  const hadSession = Boolean(session.step);
  const wasRequest = Boolean(session.step && session.step.startsWith("request:"));
  clearSession(telegramId);

  if (!hadSession) {
    await sendWithMenu(chatId, "❌ Nothing to cancel — no operation is running.");
    return;
  }

  if (wasRequest) {
    await cancelRequestWizard(telegramId, chatId);
    return;
  }

  await sendWithMenu(chatId, "❌ Cancelled. Nothing was changed.");
}

// ---------------------------------------------------------------------------
// Donor profile & availability (Step 6)
// ---------------------------------------------------------------------------

/** Shown by every profile command while Atlas is unreachable. */
const DB_DOWN_MESSAGE = [
  "💾 The database is not connected, so your profile is unavailable.",
  "",
  "Check the server logs / MongoDB connection, then try again.",
].join("\n");

/**
 * Builds the profile card text. Kept in one place so /profile and the toggle
 * callbacks always render the card identically.
 */
function buildProfileCard(donor) {
  const availabilityText = donor.available ? "🟢 Available" : "🔴 Not Available";
  const [longitude, latitude] = donor.location?.coordinates ?? [];

  return [
    "👤 My Donor Profile",
    "",
    `Name: ${donor.name}`,
    `Blood group: ${donor.bloodGroup}`,
    `Availability: ${availabilityText}`,
    `Location: ✅ saved (${latitude?.toFixed(4)}, ${longitude?.toFixed(4)})`,
    "",
    `Registered: ${new Date(donor.createdAt).toLocaleDateString()}`,
    "",
    "Toggle your availability below, or re-register to change your details.",
    "",
    HEALTH_DISCLAIMER,
  ].join("\n");
}

/** The inline buttons under the profile card. Labels flip with current state. */
function profileKeyboard(donor) {
  return buildInlineKeyboard([
    [
      donor.available
        ? { text: "🔴 Set Not Available", callbackData: AVAILABILITY_CALLBACKS.UNAVAILABLE }
        : { text: "🟢 Set Available", callbackData: AVAILABILITY_CALLBACKS.AVAILABLE },
    ],
    [{ text: "🔄 Re-register", callbackData: AVAILABILITY_CALLBACKS.EDIT_PROFILE }],
  ]);
}

/** /profile — shows the saved donor card, or guides unregistered users. */
export async function showProfile(telegramId, chatId) {
  if (!isDatabaseReady()) {
    await sendWithMenu(chatId, DB_DOWN_MESSAGE);
    return;
  }

  try {
    const donor = await getDonorByTelegramId(telegramId);

    if (!donor) {
      await sendWithMenu(
        chatId,
        [
          "👋 You are not registered as a donor yet.",
          "",
          "Tap 🩸 Register as Donor (or send /register) to create your profile:",
          "name, blood group, availability and location.",
        ].join("\n")
      );
      return;
    }

    await sendMessage(chatId, buildProfileCard(donor), {
      reply_markup: profileKeyboard(donor),
    });
  } catch (error) {
    console.error(`[bot] Could not load profile for ${telegramId}: ${error.message}`);
    await sendWithMenu(chatId, "❌ Could not load your profile. Please try again in a moment.");
  }
}

/** Applies an availability change and re-renders the SAME profile message in place. */
async function applyAvailabilityToggle(telegramId, chatId, messageId, available) {
  try {
    const donor = await setDonorAvailability(telegramId, available);

    if (!donor) {
      await sendWithMenu(
        chatId,
        "👋 You are not registered yet. Send /register to create your donor profile."
      );
      return;
    }

    await editMessageText(chatId, messageId, buildProfileCard(donor), {
      reply_markup: profileKeyboard(donor),
    });
  } catch (error) {
    console.error(`[bot] Could not update availability for ${telegramId}: ${error.message}`);
    await sendMessage(chatId, "❌ Could not update your availability. Please try again.");
  }
}

/** The "Re-register" inline button — starts the same wizard as /register. */
async function startReRegistration(telegramId, chatId, messageId) {
  try {
    await editMessageText(chatId, messageId, "🔄 Starting re-registration below...");
  } catch {
    // Editing can fail for very old messages — starting the wizard is still fine.
  }
  await startRegistration(telegramId, chatId);
}

/**
 * Entry point for every inline-button tap (update.callback_query).
 * Callback data format: "<action>:<value>" — the same prefix style the
 * donor accept/reject buttons will use in Step 11.
 */
export async function handleCallbackQuery(callbackQuery) {
  const callbackData = callbackQuery.data || "";
  const from = callbackQuery.from;
  const message = callbackQuery.message;

  // Telegram requires this ack — otherwise the client shows an endless spinner.
  await answerCallbackQuery(callbackQuery.id);

  if (!message) return; // callback from a message we cannot edit — nothing to do

  const [action, value] = callbackData.split(":");

  if (action === "avail") {
    await applyAvailabilityToggle(from.id, message.chat.id, message.message_id, value === "yes");
    return;
  }

  if (callbackData === AVAILABILITY_CALLBACKS.EDIT_PROFILE) {
    await startReRegistration(from.id, message.chat.id, message.message_id);
    return;
  }

  if (action === "reqcancel") {
    await handleRequestCancelButton(value, from.id, message.chat.id);
    return;
  }

  if (action === "respond") {
    await handleDonorResponse(callbackData, from.id, message.chat.id);
    return;
  }

  if (action === "request") {
    await handleRequestConfirmation(callbackData, from.id, message.chat.id);
    return;
  }

  console.log(`[bot] Ignored unknown callback: ${callbackData}`);
}

/**
 * Moves the conversation forward while the user is inside /register.
 * Returns true when the message was consumed by this flow.
 */
async function handleRegistrationStep(telegramId, chatId, text) {
  const session = getSession(telegramId);

  switch (session.step) {
    case "register:name": {
      if (text.length < 2 || text.length > 50) {
        await sendMessage(
          chatId,
          "⚠️ Please enter a name between 2 and 50 characters (letters only is best)."
        );
        return true;
      }
      session.data.name = text;
      session.step = "register:blood_group";
      await askBloodGroup(chatId);
      return true;
    }

    case "register:blood_group": {
      if (!isValidBloodGroup(text)) {
        await sendMessage(chatId, "⚠️ Please pick a blood group using the buttons below.", {
          reply_markup: buildReplyKeyboard(BLOOD_GROUP_BUTTONS),
        });
        return true;
      }
      session.data.bloodGroup = text;
      session.step = "register:availability";
      await askAvailability(chatId);
      return true;
    }

    case "register:availability": {
      const available = availabilityFromLabel(text);
      if (available === null) {
        await sendMessage(chatId, "⚠️ Please choose 🟢 Available or 🔴 Not Available.", {
          reply_markup: buildReplyKeyboard(AVAILABILITY_BUTTONS),
        });
        return true;
      }
      session.data.available = available;
      session.step = "register:location";
      await askLocation(chatId);
      return true;
    }

    default:
      return false;
  }
}

/**
 * Validates a Telegram location message.
 * live_period means it is a live (moving) location stream — we only want a
 * single point-in-time fix, so live locations are rejected with a hint.
 */
export function isValidRegistrationLocation(location) {
  if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
    return { ok: false, reason: "missing" };
  }
  if (location.live_period) {
    return { ok: false, reason: "live" };
  }
  return { ok: true };
}

/**
 * Handles a location message. Only consumed while the wizard is waiting on
 * the register:location step; otherwise the user gets a normal fallback.
 */
export async function handleLocationMessage(telegramId, chatId, location, username = null) {
  const session = getSession(telegramId);

  const waitingForLocation =
    session.step === "register:location" || session.step === "request:location";

  if (!waitingForLocation) {
    await sendWithMenu(
      chatId,
      [
        "📍 Thanks for sharing your location!",
        "",
        "Location is used during donor registration or an emergency request.",
        "Send /register or /request to start one of those flows.",
      ].join("\n")
    );
    return;
  }

  const check = isValidRegistrationLocation(location);
  if (!check.ok) {
    if (check.reason === "live") {
      await sendMessage(
        chatId,
        "⚠️ That was a *live* location. Please share a static location instead (don't tick the live-share option).",
        { reply_markup: buildLocationRequestKeyboard() }
      );
    } else {
      await sendMessage(chatId, "⚠️ Location could not be read. Please try again.", {
        reply_markup: buildLocationRequestKeyboard(),
      });
    }
    return;
  }

  session.data.location = {
    latitude: location.latitude,
    longitude: location.longitude,
  };

  if (session.step === "request:location") {
    session.step = "request:radius";
    await askRadius(chatId);
    return;
  }

  session.data.username = username;
  const completeData = { ...session.data };
  clearSession(telegramId);
  await saveDonor(telegramId, chatId, completeData);
}

/**
 * Any text message that is not a command and not a menu tap lands here.
 * If the user is inside a conversation, the conversation gets the message.
 */
export async function handleTextMessage(telegramId, chatId, text) {
  const session = getSession(telegramId);

  // Waiting for the donor's phone-number share — typed text would only
  // confuse; point them back to the button (or /cancel to skip).
  if (donorContactSessions.has(telegramId)) {
    await sendMessage(
      chatId,
      "⚠️ I'm waiting for your phone number. Tap the 📱 Share My Phone Number button, or type /cancel.",
      { reply_markup: buildContactRequestKeyboard() }
    );
    return;
  }

  if (session.step === "register:location" || session.step === "request:location") {
    await sendMessage(
      chatId,
      "⚠️ I'm waiting for your location. Tap the 📍 Share Location button, or type /cancel.",
      { reply_markup: buildLocationRequestKeyboard() }
    );
    return;
  }

  if (session.step && session.step.startsWith("register:")) {
    const handled = await handleRegistrationStep(telegramId, chatId, text);
    if (handled) return;
  }

  if (session.step && session.step.startsWith("request:")) {
    const handled = await handleRequestStep(telegramId, chatId, text);
    if (handled) return;
  }

  await sendWithMenu(chatId, NOT_UNDERSTOOD_MESSAGE);
}

// ---------------------------------------------------------------------------
// Request status & cancellation (Step 13)
// ---------------------------------------------------------------------------

const STATUS_ICONS = {
  OPEN: "🟠 OPEN",
  DONOR_NOTIFIED: "📨 DONOR_NOTIFIED",
  DONOR_FOUND: "🎉 DONOR_FOUND",
  COMPLETED: "✅ COMPLETED",
  CANCELLED: "❌ CANCELLED",
};

function formatRequestRow(request) {
  return [
    `• ${STATUS_ICONS[request.status] || request.status} — ${request.bloodGroup}, ${request.unitsRequired} unit(s), ${request.radiusKm} KM`,
    `  ID: ${request._id}`,
    `  Created: ${new Date(request.createdAt).toLocaleString()}`,
  ].join("\n");
}

/** /status — lists the user's recent requests with live status from Atlas. */
export async function showRequestStatus(telegramId, chatId) {
  if (!isDatabaseReady()) {
    await sendWithMenu(chatId, DB_DOWN_MESSAGE);
    return;
  }

  try {
    const requests = await getRecentRequestsForRequester(telegramId);

    if (requests.length === 0) {
      await sendWithMenu(
        chatId,
        [
          "📋 You have no blood requests yet.",
          "",
          "Send /request to create an emergency blood request.",
        ].join("\n")
      );
      return;
    }

    const activeCount = await countActiveRequestsForRequester(telegramId);
    const lines = ["📋 My Blood Requests", ""];
    for (const request of requests) {
      lines.push(formatRequestRow(request), "");
    }

    // Every still-open request gets its own ❌ Cancel button under the list.
    // The buttons carry the request's _id, so with several active requests
    // each one can be withdrawn individually — the button state is checked
    // server-side on tap (handleRequestCancelButton), never trusted.
    const cancellableRows = requests
      .filter((request) => request.status === "OPEN" || request.status === "DONOR_NOTIFIED")
      .map((request) => [
        {
          text: `❌ Cancel ${request.bloodGroup} (${request.unitsRequired}u)`,
          callbackData: `reqcancel:${request._id}`,
        },
      ]);

    lines.push(
      activeCount > 0
        ? `You have ${activeCount} active request(s). Use a ❌ button below (or /cancel) to withdraw one.`
        : "No active requests. Send /request to create a new one."
    );

    await sendMessage(chatId, lines.join("\n"), {
      reply_markup: cancellableRows.length > 0 ? buildInlineKeyboard(cancellableRows) : undefined,
    });
  } catch (error) {
    console.error(`[bot] Could not load requests for ${telegramId}: ${error.message}`);
    await sendWithMenu(chatId, "❌ Could not load your requests. Please try again in a moment.");
  }
}

/**
 * Handles a ❌ Cancel button under /status (callbackData "reqcancel:<id>").
 * The request is DELETED from the database (Step 16) — cancelled requests
 * leave nothing behind. Every guard is re-checked here server-side:
 * ownership, claimable status, and the race against a donor tapping accept
 * in the same instant (deleteRequest only matches OPEN/DONOR_NOTIFIED, so a
 * request that was just claimed survives untouched).
 */
async function handleRequestCancelButton(requestId, telegramId, chatId) {
  const deleted = await deleteRequest(requestId, telegramId);

  if (deleted) {
    const notifiedText =
      deleted.matchedDonors.length > 0
        ? `${deleted.matchedDonors.length} donor(s) had been notified — no further notifications will be sent.`
        : "No donors had been notified yet.";

    await sendWithMenu(
      chatId,
      [
        "🗑️ Request deleted.",
        "",
        `Request ID: ${deleted._id}`,
        `Blood Group: ${deleted.bloodGroup} (${deleted.unitsRequired} unit(s))`,
        "",
        notifiedText,
        "",
        "The request data was removed from the database.",
      ].join("\n")
    );
    return;
  }

  // Nothing deleted — either already accepted, completed or removed earlier.
  const current = await getRequestById(requestId);

  if (!current || current.requesterId !== telegramId) {
    await sendWithMenu(chatId, "⚠️ That request no longer exists.");
    return;
  }

  if (current.status === "DONOR_FOUND") {
    await sendWithMenu(
      chatId,
      [
        "⚠️ This request has already been accepted by a donor, so it cannot be deleted here.",
        "",
        `Request ID: ${current._id}`,
        "",
        "Coordinate with the donor through their contact info.",
      ].join("\n")
    );
    return;
  }

  await sendWithMenu(
    chatId,
    "⚠️ That request just changed state and can no longer be deleted."
  );
}/**
 * Deletes ALL of the requester's still-open requests (OPEN/DONOR_NOTIFIED)
 * from the database — /cancel with several active requests clears every one
 * of them. DONOR_FOUND requests are never touched: a donor is already on
 * their way and cancellation would break their expectation.
 * Returns the list of deleted documents (empty when nothing was open).
 */
async function deleteActiveRequests(telegramId, chatId) {
  const activeRequests = await BloodRequest.find({
    requesterId: telegramId,
    status: { $in: ["OPEN", "DONOR_NOTIFIED"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (activeRequests.length === 0) {
    return [];
  }

  const deletedRequests = [];
  for (const request of activeRequests) {
    // deleteRequest re-checks the status guard one by one, so a request that
    // is claimed by a donor mid-loop is skipped instead of being destroyed.
    const deleted = await deleteRequest(request._id, telegramId);
    if (deleted) {
      deletedRequests.push(deleted);
    }
  }

  if (deletedRequests.length === 0) {
    await sendWithMenu(
      chatId,
      "⚠️ Your open requests just changed state and can no longer be deleted."
    );
    return [];
  }

  const totalNotified = deletedRequests.reduce(
    (sum, request) => sum + request.matchedDonors.length,
    0
  );
  const skipped = activeRequests.length - deletedRequests.length;

  const lines = [
    `🗑️ ${deletedRequests.length} active request(s) deleted.`,
    "",
  ];
  for (const request of deletedRequests) {
    lines.push(`• ${request.bloodGroup} (${request.unitsRequired} unit(s)) — ID: ${request._id}`);
  }
  lines.push(
    "",
    totalNotified > 0
      ? `${totalNotified} donor notification(s) had gone out — no further notifications will be sent.`
      : "No donors had been notified yet.",
    "",
    "The request data was removed from the database."
  );
  if (skipped > 0) {
    lines.push(
      "",
      `⚠️ ${skipped} request(s) were skipped — already accepted by a donor (check /status).`
    );
  }

  await sendWithMenu(chatId, lines.join("\n"));
  return deletedRequests;
}

export async function handleCommand(telegramId, chatId, command) {
  switch (command) {
    case "/start":
      clearSession(telegramId);
      await sendWithMenu(chatId, WELCOME_MESSAGE);
      return;
    case "/help":
      clearSession(telegramId);
      await sendWithMenu(chatId, HELP_MESSAGE);
      return;
    case "/register":
      await startRegistration(telegramId, chatId);
      return;
    case "/request":
      await startRequestWizard(telegramId, chatId);
      return;
    case "/profile":
      await showProfile(telegramId, chatId);
      return;
    case "/status":
      clearSession(telegramId);
      await showRequestStatus(telegramId, chatId);
      return;
    case "/cancel": {
      const session = getSession(telegramId);

      // A pending "share your phone number" prompt is cancelled too.
      donorContactSessions.delete(telegramId);

      // 1) A running wizard cancels the conversation itself.
      if (session.step) {
        await cancelActiveOperation(telegramId, chatId);
        return;
      }

      // 2) Otherwise delete ALL open blood requests (Step 16: hard delete).
      if (!isDatabaseReady()) {
        await sendWithMenu(chatId, DB_DOWN_MESSAGE);
        return;
      }

      try {
        const deletedAny = await deleteActiveRequests(telegramId, chatId);
        if (deletedAny.length === 0) {
          const foundCount = await countActiveRequestsForRequester(telegramId);
          if (foundCount > 0) {
            await sendWithMenu(
              chatId,
              [
                "⚠️ Your remaining request(s) have already been accepted by a donor,",
                "so they cannot be deleted here. Coordinate through their contact info.",
              ].join("\n")
            );
          } else {
            await sendWithMenu(
              chatId,
              "❌ Nothing to cancel — no operation is running and no active request."
            );
          }
        }
      } catch (error) {
        console.error(`[bot] Cancellation failed for ${telegramId}: ${error.message}`);
        await sendWithMenu(chatId, "❌ Could not cancel right now. Please try again.");
      }
      return;
    }
    default:
      clearSession(telegramId);
      await sendWithMenu(chatId, "🚧 This command is not available yet.");
  }
}

export async function handleUnknownInput(chatId) {
  await sendWithMenu(chatId, NOT_UNDERSTOOD_MESSAGE);
}
