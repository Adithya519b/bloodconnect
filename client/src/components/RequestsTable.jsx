const STATUS_LABELS = {
  OPEN: "🟠 OPEN",
  DONOR_NOTIFIED: "📨 DONOR NOTIFIED",
  DONOR_FOUND: "🎉 DONOR FOUND",
  COMPLETED: "✅ COMPLETED",
  CANCELLED: "❌ CANCELLED",
};

/** The recent-requests table (plain table, simple CSS only). */
export default function RequestsTable({ requests }) {
  if (!requests.length) {
    return <p className="muted">No blood requests yet.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Blood</th>
          <th>Units</th>
          <th>Radius</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request._id}>
            <td>{request.bloodGroup}</td>
            <td>{request.unitsRequired}</td>
            <td>{request.radiusKm} km</td>
            <td>{STATUS_LABELS[request.status] || request.status}</td>
            <td>{new Date(request.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
