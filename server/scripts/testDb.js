/**
 * Sample end-to-end test of the database layer (no Telegram needed).
 * Run:  npm run test:db
 *
 * What it does:
 * 1. Connects to MongoDB Atlas (using the DNS fallback from config/dns.js)
 * 2. Saves a SAMPLE donor with clearly fake test data
 * 3. Reads it back and checks every field
 * 4. Upserts twice to prove re-registering never duplicates documents
 * 5. Runs a real geospatial query ($geoNear) to prove the 2dsphere index works
 * 6. Deletes the sample donor so the database stays clean
 *
 * telegramId 999000111 is fake test data and is always removed at the end.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { usePublicDnsFallback } from "../config/dns.js";
import { User } from "../models/User.js";
import { BloodRequest } from "../models/BloodRequest.js";
import { toGeoJsonPoint, upsertDonor } from "../services/donorService.js";
import {
  acceptRequest,
  cancelRequest,
  createBloodRequest,
  getRequestById,
  recordDonorRejection,
} from "../services/requestService.js";
import { matchDonorsForRequest } from "../services/matchingService.js";
import {
  buildDonorAlertMessage,
  buildDonorAlertKeyboard,
  buildDonorFoundMessage,
} from "../services/notificationService.js";

dotenv.config({ quiet: true });

// Same startup order as server.js — the DNS fallback must be active
// BEFORE the connection attempt on networks with a broken local resolver.
usePublicDnsFallback();

const TEST_DONOR = {
  telegramId: 999000111,
  username: "sample_test_donor",
  name: "Sample Donor (TEST DATA)",
  bloodGroup: "O+",
  available: true,
  // Test coordinates (Bengaluru city centre) — fake data, deleted at the end.
  location: { latitude: 12.9716, longitude: 77.5946 },
};

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.log("FAIL  MONGODB_URI is not set in server/.env");
    process.exit(1);
  }

  // 1. Connect — the same thing server.js does at startup.
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  } catch (error) {
    console.log(`FAIL  Connection to Atlas — ${error.message}`);
    if (error.message.includes("bad auth")) {
      console.log("      -> Atlas rejected the username/password in MONGODB_URI.");
      console.log("         Atlas > Database Access > Edit user > Edit Password,");
      console.log("         pick a letters+numbers password, update server/.env, retry.");
    } else if (error.message.includes("querySrv")) {
      console.log("      -> DNS could not resolve the Atlas cluster (network/VPN issue).");
    }
    process.exit(1);
  }
  check(
    "Connection to Atlas",
    true,
    `host: ${mongoose.connection.host}, database: ${mongoose.connection.name}`
  );

  // Make sure the model's indexes exist before querying.
  await User.syncIndexes();
  check("Indexes built (2dsphere + bloodGroup/available)", true);

  // 2. Save the sample donor through the real service the bot uses.
  const saved = await upsertDonor(TEST_DONOR);
  check("Sample donor saved via upsertDonor()", saved.telegramId === TEST_DONOR.telegramId);

  // 3. Read it back and verify every field.
  const fetched = await User.findOne({ telegramId: TEST_DONOR.telegramId }).lean();
  check("Donor found in database", Boolean(fetched));
  check("Blood group stored correctly", fetched?.bloodGroup === "O+", `got: ${fetched?.bloodGroup}`);
  check("Location type is GeoJSON Point", fetched?.location?.type === "Point");

  const [lon, lat] = fetched?.location?.coordinates || [];
  check(
    "Coordinates stored as [longitude, latitude]",
    lon === TEST_DONOR.location.longitude && lat === TEST_DONOR.location.latitude,
    `got: [${lon}, ${lat}]`
  );
  check("Availability stored as true", fetched?.available === true);

  // 4. Upsert again with a changed blood group — must update, not duplicate.
  await upsertDonor({ ...TEST_DONOR, bloodGroup: "AB+" });
  const donorCount = await User.countDocuments({ telegramId: TEST_DONOR.telegramId });
  const updated = await User.findOne({ telegramId: TEST_DONOR.telegramId }).lean();
  check("Re-register updates instead of duplicating", donorCount === 1, `${donorCount} document(s)`);
  check("Changed blood group persisted", updated?.bloodGroup === "AB+", `got: ${updated?.bloodGroup}`);

  // 5. Geospatial query — this is exactly what the Step 9 matching engine will run.
  const nearby = await User.aggregate([
    {
      $geoNear: {
        near: toGeoJsonPoint(TEST_DONOR.location),
        distanceField: "distanceMetres",
        maxDistance: 5000,
        query: { available: true },
        spherical: true,
      },
    },
  ]);
  const testHit = nearby.find((d) => d.telegramId === TEST_DONOR.telegramId);
  check(
    "$geoNear finds the donor within 5 km",
    Boolean(testHit),
    testHit ? `distance: ${testHit.distanceMetres.toFixed(0)} m` : "not found"
  );

  // 6. BloodRequest storage (Step 8) — same service the bot uses.
  const REQUESTER_ID = 999000333;
  const { request, created } = await createBloodRequest({
    requesterId: REQUESTER_ID,
    bloodGroup: "O-",
    unitsRequired: 2,
    location: TEST_DONOR.location,
    radiusKm: 10,
  });
  check("Blood request created with status OPEN", created && request?.status === "OPEN");

  const fetchedRequest = await getRequestById(request._id);
  check("Blood request readable by id", fetchedRequest?.requesterId === REQUESTER_ID);
  const [reqLon, reqLat] = fetchedRequest?.location?.coordinates || [];
  check(
    "Request location stored as GeoJSON [lon, lat]",
    reqLon === TEST_DONOR.location.longitude && reqLat === TEST_DONOR.location.latitude,
    `got: [${reqLon}, ${reqLat}]`
  );

  const duplicateAttempt = await createBloodRequest({
    requesterId: REQUESTER_ID,
    bloodGroup: "A+",
    unitsRequired: 1,
    location: TEST_DONOR.location,
    radiusKm: 5,
  });
  check(
    "Second active request for same requester is blocked",
    duplicateAttempt.created === false && duplicateAttempt.request === null
  );

  // 7. Matching engine (Step 9) — plant donors at controlled distances and
  //    verify the engine keeps exactly the one valid donor. 1° latitude ≈ 111 km.
  const MATCH_TEST_DONORS = [
    { telegramId: 999000401, name: "Near O- (TEST)", bloodGroup: "O-", available: true, location: { latitude: 12.9806, longitude: 77.5946 } }, // ~1 km
    { telegramId: 999000402, name: "Far O- (TEST)", bloodGroup: "O-", available: true, location: { latitude: 13.1066, longitude: 77.5946 } }, // ~15 km, outside 10 km radius
    { telegramId: 999000403, name: "Unavailable O- (TEST)", bloodGroup: "O-", available: false, location: { latitude: 12.9726, longitude: 77.5946 } }, // ~110 m but unavailable
    { telegramId: 999000404, name: "Wrong group A+ (TEST)", bloodGroup: "A+", available: true, location: { latitude: 12.9721, longitude: 77.5946 } }, // ~55 m but wrong group
  ];
  for (const donor of MATCH_TEST_DONORS) {
    await upsertDonor({ username: "matching_test", ...donor });
  }

  const { donors: matched } = await matchDonorsForRequest(fetchedRequest);
  check(
    "Matching keeps only the 1 valid donor",
    matched.length === 1 && matched[0]?.telegramId === 999000401,
    `found: ${matched.map((d) => d.telegramId).join(", ") || "none"}`
  );
  check(
    "Matched donor distance ≈ 1 km",
    Math.abs((matched[0]?.distanceKm ?? -1) - 1.0) < 0.3,
    `got: ${matched[0]?.distanceKm} km`
  );

  const storedAfterMatch = await getRequestById(request._id);
  check(
    "matchedDonors saved on the request",
    storedAfterMatch.matchedDonors.length === 1 && storedAfterMatch.matchedDonors[0] === 999000401,
    `got: [${storedAfterMatch.matchedDonors.join(", ")}]`
  );
  check(
    "Status flipped OPEN -> DONOR_NOTIFIED",
    storedAfterMatch.status === "DONOR_NOTIFIED",
    `got: ${storedAfterMatch.status}`
  );

  // 8. Notification message builders (Step 10) — pure functions, nothing is sent.
  const alertText = buildDonorAlertMessage(fetchedRequest, matched[0]);
  check(
    "Donor alert lists group, units and distance",
    alertText.includes("Blood Group: O-") &&
      alertText.includes("Units Required: 2") &&
      alertText.includes("1 KM")
  );

  const alertKeyboard = buildDonorAlertKeyboard(request._id);
  const [yesButton, noButton] = alertKeyboard.inline_keyboard[0];
  check(
    "Alert buttons carry respond codes with request id",
    yesButton.callback_data === `respond:yes:${request._id}` &&
      noButton.callback_data === `respond:no:${request._id}`
  );

  const foundText = buildDonorFoundMessage(fetchedRequest, { username: "sample_test_donor" });
  check(
    "Donor-found message shares username + request id",
    foundText.includes("@sample_test_donor") && foundText.includes(String(request._id))
  );

  // 9. Atomic acceptance (Step 11) — two donors tap "I CAN DONATE" simultaneously.
  //    Promise.all fires both acceptRequest calls at the same instant; exactly one may win.
  const DONOR_A = 999000501;
  const DONOR_B = 999000502;

  // Reset the request to a claimable state and store the two racers on matchedDonors.
  await BloodRequest.updateOne(
    { _id: request._id },
    {
      $set: {
        status: "DONOR_NOTIFIED",
        acceptedDonor: null,
        rejectedDonors: [],
        matchedDonors: [DONOR_A, DONOR_B],
      },
    }
  );

  const [claimA, claimB] = await Promise.all([
    acceptRequest(request._id, DONOR_A),
    acceptRequest(request._id, DONOR_B),
  ]);
  check(
    "Simultaneous acceptances: exactly one wins",
    (claimA === null) !== (claimB === null),
    `winner: ${claimA ? "A" : claimB ? "B" : "none"}`
  );

  const winner = claimA || claimB;
  check(
    "Winner recorded with DONOR_FOUND status",
    winner?.status === "DONOR_FOUND" && winner?.acceptedDonor != null
  );

  const lateClaim = await acceptRequest(request._id, DONOR_A === winner.acceptedDonor ? DONOR_B : DONOR_A);
  check(
    "Late acceptor is rejected",
    lateClaim === null,
    lateClaim ? "second update unexpectedly matched" : "correctly null"
  );

  // Self-acceptance must be impossible even via a direct service call.
  await BloodRequest.updateOne(
    { _id: request._id },
    { $set: { status: "DONOR_NOTIFIED", acceptedDonor: null } }
  );
  const selfClaim = await acceptRequest(request._id, REQUESTER_ID);
  check("Requester cannot accept own request", selfClaim === null);

  // Cancelled requests are not claimable either.
  await BloodRequest.updateOne(
    { _id: request._id },
    { $set: { status: "CANCELLED", acceptedDonor: null } }
  );
  const cancelledClaim = await acceptRequest(request._id, DONOR_A);
  check("Cancelled request cannot be accepted", cancelledClaim === null);

  const rej = await recordDonorRejection(request._id, DONOR_B);
  check("Rejection recorded once", rej.modifiedCount === 1);
  await recordDonorRejection(request._id, DONOR_B);
  const storedRequest = await getRequestById(request._id);
  check(
    "Duplicate rejection does not duplicate the entry",
    storedRequest.rejectedDonors.filter((id) => id === DONOR_B).length === 1,
    `rejectedDonors: [${storedRequest.rejectedDonors.join(", ")}]`
  );

  // 10. Cancellation flow (Step 13) — status-guarded withdraw.
  const secondRequest = await createBloodRequest({
    requesterId: REQUESTER_ID,
    bloodGroup: "B+",
    unitsRequired: 1,
    location: TEST_DONOR.location,
    radiusKm: 5,
  });
  check(
    "New request creatable after previous was cancelled",
    secondRequest.created,
    secondRequest.created ? "" : "active-request guard did not clear"
  );

  const cancelledOnce = await cancelRequest(secondRequest.request._id, REQUESTER_ID);
  check("cancelRequest flips OPEN -> CANCELLED", cancelledOnce?.status === "CANCELLED");

  const cancelledTwice = await cancelRequest(secondRequest.request._id, REQUESTER_ID);
  check("Double-cancel is a no-op (null)", cancelledTwice === null);

  // 11. Cleanup — remove ALL test documents (deleteMany also cleans up
  // leftovers if a previous run crashed before its own cleanup).
  await User.deleteOne({ telegramId: TEST_DONOR.telegramId });
  await BloodRequest.deleteMany({ requesterId: REQUESTER_ID });
  await User.deleteMany({ telegramId: { $in: [...MATCH_TEST_DONORS.map((d) => d.telegramId), DONOR_A, DONOR_B] } });
  const remainingUsers = await User.countDocuments({
    telegramId: { $in: [TEST_DONOR.telegramId, ...MATCH_TEST_DONORS.map((d) => d.telegramId), DONOR_A, DONOR_B] },
  });
  const remainingRequests = await BloodRequest.countDocuments({ requesterId: REQUESTER_ID });
  check(
    "All test documents deleted (database clean)",
    remainingUsers === 0 && remainingRequests === 0,
    `${remainingUsers} user(s), ${remainingRequests} request(s) left`
  );

  await mongoose.disconnect();

  console.log("");
  if (failures === 0) {
    console.log("✅ ALL CHECKS PASSED — the database layer works end to end.");
    process.exit(0);
  } else {
    console.log(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error.message);
  process.exit(1);
});
