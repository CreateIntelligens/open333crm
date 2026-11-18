import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  smtp: vi.fn(),
  verify: vi.fn(),
  evaluate: vi.fn(),
  resend: vi.fn(),
  config: {
    EMAIL_DELIVERY_MODE: 'smtp',
    EMAIL_SMTP_FAILOVER: true,
    EMAIL_FROM: 'primary@example.com',
    EMAIL_FALLBACK_FROM: 'backup@example.com',
    RESEND_API_KEY: 'test-key',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
  },
}));

vi.mock('#src/config/env.js', () => ({ getConfig: () => state.config }));
vi.mock('@open333crm/core', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: state.smtp, verify: state.verify }) }));
vi.mock('resend', () => ({ Resend: class { emails = { send: state.resend }; } }));

import * as email from '#src/modules/email/email.service.js';
import { EmailFailoverCoordinator } from '#src/modules/email/email-failover.js';
import type { Redis } from 'ioredis';

const message = { to: 'customer@example.com', subject: 'Hello', html: '<p>Hi</p>' };

beforeEach(() => {
  state.verify.mockReset();
  state.verify.mockResolvedValue(true);
  state.smtp.mockReset();
  state.resend.mockReset();
  state.config.EMAIL_SMTP_FAILOVER = true;
  state.resend.mockResolvedValue({ data: { id: 'backup-id' }, error: null });
  state.evaluate.mockReset()
    .mockResolvedValueOnce('smtp')
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce('resend')
    .mockResolvedValue(1);
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: state.evaluate } as unknown as Redis));
});

test('SMTP connection fails before submission', async () => {
  state.verify.mockRejectedValue(Object.assign(new Error('SMTP timed out'), { code: 'ETIMEDOUT', command: 'CONN' }));
  await email.sendEmail(message);
  assert.equal(state.resend.mock.calls.length, 1);
  assert.equal(state.resend.mock.calls[0][0].from, 'backup@example.com');
});

test('SMTP acceptance is uncertain', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'ESOCKET', command: 'CONN' }));
  await assert.rejects(email.sendEmail(message));
  assert.equal(state.resend.mock.calls.length, 0);
});

test('Failover is disabled', async () => {
  state.config.EMAIL_SMTP_FAILOVER = false;
  state.smtp.mockRejectedValue(Object.assign(new Error('DNS failed'), { code: 'EDNS', command: 'CONN' }));
  await assert.rejects(email.sendEmail(message));
  assert.equal(state.resend.mock.calls.length, 0);
});

test('Resend rejects the fallback message', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('DNS failed'), { code: 'EDNS' }));
  state.resend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'sender rejected' } });
  await assert.rejects(email.sendEmail(message), /Resend email failed/);
});

test('Coordination is unavailable', async () => {
  const evaluate = vi.fn().mockRejectedValue(new Error('Redis unavailable'));
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: evaluate } as unknown as Redis));
  await assert.rejects(email.sendEmail(message), /Redis unavailable/);
  assert.equal(state.smtp.mock.calls.length, 0);
  assert.equal(state.resend.mock.calls.length, 0);
});

test('Recipient rejection does not activate Resend', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('recipient rejected'), { code: 'EENVELOPE' }));
  await assert.rejects(email.sendEmail(message), /recipient rejected/);
  assert.equal(state.resend.mock.calls.length, 0);
  assert.equal(state.evaluate.mock.calls[1].at(-2), 'release');
});

test('An active request renews its Redis lease until it finishes', async () => {
  vi.useFakeTimers();
  const evaluate = vi.fn().mockResolvedValueOnce('smtp').mockResolvedValue(1);
  const coordinator = new EmailFailoverCoordinator({ eval: evaluate } as unknown as Redis);
  try {
    const lease = await coordinator.acquire();
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(evaluate.mock.calls.length, 2);
    await coordinator.finish(lease, 'success');
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(evaluate.mock.calls.length, 3);
  } finally {
    vi.useRealTimers();
  }
});

test('SMTP content rejection does not open the provider circuit', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('message rejected'), { code: 'EMESSAGE' }));
  await assert.rejects(email.sendEmail(message), /message rejected/);
  assert.equal(state.resend.mock.calls.length, 0);
  assert.equal(state.evaluate.mock.calls[1].at(-2), 'release');
});

test('SMTP temporary service rejection falls back to Resend', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('service unavailable'), {
    code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 454,
  }));
  await email.sendEmail(message);
  assert.equal(state.resend.mock.calls.length, 1);
  assert.equal(state.evaluate.mock.calls[1].at(-2), 'fail');
});

test('SMTP sender authorization rejection falls back to Resend', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('sender not verified'), {
    code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550,
  }));
  await email.sendEmail(message);
  assert.equal(state.resend.mock.calls.length, 1);
});

test('SMTP rate throttling backs off without opening circuit', async () => {
  state.smtp.mockRejectedValue(Object.assign(new Error('454 Throttling failure: Maximum sending rate exceeded'), {
    code: 'EENVELOPE',
    command: 'MAIL FROM',
    responseCode: 454,
    response: '454 Throttling failure: Maximum sending rate exceeded',
  }));
  await assert.rejects(
    email.sendEmail(message),
    (err: unknown) => err instanceof email.EmailCapacityError && err.reason === 'throttled' && err.retryAfterMs > 0,
  );
  assert.equal(state.resend.mock.calls.length, 0);
  assert.equal(state.evaluate.mock.calls[1].at(-2), 'release');
});

test('Bulk priority fails promptly on rate_limited without sleeping while transactional paces briefly', async () => {
  const evaluate = vi.fn().mockResolvedValueOnce('rate_limited:250');
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: evaluate } as unknown as Redis));
  await assert.rejects(
    email.sendEmail({ ...message, priority: 'bulk' }),
    (err: unknown) => err instanceof email.EmailCapacityError && err.reason === 'rate_limited' && err.retryAfterMs === 250,
  );

  const paced = vi.fn()
    .mockResolvedValueOnce('rate_limited:50')
    .mockResolvedValueOnce('smtp')
    .mockResolvedValueOnce(1);
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: paced } as unknown as Redis));
  await email.sendEmail({ ...message, priority: 'transactional' });
  assert.equal(state.smtp.mock.calls.length, 1);
});

test('Transactional send waits briefly on busy and passes idempotencyKey on Resend fallback', async () => {
  const evaluate = vi.fn()
    .mockResolvedValueOnce('busy')
    .mockResolvedValueOnce('smtp')
    .mockResolvedValueOnce(1);
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: evaluate } as unknown as Redis));
  await email.sendEmail({ ...message, priority: 'transactional' });
  assert.equal(state.smtp.mock.calls.length, 1);

  const failoverEval = vi.fn()
    .mockResolvedValueOnce('smtp')
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce('resend')
    .mockResolvedValue(1);
  email.configureEmailFailover(new EmailFailoverCoordinator({ eval: failoverEval } as unknown as Redis));
  state.verify.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
  await email.sendEmail({ ...message, idempotencyKey: 'msg-123' });
  assert.equal(state.resend.mock.calls[0][1].idempotencyKey, 'msg-123');
});

test('SMTP 454 daily quota exceeded fails over to Resend while rate throttling variants back off', async () => {
  state.smtp.mockRejectedValueOnce(Object.assign(new Error('454 Daily message quota exceeded'), {
    code: 'EENVELOPE',
    command: 'MAIL FROM',
    responseCode: 454,
    response: '454 Throttling failure: Daily message quota exceeded',
  }));
  await email.sendEmail(message);
  assert.equal(state.resend.mock.calls.length, 1);
  assert.equal(state.evaluate.mock.calls[1].at(-2), 'fail');
});
