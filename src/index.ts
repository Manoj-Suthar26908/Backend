import { createServer } from './server';
import { config } from './config/env';
import { connectPrisma } from './config/prisma';
import { initElasticsearch } from './config/elasticsearch';
import { queueService } from './queues/queue.service';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    logger.info('======================================================');
    logger.info('🚀 ReachInbox Scheduler — Zero-Cron Cold Outreach Engine');
    logger.info('======================================================');

    // Attempt PostgreSQL connection via Prisma (logs warning if not running yet)
    try {
      await connectPrisma();
    } catch (dbErr: any) {
      logger.warn('PostgreSQL not accessible directly. Operating in zero-dependency Demo Mode.');
    }

    // Attempt Elasticsearch initialization (logs warning if not running yet)
    try {
      await initElasticsearch();
    } catch (esErr: any) {
      logger.warn('Elasticsearch cluster not running. Operating in zero-dependency Demo Mode.');
    }

    // Run Queue Crash-Recovery Reconciliation
    await queueService.reconcilePendingJobs();

    // Start HTTP Server
    const app = createServer();
    const server = app.listen(config.port, () => {
      logger.info(`✅ ReachInbox API Server running at http://localhost:${config.port}`);
      logger.info(`📊 Bull-Board Queue Dashboard: http://localhost:${config.port}/admin/queues`);
      logger.info(`🩺 Health & Queue Stats: http://localhost:${config.port}/api/health`);
    });

    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed. Exiting.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error: any) {
    logger.error('Fatal bootstrap error:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

bootstrap();
