import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { demoDb, DBEmailJob } from '../config/demo-db';
import { queueService } from '../queues/queue.service';
import { elasticsearchService } from '../services/elasticsearch.service';
import { rateLimiterService } from '../services/rate-limiter.service';
import { logger } from '../utils/logger';

export const emailRouter = Router();

// Validation schema for email scheduling
const scheduleEmailSchema = z.object({
  recipients: z.array(z.string().email('Invalid email address')).min(1, 'At least one recipient is required'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  startTime: z.string().optional(), // ISO string
  delayBetweenEmailsSeconds: z.number().min(0).max(3600).default(2),
  hourlyLimit: z.number().min(1).max(1000).default(5),
  senderAccountId: z.string().optional(),
});

/**
 * POST /api/emails/schedule
 * Batch/Single email scheduling with zero-cron delayed queue
 */
emailRouter.post('/schedule', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = scheduleEmailSchema.parse(req.body);

    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
    const userId = (req as any).user?.id || 'user-demo-admin';

    // Get or create sender account
    let sender = validated.senderAccountId
      ? demoDb.getSenderAccount(validated.senderAccountId)
      : demoDb.getSenderAccounts(tenantId)[0];

    if (!sender) {
      sender = demoDb.saveSenderAccount({
        id: 'sender-default-ethereal',
        tenantId,
        email: 'outreach@reachinbox.ethereal.email',
        name: 'Alex from ReachInbox',
        provider: 'ETHEREAL',
        hourlyLimit: validated.hourlyLimit,
        minDelaySeconds: validated.delayBetweenEmailsSeconds,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else if (validated.hourlyLimit !== sender.hourlyLimit) {
      sender.hourlyLimit = validated.hourlyLimit;
      demoDb.saveSenderAccount(sender);
    }

    const batchId = `batch-${uuidv4().slice(0, 8)}`;
    const baseStartTime = validated.startTime ? new Date(validated.startTime).getTime() : Date.now();
    const createdJobs: DBEmailJob[] = [];

    // Schedule sequentially with per-email delay
    for (let i = 0; i < validated.recipients.length; i++) {
      const recipient = validated.recipients[i];
      const scheduledTimestamp = baseStartTime + i * validated.delayBetweenEmailsSeconds * 1000;
      const scheduledAtDate = new Date(scheduledTimestamp);
      const idempotencyKey = uuidv4();

      // Step 1: Write to DB with SCHEDULED status
      const jobRecord: DBEmailJob = {
        id: uuidv4(),
        idempotencyKey,
        tenantId,
        userId,
        senderAccountId: sender.id,
        recipient,
        subject: validated.subject,
        body: validated.body,
        status: 'SCHEDULED',
        scheduledAt: scheduledAtDate.toISOString(),
        retryCount: 0,
        batchId,
        metadata: {
          delayBetweenEmailsSeconds: validated.delayBetweenEmailsSeconds,
          senderEmail: sender.email,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saved = demoDb.saveEmailJob(jobRecord);

      // Step 2: Push to BullMQ / Delayed Queue
      await queueService.scheduleJob({
        emailJobId: saved.id,
        idempotencyKey: saved.idempotencyKey,
        tenantId,
        userId,
        senderAccountId: sender.id,
        recipient: saved.recipient,
        subject: saved.subject,
        body: saved.body,
        scheduledAt: scheduledAtDate,
        minDelaySeconds: validated.delayBetweenEmailsSeconds,
      });

      // Step 3: Index initial SCHEDULED document into Elasticsearch
      await elasticsearchService.indexEmail(saved);

      createdJobs.push(saved);
    }

    demoDb.logActivity('SCHEDULED', `Scheduled batch of ${createdJobs.length} cold emails with ${validated.delayBetweenEmailsSeconds}s stagger`);

    logger.info(`Scheduled batch ${batchId} with ${createdJobs.length} emails.`);

    res.status(201).json({
      success: true,
      data: {
        batchId,
        count: createdJobs.length,
        jobs: createdJobs,
      },
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * GET /api/emails/activities
 */
emailRouter.get('/activities', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const list = demoDb.getActivities(limit);
  res.json({ success: true, data: list });
});

/**
 * GET /api/emails/scheduled
 */
emailRouter.get('/scheduled', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
    const all = demoDb.getEmailJobs({ tenantId });
    const scheduled = all.filter((j) => j.status === 'SCHEDULED' || j.status === 'RESCHEDULED' || j.status === 'PROCESSING');

    scheduled.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    res.json({
      success: true,
      data: scheduled,
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * GET /api/emails/sent
 */
emailRouter.get('/sent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
    const all = demoDb.getEmailJobs({ tenantId });
    const sent = all.filter((j) => j.status === 'SENT' || j.status === 'FAILED');

    sent.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({
      success: true,
      data: sent,
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * GET /api/emails/search?q={query}&status={status}
 */
emailRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
    const query = req.query.q as string | undefined;
    const status = req.query.status as string | undefined;

    const result = await elasticsearchService.searchEmails({
      tenantId,
      query,
      status,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * POST /api/emails/:id/cancel
 */
emailRouter.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = demoDb.getEmailJob(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    if (job.status === 'SENT') {
      return res.status(400).json({ success: false, error: 'Cannot cancel an already sent email' });
    }

    await queueService.cancelJob(job.idempotencyKey);
    demoDb.deleteEmailJob(job.id);

    res.json({
      success: true,
      message: 'Job cancelled and removed from queue',
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * POST /api/emails/reset-rate-limit
 */
emailRouter.post('/reset-rate-limit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
    const sender = demoDb.getSenderAccounts(tenantId)[0];
    if (sender) {
      await rateLimiterService.resetSenderLimit(sender.id);
    }
    res.json({ success: true, message: 'Rate limits reset successfully' });
  } catch (error: any) {
    next(error);
  }
});

/**
 * GET /api/emails/stats
 */
emailRouter.get('/stats', (req: Request, res: Response) => {
  const metrics = queueService.getQueueMetrics();
  res.json({ success: true, data: metrics });
});
