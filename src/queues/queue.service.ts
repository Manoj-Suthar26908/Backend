import { emailQueue } from './email.queue';
import { demoDb, DBEmailJob } from '../config/demo-db';
import { SendEmailJobData } from '../types';
import { etherealService } from '../services/ethereal.service';
import { rateLimiterService } from '../services/rate-limiter.service';
import { slackService } from '../services/slack.service';
import { elasticsearchService } from '../services/elasticsearch.service';
import { logger } from '../utils/logger';
import { redisClient } from '../config/redis';

export interface EnqueueEmailJobParams {
  emailJobId: string;
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  senderAccountId: string;
  recipient: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  minDelaySeconds?: number;
}

class QueueService {
  // In-process timer map for zero-dependency standalone execution
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Schedules a delayed email job. Uses BullMQ if Redis is ready, or self-contained delayed timer.
   */
  async scheduleJob(params: EnqueueEmailJobParams): Promise<{ jobId: string; delayMs: number }> {
    const now = Date.now();
    const targetTimestamp = params.scheduledAt.getTime();
    const delayMs = Math.max(0, targetTimestamp - now);

    const jobData: SendEmailJobData = {
      jobId: params.idempotencyKey,
      emailJobId: params.emailJobId,
      tenantId: params.tenantId,
      userId: params.userId,
      senderAccountId: params.senderAccountId,
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
      minDelaySeconds: params.minDelaySeconds,
      scheduledAt: params.scheduledAt.toISOString(),
    };

    logger.info(
      `Scheduling email job ${params.idempotencyKey} for ${params.recipient} with delay: ${Math.round(delayMs / 1000)}s`
    );

    // Try BullMQ if Redis is active
    try {
      if (redisClient.status === 'ready') {
        await emailQueue.add('send_email', jobData, {
          jobId: params.idempotencyKey, // Enforce strict idempotency
          delay: delayMs,
        });
        logger.info(`Job ${params.idempotencyKey} pushed to BullMQ delayed queue`);
      }
    } catch (err: any) {
      logger.debug('BullMQ push skipped (using in-process delayed engine):', err.message);
    }

    // Always maintain in-process delayed trigger as resilient backup or primary
    if (this.scheduledTimers.has(params.idempotencyKey)) {
      clearTimeout(this.scheduledTimers.get(params.idempotencyKey)!);
    }

    const timer = setTimeout(async () => {
      this.scheduledTimers.delete(params.idempotencyKey);
      await this.processJob(jobData);
    }, delayMs);

    this.scheduledTimers.set(params.idempotencyKey, timer);

    return {
      jobId: params.idempotencyKey,
      delayMs,
    };
  }

  /**
   * Cancel a scheduled job
   */
  async cancelJob(idempotencyKey: string): Promise<boolean> {
    if (this.scheduledTimers.has(idempotencyKey)) {
      clearTimeout(this.scheduledTimers.get(idempotencyKey)!);
      this.scheduledTimers.delete(idempotencyKey);
    }

    try {
      const bullJob = await emailQueue.getJob(idempotencyKey);
      if (bullJob) {
        await bullJob.remove();
      }
    } catch (_) {}

    return true;
  }

  /**
   * Core Job Processing Engine:
   * 1. Checks sender rate limit (hourly sliding window).
   * 2. If rate limited: reschedules to start of next hour + dispatches Slack notification.
   * 3. If allowed: applies per-email provider delay, dispatches via Ethereal, updates DB & Elasticsearch.
   */
  async processJob(jobData: SendEmailJobData): Promise<void> {
    const jobRecord = demoDb.getEmailJob(jobData.emailJobId);
    if (!jobRecord) {
      logger.warn(`Job record ${jobData.emailJobId} not found in database. Skipping.`);
      return;
    }

    // Prevent duplicate processing if already completed
    if (jobRecord.status === 'SENT') {
      logger.info(`Job ${jobData.emailJobId} already SENT. Skipping duplicate execution.`);
      return;
    }

    const sender = demoDb.getSenderAccount(jobData.senderAccountId);
    const hourlyLimit = sender?.hourlyLimit || 50;
    const minDelaySeconds = jobData.minDelaySeconds ?? sender?.minDelaySeconds ?? 2;

    logger.info(`Processing email job ${jobRecord.idempotencyKey} to ${jobRecord.recipient}...`);

    // 1. Check Rate Limit
    const rateCheck = await rateLimiterService.checkAndIncrement(jobData.senderAccountId, hourlyLimit);

    if (!rateCheck.isAllowed) {
      // OVER-LIMIT HANDLING:
      // a) Do NOT fail or drop the job.
      // b) Compute delay until the next hour window.
      // c) Re-queue/delay the job to the next hour window.
      // d) Trigger Slack notification.
      const nextHourDate = new Date(rateCheck.nextHourTimestamp);
      logger.warn(
        `🚨 Sender ${jobData.senderAccountId} hit hourly limit (${rateCheck.currentCount}/${rateCheck.maxLimit}). Rescheduling job ${jobRecord.idempotencyKey} to ${nextHourDate.toISOString()} (+${rateCheck.retryAfterSeconds}s)`
      );

      demoDb.saveEmailJob({
        ...jobRecord,
        status: 'RESCHEDULED',
        scheduledAt: nextHourDate.toISOString(),
        errorMessage: `Hourly limit of ${rateCheck.maxLimit} reached. Auto-rescheduled to next hour window.`,
      });

      demoDb.logActivity('RATE_LIMIT', `Hourly rate limit hit (${rateCheck.currentCount}/${rateCheck.maxLimit}) for ${sender?.email || 'sender'}`);
      demoDb.logActivity('RESCHEDULED', `Email to ${jobRecord.recipient} auto-rescheduled to next hour window (0 dropped)`);

      // Trigger Slack Alert
      await slackService.notifyRateLimitHit({
        tenantId: jobData.tenantId,
        senderEmail: sender?.email || 'outreach@reachinbox.ethereal.email',
        hourlyLimit: rateCheck.maxLimit,
        currentCount: rateCheck.currentCount,
        rescheduledTo: nextHourDate,
        jobSubject: jobRecord.subject,
        recipient: jobRecord.recipient,
      });

      demoDb.logActivity('SLACK', `Slack rate-limit alert dispatched to #reachinbox-alerts`);

      // Reschedule job
      await this.scheduleJob({
        ...jobData,
        idempotencyKey: jobData.jobId,
        scheduledAt: nextHourDate,
      });

      // Update ES
      await elasticsearchService.indexEmail(demoDb.getEmailJob(jobRecord.id)!);
      return;
    }

    // 2. Mark PROCESSING
    demoDb.saveEmailJob({
      ...jobRecord,
      status: 'PROCESSING',
    });
    demoDb.logActivity('PROCESSING', `Worker processing cold email to ${jobRecord.recipient}`);

    // 3. Provider Throttling Delay (mimicking real provider cooldown)
    if (minDelaySeconds > 0) {
      logger.info(`Applying provider cooldown delay of ${minDelaySeconds}s for sender ${sender?.email}`);
      await new Promise((resolve) => setTimeout(resolve, minDelaySeconds * 1000));
    }

    // 4. Send Email via Ethereal Nodemailer
    try {
      const sendResult = await etherealService.sendEmail({
        fromName: sender?.name || 'ReachInbox Scheduler',
        fromEmail: sender?.email || 'outreach@reachinbox.ethereal.email',
        to: jobRecord.recipient,
        subject: jobRecord.subject,
        body: jobRecord.body,
      });

      const updated = demoDb.saveEmailJob({
        ...jobRecord,
        status: 'SENT',
        sentAt: new Date().toISOString(),
        etherealPreviewUrl: sendResult.previewUrl || null,
        errorMessage: null,
      });

      demoDb.logActivity('SENT', `Email delivered to ${jobRecord.recipient} via Ethereal SMTP`);

      // 5. Index into Elasticsearch
      await elasticsearchService.indexEmail(updated);

      logger.info(`✅ Successfully dispatched email to ${jobRecord.recipient}! Preview: ${sendResult.previewUrl}`);
    } catch (sendError: any) {
      logger.error(`❌ Failed to send email to ${jobRecord.recipient}: ${sendError.message}`);

      const failedJob = demoDb.saveEmailJob({
        ...jobRecord,
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        errorMessage: sendError.message,
        retryCount: jobRecord.retryCount + 1,
      });

      demoDb.logActivity('FAILED', `Email failed to ${jobRecord.recipient}: ${sendError.message}`);

      await elasticsearchService.indexEmail(failedJob);
    }
  }

  /**
   * Reconciliation Service:
   * On startup, scan DB for any 'SCHEDULED' or 'RESCHEDULED' jobs and safely re-enqueue them.
   */
  async reconcilePendingJobs(): Promise<{ reconciledCount: number }> {
    logger.info('Running startup queue reconciliation...');
    const allJobs = demoDb.getEmailJobs();
    const pendingJobs = allJobs.filter((j) => j.status === 'SCHEDULED' || j.status === 'RESCHEDULED');

    let reconciledCount = 0;
    const now = Date.now();

    for (const job of pendingJobs) {
      const scheduledTime = new Date(job.scheduledAt).getTime();
      // If scheduled time was in the past, schedule for immediate execution
      const effectiveScheduledAt = scheduledTime <= now ? new Date(now + 2000) : new Date(scheduledTime);

      await this.scheduleJob({
        emailJobId: job.id,
        idempotencyKey: job.idempotencyKey,
        tenantId: job.tenantId,
        userId: job.userId,
        senderAccountId: job.senderAccountId,
        recipient: job.recipient,
        subject: job.subject,
        body: job.body,
        scheduledAt: effectiveScheduledAt,
      });

      reconciledCount++;
    }

    logger.info(`Reconciliation complete. ${reconciledCount} pending jobs verified and queued.`);
    return { reconciledCount };
  }

  /**
   * Returns current queue statistics
   */
  getQueueMetrics() {
    const all = demoDb.getEmailJobs();
    const scheduled = all.filter((j) => j.status === 'SCHEDULED' || j.status === 'RESCHEDULED').length;
    const processing = all.filter((j) => j.status === 'PROCESSING').length;
    const sent = all.filter((j) => j.status === 'SENT').length;
    const failed = all.filter((j) => j.status === 'FAILED').length;

    return {
      total: all.length,
      scheduled,
      processing,
      sent,
      failed,
      activeTimers: this.scheduledTimers.size,
    };
  }
}

export const queueService = new QueueService();
