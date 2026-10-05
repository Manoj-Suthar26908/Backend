import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { RateLimitCheckResult } from '../types';

export class RateLimiterService {
  // In-memory fallback map if Redis is not running in demo mode
  private memoryCounters: Map<string, { count: number; expiresAt: number }> = new Map();

  /**
   * Helper to compute current hour window start and the upcoming hour window start
   */
  getHourWindowInfo(): { currentWindowKey: string; nextHourTimestamp: number; secondsUntilNextHour: number } {
    const now = new Date();
    // Get start of the current hour (e.g. 2026-10-05 23:00:00)
    const currentHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
    // Get start of next hour
    const nextHourStart = new Date(currentHourStart.getTime() + 60 * 60 * 1000);

    const currentWindowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_H${now.getHours()}`;
    const nextHourTimestamp = nextHourStart.getTime();
    const secondsUntilNextHour = Math.max(1, Math.ceil((nextHourTimestamp - Date.now()) / 1000));

    return {
      currentWindowKey,
      nextHourTimestamp,
      secondsUntilNextHour,
    };
  }

  /**
   * Atomically checks and increments the sender's hourly email counter.
   */
  async checkAndIncrement(senderId: string, maxPerHour: number): Promise<RateLimitCheckResult> {
    const { currentWindowKey, nextHourTimestamp, secondsUntilNextHour } = this.getHourWindowInfo();
    const redisKey = `rate_limit:${senderId}:${currentWindowKey}`;

    // Try Redis first
    try {
      if (redisClient.status === 'ready' || redisClient.status === 'connecting') {
        const pipeline = redisClient.pipeline();
        pipeline.incr(redisKey);
        pipeline.ttl(redisKey);
        const results = await pipeline.exec();

        if (results && results[0] && results[1]) {
          const count = Number(results[0][1]);
          const ttl = Number(results[1][1]);

          // If key was just created, set its TTL to expire at the end of the hour window
          if (ttl === -1 || ttl === -2) {
            await redisClient.expire(redisKey, secondsUntilNextHour + 60);
          }

          if (count > maxPerHour) {
            logger.warn(`Sender ${senderId} exceeded hourly rate limit (${count}/${maxPerHour})`);
            return {
              isAllowed: false,
              currentCount: count,
              maxLimit: maxPerHour,
              retryAfterSeconds: secondsUntilNextHour,
              nextHourTimestamp,
            };
          }

          return {
            isAllowed: true,
            currentCount: count,
            maxLimit: maxPerHour,
            retryAfterSeconds: 0,
            nextHourTimestamp,
          };
        }
      }
    } catch (e: any) {
      logger.debug('Redis unavailable for rate limiting, using atomic memory rate limiter', { error: e.message });
    }

    // Fallback: Atomic in-memory sliding window
    const nowTime = Date.now();
    const memEntry = this.memoryCounters.get(redisKey);

    if (!memEntry || memEntry.expiresAt <= nowTime) {
      // First email in this hour window
      this.memoryCounters.set(redisKey, {
        count: 1,
        expiresAt: nextHourTimestamp,
      });

      return {
        isAllowed: true,
        currentCount: 1,
        maxLimit: maxPerHour,
        retryAfterSeconds: 0,
        nextHourTimestamp,
      };
    }

    // Increment
    memEntry.count += 1;
    if (memEntry.count > maxPerHour) {
      logger.warn(`[RateLimit Exceeded] Sender ${senderId}: ${memEntry.count}/${maxPerHour} emails sent this hour.`);
      return {
        isAllowed: false,
        currentCount: memEntry.count,
        maxLimit: maxPerHour,
        retryAfterSeconds: secondsUntilNextHour,
        nextHourTimestamp,
      };
    }

    return {
      isAllowed: true,
      currentCount: memEntry.count,
      maxLimit: maxPerHour,
      retryAfterSeconds: 0,
      nextHourTimestamp,
    };
  }

  /**
   * Resets counter (useful for test/demo resets)
   */
  async resetSenderLimit(senderId: string): Promise<void> {
    const { currentWindowKey } = this.getHourWindowInfo();
    const redisKey = `rate_limit:${senderId}:${currentWindowKey}`;
    try {
      if (redisClient.status === 'ready') {
        await redisClient.del(redisKey);
      }
    } catch (_) {}
    this.memoryCounters.delete(redisKey);
    logger.info(`Rate limit reset for sender ${senderId}`);
  }
}

export const rateLimiterService = new RateLimiterService();
