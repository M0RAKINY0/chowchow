import { createClient } from "redis";
import type { AppConfig } from "../../config.js";
import { logger } from "../../logger.js";

export type PopularFoodItem = {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  imageUrl: string | null;
  orderCount: number;
};

export type PopularFoodCache = {
  get(vendorId: string): Promise<PopularFoodItem[] | null>;
  set(vendorId: string, items: PopularFoodItem[]): Promise<void>;
  invalidate(vendorId: string): Promise<void>;
};

type RedisClientLike = {
  isReady: boolean;
  isOpen?: boolean;
  connect?: () => Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  quit?: () => Promise<unknown>;
};

const CACHE_KEY_PREFIX = "popular-food";
const DEFAULT_TTL_SECONDS = 300;

export function popularFoodCacheKey(vendorId: string): string {
  return `${CACHE_KEY_PREFIX}:${vendorId}:v1`;
}

export function createMemoryPopularFoodCache(
  options: {
    ttlSeconds?: number;
  } = {},
): PopularFoodCache {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const values = new Map<
    string,
    { items: PopularFoodItem[]; expiresAt: number }
  >();

  return {
    async get(vendorId) {
      const value = values.get(vendorId);
      if (!value || value.expiresAt <= Date.now()) {
        values.delete(vendorId);
        return null;
      }
      return value.items.map((item) => ({ ...item }));
    },
    async set(vendorId, items) {
      values.set(vendorId, {
        items: items.map((item) => ({ ...item })),
        expiresAt: Date.now() + ttlSeconds * 1_000,
      });
    },
    async invalidate(vendorId) {
      values.delete(vendorId);
    },
  };
}

export function createRedisPopularFoodCache(options: {
  redisUrl: string;
  ttlSeconds?: number;
  client?: RedisClientLike;
}): PopularFoodCache {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  let client: RedisClientLike;
  if (options.client) {
    client = options.client;
  } else {
    const redisClient = createClient({
      url: options.redisUrl,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: () => false,
      },
    });
    redisClient.on("error", (error) => {
      logger.warn({ err: error }, "Redis popular food cache client error");
    });
    client = redisClient as unknown as RedisClientLike;
  }
  let connectPromise: Promise<void> | null = null;

  async function ensureConnected(): Promise<void> {
    if (client.isReady) {
      return;
    }
    if (!client.connect) {
      throw new Error("Redis client is not connected");
    }
    if (!connectPromise) {
      connectPromise = client.connect().then(
        () => undefined,
        (error: unknown) => {
          connectPromise = null;
          throw error;
        },
      );
    }
    await connectPromise;
  }

  return {
    async get(vendorId) {
      await ensureConnected();
      const value = await client.get(popularFoodCacheKey(vendorId));
      if (!value) {
        return null;
      }

      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? (parsed as PopularFoodItem[]) : null;
      } catch {
        return null;
      }
    },
    async set(vendorId, items) {
      await ensureConnected();
      await client.set(popularFoodCacheKey(vendorId), JSON.stringify(items), {
        EX: ttlSeconds,
      });
    },
    async invalidate(vendorId) {
      await ensureConnected();
      await client.del(popularFoodCacheKey(vendorId));
    },
  };
}

export function createPopularFoodCache(config: AppConfig): PopularFoodCache {
  if (config.nodeEnv === "test") {
    return createMemoryPopularFoodCache();
  }

  return createRedisPopularFoodCache({ redisUrl: config.redisUrl });
}

export async function invalidatePopularFoodCache(
  cache: PopularFoodCache | undefined,
  vendorId: string,
): Promise<void> {
  if (!cache) {
    return;
  }

  try {
    await cache.invalidate(vendorId);
  } catch (error) {
    logger.warn(
      { err: error, vendorId },
      "Unable to invalidate popular food cache",
    );
  }
}
