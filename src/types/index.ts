export interface SendEmailJobData {
  jobId: string; // matches EmailJob.idempotencyKey
  emailJobId: string; // DB UUID
  tenantId: string;
  userId: string;
  senderAccountId: string;
  recipient: string;
  subject: string;
  body: string;
  minDelaySeconds?: number;
  scheduledAt: string; // ISO string
}

export interface ElasticsearchEmailDoc {
  id: string;
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  senderAccountId: string;
  recipient: string;
  sender: string;
  subject: string;
  body_preview: string;
  status: string;
  scheduled_at: string;
  sent_at?: string | null;
  created_at: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string | null;
  tenantId: string;
  role: string;
}

export interface RateLimitCheckResult {
  isAllowed: boolean;
  currentCount: number;
  maxLimit: number;
  retryAfterSeconds: number;
  nextHourTimestamp: number;
}
