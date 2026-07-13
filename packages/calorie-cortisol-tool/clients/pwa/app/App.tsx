import { useState } from 'react';
import { api } from './api';

type Json = Record<string, unknown>;

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: '1px solid #d0d7de',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        background: '#fff',
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 18 }}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function Output({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre
      style={{
        background: '#f6f8fa',
        padding: 12,
        borderRadius: 6,
        overflowX: 'auto',
        fontSize: 12,
        marginTop: 12,
      }}
    >
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function App() {
  const [health, setHealth] = useState<unknown>(null);
  const [tier, setTier] = useState<unknown>(null);
  const [nutrition, setNutrition] = useState<unknown>(null);
  const [guidance, setGuidance] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      // Surface network errors in the relevant panel.
      const msg = { error: (e as Error).message };
      if (key === 'health') setHealth(msg);
      if (key === 'tier') setTier(msg);
      if (key === 'nutrition') setNutrition(msg);
      if (key === 'guidance') setGuidance(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        color: '#1f2328',
      }}
    >
      <h1 style={{ fontSize: 24 }}>Calorie &amp; Cortisol — Live Stack Demo</h1>
      <p style={{ color: '#57606a' }}>
        Each panel calls a real backend endpoint through the API gateway
        (in-memory dev mode).
      </p>

      <Panel title="1 · Gateway health">
        <button
          disabled={busy !== null}
          onClick={() =>
            run('health', async () => {
              const { data } = await api.get<Json>('/health');
              setHealth(data);
            })
          }
        >
          Check gateway /health
        </button>
        <Output value={health} />
      </Panel>

      <Panel title="2 · Stress questionnaire (cortisol-data)">
        <p style={{ color: '#57606a', fontSize: 13 }}>
          Submits a sample PSS-10 questionnaire and shows the mapped burden tier.
        </p>
        <button
          disabled={busy !== null}
          onClick={() =>
            run('tier', async () => {
              const { data } = await api.post<Json>('/questionnaire', {
                type: 'PSS-10',
                answers: [2, 3, 1, 2, 2, 3, 1, 2, 2, 3],
              });
              setTier(data);
            })
          }
        >
          Submit questionnaire
        </button>
        <Output value={tier} />
      </Panel>

      <Panel title="3 · Nutrition calculation (nutrition-lookup)">
        <p style={{ color: '#57606a', fontSize: 13 }}>
          Calculates nutrition for a plate of rice + chicken + broccoli.
        </p>
        <button
          disabled={busy !== null}
          onClick={() =>
            run('nutrition', async () => {
              const { data } = await api.post<Json>('/nutrition', {
                items: [
                  { food_class: 'rice_cooked', volume_ml: 200 },
                  { food_class: 'chicken_breast', volume_ml: 150 },
                  { food_class: 'broccoli', volume_ml: 120 },
                ],
              });
              setNutrition(data);
            })
          }
        >
          Calculate nutrition
        </button>
        <Output value={nutrition} />
      </Panel>

      <Panel title="4 · Cortisol guidance (insights-ml)">
        <p style={{ color: '#57606a', fontSize: 13 }}>
          Requests guidance for a sparse reading set (expect a
          &ldquo;more readings required&rdquo; readiness gate).
        </p>
        <button
          disabled={busy !== null}
          onClick={() =>
            run('guidance', async () => {
              const { data } = await api.post<Json>('/guidance', {
                user_id: 'dev-user',
                readings: [
                  {
                    id: 'r1',
                    user_id: 'dev-user',
                    measured_at: '2024-01-01T07:00:00Z',
                    value_nmol_l: 18,
                    classification: 'above',
                    ref_lower: 5,
                    ref_upper: 15,
                  },
                ],
                referral_threshold_nmol_l: 15,
              });
              setGuidance(data);
            })
          }
        >
          Request guidance
        </button>
        <Output value={guidance} />
      </Panel>
    </main>
  );
}
