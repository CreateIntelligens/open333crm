import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const COLLECTION_KEY = 'test:items';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheStore = FastifyInstance['cache'];

export type RedisTestItem = {
  id: string;
  title: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};

export type RedisTestItemCreateInput = {
  title: string;
  value: string;
};

export type RedisTestItemUpdateInput = {
  title?: string;
  value?: string;
};

const cacheGet = <T>(cache: CacheStore, key: string): Promise<T | null> =>
  new Promise((resolve, reject) => {
    cache.get<T>(key, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result?.item ?? null);
    });
  });

const cacheSet = (cache: CacheStore, key: string, value: unknown, ttlMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    cache.set(key, value, ttlMs, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const readCollection = async (cache: CacheStore): Promise<RedisTestItem[]> => {
  const result = await cacheGet<RedisTestItem[]>(cache, COLLECTION_KEY);
  return result ?? [];
};

const writeCollection = async (cache: CacheStore, items: RedisTestItem[]) => {
  await cacheSet(cache, COLLECTION_KEY, items, CACHE_TTL_MS);
};

export const createRedisTestItemModel = (cache: CacheStore) => ({
  async list(): Promise<RedisTestItem[]> {
    const items = await readCollection(cache);
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getById(id: string): Promise<RedisTestItem | null> {
    const items = await readCollection(cache);
    return items.find((item) => item.id === id) ?? null;
  },

  async create(input: RedisTestItemCreateInput): Promise<RedisTestItem> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const item: RedisTestItem = {
      id,
      title: input.title,
      value: input.value,
      createdAt: now,
      updatedAt: now,
    };

    const items = await readCollection(cache);
    items.push(item);
    await writeCollection(cache, items);

    return item;
  },

  async updateById(id: string, input: RedisTestItemUpdateInput): Promise<RedisTestItem | null> {
    const items = await readCollection(cache);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }

    const existing = items[index];
    const updated: RedisTestItem = {
      ...existing,
      title: input.title ?? existing.title,
      value: input.value ?? existing.value,
      updatedAt: new Date().toISOString(),
    };

    items[index] = updated;
    await writeCollection(cache, items);
    return updated;
  },

  async deleteById(id: string): Promise<boolean> {
    const items = await readCollection(cache);
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) {
      return false;
    }
    await writeCollection(cache, next);
    return true;
  },
});
