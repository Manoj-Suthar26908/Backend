import { Queue } from 'bullmq';
import { redisOptions } from '../config/redis';
import { SendEmailJobData } from '../types';
import { logger } from '../utils/logger';

export const EMAIL_QUEUE_NAME = 'reachinbox_email_queue';

// BullMQ Queue instance backed by ioredis
export const emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24h
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

emailQueue.on('error', (err) => {
  logger.error('Email Queue error', { error: err.message });
});
