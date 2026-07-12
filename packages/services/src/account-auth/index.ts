/**
 * Account Auth (`account-auth`) — barrel export.
 *
 * Sign-up, sign-in, session lifecycle, and account lockout for API Copilot AI.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 18.1
 */

export {
  AccountAuthService,
  ScryptPasswordHasher,
  SESSION_INACTIVITY_MS,
  LOCKOUT_THRESHOLD,
  LOCKOUT_WINDOW_MS,
  LOCKOUT_DURATION_MS,
} from './account-auth.service';

export {
  EmailAlreadyRegisteredError,
  InvalidRegistrationError,
  InvalidCredentialsError,
  AccountLockedError,
} from './account-auth.errors';

export {
  validateSignUp,
  isValidEmail,
  isValidPasswordLength,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './account-auth.validators';

export type {
  SignUpRequest,
  SignInRequest,
  PasswordHasher,
  AccountAuthDependencies,
} from './account-auth.types';
