import axios from 'axios';
import { Platform } from 'react-native';

// Mock react-native
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Mock @react-native-community/netinfo
const mockNetInfoFetch = jest.fn();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: () => mockNetInfoFetch() },
}));

// Mock the auth store
const mockGetState = jest.fn();
jest.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => mockGetState() },
}));

// Mock the offline cache
const mockCacheGet = jest.fn();
const mockCacheIsExpired = jest.fn();
jest.mock('../cache/offlineCache', () => ({
  offlineCache: {
    get: (...args: any[]) => mockCacheGet(...args),
    set: jest.fn(),
    clear: jest.fn(),
    purgeStale: jest.fn(),
    isExpired: (...args: any[]) => mockCacheIsExpired(...args),
  },
}));

// Mock axios.create to return a controllable instance
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockInterceptorsRequest = { use: jest.fn() };
const mockInterceptorsResponse = { use: jest.fn() };

jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  return {
    ...actualAxios,
    create: jest.fn(() => ({
      get: mockGet,
      post: mockPost,
      put: mockPut,
      delete: mockDelete,
      interceptors: {
        request: mockInterceptorsRequest,
        response: mockInterceptorsResponse,
      },
    })),
  };
});

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockGetState.mockReturnValue({
      accessToken: 'test-token',
      refreshToken: 'test-refresh-token',
      refreshAccessToken: jest.fn().mockResolvedValue(true),
      logout: jest.fn(),
    });
  });

  describe('Axios instance configuration', () => {
    it('creates axios instance with correct base URL and timeout', () => {
      // Re-import to trigger module initialization
      jest.isolateModules(() => {
        require('./client');
      });

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://bsmd-health-checkup-production.up.railway.app',
        timeout: 15_000,
      });
    });

    it('registers request interceptors', () => {
      jest.isolateModules(() => {
        require('./client');
      });

      // Should register 2 request interceptors (auth + headers)
      expect(mockInterceptorsRequest.use).toHaveBeenCalledTimes(2);
    });

    it('registers response interceptor', () => {
      jest.isolateModules(() => {
        require('./client');
      });

      expect(mockInterceptorsResponse.use).toHaveBeenCalledTimes(1);
    });
  });

  describe('Request interceptors behavior', () => {
    let authInterceptor: (config: any) => any;
    let headersInterceptor: (config: any) => any;

    beforeEach(() => {
      jest.isolateModules(() => {
        require('./client');
      });

      // Extract the interceptor functions registered
      authInterceptor = mockInterceptorsRequest.use.mock.calls[0][0];
      headersInterceptor = mockInterceptorsRequest.use.mock.calls[1][0];
    });

    it('attaches JWT Bearer token to Authorization header', () => {
      const config = { headers: {} as any };
      const result = authInterceptor(config);
      expect(result.headers.Authorization).toBe('Bearer test-token');
    });

    it('does not set Authorization header when no token exists', () => {
      mockGetState.mockReturnValue({
        accessToken: null,
        refreshToken: null,
        refreshAccessToken: jest.fn(),
        logout: jest.fn(),
      });

      const config = { headers: {} as any };
      const result = authInterceptor(config);
      expect(result.headers.Authorization).toBeUndefined();
    });

    it('sets Content-Type header to application/json', () => {
      const config = { headers: {} as any };
      const result = headersInterceptor(config);
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('sets Accept header to application/json', () => {
      const config = { headers: {} as any };
      const result = headersInterceptor(config);
      expect(result.headers['Accept']).toBe('application/json');
    });

    it('sets X-Client-Platform header to Platform.OS', () => {
      const config = { headers: {} as any };
      const result = headersInterceptor(config);
      expect(result.headers['X-Client-Platform']).toBe('ios');
    });
  });

  describe('Response interceptor — 401 handling', () => {
    let responseSuccessHandler: (response: any) => any;
    let responseErrorHandler: (error: any) => Promise<any>;

    beforeEach(() => {
      jest.isolateModules(() => {
        require('./client');
      });

      responseSuccessHandler = mockInterceptorsResponse.use.mock.calls[0][0];
      responseErrorHandler = mockInterceptorsResponse.use.mock.calls[0][1];
    });

    it('passes through successful responses unchanged', () => {
      const response = { data: { data: 'test' }, status: 200 };
      const result = responseSuccessHandler(response);
      expect(result).toBe(response);
    });

    it('attempts token refresh on 401 response', async () => {
      const mockRefresh = jest.fn().mockResolvedValue(true);
      mockGetState.mockReturnValue({
        accessToken: 'new-token',
        refreshToken: 'test-refresh-token',
        refreshAccessToken: mockRefresh,
        logout: jest.fn(),
      });

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: false },
      };

      // The interceptor will call axiosInstance(config) which is the mock
      // We just verify refresh was called
      try {
        await responseErrorHandler(error);
      } catch {
        // May throw because mock instance doesn't do full retry
      }

      expect(mockRefresh).toHaveBeenCalled();
    });

    it('triggers logout when refresh fails', async () => {
      const mockLogout = jest.fn();
      const mockRefresh = jest.fn().mockResolvedValue(false);
      mockGetState.mockReturnValue({
        accessToken: null,
        refreshToken: 'test-refresh-token',
        refreshAccessToken: mockRefresh,
        logout: mockLogout,
      });

      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: false },
      };

      await expect(responseErrorHandler(error)).rejects.toBeDefined();
      expect(mockLogout).toHaveBeenCalled();
    });

    it('does not retry the same request twice', async () => {
      const error = {
        response: { status: 401 },
        config: { headers: {}, _retry: true },
      };

      await expect(responseErrorHandler(error)).rejects.toBeDefined();
    });

    it('rejects non-401 errors without attempting refresh', async () => {
      const mockRefresh = jest.fn();
      mockGetState.mockReturnValue({
        accessToken: 'test-token',
        refreshToken: 'test-refresh-token',
        refreshAccessToken: mockRefresh,
        logout: jest.fn(),
      });

      const error = {
        response: { status: 500 },
        config: { headers: {} },
      };

      await expect(responseErrorHandler(error)).rejects.toBeDefined();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe('Offline handling', () => {
    let apiClient: any;

    beforeEach(() => {
      jest.isolateModules(() => {
        apiClient = require('./client').apiClient;
      });
    });

    it('serves cached data when offline and cache is available', async () => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: false });
      mockCacheGet.mockResolvedValue({
        data: { test: 'cached-data' },
        cachedAt: Date.now(),
        expiresAt: Date.now() + 1000000,
      });
      mockCacheIsExpired.mockReturnValue(false);

      const result = await apiClient.get(
        '/device-readings/seniors/senior123/daily/2024-01-01',
      );
      expect(result.data).toEqual({ test: 'cached-data' });
    });

    it('throws OfflineError when offline with no cache', async () => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: false });
      mockCacheGet.mockResolvedValue(null);

      await expect(
        apiClient.get('/device-readings/seniors/senior123/daily/2024-01-01'),
      ).rejects.toThrow('No network connectivity');
    });

    it('throws OfflineError when offline and cache is expired', async () => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: false });
      mockCacheGet.mockResolvedValue({
        data: { test: 'old-data' },
        cachedAt: 0,
        expiresAt: 0,
      });
      mockCacheIsExpired.mockReturnValue(true);

      await expect(
        apiClient.get('/device-readings/seniors/senior123/daily/2024-01-01'),
      ).rejects.toThrow('No network connectivity');
    });

    it('makes network request when online', async () => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: true });
      mockGet.mockResolvedValue({
        data: { data: { test: 'live-data' } },
      });

      const result = await apiClient.get('/some/path');
      expect(mockGet).toHaveBeenCalledWith('/some/path', { params: undefined });
      expect(result).toEqual({ data: { test: 'live-data' } });
    });
  });

  describe('Cache key derivation for offline', () => {
    let apiClient: any;

    beforeEach(() => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: false });
      mockCacheGet.mockResolvedValue(null);

      jest.isolateModules(() => {
        apiClient = require('./client').apiClient;
      });
    });

    it('derives readings cache key from device-readings path', async () => {
      try {
        await apiClient.get(
          '/device-readings/seniors/sen1/daily/2024-01-15',
        );
      } catch {
        // Expected to throw OfflineError
      }
      expect(mockCacheGet).toHaveBeenCalledWith('readings:sen1:2024-01-15');
    });

    it('derives devices cache key from devices path', async () => {
      try {
        await apiClient.get('/device-readings/devices/senior/sen1');
      } catch {
        // Expected to throw OfflineError
      }
      expect(mockCacheGet).toHaveBeenCalledWith('devices:sen1');
    });

    it('derives appointments cache key from scheduling path', async () => {
      try {
        await apiClient.get('/scheduling/seniors/sen1/appointments');
      } catch {
        // Expected to throw OfflineError
      }
      expect(mockCacheGet).toHaveBeenCalledWith('appointments:sen1');
    });

    it('derives profile cache key from registration path', async () => {
      try {
        await apiClient.get('/registration/seniors/sen1');
      } catch {
        // Expected to throw OfflineError
      }
      expect(mockCacheGet).toHaveBeenCalledWith('profile:sen1');
    });

    it('derives reports cache key from reports path', async () => {
      try {
        await apiClient.get('/reports/seniors/sen1');
      } catch {
        // Expected to throw OfflineError
      }
      expect(mockCacheGet).toHaveBeenCalledWith('reports:sen1');
    });
  });

  describe('HTTP methods', () => {
    let apiClient: any;

    beforeEach(() => {
      mockNetInfoFetch.mockResolvedValue({ isConnected: true });

      jest.isolateModules(() => {
        apiClient = require('./client').apiClient;
      });
    });

    it('post sends body in the request', async () => {
      const body = { email: 'test@example.com', password: 'pass' };
      mockPost.mockResolvedValue({ data: { data: { token: 'abc' } } });

      const result = await apiClient.post('/auth/login', body);
      expect(mockPost).toHaveBeenCalledWith('/auth/login', body);
      expect(result).toEqual({ data: { token: 'abc' } });
    });

    it('put sends body in the request', async () => {
      const body = { name: 'Updated Name' };
      mockPut.mockResolvedValue({ data: { data: { success: true } } });

      const result = await apiClient.put('/registration/seniors/sen1', body);
      expect(mockPut).toHaveBeenCalledWith(
        '/registration/seniors/sen1',
        body,
      );
      expect(result).toEqual({ data: { success: true } });
    });

    it('delete sends request without body', async () => {
      mockDelete.mockResolvedValue({ data: { data: null } });

      const result = await apiClient.delete('/some/resource/123');
      expect(mockDelete).toHaveBeenCalledWith('/some/resource/123');
      expect(result).toEqual({ data: null });
    });
  });
});
