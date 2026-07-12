/**
 * Auth Store — Zustand store for authentication state management.
 * Uses react-native-mmkv for secure encrypted token storage.
 * Uses axios directly (not apiClient) to avoid circular dependency.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */
import { create } from 'zustand';
import axios from 'axios';
import { MMKV } from 'react-native-mmkv';
import { offlineCache } from '../cache/offlineCache';

// ---------- Types ----------

export interface AuthUser {
  userId: string;
  role: 'Senior_Citizen' | 'Caregiver' | 'Physician';
  seniorId: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshAccessToken(): Promise<boolean>;
  restoreSession(): Promise<void>;
}

// ---------- Constants ----------

const BASE_URL = 'https://bsmd-health-checkup-production.up.railway.app';
const STORAGE_KEY_ACCESS_TOKEN = 'auth.accessToken';
const STORAGE_KEY_REFRESH_TOKEN = 'auth.refreshToken';
const STORAGE_KEY_USER = 'auth.user';

// ---------- Secure Storage (MMKV) ----------

/**
 * MMKV instance configured with encryption for secure token storage.
 * Exported for testing purposes.
 */
export const secureStorage = new MMKV({
  id: 'auth-secure-storage',
  encryptionKey: 'bsmd-health-app-enc-key',
});

// ---------- Helpers ----------

/**
 * Decode a JWT payload to extract expiration time.
 * Does NOT validate signature — the backend handles that.
 */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a JWT token has expired (with 30s buffer for clock skew).
 */
function isTokenExpired(token: string): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) return true;
  // exp is in seconds; compare with current time minus 30s buffer
  return Date.now() / 1000 >= exp - 30;
}

// ---------- Store Implementation ----------

export const useAuthStore = create<AuthState>()((set, get) => ({
  isAuthenticated: false,
  accessToken: null,
  refreshToken: null,
  user: null,

  /**
   * Authenticate against the Backend API with email/password.
   * On success, stores tokens in MMKV encrypted storage and updates state.
   * Requirement 1.1
   */
  async login(email: string, password: string): Promise<void> {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      email,
      password,
    });

    const { accessToken, refreshToken, user } = response.data as {
      accessToken: string;
      refreshToken: string;
      user: AuthUser;
    };

    // Persist tokens and user info in encrypted storage
    secureStorage.set(STORAGE_KEY_ACCESS_TOKEN, accessToken);
    secureStorage.set(STORAGE_KEY_REFRESH_TOKEN, refreshToken);
    secureStorage.set(STORAGE_KEY_USER, JSON.stringify(user));

    set({
      isAuthenticated: true,
      accessToken,
      refreshToken,
      user,
    });
  },

  /**
   * Clear all stored tokens, clear offline cache, and reset state.
   * Navigation to login is handled by the auth gate pattern in RootStackNavigator.
   * Requirement 1.5
   */
  async logout(): Promise<void> {
    // Clear encrypted token storage
    secureStorage.delete(STORAGE_KEY_ACCESS_TOKEN);
    secureStorage.delete(STORAGE_KEY_REFRESH_TOKEN);
    secureStorage.delete(STORAGE_KEY_USER);

    // Clear offline cache
    await offlineCache.clear();

    // Reset state — auth gate will redirect to login screen
    set({
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  },

  /**
   * Attempt to refresh the access token using the stored refresh token.
   * Returns true on success, false on failure.
   * On failure (expired/invalid refresh token), triggers full logout.
   * Requirements 1.3, 1.4
   */
  async refreshAccessToken(): Promise<boolean> {
    const { refreshToken } = get();

    if (!refreshToken) {
      await get().logout();
      return false;
    }

    try {
      const response = await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken,
      });

      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        response.data as {
          accessToken: string;
          refreshToken?: string;
        };

      // Use the new refresh token if provided, otherwise keep the existing one
      const updatedRefreshToken = newRefreshToken ?? refreshToken;

      // Persist updated tokens
      secureStorage.set(STORAGE_KEY_ACCESS_TOKEN, newAccessToken);
      secureStorage.set(STORAGE_KEY_REFRESH_TOKEN, updatedRefreshToken);

      set({
        accessToken: newAccessToken,
        refreshToken: updatedRefreshToken,
      });

      return true;
    } catch {
      // Refresh failed — token is expired or invalid
      await get().logout();
      return false;
    }
  },

  /**
   * Restore session on app launch by checking stored token validity.
   * If access token is valid, restores state. If expired, attempts refresh.
   * If refresh also fails, stays logged out (auth gate shows login screen).
   * Requirements 1.2, 1.3, 1.4
   */
  async restoreSession(): Promise<void> {
    const storedAccessToken =
      secureStorage.getString(STORAGE_KEY_ACCESS_TOKEN) ?? null;
    const storedRefreshToken =
      secureStorage.getString(STORAGE_KEY_REFRESH_TOKEN) ?? null;
    const storedUserJson = secureStorage.getString(STORAGE_KEY_USER) ?? null;

    // No stored credentials — remain logged out
    if (!storedAccessToken || !storedRefreshToken || !storedUserJson) {
      return;
    }

    let user: AuthUser;
    try {
      user = JSON.parse(storedUserJson) as AuthUser;
    } catch {
      // Corrupted user data — clear everything
      await get().logout();
      return;
    }

    // If access token is still valid, restore session directly
    if (!isTokenExpired(storedAccessToken)) {
      set({
        isAuthenticated: true,
        accessToken: storedAccessToken,
        refreshToken: storedRefreshToken,
        user,
      });
      return;
    }

    // Access token expired — attempt refresh
    set({
      refreshToken: storedRefreshToken,
      user,
    });

    const refreshed = await get().refreshAccessToken();
    if (refreshed) {
      set({ isAuthenticated: true, user });
    }
    // If refresh failed, logout() was already called inside refreshAccessToken()
  },
}));
