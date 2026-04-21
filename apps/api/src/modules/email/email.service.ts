import { getConfig } from '../../config/env.js';
import { logger } from '@open333crm/core';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const mode = process.env.EMAIL_DELIVERY_MODE ?? 'log';

  if (mode === 'webhook') {
    await sendViaWebhook(input);
    return;
  }

  logEmail(input);
}

async function sendViaWebhook(input: SendEmailInput): Promise<void> {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url) {
    throw new Error('EMAIL_WEBHOOK_URL is required when EMAIL_DELIVERY_MODE=webhook');
  }

  const from = process.env.EMAIL_FROM ?? 'noreply@open333crm.local';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EMAIL_WEBHOOK_AUTH_TOKEN
        ? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_AUTH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      metadata: input.metadata ?? {},
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email webhook failed (${response.status}): ${body}`);
  }
}

function logEmail(input: SendEmailInput) {
  void getConfig();
  logger.info(
    '[EmailService] Delivery mode=log',
    JSON.stringify(
      {
        to: input.to,
        subject: input.subject,
        htmlLength: input.html.length,
        metadata: input.metadata ?? {},
      },
      null,
      2,
    ),
  );
}
