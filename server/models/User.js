import mongoose from "mongoose";

/**
 * The donor document. TelegramId is the natural unique key: one donor account
 * per Telegram user, re-registering overwrites the old profile (upsert).
 *
 * location uses GeoJSON because MongoDB geospatial queries ($geoNear, $near)
 * only work on this format:
 *   { type: "Point", coordinates: [longitude, latitude] }
 * ⚠️ GeoJSON order is LONGITUDE FIRST, latitude second — the opposite of how
 * Telegram (and Google Maps) show it. Mixing them up is a classic bug.
 */
const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, trim: true, default: null },
    name: { type: String, required: true, trim: true },
    bloodGroup: {
      type: String,
      required: true,
      enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    available: { type: Boolean, default: true },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

/**
 * 2dsphere index = the index MongoDB needs to answer
 * "which donors are within X km of this point?" efficiently.
 * Compound index = bloodGroup + available, so the matching engine can filter
 * those without scanning the whole collection.
 */
userSchema.index({ location: "2dsphere" });
userSchema.index({ bloodGroup: 1, available: 1 });

export const User = mongoose.model("User", userSchema);
