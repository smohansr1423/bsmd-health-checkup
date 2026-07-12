/**
 * Personalization training-record queue (Task 14.10).
 *
 * Public surface: the queue types/ports/error codes, the reference in-memory
 * backend for testing, and the {@link PersonalizationTrainingQueue} itself,
 * which implements the {@link CorrectionTrainingRecorder} seam the
 * meal-correction module (Task 14.7) depends on.
 *
 * Requirements: 5.5, 5.8
 */
export * from './types';
export * from './in-memory-queue-backend';
export * from './training-queue';
