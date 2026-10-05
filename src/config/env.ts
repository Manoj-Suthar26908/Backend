import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory or fallback to root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',

  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres123@localhost:5432/reachinbox_scheduler?schema=public',

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'redis123',
    maxRetriesPerRequest: null, // Required for BullMQ
  },

  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_INDEX || 'reachinbox_emails',
  },

  queue: {
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
    defaultMinDelaySeconds: parseInt(process.env.DEFAULT_MIN_DELAY_SECONDS || '2', 10),
    defaultMaxEmailsPerHour: parseInt(process.env.DEFAULT_MAX_EMAILS_PER_HOUR || '50', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'super_secret_jwt_reachinbox_dev_key_change_in_production_32char',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
  },

  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:4000/api/slack/callback',
  },

  ethereal: {
    user: process.env.ETHEREAL_USER || '',
    pass: process.env.ETHEREAL_PASS || '',
  },
};
