import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { connectDB, disconnectDB } from "./config/db.js";
import { usePublicDnsFallback } from "./config/dns.js";
import { startBot, stopBot } from "./bot/bot.js";
import adminRoutes from "./routes/adminRoutes.js";

// Reads the .env file and puts every value into process.env.
dotenv.config({ quiet: true });

// Some campus/VPN networks break the SRV lookup that Atlas needs — route this
// process's DNS through public resolvers (see config/dns.js). Must run before connectDB().
usePublicDnsFallback();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS lets the future React dashboard (running on another port) call this API.
app.use(cors());

// Lets the backend accept JSON bodies such as { "name": "Asha" } in POST requests.
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BloodConnect server is running",
  });
});

// Admin dashboard API (Step 15) — prototype-only x-admin-key auth.
app.use("/api/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((error, req, res, next) => {
  console.error(`[server] ${error.message}`);
  res.status(500).json({ success: false, message: "Internal server error" });
});

const server = app.listen(PORT, async () => {
  console.log(`[server] BloodConnect API running on http://localhost:${PORT}`);
  await connectDB();
  startBot();
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[server] Port ${PORT} is already in use. Stop the other process or change PORT in server/.env`
    );
    process.exit(1);
  }
  throw error;
});

async function shutdown() {
  console.log("\n[server] Shutting down...");
  stopBot();
  server.close();
  await disconnectDB();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
