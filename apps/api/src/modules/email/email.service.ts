import { getConfig } from '../../config/env.js';
import { logger } from '@open333crm/core';
import { Resend } from 'resend';
import { setTimeout as delay } from 'node:timers/promises';
import type { Transporter } from 'nodemailer';
import { EmailCapacityError, type EmailFailoverCoordinator, type EmailPriority } from './email-failover.js';

export { EmailCapacityError, type EmailPriority } from './email-failover.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  metadata?: Record<string, unknown>;
  priority?: EmailPriority;
  idempotencyKey?: string;
}

export class UncertainEmailDeliveryError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Uncertain SMTP delivery outcome', { cause });
    this.name = 'UncertainEmailDeliveryError';
  }
}

let failoverCoordinator: EmailFailoverCoordinator | undefined;

export function configureEmailFailover(coordinator: EmailFailoverCoordinator): void {
  failoverCoordinator = coordinator;
}

function isSmtpRateThrottled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { responseCode?: number; response?: string };
  return detail.responseCode === 454 && typeof detail.response === 'string' &&
    !/daily.*quota/i.test(detail.response) && /throttl|rate|too many/i.test(detail.response);
}

function safeToFallback(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (isSmtpRateThrottled(error)) return false;
  const detail = error as { code?: string; originalCode?: string; responseCode?: number; command?: string };
  const serviceRejection = detail.responseCode !== undefined && detail.responseCode >= 400 && detail.responseCode < 600 &&
    (detail.command === 'MAIL FROM' || (detail.responseCode < 500 && detail.command === 'DATA') || detail.responseCode === 421);
  return detail.code === 'EDNS' || detail.code === 'EAUTH' || serviceRejection ||
    ((detail.code === 'ECONNECTION' || detail.code === 'ESOCKET') && detail.originalCode === 'ECONNREFUSED');
}

async function acquirePacedLease(
  coordinator: EmailFailoverCoordinator,
  priority: EmailPriority,
): Promise<{ token: string; provider: 'smtp' | 'resend' | 'probe' }> {
  const maxWaitMs = priority === 'transactional' ? 1_500 : 0;
  const startedAt = Date.now();
  while (true) {
    try {
      return await coordinator.acquire(priority);
    } catch (error) {
      if (!(error instanceof EmailCapacityError) || (error.reason !== 'rate_limited' && error.reason !== 'busy') || maxWaitMs <= 0) {
        throw error;
      }
      const remainingMs = maxWaitMs - (Date.now() - startedAt);
      if (remainingMs <= 0) throw error;
      const delayMs = Math.min(error.retryAfterMs + Math.floor(Math.random() * 50), remainingMs);
      await delay(delayMs);
    }
  }
}

async function sendWithCoordinator(input: SendEmailInput, failoverEnabled: boolean): Promise<void> {
  if (!failoverCoordinator) throw new Error('Email failover coordination is unavailable');
  const coordinator = failoverCoordinator;
  const priority = input.priority ?? 'transactional';
  const lease = await acquirePacedLease(coordinator, priority);

  if (lease.provider === 'resend') {
    if (!failoverEnabled) {
      await coordinator.finish(lease, 'success').catch(() => {});
      throw new Error('SMTP failover is disabled');
    }
    try {
      await sendViaResend(input, getConfig().EMAIL_FALLBACK_FROM, true);
    } finally {
      await coordinator.finish(lease, 'success').catch(() => logger.error('[EmailService] Failed to release Resend lease'));
    }
    return;
  }

  let submitted = false;
  try {
    await (await getTransporter()).verify();
    submitted = true;
    await sendViaSmtp(input);
  } catch (error) {
    if (isSmtpRateThrottled(error)) {
      await coordinator.finish(lease, 'throttled').catch(() => logger.error('[EmailService] Failed to release SMTP lease'));
      throw new EmailCapacityError('throttled', 1_000);
    }
    if (!failoverEnabled) {
      await coordinator.finish(lease, 'success').catch(() => logger.error('[EmailService] Failed to release SMTP lease'));
      if (submitted && !safeToFallback(error) && !(error && typeof error === 'object' && 'code' in error && (error.code === 'EENVELOPE' || error.code === 'EMESSAGE' || error.code === 'ESTREAM'))) {
        throw new UncertainEmailDeliveryError(error);
      }
      throw error;
    }
    const messageRejected = submitted && !safeToFallback(error) && !!error && typeof error === 'object' && 'code' in error &&
      (error.code === 'EENVELOPE' || error.code === 'EMESSAGE' || error.code === 'ESTREAM');
    await coordinator.finish(lease, messageRejected ? 'success' : 'fail');
    if (messageRejected) throw error;
    logger.info('[EmailService] SMTP circuit opened');
    if (submitted && !safeToFallback(error)) throw new UncertainEmailDeliveryError(error);
    const fallback = await acquirePacedLease(coordinator, priority);
    if (fallback.provider !== 'resend') {
      await coordinator.finish(fallback, 'success');
      throw new Error('Email failover circuit did not open');
    }
    try {
      await sendViaResend(input, getConfig().EMAIL_FALLBACK_FROM, true);
    } finally {
      await coordinator.finish(fallback, 'success').catch(() => logger.error('[EmailService] Failed to release Resend lease'));
    }
    return;
  }
  await coordinator.finish(lease, 'success').catch(() => logger.error('[EmailService] Failed to release SMTP lease'));
  if (lease.provider === 'probe') logger.info('[EmailService] SMTP recovery probe succeeded');
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const config = getConfig();
  const mode = config.EMAIL_DELIVERY_MODE;

  if (mode === 'webhook') {
    await sendViaWebhook(input);
    return;
  }
  if (mode === 'smtp') {
    if (config.EMAIL_SMTP_FAILOVER) {
      await sendWithCoordinator(input, true);
    } else if (failoverCoordinator) {
      await sendWithCoordinator(input, false);
    } else {
      await sendViaSmtp(input);
    }
    return;
  }
  if (mode === 'resend') {
    await sendViaResend(input);
    return;
  }

  logEmail(input);
}

// nodemailer transporter 模組級 lazy singleton（首次寄信才建）
let _transporter: Transporter | null = null;
let _resendClient: Resend | null = null;
async function getTransporter() {
  if (_transporter) return _transporter;
  // Lazy-load nodemailer so resend/log modes do not load SMTP transport unless used.
  const nodemailer = await import('nodemailer');
  if (_transporter) return _transporter;
  // 用 getConfig() 取強型別、已驗證的設定（SMTP_PORT 已 coerce number、SMTP_SECURE 已正確解析）
  const config = getConfig();
  _transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.EMAIL_SMTP_FAILOVER || failoverCoordinator
      ? { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 }
      : {}),
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

async function sendViaResend(input: SendEmailInput, sender = getConfig().EMAIL_FROM, bounded = false): Promise<void> {
  if (!sender) {
    throw new Error('A sender is required for Resend delivery');
  }

  const requestOptions = bounded || input.idempotencyKey
    ? {
        headers: {},
        ...(bounded ? { signal: AbortSignal.timeout(30_000) } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      }
    : undefined;
  try {
    const { data, error } = await getResendClient().emails.send({
      from: sender,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text !== undefined ? { text: input.text } : {}),
    }, requestOptions);

    if (error || !data?.id) {
      if (bounded && error?.statusCode === 429) {
        throw new EmailCapacityError('throttled', 1_000, `Resend rate limited (429): ${error.message}`);
      }
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
