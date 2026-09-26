import { getDashboardStats, getRecentRequests } from "../services/statsService.js";
import { User } from "../models/User.js";

/**
 * Admin dashboard API (Step 15).
 *
 * ⚠️ PROTOTYPE-ONLY AUTH (spec §23): a single shared key in the
 * `x-admin-key` header. This is NOT production security — it just stops the
 * dashboard numbers being publicly browsable during a demo.
 */
export function requireAdminKey(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  const provided = req.header("x-admin-key");

  // No key configured = endpoints stay open (local dev convenience).
  if (!adminKey || provided === adminKey) {
    next();
    return;
  }

  res.status(401).json({ success: false, message: "Invalid admin key" });
}

export async function getStats(req, res, next) {
  try {
    const stats = await getDashboardStats();
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
}

export async function getRequests(req, res, next) {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 10, 50);
    const requests = await getRecentRequests(limit);
    res.json({ success: true, requests });
  } catch (error) {
    next(error);
  }
}

export async function getDonors(req, res, next) {
  try {
    const donors = await User.find({})
      .sort({ updatedAt: -1 })
      .limit(50)
      .select("telegramId username name bloodGroup available createdAt updatedAt")
      .lean();
    res.json({ success: true, donors });
  } catch (error) {
    next(error);
  }
}
