import mongoose from "mongoose";

/**
 * A single emergency blood request created through the /request wizard.
 *
 * Status lifecycle:
 *   OPEN           - created, donors not yet notified
 *   DONOR_NOTIFIED - matching donors have been notified (Steps 9-10)
 *   DONOR_FOUND    - a donor accepted (Step 11); no further accepts allowed
 *   COMPLETED      - donation happened (Step 13)
 *   CANCELLED      - requester cancelled (Step 13)
 *
 * location is GeoJSON ([longitude, latitude]) exactly like the donor model,
 * so the same 2dsphere-powered queries work on both collections.
 */
const bloodRequestSchema = new mongoose.Schema(
  {
    requesterId: { type: Number, required: true, index: true },
    bloodGroup: {
      type: String,
      required: true,
      enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
    },
    unitsRequired: { type: Number, required: true, min: 1, max: 10 },
    location: {
      type: { type: String, enum: ["Point"], required: true },
      coordinates: { type: [Number], required: true }, // [longitude, latitude]
    },
    radiusKm: { type: Number, required: true, min: 1, max: 100 },
    status: {
      type: String,
      enum: ["OPEN", "DONOR_NOTIFIED", "DONOR_FOUND", "COMPLETED", "CANCELLED"],
      default: "OPEN",
      index: true,
    },
    matchedDonors: { type: [Number], default: [] }, // telegramIds that were notified
    rejectedDonors: { type: [Number], default: [] }, // telegramIds that tapped NOT AVAILABLE
    acceptedDonor: { type: Number, default: null }, // telegramId of the accepting donor
  },
  {
    timestamps: true,
  }
);

/**
 * Fast lookups for the flows we already know are coming:
 * - requesterId + status   -> /status and cancellation ("my active requests")
 * - status + createdAt     -> the dashboard's "recent requests" list (Step 15)
 */
bloodRequestSchema.index({ requesterId: 1, status: 1 });
bloodRequestSchema.index({ status: 1, createdAt: -1 });

export const BloodRequest = mongoose.model("BloodRequest", bloodRequestSchema);
