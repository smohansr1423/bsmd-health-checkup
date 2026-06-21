import React, { useEffect, useState } from 'react';

export default function HomePage() {
  const [healthStatus, setHealthStatus] = useState<string>('Checking...');

  useEffect(() => {
    fetch('http://localhost:3000/health')
      .then((r) => r.json())
      .then((data) => setHealthStatus(`✅ API is ${data.status} (${data.timestamp})`))
      .catch(() => setHealthStatus('❌ API not reachable — make sure the gateway is running on port 3000'));
  }, []);

  return (
    <div>
      <h1>Senior Citizen Health Checkup System</h1>
      <p style={{ color: '#666', fontSize: '16px' }}>
        Comprehensive healthcare management for senior citizens aged 60+
      </p>

      <div style={{ background: '#f0f8ff', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
        <strong>API Status:</strong> {healthStatus}
      </div>

      <h2>Quick Actions</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
        <Card title="📋 Registration" href="/registration" description="Register a new senior citizen with complete health profile" />
        <Card title="📦 Packages" href="/packages" description="View and manage health checkup packages" />
        <Card title="📅 Scheduling" href="/scheduling" description="Book appointments and manage time slots" />
        <Card title="📊 Dashboard" href="/dashboard" description="View follow-up actions and analytics" />
      </div>
    </div>
  );
}

function Card({ title, href, description }: { title: string; href: string; description: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'block',
        padding: '20px',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'box-shadow 0.2s',
      }}
    >
      <h3 style={{ margin: '0 0 8px 0' }}>{title}</h3>
      <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>{description}</p>
    </a>
  );
}
