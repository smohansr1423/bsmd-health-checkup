/**
 * Offline mode — on-device inference, "inference pending" status, and the
 * consent-aware sync engine (Task 14.16).
 *
 * Public surface: the offline types/ports, the {@link OfflineCapture} engine
 * (`inferLocal`) with its production {@link RealTimeoutScheduler}, and the
 * {@link SyncEngine} (`push`).
 *
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 17.2
 */
export * from './types';
export * from './offline-inference';
export * from './sync-engine';
