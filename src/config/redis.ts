import Redis, { RedisOptions } from 'ioredis';
import { config } from './env';
import { logger } from '../utils/logger';

export const redisOptions: RedisOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Critical requirement for BullMQ
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
};

// Singleton Redis connection for general queries / atomic rate limiting
export const redisClient = new Redis(redisOptions);

redisClient.on('connect', () => {
  logger.info(`Redis connected successfully at ${config.redis.host}:${config.redis.port}`);
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error', { error: err.message });
});
