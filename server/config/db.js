import mongoose from "mongoose";

/**
 * Connects Node.js to MongoDB (Atlas).
 * Called once when the server starts.
 */
export async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn(
      "[db] MONGODB_URI is not set - skipping database connection. Add it to server/.env"
    );
    return null;
  }

  try {
    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`[db] MongoDB connected -> ${connection.connection.host}`);
    return connection;
  } catch (error) {
    console.error(`[db] MongoDB connection failed: ${error.message}`);
    return null;
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("[db] MongoDB disconnected");
  }
}
