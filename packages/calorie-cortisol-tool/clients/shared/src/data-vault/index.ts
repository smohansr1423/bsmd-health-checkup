/**
 * On-device Data Vault storage layer (Task 2.4).
 *
 * Public surface: the storage-backend-agnostic types, the reference in-memory
 * backend and pass-through encryptor for testing, and the {@link DataVault}
 * itself (`put/get/list/delete`).
 *
 * Requirements: 17.1, 27.1, 27.3
 */
export * from './types';
export * from './passthrough-encryptor';
export * from './in-memory-backend';
export * from './data-vault';
