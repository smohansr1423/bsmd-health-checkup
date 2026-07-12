/**
 * Cross-cutting encryption & key management (Task 3.1).
 *
 * Public surface for AES-256 per-user encryption with a separated key store.
 * Other components (e.g. the Data Vault, task 2.4) import the {@link Encryptor}
 * port and, where needed, a {@link KeyStore} implementation from here — without
 * touching crypto internals.
 *
 * Requirements: 25.1
 */

// Separated key store (per-user AES-256 key material).
export * from './key-store';

// Encryptor port + AES-256-GCM implementation over health-data records.
export * from './encryptor';
