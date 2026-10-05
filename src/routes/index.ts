import { Router } from 'express';
import { emailRouter } from './email.routes';
import { slackRouter } from './slack.routes';
import { authRouter } from './auth.routes';
import { queueService } from '../queues/queue.service';

export const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'reachinbox-scheduler-backend',
    timestamp: new Date().toISOString(),
    queueMetrics: queueService.getQueueMetrics(),
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/emails', emailRouter);
apiRouter.use('/slack', slackRouter);
apiRouter.get('/admin/queue-stats', (req, res) => {
  res.json({
    success: true,
    data: queueService.getQueueMetrics(),
  });
});
