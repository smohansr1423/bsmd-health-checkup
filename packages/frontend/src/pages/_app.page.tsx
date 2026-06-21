import type { AppProps } from 'next/app';
import React from 'react';

const API_BASE = 'http://localhost:3000';
const AUTH_HEADER = { Authorization: 'Bearer dev-token-123', 'Content-Type': 'application/json' };

// Make API config available globally
if (typeof window !== 'undefined') {
  (window as any).__API_BASE = API_BASE;
  (window as any).__AUTH_HEADER = AUTH_HEADER;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: 0 }}>
      <nav style={{ background: '#1a5276', padding: '12px 24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <a href="/" style={{ color: 'white', textDecoration: 'none', fontWeight: 'bold', fontSize: '18px' }}>
          🏥 Senior Health Checkup
        </a>
        <a href="/registration" style={{ color: '#d4efdf', textDecoration: 'none' }}>Registration</a>
        <a href="/packages" style={{ color: '#d4efdf', textDecoration: 'none' }}>Packages</a>
        <a href="/scheduling" style={{ color: '#d4efdf', textDecoration: 'none' }}>Scheduling</a>
        <a href="/dashboard" style={{ color: '#d4efdf', textDecoration: 'none' }}>Dashboard</a>
      </nav>
      <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <Component {...pageProps} />
      </main>
    </div>
  );
}
