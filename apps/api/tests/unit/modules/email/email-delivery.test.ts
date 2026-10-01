import assert from 'node:assert/strict';
import { logger } from '@open333crm/core';
import { loadEnvConfig, parseEnvConfig } from '../config/env.js';
import { sendEmail } from '../modules/email/email.service.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-12345',
  CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
  MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
};

Object.assign(process.env, requiredEnv, {
  EMAIL_DELIVERY_MODE: 'resend',
  RESEND_API_KEY: 're_test_key',
  EMAIL_FROM: 'Open333 Test <noreply@example.com>',
});

const validResendConfig = { ...requiredEnv, EMAIL_DELIVERY_MODE: 'resend', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'noreply@example.com' };

assert.equal(parseEnvConfig({ ...requiredEnv }).EMAIL_DELIVERY_MODE, 'log');
assert.equal(parseEnvConfig(validResendConfig).RESEND_API_KEY, 're_test_key');
assert.equal(parseEnvConfig({ ...requiredEnv, EMAIL_DELIVERY_MODE: 'webhook', EMAIL_WEBHOOK_URL: 'https://example.com/email' }).EMAIL_DELIVERY_MODE, 'webhook');
assert.throws(
  () => parseEnvConfig({ ...validResendConfig, RESEND_API_KEY: undefined }),
  /RESEND_API_KEY/,
);
assert.throws(
  () => parseEnvConfig({ ...validResendConfig, EMAIL_FROM: undefined }),
  /EMAIL_FROM/,
);
assert.equal(parseEnvConfig({ ...requiredEnv, EMAIL_DELIVERY_MODE: 'smtp', SMTP_HOST: 'smtp.example.com' }).EMAIL_DELIVERY_MODE, 'smtp');

const originalFetch = globalThis.fetch;
const originalLoggerInfo = logger.info;
const originalLoggerError = logger.error;
const infoLogs: string[] = [];
const errorLogs: string[] = [];
logger.info = ((message: string) => infoLogs.push(message)) as typeof logger.info;
logger.error = ((message: string) => errorLogs.push(message)) as typeof logger.error;
let capturedRequest: { url: string; init: RequestInit } | undefined;
globalThis.fetch = async (input, init) => {
  capturedRequest = { url: String(input), init: init ?? {} };
  return new Response(JSON.stringify({ id: 'resend-message-id' }), { status: 200 });
};

loadEnvConfig();
await sendEmail({
  to: 'customer@example.com',
  subject: 'Test subject',
  html: '<p>Test body</p>',
  text: 'Test body',
});

assert.equal(capturedRequest?.url, 'https://api.resend.com/emails');
assert.equal(capturedRequest?.init.headers && new Headers(capturedRequest.init.headers).get('authorization'), 'Bearer re_test_key');
assert.deepEqual(JSON.parse(String(capturedRequest?.init.body)), {
  from: 'Open333 Test <noreply@example.com>',
  to: ['customer@example.com'],
  subject: 'Test subject',
  html: '<p>Test body</p>',
  text: 'Test body',
});
assert.match(infoLogs.join('\n'), /providerMessageId.*resend-message-id/);
assert.doesNotMatch(infoLogs.join('\n'), /re_test_key|<p>Test body<\/p>/);

globalThis.fetch = async () => new Response(JSON.stringify({ message: 'sender rejected' }), { status: 400 });
await assert.rejects(
  sendEmail({ to: 'customer@example.com', subject: 'Rejected', html: '<p>Rejected</p>' }),
);

globalThis.fetch = async () => {
  throw new Error('network unavailable');
};
await assert.rejects(
  sendEmail({ to: 'customer@example.com', subject: 'Network failure', html: '<p>Network failure</p>' }),
  /Unable to fetch data|network unavailable/,
);
assert.doesNotMatch(errorLogs.join('\n'), /re_test_key|<p>Rejected<\/p>|<p>Network failure<\/p>/);

globalThis.fetch = originalFetch;
logger.info = originalLoggerInfo;
logger.error = originalLoggerError;
process.exit(0);
