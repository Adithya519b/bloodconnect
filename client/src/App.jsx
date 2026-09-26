import { useState } from "react";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import { getStoredAdminKey } from "./services/api.js";

export default function App() {
  // A stored key means the login already succeeded in this browser tab.
  const [loggedIn, setLoggedIn] = useState(Boolean(getStoredAdminKey()));

  return loggedIn ? (
    <Dashboard onLogout={() => setLoggedIn(false)} />
  ) : (
    <Login onLogin={() => setLoggedIn(true)} />
  );
}
