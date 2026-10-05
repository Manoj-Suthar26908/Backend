import axios from 'axios';
import { demoDb } from '../config/demo-db';
import { logger } from '../utils/logger';

export interface SlackRateLimitAlertData {
  tenantId: string;
  senderEmail: string;
  hourlyLimit: number;
  currentCount: number;
  rescheduledTo: Date;
  jobSubject: string;
  recipient: string;
}

export class SlackService {
  /**
   * Dispatches a formatted rich Slack message via incoming webhook
   */
  async notifyRateLimitHit(alert: SlackRateLimitAlertData): Promise<boolean> {
    const integration = demoDb.getSlackIntegration(alert.tenantId);

    if (!integration || !integration.incomingWebhookUrl) {
      logger.info(
        `[Slack Notice] Rate limit triggered for ${alert.senderEmail}, but no active Slack Webhook is connected for tenant ${alert.tenantId}.`
      );
      return false;
    }

    const payload = {
      text: `⚠️ *ReachInbox Rate Limit Alert*: Sender \`${alert.senderEmail}\` exceeded hourly limit!`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Sender Hourly Rate Limit Exceeded',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Sender Account:* \`${alert.senderEmail}\`\n*Limit Status:* Sent *${alert.currentCount}* / *${alert.hourlyLimit}* emails in the current hour window.\n*Automated Action:* Job has been safely delayed and rescheduled to the start of the next hour window. Zero emails were dropped.`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Next Resume Window:*\n<!date^${Math.floor(alert.rescheduledTo.getTime() / 1000)}^{date_num} {time_secs}|${alert.rescheduledTo.toISOString()}>`,
            },
            {
              type: 'mrkdwn',
              text: `*Paused Recipient:*\n\`${alert.recipient}\``,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `ReachInbox Scheduler | Zero-Cron Rescheduling Engine | Tenant: ${alert.tenantId}`,
            },
          ],
        },
      ],
    };

    try {
      logger.info(`Dispatching Slack alert to webhook for tenant ${alert.tenantId}...`);
      await axios.post(integration.incomingWebhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      logger.info(`Slack alert successfully delivered for ${alert.senderEmail}`);
      return true;
    } catch (error: any) {
      logger.error('Failed to deliver Slack webhook notification', {
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Sends a test ping to verify a webhook URL
   */
  async sendTestWebhook(webhookUrl: string, channelName: string = '#general'): Promise<boolean> {
    const payload = {
      text: '✅ *ReachInbox Scheduler Slack Integration Connected!*',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎉 *ReachInbox Scheduler* is now connected to *${channelName}*! Real-time alerts will appear here whenever sender limits trigger.`,
          },
        },
      ],
    };

    try {
      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      return true;
    } catch (error: any) {
      logger.error('Slack webhook test failed', { error: error.response?.data || error.message });
      throw new Error(`Slack test failed: ${error.message}`);
    }
  }
}

export const slackService = new SlackService();
