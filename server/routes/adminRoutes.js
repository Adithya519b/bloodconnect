import { Router } from "express";
import { requireAdminKey, getStats, getRequests, getDonors } from "../controllers/adminController.js";

const router = Router();

// Everything behind the prototype-only key check (see controller).
router.use(requireAdminKey);

router.get("/stats", getStats);
router.get("/requests", getRequests);
router.get("/donors", getDonors);

export default router;
