/**
 * 渠道狀態查詢不寫入資料（change fix-admin-settings-safeguards，channel-management）。
 * G03：只是打開渠道管理頁，FB 卡片的「最後驗證」就被更新，權杖失效時也一樣。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const { patchChannelSettings } = vi.hoisted(() => ({ patchChannelSettings: vi.fn() }));
vi.mock('#src/modules/channel/channel.service.js', () => ({
  decryptCredentials: () => ({ pageAccessToken: 'tok', appId: 'app', appSecret: 'secret' }),
  patchChannelSettings,
}));

const { checkFbTokenStatus } = await import('#src/modules/channel/fb-token-monitor.service.js');

const realFetch = globalThis.fetch;
const update = vi.fn();
const prisma = {
  channel: {
    findFirst: vi.fn(async () => ({ id: 'ch1', tenantId: 't1', channelType: 'FB', credentialsEncrypted: 'x' })),
    update,
  },
  $executeRaw: vi.fn(),
};

beforeEach(() => {
  update.mockClear();
  patchChannelSettings.mockClear();
  prisma.$executeRaw.mockClear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('查詢 FB 權杖狀態不更新最後驗證', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3 * 86400;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { is_valid: false, expires_at: expiresAt } }), { status: 200 })) as typeof fetch;

  const status = await checkFbTokenStatus(prisma as never, 'ch1', 't1');

  assert.equal(status.valid, false);
  assert.equal(update.mock.calls.length, 0, '不可更新 lastVerifiedAt');
  assert.equal(patchChannelSettings.mock.calls.length, 0, '不可寫入 settings');
  assert.equal(prisma.$executeRaw.mock.calls.length, 0);
});

test('debug_token 失敗改用 /me 時也不寫入', async () => {
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    return call === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ id: 'p1' }), { status: 200 });
  }) as typeof fetch;

  const status = await checkFbTokenStatus(prisma as never, 'ch1', 't1');

  assert.equal(status.valid, true);
  assert.equal(update.mock.calls.length, 0);
});
