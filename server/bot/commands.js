/**
 * One single place that defines every command and every menu button,
 * so the Telegram "/" menu, the reply keyboard and the router can never drift apart.
 */

export const BOT_COMMANDS = [
  { command: "start", description: "Show the main menu" },
  { command: "help", description: "How to use BloodConnect" },
  { command: "register", description: "Register as a blood donor" },
  { command: "request", description: "Send an emergency blood request" },
  { command: "profile", description: "View my donor profile" },
  { command: "status", description: "Check my blood requests" },
  { command: "cancel", description: "Cancel the current operation" },
];

export const MAIN_MENU_BUTTONS = [
  { label: "🩸 Register as Donor", command: "/register" },
  { label: "🚨 Emergency Blood Request", command: "/request" },
  { label: "👤 My Profile", command: "/profile" },
  { label: "📋 My Requests", command: "/status" },
  { label: "❓ Help", command: "/help" },
];

export const MAIN_MENU_LABELS = MAIN_MENU_BUTTONS.map((button) => button.label);

/** Buttons for the blood-group question. Two per row keeps the keyboard compact. */
export const BLOOD_GROUP_BUTTONS = [
  "A+", "A-",
  "B+", "B-",
  "O+", "O-",
  "AB+", "AB-",
];

export const VALID_BLOOD_GROUPS = new Set(BLOOD_GROUP_BUTTONS);

/** Availability buttons; the emoji makes the current state obvious in chat. */
export const AVAILABILITY_BUTTONS = ["🟢 Available", "🔴 Not Available"];

/**
 * Hidden codes carried by INLINE buttons (profile toggles, and later the
 * donor accept/reject buttons). The user never sees these — the bot reads
 * them from the callback_query. Format: "<action>:<value>".
 */
export const AVAILABILITY_CALLBACKS = {
  AVAILABLE: "avail:yes",
  UNAVAILABLE: "avail:no",
  EDIT_PROFILE: "profile:edit",
};

/** Hidden codes for the emergency request confirmation buttons. */
export const REQUEST_CALLBACKS = {
  CONFIRM: "request:confirm",
  CANCEL: "request:cancel",
};

/** Search radius options for an emergency request. */
export const RADIUS_BUTTONS = ["5 KM", "10 KM", "20 KM", "50 KM"];

/** Label -> kilometre value lookup (keys uppercase so typed variants work). */
export const RADIUS_VALUES = {
  "5 KM": 5,
  "10 KM": 10,
  "20 KM": 20,
  "50 KM": 50,
};

export function radiusFromLabel(label) {
  const value = RADIUS_VALUES[label.trim().toUpperCase()];
  return value === undefined ? null : value;
}

/** Parses a units answer. Accepts only whole numbers 1-10; null = invalid. */
export function parseUnits(text) {
  const value = Number.parseInt(text.trim(), 10);
  if (!Number.isInteger(value) || value < 1 || value > 10) return null;
  return value;
}

/** Reverse lookup so a tapped label becomes the boolean we store. */
export const AVAILABILITY_LABELS = {
  "🟢 Available": true,
  "🔴 Not Available": false,
};

export function isValidBloodGroup(text) {
  return VALID_BLOOD_GROUPS.has(text.trim().toUpperCase());
}

export function availabilityFromLabel(label) {
  const available = AVAILABILITY_LABELS[label.trim()];
  return available === undefined ? null : available;
}

/** Plain-word cancel works mid-conversation ("cancel", "/cancel", "stop"). */
export function isCancelText(text) {
  return ["cancel", "/cancel", "stop"].includes(text.trim().toLowerCase());
}

export function getCommandNames() {
  return BOT_COMMANDS.map((item) => `/${item.command}`);
}

/**
 * Turns any typed text into a command name, or returns null if it is not a command.
 * The "@botname" part is stripped because Telegram sends /start@MyBot inside groups.
 */
export function parseCommand(text) {
  const firstWord = text.trim().split(/\s+/)[0];
  const withoutBotName = firstWord.split("@")[0].toLowerCase();
  const command = withoutBotName.startsWith("/")
    ? withoutBotName
    : `/${withoutBotName}`;

  return getCommandNames().includes(command) ? command : null;
}

/**
 * Tapping a reply-keyboard button simply sends its text to the bot,
 * so we translate the label back into the command it stands for.
 */
export function commandFromButtonLabel(label) {
  const button = MAIN_MENU_BUTTONS.find((item) => item.label === label);
  return button ? button.command : null;
}
