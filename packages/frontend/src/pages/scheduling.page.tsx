import React, { useEffect, useState } from 'react';

const API = 'http://localhost:3000';
const HEADERS = { Authorization: 'Bearer dev-token-123', 'Content-Type': 'application/json' };

export default function SchedulingPage() {
  const [slots, setSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSlots();
  }, []);

  const loadSlots = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/scheduling/slots`, { headers: HEADERS });
      const data = await res.json();
      setSlots(data.data || []);
    } catch (err: any) { setMessage('Failed to load: ' + err.message); }
    setLoading(false);
  };

  return (
    <div>
      <h1>Appointment Scheduling</h1>
      <p style={{ color: '#666' }}>View available appointment slots for the next 30 days.</p>

      <button onClick={loadSlots} style={btnStyle}>Refresh Slots</button>
      {message && <p style={{ color: '#c0392b', marginTop: '8px' }}>{message}</p>}

      <div style={{ marginTop: '24px' }}>
        {loading ? <p>Loading available slots...</p> : (
          slots.length === 0 ? (
            <div style={{ padding: '24px', background: '#fef9e7', borderRadius: '8px', border: '1px solid #f9e79f' }}>
              <h3 style={{ margin: '0 0 8px 0' }}>No Available Slots</h3>
              <p style={{ margin: 0, color: '#666' }}>
                No appointment slots have been configured yet. In a production system, physicians would set their availability.
                You can test the scheduling API by creating slots via the API directly.
              </p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Time</th>
                  <th style={thStyle}>Physician</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{new Date(slot.startTime).toLocaleDateString()}</td>
                    <td style={tdStyle}>{new Date(slot.startTime).toLocaleTimeString()}</td>
                    <td style={tdStyle}>{slot.physicianId}</td>
                    <td style={tdStyle}><button style={{ ...btnStyle, padding: '4px 12px', fontSize: '12px' }}>Book</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: '10px 20px', background: '#1a5276', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' };
const thStyle: React.CSSProperties = { padding: '10px', textAlign: 'left', borderBottom: '2px solid #ddd' };
const tdStyle: React.CSSProperties = { padding: '10px' };
