/**
 * Auth Assistant — barrel export.
 *
 * Manages target-API credentials and tokens for API Copilot AI: the sole
 * decryptor of stored credentials, with envelope-encrypted storage at rest and
 * redacted authentication errors.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */

export {
  AuthAssistant,
  FakeTokenAcquisition,
  UnconfiguredTokenAcquisition,
} from './auth-assistant.service';

export { AesGcmCryptoProvider } from './auth-assistant.crypto';
export type { AesGcmCryptoProviderOptions } from './auth-assistant.crypto';

export {
  AuthError,
  AuthTimeoutError,
  NoRefreshMechanismError,
  RefreshFailedError,
  InvalidCredentialsError,
  UnsupportedSchemeError,
  CredentialNotFoundError,
} from './auth-assistant.errors';
export type { AuthErrorReason, AuthErrorDetails } from './auth-assistant.errors';

export {
  SUPPORTED_SCHEMES,
  isSupportedScheme,
  isStaticScheme,
  isTokenScheme,
  hasRefreshMechanism,
} from './auth-assistant.validators';

export type {
  TargetApiRef,
  CredentialSecret,
  ApiKeySecret,
  BasicSecret,
  JwtSecret,
  OAuthSecret,
  TokenAcquisition,
  TokenAcquisitionRequest,
  TokenRefreshRequest,
  TokenResult,
  RegisterCredentialInput,
  AuthAssistantDependencies,
  CachedToken,
  AuthMaterial,
} from './auth-assistant.types';
