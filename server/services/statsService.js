import { User } from "../models/User.js";
import { BloodRequest } from "../models/BloodRequest.js";

/**
 * The numbers for the admin dashboard (Step 15).
 * Four counting queries + one recent-requests fetch — cheap on Atlas free tier.
 */
export async function getDashboardStats() {
  const [totalDonors, availableDonors, activeRequests, donorFoundCount, completedRequests] =
    await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ available: true }),
      BloodRequest.countDocuments({ status: { $in: ["OPEN", "DONOR_NOTIFIED", "DONOR_FOUND"] } }),
      BloodRequest.countDocuments({ status: { $in: ["DONOR_FOUND", "COMPLETED"] } }),
      BloodRequest.countDocuments({ status: "COMPLETED" }),
    ]);

  return { totalDonors, availableDonors, activeRequests, donorFoundCount, completedRequests };
}

/** The dashboard's recent-requests table rows. */
export async function getRecentRequests(limit = 10) {
  return BloodRequest.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select(
      "bloodGroup unitsRequired radiusKm status requesterId acceptedDonor matchedDonors createdAt updatedAt"
    )
    .lean();
}
