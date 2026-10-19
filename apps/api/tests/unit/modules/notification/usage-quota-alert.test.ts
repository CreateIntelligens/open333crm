/**
 * 用量告警的站內通知與信件（主規格 usage-quota-alerts「告警的通知與信件」「告警不影響 AI 回覆」）。
 * 佇列與寄信換成 mock；信件內容走真的模板。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-usage-alert-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
process.env.WEB_BASE_URL = 'https://crm.example';

import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const sent = vi.hoisted(() => ({
  jobs: [] as Array<{ agentId: string; type: string; clickUrl: string }>,
  emails: [] as Array<{ to: string; subject: string; html: string }>,
  failEmailTo: null as string | null,
}));
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('bullmq')>()),
  Queue: class {
    async add(_name: string, data: { agentId: string; type: string; clickUrl: string }) {
      sent.jobs.push(data);
    }
  },
}));
vi.mock('#src/modules/email/email.service.js', () => ({
  sendEmail: async (input: { to: string; subject: string; html: string }) => {
    if (input.to === sent.failEmailTo) throw new Error('smtp down');
    sent.emails.push(input);
  },
}));

import { loadEnvConfig } from '#src/config/env.js';
import { eventBus } from '#src/events/event-bus.js';
import { setupNotificationWorker } from '#src/modules/notification/notification.worker.js';

loadEnvConfig();

const TENANT = '11111111-1111-4111-8111-111111111111';
const tenant = { name: '測試站台' };
const admins = [
  { id: 'admin-1', email: 'a1@example.com' },
  { id: 'admin-2', email: 'a2@example.com' },
];

setupNotificationWorker({
  agent: {
    findMany: async ({ where }: { where: { role: string; isActive: boolean } }) =>
      where.role === 'ADMIN' && where.isActive ? admins : [],
  },
  tenant: { findUnique: async () => tenant },
} as never);

beforeEach(() => {
  sent.jobs = [];
  sent.emails = [];
  sent.failEmailTo = null;
  tenant.name = '測試站台';
});

async function alert(level: 'warning' | 'critical') {
  eventBus.publish({
    name: 'usage.quota.threshold',
    tenantId: TENANT,
    timestamp: new Date(),
    payload: { level, usedTokens: 1000, limitTokens: 1000, monthKey: '2026-10' },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test('每位管理員都收到通知與 email：兩位管理員各一則 usage_quota_critical 與一封 critical email', async () => {
  await alert('critical');

  assert.deepEqual(sent.jobs.map((j) => [j.agentId, j.type, j.clickUrl]), [
    ['admin-1', 'usage_quota_critical', '/dashboard/plan'],
    ['admin-2', 'usage_quota_critical', '/dashboard/plan'],
  ]);
  assert.deepEqual(sent.emails.map((e) => e.to), ['a1@example.com', 'a2@example.com']);
  assert.ok(sent.emails.every((e) => e.subject.includes('已達上限')));
});

test('critical email 說明影響：AI 自動回覆已暫停、真人回覆不受影響', async () => {
  await alert('critical');

  const html = sent.emails[0]!.html;
  assert.ok(html.includes('AI 自動回覆已暫停'));
  assert.ok(html.includes('真人回覆不受影響'));
});

test('email 的按鈕連到站台的方案頁：href 是 WEB_BASE_URL 下的 /dashboard/plan', async () => {
  await alert('warning');
  await alert('critical');

  assert.equal(sent.emails.length, 4);
  for (const email of sent.emails) {
    assert.ok(email.html.includes('href="https://crm.example/dashboard/plan"'), email.subject);
  }
});

test('租戶名稱經過 HTML 轉義：含 &lt;script&gt;，不含 <script>', async () => {
  tenant.name = '<script>alert(1)</script>';
  await alert('warning');

  const html = sent.emails[0]!.html;
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(html.includes('<script>'), false);
});

test('email 寄送失敗：其他管理員的通知與 email 照常發送', async () => {
  sent.failEmailTo = 'a1@example.com';
  await alert('critical');

  assert.equal(sent.jobs.length, 2);
  assert.deepEqual(sent.emails.map((e) => e.to), ['a2@example.com']);
});
