import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import webPush from 'web-push';
import type { EmailConfig, GatewayConfig } from '../config/gateway-config.js';
import type { RenderedEmail } from './templates.js';

export interface EmailMessage extends RenderedEmail {
  to: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Development provider: logs instead of sending, and keeps the last messages for tests. */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`(EMAIL_PROVIDER=log) To ${message.to}: ${message.subject}`);
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, html: message.html, text: message.text });
  }
}

export function createEmailSender(config: EmailConfig): EmailSender {
  switch (config.provider) {
    case 'resend':
      return new ResendEmailSender(config.resendApiKey, config.from);
    case 'smtp':
      return new SmtpEmailSender(config.smtpUrl, config.from);
    case 'log':
      return new LogEmailSender();
  }
}

export class PushGoneError extends Error {}

export interface PushSender {
  readonly enabled: boolean;
  send(subscription: { endpoint: string; p256dh: string; auth: string }, payload: object): Promise<void>;
}

export function createPushSender(config: GatewayConfig['push']): PushSender {
  return {
    enabled: Boolean(config),
    async send(subscription, payload) {
      if (!config) throw new Error('Web push is not configured (VAPID keys missing)');
      try {
        await webPush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { TTL: 3_600, vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey } },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // The browser unsubscribed or the subscription expired: it will never work again.
        if (status === 404 || status === 410) throw new PushGoneError(`Subscription gone (${status})`);
        throw error;
      }
    },
  };
}
