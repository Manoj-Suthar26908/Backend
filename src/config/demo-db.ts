import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface DBUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  googleId: string;
  role: 'ADMIN' | 'USER';
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DBTenant {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DBSenderAccount {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  provider: 'ETHEREAL' | 'SMTP' | 'GOOGLE';
  hourlyLimit: number;
  minDelaySeconds: number;
  credentials?: any;
  createdAt: string;
  updatedAt: string;
}

export interface DBEmailJob {
  id: string;
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  senderAccountId: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RESCHEDULED';
  scheduledAt: string;
  sentAt?: string | null;
  failedAt?: string | null;
  etherealPreviewUrl?: string | null;
  errorMessage?: string | null;
  retryCount: number;
  batchId?: string | null;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface DBSlackIntegration {
  id: string;
  tenantId: string;
  userId?: string | null;
  teamId: string;
  teamName: string;
  channel: string;
  channelId: string;
  incomingWebhookUrl: string;
  botAccessToken?: string | null;
  scopes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DBActivity {
  id: string;
  type: 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'RATE_LIMIT' | 'SLACK' | 'RESCHEDULED';
  message: string;
  timestamp: string;
  metadata?: any;
}

interface DatabaseSchema {
  tenants: DBTenant[];
  users: DBUser[];
  senderAccounts: DBSenderAccount[];
  emailJobs: DBEmailJob[];
  slackIntegrations: DBSlackIntegration[];
  activities: DBActivity[];
}

const DATA_FILE = path.resolve(__dirname, '../../data/demo_db.json');

class DemoDatabase {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.loadData();
    this.seedDefaultData();
  }

  private loadData(): DatabaseSchema {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.activities) parsed.activities = [];
        return parsed;
      }
    } catch (e) {
      logger.warn('Could not read existing demo DB file, initializing fresh store.');
    }

    return {
      tenants: [],
      users: [],
      senderAccounts: [],
      emailJobs: [],
      slackIntegrations: [],
      activities: [],
    };
  }

  private persist() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e: any) {
      logger.error('Failed to persist demo database', { error: e.message });
    }
  }

  private seedDefaultData() {
    if (this.data.tenants.length === 0) {
      const defaultTenant: DBTenant = {
        id: 'tenant-reachinbox-primary',
        name: 'ReachInbox Growth Workspace',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.tenants.push(defaultTenant);

      const defaultUser: DBUser = {
        id: 'user-demo-admin',
        email: 'alex.morgan@reachinbox.ai',
        name: 'Alex Morgan',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        googleId: 'google-oauth-demo-12345',
        role: 'ADMIN',
        tenantId: defaultTenant.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.users.push(defaultUser);

      const defaultSender: DBSenderAccount = {
        id: 'sender-default-ethereal',
        tenantId: defaultTenant.id,
        email: 'outreach@reachinbox.ethereal.email',
        name: 'Alex from ReachInbox',
        provider: 'ETHEREAL',
        hourlyLimit: 5, // Set to 5 for easy demo testing of rate limit handling
        minDelaySeconds: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.senderAccounts.push(defaultSender);

      this.persist();
      logger.info('Demo database seeded with default tenant, user, and sender account (hourly limit: 5).');
    }

    if (!this.data.activities || this.data.activities.length === 0) {
      this.data.activities = [
        {
          id: 'act-init-1',
          type: 'SENT',
          message: 'Cold outreach email sent to sarah.connor@example.com (Ethereal preview ready)',
          timestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        },
        {
          id: 'act-init-2',
          type: 'RATE_LIMIT',
          message: 'Hourly sliding window limit (5/5) reached for sender outreach@reachinbox.ai',
          timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
        {
          id: 'act-init-3',
          type: 'SLACK',
          message: 'Slack rate-limit alert block-kit notification sent to connected webhook',
          timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
        {
          id: 'act-init-4',
          type: 'RESCHEDULED',
          message: 'Job lead5@company.com auto-delayed to start of next hour window (0 dropped)',
          timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
      ];
      this.persist();
    }
  }

  // Tenant methods
  getTenant(id: string) {
    return this.data.tenants.find((t) => t.id === id);
  }

  // User methods
  getUser(id: string) {
    return this.data.users.find((u) => u.id === id);
  }

  getUserByEmail(email: string) {
    return this.data.users.find((u) => u.email === email);
  }

  saveUser(user: DBUser) {
    const idx = this.data.users.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      this.data.users[idx] = user;
    } else {
      this.data.users.push(user);
    }
    this.persist();
    return user;
  }

  // Sender methods
  getSenderAccount(id: string) {
    return this.data.senderAccounts.find((s) => s.id === id);
  }

  getSenderAccounts(tenantId: string) {
    return this.data.senderAccounts.filter((s) => s.tenantId === tenantId);
  }

  saveSenderAccount(sender: DBSenderAccount) {
    const idx = this.data.senderAccounts.findIndex((s) => s.id === sender.id);
    if (idx >= 0) {
      this.data.senderAccounts[idx] = sender;
    } else {
      this.data.senderAccounts.push(sender);
    }
    this.persist();
    return sender;
  }

  // EmailJob methods
  getEmailJob(id: string) {
    return this.data.emailJobs.find((j) => j.id === id || j.idempotencyKey === id);
  }

  getEmailJobs(filter?: { tenantId?: string; status?: string }) {
    return this.data.emailJobs.filter((j) => {
      if (filter?.tenantId && j.tenantId !== filter.tenantId) return false;
      if (filter?.status && j.status !== filter.status) return false;
      return true;
    });
  }

  saveEmailJob(job: DBEmailJob) {
    const idx = this.data.emailJobs.findIndex((j) => j.id === job.id || j.idempotencyKey === job.idempotencyKey);
    if (idx >= 0) {
      this.data.emailJobs[idx] = { ...this.data.emailJobs[idx], ...job, updatedAt: new Date().toISOString() };
    } else {
      this.data.emailJobs.push(job);
    }
    this.persist();
    return this.getEmailJob(job.id)!;
  }

  deleteEmailJob(id: string) {
    const idx = this.data.emailJobs.findIndex((j) => j.id === id);
    if (idx >= 0) {
      this.data.emailJobs.splice(idx, 1);
      this.persist();
      return true;
    }
    return false;
  }

  // SlackIntegration methods
  getSlackIntegration(tenantId: string) {
    return this.data.slackIntegrations.find((s) => s.tenantId === tenantId && s.isActive);
  }

  saveSlackIntegration(integration: DBSlackIntegration) {
    const idx = this.data.slackIntegrations.findIndex((s) => s.tenantId === integration.tenantId);
    if (idx >= 0) {
      this.data.slackIntegrations[idx] = integration;
    } else {
      this.data.slackIntegrations.push(integration);
    }
    this.persist();
    return integration;
  }

  // Activity Log methods
  getActivities(limit: number = 20): DBActivity[] {
    if (!this.data.activities) this.data.activities = [];
    return [...this.data.activities].reverse().slice(0, limit);
  }

  logActivity(type: DBActivity['type'], message: string, metadata?: any): DBActivity {
    if (!this.data.activities) this.data.activities = [];
    const item: DBActivity = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };
    this.data.activities.push(item);
    // Keep last 100 activities
    if (this.data.activities.length > 100) {
      this.data.activities = this.data.activities.slice(-100);
    }
    this.persist();
    return item;
  }
}

export const demoDb = new DemoDatabase();
