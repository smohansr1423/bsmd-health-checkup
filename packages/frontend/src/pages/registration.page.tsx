import React, { useState } from 'react';

const API = 'http://localhost:3000';
const HEADERS = { Authorization: 'Bearer dev-token-123', 'Content-Type': 'application/json' };

export default function RegistrationPage() {
  const [form, setForm] = useState({
    fullName: '', dateOfBirth: '', gender: 'male', phoneNumber: '',
    street: '', city: '', state: '', postalCode: '', country: 'India',
    emergencyName: '', emergencyRelation: '', emergencyPhone: '',
    preferredLanguage: 'en',
  });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(''); setResult(null);
    try {
      const body = {
        fullName: form.fullName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        address: { street: form.street, city: form.city, state: form.state, postalCode: form.postalCode, country: form.country },
        phoneNumber: form.phoneNumber,
        medicalHistory: [],
        currentMedications: [],
        allergies: [],
        emergencyContacts: [{ name: form.emergencyName, relationship: form.emergencyRelation, phoneNumber: form.emergencyPhone }],
        preferredLanguage: form.preferredLanguage,
        accessibilityPreferences: { textSize: 'normal', contrastMode: 'default', voiceAssistance: false, simplifiedNavigation: false },
      };
      const res = await fetch(`${API}/api/registration`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message || 'Registration failed'); }
      else { setResult(data.data); }
    } catch (err: any) { setError(err.message); }
    setLoading(false);
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [field]: e.target.value });

  return (
    <div>
      <h1>Senior Citizen Registration</h1>
      <form onSubmit={handleSubmit} style={{ maxWidth: '600px' }}>
        <Section title="Personal Information">
          <Field label="Full Name" value={form.fullName} onChange={set('fullName')} required />
          <Field label="Date of Birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} required />
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Gender</label>
            <select value={form.gender} onChange={set('gender')} style={inputStyle}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Field label="Phone Number" value={form.phoneNumber} onChange={set('phoneNumber')} placeholder="+91-9876543210" required />
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Preferred Language</label>
            <select value={form.preferredLanguage} onChange={set('preferredLanguage')} style={inputStyle}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="es">Spanish</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
            </select>
          </div>
        </Section>

        <Section title="Address">
          <Field label="Street" value={form.street} onChange={set('street')} required />
          <Field label="City" value={form.city} onChange={set('city')} required />
          <Field label="State" value={form.state} onChange={set('state')} required />
          <Field label="Postal Code" value={form.postalCode} onChange={set('postalCode')} required />
          <Field label="Country" value={form.country} onChange={set('country')} required />
        </Section>

        <Section title="Emergency Contact">
          <Field label="Name" value={form.emergencyName} onChange={set('emergencyName')} required />
          <Field label="Relationship" value={form.emergencyRelation} onChange={set('emergencyRelation')} placeholder="daughter, son, spouse" required />
          <Field label="Phone" value={form.emergencyPhone} onChange={set('emergencyPhone')} required />
        </Section>

        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? 'Registering...' : 'Register Senior Citizen'}
        </button>
      </form>

      {error && <div style={{ marginTop: '16px', padding: '12px', background: '#fde8e8', borderRadius: '6px', color: '#c0392b' }}>{error}</div>}
      {result && (
        <div style={{ marginTop: '16px', padding: '16px', background: '#e8f8f5', borderRadius: '6px' }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#1a7a5c' }}>✅ Registration Successful</h3>
          <p><strong>ID:</strong> {result.id}</p>
          <p><strong>Name:</strong> {result.fullName}</p>
          <p><strong>Created:</strong> {new Date(result.createdAt).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
      <legend style={{ fontWeight: 'bold', padding: '0 8px' }}>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, ...props }: { label: string; [key: string]: any }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{label}</label>
      <input style={inputStyle} {...props} />
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { padding: '12px 24px', background: '#1a5276', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', cursor: 'pointer' };
