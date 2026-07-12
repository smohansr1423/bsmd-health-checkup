import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

// These modules will be created in parallel tasks — import paths are pre-declared
import { useAuthStore } from '../stores/authStore';
import { offlineCache } from '../cache/offlineCache';

// ---------- Types ----------

export interface APIResponse<T> {
  data: T;
  meta?: { page: number; pageSize: number; total: number };
}

export interface APIClient {
  get<T>(path: string, params?: Record<string, string>): Promise<APIResponse<T>>;
  post<T>(path: string, body?: unknown): Promise<APIResponse<T>>;
  put<T>(path: string, body?: unknown): Promise<APIResponse<T>>;
  delete<T>(path: string): Promise<APIResponse<T>>;
}

// ---------- Constants ----------

const BASE_URL = 'https://bsmd-health-checkup-production.up.railway.app';
const REQUEST_TIMEOUT_MS = 15_000;

// ---------- Axios Instance ----------

const axiosInstance: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

// ---------- Request Interceptors ----------

/**
 * Attach JWT Bearer token from the auth store to every outgoing request.
 */
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Set standard request headers:
 * - Content-Type: application/json
 * - Accept: application/json
 * - X-Client-Platform: ios | android
 */
axiosInstance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    config.headers['Content-Type'] = 'application/json';
    config.headers['Accept'] = 'application/json';
    config.headers['X-Client-Platform'] = Platform.OS; // 'ios' | 'android'
    return config;
  },
  (error) => Promise.reject(error),
);

// ---------- Response Interceptor (401 + token refresh) ----------

/** Flag to prevent multiple concurrent refresh attempts */
let isRefreshing = false;
/** Queue of requests waiting for a token refresh to complete */
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  config: InternalAxiosRequestConfig;
}> = [];

function processQueue(error: unknown) {
  failedQueue.forEach(({ reject }) => reject(error));
  failedQueue = [];
}

function retryQueuedRequests() {
  const queue = [...failedQueue];
  failedQueue = [];
  queue.forEach(({ resolve, config }) => {
    // Re-attach new token for retried requests
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    resolve(axiosInstance(config));
  });
}

axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only attempt refresh on 401 responses and only once per request
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (isRefreshing) {
        // Another refresh is in progress — queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      isRefreshing = true;

      try {
        const refreshSuccess = await useAuthStore
          .getState()
          .refreshAccessToken();

        if (refreshSuccess) {
          // Retry the original request with new token
          const { accessToken } = useAuthStore.getState();
          if (accessToken) {
            originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          }
          retryQueuedRequests();
          return axiosInstance(originalRequest);
        } else {
          // Refresh failed — trigger logout
          processQueue(error);
          await useAuthStore.getState().logout();
          return Promise.reject(error);
        }
      } catch (refreshError) {
        processQueue(refreshError);
        await useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ---------- Network Connectivity Detection ----------

/**
 * Checks network connectivity before making a request.
 * If offline, attempts to serve from offline cache; otherwise queues the context.
 */
async function checkConnectivity(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected ?? false;
}

// ---------- API Client Implementation ----------

export const apiClient: APIClient = {
  async get<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<APIResponse<T>> {
    const isOnline = await checkConnectivity();

    if (!isOnline) {
      return handleOfflineRequest<T>('GET', path);
    }

    const response = await axiosInstance.get<APIResponse<T>>(path, { params });
    return response.data;
  },

  async post<T>(path: string, body?: unknown): Promise<APIResponse<T>> {
    const isOnline = await checkConnectivity();

    if (!isOnline) {
      return handleOfflineRequest<T>('POST', path);
    }

    const response = await axiosInstance.post<APIResponse<T>>(path, body);
    return response.data;
  },

  async put<T>(path: string, body?: unknown): Promise<APIResponse<T>> {
    const isOnline = await checkConnectivity();

    if (!isOnline) {
      return handleOfflineRequest<T>('PUT', path);
    }

    const response = await axiosInstance.put<APIResponse<T>>(path, body);
    return response.data;
  },

  async delete<T>(path: string): Promise<APIResponse<T>> {
    const isOnline = await checkConnectivity();

    if (!isOnline) {
      return handleOfflineRequest<T>('DELETE', path);
    }

    const response = await axiosInstance.delete<APIResponse<T>>(path);
    return response.data;
  },
};

// ---------- Offline Request Handling ----------

/**
 * Derives a cache key from the request path.
 * The offline cache module will provide the actual implementation — this maps
 * paths to known cache key patterns.
 */
function deriveCacheKey(path: string): string | null {
  // Match common API patterns to cache keys
  const readingsMatch = path.match(
    /\/device-readings\/seniors\/([^/]+)\/daily\/([^/]+)/,
  );
  if (readingsMatch) return `readings:${readingsMatch[1]}:${readingsMatch[2]}`;

  const devicesMatch = path.match(
    /\/device-readings\/devices\/senior\/([^/]+)/,
  );
  if (devicesMatch) return `devices:${devicesMatch[1]}`;

  const appointmentsMatch = path.match(
    /\/scheduling\/seniors\/([^/]+)\/appointments/,
  );
  if (appointmentsMatch) return `appointments:${appointmentsMatch[1]}`;

  const profileMatch = path.match(/\/registration\/seniors\/([^/]+)/);
  if (profileMatch) return `profile:${profileMatch[1]}`;

  const reportsMatch = path.match(/\/reports\/seniors\/([^/]+)/);
  if (reportsMatch) return `reports:${reportsMatch[1]}`;

  return null;
}

async function handleOfflineRequest<T>(
  _method: string,
  path: string,
): Promise<APIResponse<T>> {
  const cacheKey = deriveCacheKey(path);

  if (cacheKey) {
    const cached = await offlineCache.get<T>(cacheKey as any);
    if (cached && !offlineCache.isExpired(cached)) {
      return { data: cached.data };
    }
  }

  throw new OfflineError(
    'No network connectivity. Please check your internet connection.',
  );
}

// ---------- Custom Error Classes ----------

export class OfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineError';
  }
}

// ---------- Exports ----------

export { axiosInstance };
export default apiClient;
