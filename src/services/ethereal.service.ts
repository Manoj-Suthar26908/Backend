import nodemailer, { Transporter, TestAccount } from 'nodemailer';
import { logger } from '../utils/logger';

class EtherealService {
  private transporter: Transporter | null = null;
  private testAccount: TestAccount | null = null;
  private isInitializing = false;

  async getTransporter(): Promise<{ transporter: Transporter; account: TestAccount }> {
    if (this.transporter && this.testAccount) {
      return { transporter: this.transporter, account: this.testAccount };
    }

    if (this.isInitializing) {
      // Wait for initialization to complete
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this.getTransporter();
    }

    this.isInitializing = true;
    try {
      logger.info('Initializing Nodemailer Ethereal test account...');
      this.testAccount = await nodemailer.createTestAccount();
      logger.info(`Ethereal test account created: ${this.testAccount.user}`);

      this.transporter = nodemailer.createTransport({
        host: this.testAccount.smtp.host,
        port: this.testAccount.smtp.port,
        secure: this.testAccount.smtp.secure,
        auth: {
          user: this.testAccount.user,
          pass: this.testAccount.pass,
        },
      });

      return { transporter: this.transporter, account: this.testAccount };
    } catch (err: any) {
      logger.error('Failed to create Ethereal test account', { error: err.message });
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  async sendEmail(options: {
    fromName?: string;
    fromEmail?: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<{ messageId: string; previewUrl: string | false }> {
    const { transporter, account } = await this.getTransporter();

    const fromAddress = options.fromEmail
      ? `"${options.fromName || 'ReachInbox Scheduler'}" <${options.fromEmail}>`
      : `"${options.fromName || 'ReachInbox Scheduler'}" <${account.user}>`;

    const info = await transporter.sendMail({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
          <div style="border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 20px;">
            <h2 style="color: #1e293b; margin: 0; font-size: 20px;">ReachInbox Scheduler</h2>
            <p style="color: #64748b; margin: 4px 0 0 0; font-size: 13px;">Automated Cold Outreach Engine</p>
          </div>
          <div style="color: #334155; line-height: 1.6; font-size: 15px; white-space: pre-line;">
            ${options.body}
          </div>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; color: #94a3b8; font-size: 12px; display: flex; justify-content: space-between;">
            <span>Sent via ReachInbox Zero-Cron Delayed Queue</span>
            <span>ID: ${Date.now()}</span>
          </div>
        </div>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    logger.info(`Email successfully dispatched via Ethereal to ${options.to}`);
    if (previewUrl) {
      logger.info(`Ethereal Preview URL: ${previewUrl}`);
    }

    return {
      messageId: info.messageId,
      previewUrl: previewUrl,
    };
  }
}

export const etherealService = new EtherealService();
