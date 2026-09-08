import { getConfig } from '../../config/env.js';
import { logger } from '@open333crm/core';
import { Resend } from 'resend';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const mode = getConfig().EMAIL_DELIVERY_MODE;

  if (mode === 'webhook') {
    await sendViaWebhook(input);
    return;
  }
  if (mode === 'smtp') {
    await sendViaSmtp(input);
    return;
  }
  if (mode === 'resend') {
    await sendViaResend(input);
    return;
  }

  logEmail(input);
}

// nodemailer transporter 模組級 lazy singleton（首次寄信才建）
let _transporter: import('nodemailer').Transporter | null = null;
let _resendClient: Resend | null = null;
async function getTransporter() {
  if (_transporter) return _transporter;
  const nodemailer = await import('nodemailer');
  // 用 getConfig() 取強型別、已驗證的設定（SMTP_PORT 已 coerce number、SMTP_SECURE 已正確解析）
  const config = getConfig();
  _transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } } : {}),
  });
  return _transporter;
}

async function sendViaSmtp(input: SendEmailInput): Promise<void> {
  const from = getConfig().EMAIL_FROM ?? 'noreply@open333crm.local';
  const transporter = await getTransporter();
  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
}

function getResendClient(): Resend {
  if (_resendClient) return _resendClient;

  const apiKey = getConfig().RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required when EMAIL_DELIVERY_MODE=resend');
  }

  _resendClient = new Resend(apiKey);
  return _resendClient;
}

async function sendViaResend(input: SendEmailInput): Promise<void> {
  const config = getConfig();
  if (!config.EMAIL_FROM) {
    throw new Error('EMAIL_FROM is required when EMAIL_DELIVERY_MODE=resend');
  }

  try {
    const { data, error } = await getResendClient().emails.send({
      from: config.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text !== undefined ? { text: input.text } : {}),
    });

    if (error || !data?.id) {
      const providerError = error
        ? `${error.name ?? 'provider_error'} (${error.statusCode ?? 'unknown'}): ${error.message}`
        : 'provider returned no message ID';
      throw new Error(`Resend email failed: ${providerError}`);
    }

    logger.info(
      `[EmailService] Delivery mode=resend ${JSON.stringify({
        to: input.to,
        subject: input.subject,
        providerMessageId: data.id,
      })}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
    logger.error(`[EmailService] Resend delivery failed: ${message}`);
    throw error;
  }
}

async function sendViaWebhook(input: SendEmailInput): Promise<void> {
  const config = getConfig();
  const url = config.EMAIL_WEBHOOK_URL;
  if (!url) {
    throw new Error('EMAIL_WEBHOOK_URL is required when EMAIL_DELIVERY_MODE=webhook');
  }

  const from = config.EMAIL_FROM ?? 'noreply@open333crm.local';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.EMAIL_WEBHOOK_AUTH_TOKEN
        ? { Authorization: `Bearer ${config.EMAIL_WEBHOOK_AUTH_TOKEN}` }
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
