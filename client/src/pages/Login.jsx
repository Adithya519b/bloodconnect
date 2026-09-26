import { useState } from "react";
import { verifyKey, setAdminKey } from "../services/api.js";

/**
 * Login screen. ⚠️ Prototype-only auth: a shared admin key, not real security.
 */
export default function Login({ onLogin }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setChecking(true);
    setError("");

    try {
      const ok = await verifyKey(key);
      if (ok) {
        setAdminKey(key);
        onLogin();
      } else {
        setError("Invalid admin key.");
      }
    } catch {
      setError("Server not reachable or key rejected. Is the backend running?");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>🩸 BloodConnect Admin</h1>
        <p className="muted">Prototype dashboard — enter the admin key from server/.env</p>
        <input
          type="password"
          placeholder="Admin key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={checking || !key}>
          {checking ? "Checking..." : "Open dashboard"}
        </button>
      </form>
    </div>
  );
}
