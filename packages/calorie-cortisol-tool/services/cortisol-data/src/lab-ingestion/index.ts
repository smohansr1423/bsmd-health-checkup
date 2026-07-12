/**
 * Lab-result ingestion module (Task 9.4).
 *
 * Implements `POST /webhooks/lab-results` (HL7/JSON, HMAC-verified, structural
 * validation, results-pending on missing/invalid within 72h), diurnal 4-sample
 * window acceptance (Req 8.3), and age/sex/time-of-day reference-range
 * classification (Req 8.5).
 *
 * Requirements: 8.3, 8.4, 8.5, 8.8
 */
export * from './errors';
export * from './units';
export * from './hmac';
export * from './diurnal-windows';
export * from './reference-ranges';
export * from './parse';
export * from './ingest';
