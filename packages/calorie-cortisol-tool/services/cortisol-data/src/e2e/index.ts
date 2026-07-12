/**
 * End-to-end cortisol flow wiring (Task 18.2).
 *
 * Composition seat that connects lab-kit ordering/QR linkage (9.1), lab-result
 * webhook ingestion (9.4), wearable/patch sync (9.7), questionnaire scoring
 * (9.11), and CAR/diurnal tracking (9.15) with TimescaleDB persistence,
 * Notification-Service events (13.1), and dashboard/insights refreshes
 * (11.x, 17.2), realizing design Flow 2 (Lab Kit → Cortisol Result) and Flow 3
 * (Wearable → Cortisol Proxy).
 *
 * Requirements: 8.1, 8.4, 9.1, 10.1, 11.1
 */
export * from './ports';
export * from './cortisol-flows';
