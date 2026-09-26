import mongoose from "mongoose";
import { User } from "../models/User.js";

/**
 * Converts a Telegram location { latitude, longitude } into the GeoJSON Point
 * format MongoDB requires ([longitude, latitude] — order matters!).
 */
export function toGeoJsonPoint({ latitude, longitude }) {
  return {
    type: "Point",
    coordinates: [longitude, latitude],
  };
}

/**
 * Saves or updates a donor (upsert). Re-running /register overwrites the
 * previous profile instead of creating a duplicate — telegramId is the key.
 *
 * Returns the saved document so the bot can confirm with real data.
 */
export async function upsertDonor(donorData) {
  const { telegramId, username, name, bloodGroup, available, location } = donorData;

  const donor = await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        telegramId,
        username: username || null,
        name,
        bloodGroup,
        available,
        location: toGeoJsonPoint(location),
      },
    },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
  );

  return donor;
}

/**
 * Fetches one donor document by Telegram user id, or null when the user has
 * never registered. `.lean()` returns a plain object (faster, read-only).
 */
export async function getDonorByTelegramId(telegramId) {
  return User.findOne({ telegramId }).lean();
}

/**
 * Flips a donor's availability flag (🟢/🔴) and returns the updated document.
 * Returns null when the donor does not exist — callers decide the message.
 */
export async function setDonorAvailability(telegramId, available) {
  return User.findOneAndUpdate(
    { telegramId },
    { $set: { available } },
    { returnDocument: "after" }
  ).lean();
}

/** True when Mongoose has an open connection, so the bot can save documents. */
export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}
