import mongoose from "mongoose";
import { BloodRequest } from "../models/BloodRequest.js";
import { toGeoJsonPoint } from "./donorService.js";

/** Statuses that still count as "active" for a requester. */
const ACTIVE_STATUSES = ["OPEN", "DONOR_NOTIFIED", "DONOR_FOUND"];

/**
 * Creates the BloodRequest document from validated wizard data.
 * The location is converted to GeoJSON exactly like donor locations.
 *
 * Guard: one requester may have only ONE active request at a time — it keeps
 * the /status and /cancel flows unambiguous for the prototype.
 *
 * Returns { request, created } where created=false when an active request
 * already exists (request is null in that case).
 */
export async function createBloodRequest(requestData) {
  const { requesterId, bloodGroup, unitsRequired, location, radiusKm } = requestData;

  const existingActive = await BloodRequest.findOne({
    requesterId,
    status: { $in: ACTIVE_STATUSES },
  }).lean();

  if (existingActive) {
    return { request: null, created: false, existingActive };
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
 * Cancels a request (Step 13). The status guard in the filter means a request
 * that was accepted, completed or already cancelled cannot be flipped — the
 * update simply matches nothing.
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
 * The requester's active request, or null. Used by /cancel to tell the user
 * exactly what is being withdrawn.
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
