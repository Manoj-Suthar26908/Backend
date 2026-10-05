import { Router, Request, Response, NextFunction } from 'express';
import { demoDb, DBSlackIntegration } from '../config/demo-db';
import { slackService } from '../services/slack.service';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export const slackRouter = Router();

/**
 * GET /api/slack/status
 * Returns current tenant Slack connection status
 */
slackRouter.get('/status', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
  const integration = demoDb.getSlackIntegration(tenantId);

  res.json({
    success: true,
    data: {
      isConnected: Boolean(integration && integration.isActive),
      teamName: integration?.teamName || null,
      channel: integration?.channel || null,
      webhookConfigured: Boolean(integration?.incomingWebhookUrl),
    },
  });
});

/**
 * POST /api/slack/webhook
 * Configure incoming webhook URL manually or via onboarding
 */
slackRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { webhookUrl, channel = '#reachinbox-alerts' } = req.body;
    const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';

    if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid Slack webhook URL (https://hooks.slack.com/...)',
      });
    }

    // Test webhook delivery
    await slackService.sendTestWebhook(webhookUrl, channel);

    const integration: DBSlackIntegration = {
      id: `slack-${Date.now()}`,
      tenantId,
      teamId: 'T0DEMO12345',
      teamName: 'ReachInbox Workspace',
      channel,
      channelId: 'C0DEMO12345',
      incomingWebhookUrl: webhookUrl,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    demoDb.saveSlackIntegration(integration);

    res.json({
      success: true,
      message: 'Slack webhook verified and connected!',
      data: integration,
    });
  } catch (error: any) {
    next(error);
  }
});

/**
 * GET /api/slack/install
 * Redirect to Slack OAuth authorization URL
 */
slackRouter.get('/install', (req: Request, res: Response) => {
  if (!config.slack.clientId) {
    return res.redirect(`${config.clientUrl}?slack_error=missing_credentials`);
  }

  const scopes = encodeURIComponent('incoming-webhook,chat:write');
  const redirectUri = encodeURIComponent(config.slack.redirectUri);
  const slackUrl = `https://slack.com/oauth/v2/authorize?client_id=${config.slack.clientId}&scope=${scopes}&redirect_uri=${redirectUri}`;

  res.redirect(slackUrl);
});

/**
 * GET /api/slack/callback
 * Handles Slack OAuth callback redirect
 */
slackRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error || !code) {
    return res.redirect(`${config.clientUrl}?slack_status=failed`);
  }

  try {
    // In production: exchange code for bot token & incoming webhook via https://slack.com/api/oauth.v2.access
    // In demo environment: simulate successful exchange
    const tenantId = 'tenant-reachinbox-primary';
    const integration: DBSlackIntegration = {
      id: `slack-${Date.now()}`,
      tenantId,
      teamId: 'T_SLACK_CONNECTED',
      teamName: 'Production Slack Workspace',
      channel: '#growth-outreach-alerts',
      channelId: 'C_GROWTH_01',
      incomingWebhookUrl: 'https://hooks.slack.com/services/DEMO/OAUTH/WEBHOOK',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    demoDb.saveSlackIntegration(integration);
    return res.redirect(`${config.clientUrl}?slack_status=connected`);
  } catch (err: any) {
    logger.error('Slack OAuth callback error', { error: err.message });
    return res.redirect(`${config.clientUrl}?slack_status=failed`);
  }
});

/**
 * POST /api/slack/disconnect
 */
slackRouter.post('/disconnect', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId || 'tenant-reachinbox-primary';
  const existing = demoDb.getSlackIntegration(tenantId);
  if (existing) {
    existing.isActive = false;
    existing.incomingWebhookUrl = '';
    demoDb.saveSlackIntegration(existing);
  }

  res.json({ success: true, message: 'Slack integration disconnected' });
});
