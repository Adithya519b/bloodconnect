import dotenv from "dotenv";

dotenv.config({ quiet: true });

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Every Telegram Bot API URL looks like:
 * https://api.telegram.org/bot<YOUR_TOKEN>/<METHOD_NAME>
 * The token is a secret, so it is read from .env and never written in code.
 */
function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing. Copy server/.env.example to server/.env and paste your BotFather token."
    );
  }

  return token;
}

/**
 * Sends one request to any Telegram Bot API method.
 * "method" is the API name (sendMessage, getUpdates, getMe, ...).
 * "payload" is a plain JavaScript object - it becomes JSON automatically.
 */
async function callTelegramApi(method, payload = {}) {
  const url = `${TELEGRAM_API_BASE}/bot${getBotToken()}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(`Telegram API error in ${method}: ${result.description}`);
  }

  return result.result;
}

export async function sendMessage(chatId, text, options = {}) {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    ...options,
  });
}

export async function getMe() {
  return callTelegramApi("getMe", {});
}

export async function getUpdates(offset, timeoutSeconds = 25) {
  return callTelegramApi("getUpdates", {
    offset,
    timeout: timeoutSeconds,
    allowed_updates: ["message", "callback_query"],
  });
}

/**
 * Publishes the slash command list, so the "/" menu inside Telegram shows
 * /register, /request, ... instead of nothing.
 */
export async function setMyCommands(commands) {
  return callTelegramApi("setMyCommands", { commands });
}

/**
 * Rewrites the text (and optionally the inline keyboard) of a message the bot
 * ALREADY sent. Used when a button tap should refresh the same message —
 * e.g. the profile card updating in place after a toggle, instead of the bot
 * spamming a new message for every change.
 */
export async function editMessageText(chatId, messageId, text, options = {}) {
  return callTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  });
}

/**
 * An INLINE keyboard attaches buttons directly under a message bubble
 * (unlike a reply keyboard, which lives at the bottom of the chat).
 * Tapping one does NOT send a text message — it fires a "callback_query"
 * event with the hidden `callback_data` string, which our bot handles.
 * This is the pattern the donor accept/reject buttons will use in Step 11.
 *
 * Input: rows of buttons, e.g. [[{ text, callbackData }], ...]
 */
export function buildInlineKeyboard(rows) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => ({ text: button.text, callback_data: button.callbackData }))
    ),
  };
}

/**
 * Telegram REQUIRES every callback button tap to be acknowledged within a
 * few seconds, otherwise the client shows a spinner and "loading" forever.
 * `text` (optional) pops up a small toast on the user's screen.
 */
export async function answerCallbackQuery(callbackQueryId, text = "") {
  return callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

/**
 * A reply keyboard is the row of buttons that sits at the bottom of the chat,
 * above the message input box. Every entry is a normal string the user can tap.
 */
export function buildReplyKeyboard(labels) {
  return {
    keyboard: labels.map((label) => [{ text: label }]),
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Tap a button below",
  };
}

/**
 * Shows the "typed text goes here" bar instead of the menu buttons.
 * Used inside a multi-step conversation so user answers are not mistaken
 * for menu taps.
 */
export function buildRemoveKeyboard() {
  return { remove_keyboard: true };
}

/**
 * A keyboard with one special button. `request_location: true` makes Telegram
 * pop up its native "Share your location" dialog with a map — the user taps
 * once and the app sends the exact GPS coordinates. No typing coordinates.
 * The keyboard is kept persistent (not one-time) so the button stays visible
 * until the user shares — Telegram Desktop keeps collapsed keyboards hidden
 * behind the small keyboard icon, and a one-time keyboard only makes that worse.
 */
export function buildLocationRequestKeyboard(text = "📍 Share Location") {
  return {
    keyboard: [[{ text, request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Tap 📍 Share Location (or /cancel)",
  };
}
