import {
  BOT_COMMANDS,
  commandFromButtonLabel,
  parseCommand,
  isCancelText,
} from "./commands.js";
import {
  clearSession,
  handleCallbackQuery,
  handleCommand,
  handleDonorContact,
  handleLocationMessage,
  handleTextMessage,
  handleUnknownInput,
} from "./handlers.js";
import { getMe, getUpdates, setMyCommands } from "../services/telegramService.js";

async function handleMessage(message) {
  const chatId = message.chat.id;
  const telegramId = message.from.id;
  const text = (message.text || "").trim();

  console.log(`[bot] chat ${chatId} @${message.from.username || "unknown"}: ${text}`);

  // Location comes as a message with `location` instead of `text`.
  if (message.location) {
    await handleLocationMessage(telegramId, chatId, message.location, message.from.username || null);
    return;
  }

  // A shared contact (donor sending their phone number after accepting a
  // request without a username). Checked before the text handlers because a
  // contact message carries no text.
  if (message.contact) {
    await handleDonorContact(telegramId, chatId, message.contact);
    return;
  }

  // Photos, stickers, voice notes etc. — the flows only understand text for now.
  if (!text) {
    await handleTextMessage(telegramId, chatId, "");
    return;
  }

  const command = parseCommand(text) ?? commandFromButtonLabel(text);

  if (command) {
    clearSession(telegramId);
    await handleCommand(telegramId, chatId, command);
    return;
  }

  // /cancel typed as a plain word must work mid-conversation too, but the
  // blood-group "AB-" contains a dash, so only exact words cancel.
  if (isCancelText(text)) {
    clearSession(telegramId);
    await handleCommand(telegramId, chatId, "/cancel");
    return;
  }

  await handleTextMessage(telegramId, chatId, text);
}

export async function handleUpdate(update) {
  try {
    if (update.message) {
      await handleMessage(update.message);
      return;
    }

    // Inline-button taps arrive as callback_query events (profile toggles now,
    // donor accept/reject buttons in Step 11).
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (error) {
    console.error(`[bot] Could not handle update: ${error.message}`);
  }
}

let isPolling = false;
let nextOffset = 0;

async function pollOnce() {
  const updates = await getUpdates(nextOffset);

  for (const update of updates) {
    nextOffset = update.update_id + 1;
    await handleUpdate(update);
  }
}

/**
 * Publishes the slash command list once at startup so the "/" menu in
 * Telegram shows /register, /request and the rest.
 */
async function registerBotCommands() {
  try {
    await setMyCommands(BOT_COMMANDS);
    console.log("[bot] Command menu published to Telegram");
  } catch (error) {
    console.error(`[bot] Could not publish commands: ${error.message}`);
  }
}

/**
 * Polling = our server repeatedly asks Telegram "any new messages for me?".
 * Telegram holds the request open for ~25 seconds and returns an empty list
 * if nothing happened, so this loop is cheap and works well on local dev.
 */
export async function startBot() {
  if (isPolling) return;

  try {
    const botInfo = await getMe();
    console.log(`[bot] Connected to Telegram as @${botInfo.username}`);
  } catch (error) {
    console.error(`[bot] Bot not started: ${error.message}`);
    return;
  }

  await registerBotCommands();

  isPolling = true;
  console.log("[bot] Polling for updates...");

  while (isPolling) {
    try {
      await pollOnce();
    } catch (error) {
      if (!isPolling) break;
      console.error(`[bot] Polling error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export function stopBot() {
  isPolling = false;
  console.log("[bot] Polling stopped");
}
