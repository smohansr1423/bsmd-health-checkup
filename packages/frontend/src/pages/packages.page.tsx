import React, { useEffect, useState } from 'react';

const API = 'http://localhost:3000';
const HEADERS = { Authorization: 'Bearer dev-token-123', 'Content-Type': 'application/json' };

export default function PackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const loadPackages = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/checkup-packages`, { headers: HEADERS });
      const data = await res.json();
      setPackages(data.data || []);
    } catch (err: any) { setMessage('Failed to load packages: ' + err.message); }
    setLoading(false);
  };

  const seedPackages = async () => {
    setMessage('Seeding...');
    try {
      const res = await fetch(`${API}/api/checkup-packages/seed`, { method: 'POST', headers: HEADERS });
      const data = await res.json();
      if (res.ok) { setMessage(`✅ Seeded ${data.data.length} packages`); loadPackages(); }
      else { setMessage('❌ ' + (data.error?.message || 'Seed failed')); }
    } catch (err: any) { setMessage('❌ ' + err.message); }
  };

  useEffect(() => { loadPackages(); }, []);

  return (
    <div>
      <h1>Health Checkup Packages</h1>
      <button onClick={seedPackages} style={btnStyle}>Seed Predefined Packages</button>
      <button onClick={loadPackages} style={{ ...btnStyle, background: '#6c757d', marginLeft: '8px' }}>Refresh</button>
      {message && <p style={{ marginTop: '12px', color: message.startsWith('✅') ? '#1a7a5c' : '#c0392b' }}>{message}</p>}

      {loading ? <p>Loading...</p> : (
        <div style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          {packages.length === 0 && <p>No packages yet. Click "Seed Predefined Packages" to create Basic, Standard, and Comprehensive packages.</p>}
          {packages.map((pkg) => (
            <div key={pkg.id} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0' }}>{pkg.name}</h3>
              <span style={{ display: 'inline-block', padding: '2px 8px', background: tierColor(pkg.tier), color: 'white', borderRadius: '4px', fontSize: '12px', marginBottom: '12px' }}>
                {pkg.tier}
              </span>
              <p style={{ margin: '8px 0', fontSize: '14px' }}><strong>Tests:</strong> {pkg.tests?.length || 0}</p>
              <p style={{ margin: '8px 0', fontSize: '14px' }}><strong>Total Cost:</strong> ₹{pkg.totalCost?.toLocaleString()}</p>
              <p style={{ margin: '8px 0', fontSize: '12px', color: '#888' }}>ID: {pkg.id}</p>
              {pkg.tests && pkg.tests.length > 0 && (
                <details style={{ marginTop: '8px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#555' }}>View tests ({pkg.tests.length})</summary>
                  <ul style={{ fontSize: '12px', paddingLeft: '20px', marginTop: '8px' }}>
                    {pkg.tests.map((t: any, i: number) => (
                      <li key={i}>{t.testType} — ₹{t.cost}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function tierColor(tier: string) {
  switch (tier) {
    case 'Basic': return '#27ae60';
    case 'Standard': return '#2980b9';
    case 'Comprehensive': return '#8e44ad';
    default: return '#7f8c8d';
  }
}

const btnStyle: React.CSSProperties = { padding: '10px 20px', background: '#1a5276', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' };
