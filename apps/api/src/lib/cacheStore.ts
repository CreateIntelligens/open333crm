import * as IORedis from 'ioredis';
import { env } from '../config/env.js';

type CacheKey = string | { id: string; segment: string };

const keyToString = (key: CacheKey) => {
  if (typeof key === 'string') {
    return `${env.CACHE_SEGMENT}:${key}`;
  }
  return `${key.segment}:${key.id}`;
};

type CacheResult<T> = {
  item: T;
  stored: number;
  ttl: number;
} | null;

type CacheStore = {
  get<T = unknown>(key: CacheKey, callback: (error: unknown, result: CacheResult<T>) => void): void;
  get<T = unknown>(key: CacheKey): Promise<CacheResult<T>>;
  set(
    key: CacheKey,
    value: unknown,
    timeToLive: number,
    callback?: (error: unknown, result: unknown) => void,
  ): void;
};

const createRedisCacheStore = () => {
  const redis = new IORedis.Redis(env.REDIS_URL, {
    db: env.CACHE_REDIS_DB,
    maxRetriesPerRequest: 1,
  });

  // Overload signatures: support both callback-style and Promise-style get().
  function getFromRedis<T = unknown>(
    key: CacheKey,
    callback: (error: unknown, result: CacheResult<T>) => void,
  ): void;
  function getFromRedis<T = unknown>(key: CacheKey): Promise<CacheResult<T>>;
  function getFromRedis<T = unknown>(
    key: CacheKey,
    callback?: (error: unknown, result: CacheResult<T>) => void,
  ) {
    const op = redis.get(keyToString(key)).then((raw) => {
      if (!raw) {
        return null as CacheResult<T>;
      }
      return JSON.parse(raw) as CacheResult<T>;
    });

    if (!callback) {
      return op;
    }

    op.then((result) => callback(null, result)).catch((error) => callback(error, null));
  }

  const cacheStore: CacheStore = {
    get: getFromRedis,
    set(key, value, timeToLive, callback) {
      const payload = JSON.stringify({
        item: value,
        stored: Date.now(),
        ttl: timeToLive,
      });

      const write = timeToLive > 0
        ? redis.psetex(keyToString(key), timeToLive, payload)
        : redis.set(keyToString(key), payload);

      write
        .then((result) => callback?.(null, result))
        .catch((error) => callback?.(error, null));
    },
  };

  return {
    cacheStore,
    connect: async () => {
      await redis.ping();
    },
    disconnect: async () => {
      await redis.quit();
    },
  };
};

const memoryCacheStore: {
  cacheStore?: CacheStore;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
} = {
  connect: async () => {},
  disconnect: async () => {},
};

const redisCacheStore = env.CACHE_DRIVER === 'redis' ? createRedisCacheStore() : null;

export const cachePluginOptions = {
  cache: redisCacheStore?.cacheStore ?? memoryCacheStore.cacheStore,
  cacheSegment: env.CACHE_SEGMENT,
  expiresIn: env.CACHE_EXPIRES_IN,
};

export const connectCacheStore = async () => {
  if (redisCacheStore) {
    await redisCacheStore.connect();
  }
};

export const disconnectCacheStore = async () => {
  if (redisCacheStore) {
    await redisCacheStore.disconnect();
  }
};
