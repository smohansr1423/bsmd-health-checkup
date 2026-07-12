import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------- Types ----------

export type CacheKey =
  | `readings:${string}:${string}` // readings:{seniorId}:{date}
  | `devices:${string}` // devices:{seniorId}
  | `appointments:${string}` // appointments:{seniorId}
  | `profile:${string}` // profile:{seniorId}
  | `reports:${string}`; // reports:{seniorId}

export interface CachedEntry<T> {
  data: T;
  cachedAt: number; // epoch ms
  expiresAt: number; // epoch ms (cachedAt + DEFAULT_TTL_MS)
}

export interface OfflineCache {
  get<T>(key: CacheKey): Promise<CachedEntry<T> | null>;
  set<T>(key: CacheKey, data: T): Promise<void>;
  clear(): Promise<void>;
  purgeStale(maxAgeDays: number): Promise<void>;
  isExpired(entry: CachedEntry<unknown>): boolean;
}

// ---------- Constants ----------

/** Default TTL: 7 days in milliseconds */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Prefix applied to all cache keys in AsyncStorage to avoid collisions */
const CACHE_PREFIX = '@offline_cache:';

// ---------- Helpers ----------

function prefixedKey(key: CacheKey): string {
  return `${CACHE_PREFIX}${key}`;
}

// ---------- Implementation ----------

function createOfflineCache(): OfflineCache {
  const cache: OfflineCache = {
    async get<T>(key: CacheKey): Promise<CachedEntry<T> | null> {
      try {
        const raw = await AsyncStorage.getItem(prefixedKey(key));
        if (raw === null) {
          return null;
        }
        const entry: CachedEntry<T> = JSON.parse(raw);
        return entry;
      } catch {
        return null;
      }
    },

    async set<T>(key: CacheKey, data: T): Promise<void> {
      const now = Date.now();
      const entry: CachedEntry<T> = {
        data,
        cachedAt: now,
        expiresAt: now + DEFAULT_TTL_MS,
      };
      await AsyncStorage.setItem(prefixedKey(key), JSON.stringify(entry));
    },

    async clear(): Promise<void> {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    },

    async purgeStale(maxAgeDays: number): Promise<void> {
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));

      if (cacheKeys.length === 0) {
        return;
      }

      const pairs = await AsyncStorage.multiGet(cacheKeys);
      const keysToRemove: string[] = [];

      for (const [key, value] of pairs) {
        if (value === null) {
          continue;
        }
        try {
          const entry: CachedEntry<unknown> = JSON.parse(value);
          if (now - entry.cachedAt > maxAgeMs) {
            keysToRemove.push(key);
          }
        } catch {
          // Corrupted entry — remove it
          keysToRemove.push(key);
        }
      }

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }
    },

    isExpired(entry: CachedEntry<unknown>): boolean {
      return Date.now() > entry.expiresAt;
    },
  };

  return cache;
}

/** Singleton offline cache instance */
export const offlineCache: OfflineCache = createOfflineCache();
