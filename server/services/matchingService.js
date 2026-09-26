import { User } from "../models/User.js";
import { BloodRequest } from "../models/BloodRequest.js";

/**
 * The matching engine (Step 9).
 *
 * HOW IT WORKS
 * $geoNear is MongoDB's geospatial search: it starts at a point, walks outward,
 * and returns documents inside maxDistance — sorted nearest first. It requires
 * the 2dsphere index created by the User model in Step 5.
 *
 * THE FILTER inside $geoNear's `query` keeps only donors that are ALL of:
 *   - the requested blood group
 *   - available = true          (🔴 donors are never notified)
 *   - not the requester themself
 *
 * UNITS: MongoDB measures geospatial distance in METRES, so radiusKm * 1000.
 */
export async function findMatchingDonors(request) {
  const donors = await User.aggregate([
    {
      $geoNear: {
        // Normalize to a plain GeoJSON point so this works with both Mongoose
        // documents and lean objects.
        near: { type: "Point", coordinates: request.location.coordinates },
        distanceField: "distanceMetres", // added to each result by MongoDB
        maxDistance: request.radiusKm * 1000,
        query: {
          bloodGroup: request.bloodGroup,
          available: true,
          telegramId: { $ne: request.requesterId },
        },
        spherical: true,
      },
    },
    { $sort: { distanceMetres: 1 } }, // nearest donors first
    { $limit: 50 }, // safety cap for the prototype
  ]);

  // Shape the result for notifications (Step 10). In a private Telegram chat
  // the chatId equals the user's telegramId, which is how we can message them.
  return donors.map((donor) => ({
    telegramId: donor.telegramId,
    username: donor.username,
    name: donor.name,
    chatId: donor.telegramId,
    distanceKm: Math.round((donor.distanceMetres / 1000) * 10) / 10,
  }));
}

/**
 * Runs matching for a request and records the outcome:
 *   1. matched donor ids are stored on matchedDonors
 *   2. status flips OPEN -> DONOR_NOTIFIED when at least one donor was found
 *   3. with no donors the request stays OPEN — honest, per the project rules
 *
 * Returns the shaped donor list so the caller can notify them (Step 10).
 */
export async function matchDonorsForRequest(request) {
  const donors = await findMatchingDonors(request);

  await BloodRequest.updateOne(
    { _id: request._id },
    { $set: { matchedDonors: donors.map((donor) => donor.telegramId) } }
  );

  if (donors.length > 0) {
    // Guarded by status: "OPEN" so a cancelled/completed request is never flipped.
    await BloodRequest.updateOne(
      { _id: request._id, status: "OPEN" },
      { $set: { status: "DONOR_NOTIFIED" } }
    );
  }

  return { donors };
}
