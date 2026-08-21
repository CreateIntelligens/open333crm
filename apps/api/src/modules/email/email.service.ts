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
  if (mode === 'smtp') {
    await sendViaSmtp(input);
    return;
  }

  logEmail(input);
}

// nodemailer transporter 模組級 lazy singleton（首次寄信才建）
let _transporter: import('nodemailer').Transporter | null = null;
async function getTransporter() {
  if (_transporter) return _transporter;
  const nodemailer = await import('nodemailer');
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {}),
  });
  return _transporter;
}

async function sendViaSmtp(input: SendEmailInput): Promise<void> {
  const from = process.env.EMAIL_FROM ?? 'noreply@open333crm.local';
  const transporter = await getTransporter();
  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
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
  // metadata 拼進 message 字串（winston 第二參數需為 object，字串會被丟）——
  // log 模式供本機/開發取驗證連結等。
  const meta = JSON.stringify({
    to: input.to,
    subject: input.subject,
    htmlLength: input.html.length,
    metadata: input.metadata ?? {},
  });
  logger.info(`[EmailService] Delivery mode=log ${meta}`);
}
