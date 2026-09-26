import { useCallback, useEffect, useState } from "react";
import { fetchStats, fetchRequests, fetchDonors, setAdminKey } from "../services/api.js";
import StatCard from "../components/StatCard.jsx";
import RequestsTable from "../components/RequestsTable.jsx";

/**
 * The admin dashboard: five counters, the recent-requests table and the
 * donor list. Data refreshes every 15 seconds while the tab is visible.
 */
export default function Dashboard({ onLogout }) {
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [donors, setDonors] = useState([]);
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [statsData, requestsData, donorsData] = await Promise.all([
        fetchStats(),
        fetchRequests(10),
        fetchDonors(),
      ]);
      setStats(statsData);
      setRequests(requestsData);
      setDonors(donorsData);
      setError("");
    } catch (error) {
      if (error.response?.status === 401) {
        // Key stopped working (changed or cleared on the server).
        setAdminKey(null);
        onLogout();
        return;
      }
      setError("Could not load dashboard data. Is the backend running?");
    }
  }, [onLogout]);

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 15000);
    return () => clearInterval(timer);
  }, [loadAll]);

  function handleLogout() {
    setAdminKey(null);
    onLogout();
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🩸 BloodConnect Admin</h1>
        <button className="ghost" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {stats && (
        <section className="stat-grid">
          <StatCard label="Total donors" value={stats.totalDonors} />
          <StatCard label="Available donors" value={stats.availableDonors} tone="ok" />
          <StatCard label="Active requests" value={stats.activeRequests} tone="warn" />
          <StatCard label="Donor found count" value={stats.donorFoundCount} tone="ok" />
          <StatCard label="Completed requests" value={stats.completedRequests} />
        </section>
      )}

      <section className="panel">
        <h2>Recent requests</h2>
        <RequestsTable requests={requests} />
      </section>

      <section className="panel">
        <h2>Registered donors (latest 50)</h2>
        {donors.length === 0 ? (
          <p className="muted">No donors registered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Blood</th>
                <th>Availability</th>
                <th>Username</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {donors.map((donor) => (
                <tr key={donor._id}>
                  <td>{donor.name}</td>
                  <td>{donor.bloodGroup}</td>
                  <td>{donor.available ? "🟢 Available" : "🔴 Not Available"}</td>
                  <td>{donor.username ? `@${donor.username}` : "—"}</td>
                  <td>{new Date(donor.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="muted disclaimer">
        ⚠️ Prototype dashboard. Donor eligibility and medical suitability must be verified by
        qualified medical professionals or blood banks.
      </p>
    </div>
  );
}
