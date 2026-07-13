/**
 * @calorie-cortisol/client-shared
 *
 * Scaffolding placeholder. Camera capture handling, meal correction, history
 * aggregation, offline inference, the Data Vault, and the consent-aware sync
 * engine are implemented in later tasks.
 */
export const PACKAGE_NAME = '@calorie-cortisol/client-shared';

// On-device Data Vault storage layer (Task 2.4): encrypted, local-first record
// store with `put/get/list/delete`, sync-status fields, and a 50 MB free-space
// precheck (Req 17.1, 27.1, 27.3).
export * from './data-vault';

// Camera_Capture media handling (Task 14.1): single/multi-angle (3 shots at
// 0/45/90° ±10°) capture with partial-session discard, gallery format/size
// (≤20 MB) acceptance, ≤60s video sharpest-frame extraction, <50 lux
// enhancement, and failed/timed-out recognition retaining the input for retry.
// Device/camera/recognition effects are behind injectable ports so the logic is
// pure and testable (Req 1.1–1.9, 21.6).
export * from './capture';

// Food-photo → calorie-estimate end-to-end flow (Task 18.1): the
// `FoodCalorieFlow` orchestrator wires Camera_Capture → gateway-routed Food
// Vision recognize/portion → Nutrition Lookup → local Data Vault + consent-
// aware sync + async insights enqueue, all behind injectable ports and honoring
// the 10s analysis timeout guard. It reimplements none of the recognition/
// portion/nutrition logic; it composes those services through their ports
// (Req 1.1, 2.6, 3.1, 4.1, 21.6, 27.1).
export * from './food-flow';

// Meal history aggregation, streaks, and insights gating (Task 14.12): pure,
// deterministic daily/weekly aggregation (empty days counted as zero), the
// consecutive-day logging streak (0–3650, reset on a gap day), and meal-pattern
// insights gating on ≥7 distinct logged days within the preceding 30 days with
// an exact-additional-days message otherwise. "Today"/"now" is injected so the
// logic stays pure and testable (Req 6.1–6.7).
export * from './history';

// Meal correction and totals recomputation (Task 14.7): pure, deterministic
// `applyCorrection(mealId, op)` supporting portion multipliers (0.25×–3× in
// 0.25 steps), ingredient swap, add-by-text/barcode, and delete, recomputing
// the meal's totals as the exact sum of the current items after every change.
// A no-match text/barcode lookup leaves the meal unchanged, and deleting the
// last remaining item yields zero totals. The Nutrition Lookup resolver and
// meal store are injectable ports so the logic is pure and testable (Req 5.1,
// 5.2, 5.3, 5.4, 5.6, 5.7).
export * from './correction';

// Personalization training-record queue (Task 14.10): records every applied
// meal correction as a training input for the Personalization_Model, and on
// delivery failure retains the record locally and queues it for retry so every
// correction produces a durable training record. Exposes the
// `CorrectionTrainingRecorder` seam that the meal-correction logic (Task 14.7)
// depends on. Delivery and durable storage are injectable ports so the queue
// logic is pure and testable (Req 5.5, 5.8).
export * from './personalization';

// Offline mode — on-device inference, "inference pending" status, and the
// consent-aware sync engine (Task 14.16): `OfflineCapture.inferLocal` runs the
// on-device model with a 10s pending fallback and stores the capture in the
// local Data Vault (rejecting below the 50 MB free-space minimum, retaining
// prior records); `SyncEngine.push` synchronizes, on reconnect, exactly the
// consent-permitted records within 60s, bounds retries to 3 (retaining the
// record unsynced on exhaustion), and on a conflict retains both versions and
// applies the settings-defined deterministic resolution. Inference, the 10s
// timer, the cloud transport, and the clock are injectable ports so the logic
// is pure and testable (Req 17.2, 27.1, 27.2, 27.3, 27.4, 27.5, 27.6).
export * from './offline';

// Biometric access gate (Task 14.19): pure, deterministic gate that hides
// health data on app open / resume-after-≥60s until an authentication
// succeeds, allows retry on a single biometric failure, denies biometrics
// after 3 consecutive failures and presents the fallback, and presents the
// fallback on cancel or unavailable hardware. Biometric/clock effects are
// behind injectable ports so the logic is pure and testable (Req 18.1, 18.3,
// 18.4, 18.5, 18.6).
export * from './biometric';

// Voice food logging & accessibility semantics (Task 14.21): pure, injectable-
// port-driven logic for (a) voice-guided food logging — free-form ≤60s
// transcription → `voice`-sourced meal entry with a 10s budget, plus
// field-by-field audible prompts that re-prompt at most 3 times before offering
// an alternative input method — and (b) WCAG 2.1 AA semantics: accessible
// name/role/state auditing, contrast-ratio (≥4.5:1 / ≥3:1) and target-size
// (≥44×44 CSS px) checks, ≤1s screen-reader announcements, and logical focus
// order with visible focus indicators. The speech recognizer, audible prompter,
// screen reader, and clock are injected so the logic is pure and testable
// (Req 7.3, 7.4, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6).
export * from './voice-accessibility';
