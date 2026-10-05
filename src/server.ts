import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from './queues/email.queue';
import { apiRouter } from './routes';
import { errorHandler } from './middlewares/error.middleware';
import { config } from './config/env';

export function createServer() {
  const app = express();

  // Bull-Board UI Setup mounted at /admin/queues
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter: serverAdapter,
  });

  // Security & Utility Middlewares
  app.use(
    helmet({
      contentSecurityPolicy: false, // Required for Bull-Board dashboard assets
    })
  );
  app.use(
    cors({
      origin: [config.clientUrl, 'http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    })
  );
  app.use(morgan('dev'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount Bull-Board monitoring
  app.use('/admin/queues', serverAdapter.getRouter());

  // Mount API Endpoints
  app.use('/api', apiRouter);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
