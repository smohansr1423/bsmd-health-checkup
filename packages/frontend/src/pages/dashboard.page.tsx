import React, { useState } from 'react';

const API = 'http://localhost:3000';
const HEADERS = { Authorization: 'Bearer dev-token-123', 'Content-Type': 'application/json' };

export default function DashboardPage() {
  const [seniorId, setSeniorId] = useState('');
  const [followUp, setFollowUp] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    if (!seniorId.trim()) { setError('Please enter a Senior ID'); return; }
    setLoading(true); setError(''); setFollowUp(null); setAnalytics(null);
    try {
      const [fuRes, anRes] = await Promise.all([
        fetch(`${API}/api/follow-up/dashboard/${seniorId}`, { headers: HEADERS }),
        fetch(`${API}/api/analytics/patients/${seniorId}/summary`, { headers: HEADERS }),
      ]);
      const fuData = await fuRes.json();
      const anData = await anRes.json();
      if (fuRes.ok) setFollowUp(fuData.data);
      if (anRes.ok) setAnalytics(anData.data);
      if (!fuRes.ok && !anRes.ok) setError('No data found for this senior ID');
    } catch (err: any) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div>
      <h1>Senior Dashboard</h1>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input
          placeholder="Enter Senior ID (e.g. HP_xxx)"
          value={seniorId}
          onChange={(e) => setSeniorId(e.target.value)}
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px' }}
        />
        <button onClick={loadData} disabled={loading} style={btnStyle}>
          {loading ? 'Loading...' : 'Load Dashboard'}
        </button>
      </div>

      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      {followUp && (
        <div style={{ marginBottom: '24px' }}>
          <h2>Follow-Up Actions</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
            <StatCard label="Pending" value={followUp.summary?.pending || 0} color="#f39c12" />
            <StatCard label="Completed" value={followUp.summary?.completed || 0} color="#27ae60" />
            <StatCard label="Overdue" value={followUp.summary?.overdue || 0} color="#e74c3c" />
            <StatCard label="Total" value={followUp.summary?.total || 0} color="#2c3e50" />
          </div>
          {followUp.actions && followUp.actions.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Due Date</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {followUp.actions.map((a: any, i: number) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{a.description}</td>
                    <td style={tdStyle}>{a.actionType}</td>
                    <td style={tdStyle}>{new Date(a.dueDate).toLocaleDateString()}</td>
                    <td style={tdStyle}><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={{ color: '#888' }}>No follow-up actions assigned yet.</p>}
        </div>
      )}

      {analytics && (
        <div>
          <h2>Health Analytics</h2>
          {analytics.insufficientData ? (
            <p style={{ color: '#888' }}>Insufficient data — need at least 2 checkups for analytics.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              <StatCard label="Health Score" value={analytics.healthScore || 'N/A'} color="#1a5276" />
              <StatCard label="Change" value={analytics.pointChange || 0} color={analytics.pointChange >= 0 ? '#27ae60' : '#e74c3c'} />
              <StatCard label="Critical Params" value={analytics.criticalCount || 0} color="#e74c3c" />
            </div>
          )}
        </div>
      )}

      {!followUp && !analytics && !loading && !error && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#888', background: '#f8f9fa', borderRadius: '8px' }}>
          <p>Enter a Senior ID and click "Load Dashboard" to view follow-up actions and health analytics.</p>
          <p style={{ fontSize: '13px' }}>Tip: Register a senior first at <a href="/registration">/registration</a> to get an ID.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid #e0e0e0', textAlign: 'center' }}>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color }}>{value}</div>
      <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { pending: '#f39c12', completed: '#27ae60', overdue: '#e74c3c', expired: '#95a5a6' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: colors[status] || '#bbb', color: 'white' }}>
      {status}
    </span>
  );
}

const btnStyle: React.CSSProperties = { padding: '10px 20px', background: '#1a5276', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' };
const thStyle: React.CSSProperties = { padding: '10px', textAlign: 'left', borderBottom: '2px solid #ddd' };
const tdStyle: React.CSSProperties = { padding: '10px' };
