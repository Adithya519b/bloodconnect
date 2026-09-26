import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The proxy forwards /api calls to the Express server so there are no
// CORS headaches during development: the dashboard calls /api/... on its
// own origin (5173) and Vite relays it to the backend on 5000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
});
