import mongoose from "mongoose";
import { BloodRequest } from "../models/BloodRequest.js";
import { toGeoJsonPoint } from "./donorService.js";

/** Statuses that still count as "active" for a requester. */
const ACTIVE_STATUSES = ["OPEN", "DONOR_NOTIFIED", "DONOR_FOUND"];

/** Upper bound on concurrent active requests per requester (prototype guard). */
export const MAX_ACTIVE_REQUESTS = 3;

/**
 * Creates the BloodRequest document from validated wizard data.
 * The location is converted to GeoJSON exactly like donor locations.
 *
 * A requester may have SEVERAL active requests at once (e.g. different blood
 * groups for different patients), capped at MAX_ACTIVE_REQUESTS so /status
 * stays readable and donors are not flooded.
 *
 * Returns { request, created } where created=false when the cap is reached
 * (request is null in that case).
 */
export async function createBloodRequest(requestData) {
  const { requesterId, bloodGroup, unitsRequired, location, radiusKm } = requestData;

  const activeCount = await countActiveRequestsForRequester(requesterId);

  if (activeCount >= MAX_ACTIVE_REQUESTS) {
    return { request: null, created: false, activeCount };
  }

  const request = await BloodRequest.create({
    requesterId,
    bloodGroup,
    unitsRequired,
    location: toGeoJsonPoint(location),
    radiusKm,
    status: "OPEN",
  });

  return { request, created: true };
}

/** Fetches one request document, or null. */
export async function getRequestById(id) {
  return BloodRequest.findById(id).lean();
}

/**
 * ATOMIC donor acceptance (Step 11, spec §15).
 *
 * The claim happens INSIDE one MongoDB update: the filter only matches a
 * request that is still claimable (OPEN or DONOR_NOTIFIED, no accepted donor,
 * not the requester themself). MongoDB executes filter + set as a single
 * atomic operation, so when two donors tap "I CAN DONATE" at the same
 * moment, exactly ONE update matches — the first — and the other gets null.
 * No buttons, timings or client state are trusted.
 *
 * Returns the updated request on success, or null when someone else already
 * claimed it / it was cancelled / the donor IS the requester.
 */
export async function acceptRequest(requestId, donorId) {
  return BloodRequest.findOneAndUpdate(
    {
      _id: requestId,
      status: { $in: ["OPEN", "DONOR_NOTIFIED"] },
      acceptedDonor: null,
      requesterId: { $ne: donorId },
    },
    { $set: { status: "DONOR_FOUND", acceptedDonor: donorId } },
    { returnDocument: "after" }
  ).lean();
}

/** Records a "NOT AVAILABLE" tap so the dashboard can show rejection stats. */
export async function recordDonorRejection(requestId, donorId) {
  return BloodRequest.updateOne(
    { _id: requestId },
    { $addToSet: { rejectedDonors: donorId } }
  );
}

/**
 * Cancels a request (status-guarded). The filter means a request that was
 * accepted, completed or already cancelled cannot be flipped — the update
 * simply matches nothing.
 *
 * Returns the updated document, or null when there was nothing to cancel.
 */
export async function cancelRequest(requestId, requesterId) {
  return BloodRequest.findOneAndUpdate(
    {
      _id: requestId,
      requesterId,
      status: { $in: ["OPEN", "DONOR_NOTIFIED"] },
    },
    { $set: { status: "CANCELLED" } },
    { returnDocument: "after" }
  ).lean();
}

/**
 * HARD DELETE (Step 16): removes the requester's OPEN/DONOR_NOTIFIED request
 * from the database entirely — cancelled requests leave no document behind.
 *
 * The filter is status-guarded on purpose:
 * - a DONOR_FOUND request (a donor is on their way) can never be deleted
 *   through this path,
 * - a COMPLETED/CANCELLED request is untouched,
 * - a request that races from DONOR_NOTIFIED to DONOR_FOUND between the
 *   donor's tap and this delete simply does not match (deleteMany returns
 *   deletedCount: 0), so the donor's acceptance can never vanish.
 *
 * Returns the deleted document (via findOneAndDelete), or null when nothing
 * matched — callers use this to tell the user exactly what was removed.
 */
export async function deleteRequest(requestId, requesterId) {
  return BloodRequest.findOneAndDelete({
    _id: requestId,
    requesterId,
    status: { $in: ["OPEN", "DONOR_NOTIFIED"] },
  }).lean();
}

/** How many active (OPEN/DONOR_NOTIFIED/DONOR_FOUND) requests a requester has. */
export async function countActiveRequestsForRequester(requesterId) {
  return BloodRequest.countDocuments({
    requesterId,
    status: { $in: ACTIVE_STATUSES },
  });
}

/**
 * The requester's most recent active request, or null. Kept for flows that
 * need "the newest live request" (used by the /cancel fallback message).
 */
export async function getActiveRequestForRequester(requesterId) {
  return BloodRequest.findOne({
    requesterId,
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();
}

/** The requester's recent requests, newest first (capped for chat readability). */
export async function getRecentRequestsForRequester(requesterId, limit = 5) {
  return BloodRequest.find({ requesterId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
