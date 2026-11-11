/**
 * 登入依 email 解析租戶，以及停用租戶的登入、換發與進站事件
 * （change restore-tenant-aware-login-specs：auth-session「登入依 email 解析所屬租戶」
 * 「停用租戶的成員不能登入或換發 token」，inbound-message-processing「停用租戶的進站事件直接丟棄」）。
 *
 * 走真實的 auth.plugin、/auth/login、/auth/refresh、processWebhookEvent 與測試資料庫。
 * 每個租戶、成員與渠道都帶 stamp，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterAll, test } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, fbPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import authPlugin from '#src/plugins/auth.plugin.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import authRoutes from '#src/modules/auth/auth.routes.js';
import { hashPassword } from '#src/shared/utils/password.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { processWebhookEvent } from '#src/modules/webhook/webhook.service.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';

loadEnvConfig();
registerChannelPlugin(fbPlugin);
// 假的粉專 token 不能真的打到 Meta：攔下所有對外 fetch
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ error: { message: 'offline test' } }), { status: 400 })) as typeof fetch;

const prisma = new PrismaClient();
const io = { to: () => ({ emit: () => {} }), emit: () => {} } as never;
const stamp = Date.now();
const PASSWORD = 'Correct-Pass-1';
const APP_SECRET = `tenant-disabled-secret-${stamp}`;

const tenantOn = await prisma.tenant.create({ data: { name: `CI 停用租戶測試・啟用 ${stamp}` } });
const tenantOff = await prisma.tenant.create({ data: { name: `CI 停用租戶測試・停用 ${stamp}`, isActive: false } });
const passwordHash = await hashPassword(PASSWORD);
const mkAgent = (tenantId: string, name: string) =>
  prisma.agent.create({
    data: { tenantId, email: `ci-tenant-disabled-${name}-${stamp}@example.test`, name, passwordHash, role: 'ADMIN' },
  });
const agentOn = await mkAgent(tenantOn.id, 'on');
const agentOff = await mkAgent(tenantOff.id, 'off');

const mkChannel = (tenantId: string, name: string) =>
  prisma.channel.create({
    data: {
      tenantId,
      channelType: 'FB',
      displayName: `CI 停用租戶測試 ${name} ${stamp}`,
      externalAccountId: `PAGE_${name}_${stamp}`,
      credentialsEncrypted: encryptCredentials({ pageAccessToken: `token-${name}`, appSecret: APP_SECRET, verifyToken: 'v' }),
    },
  });
const channelOn = await mkChannel(tenantOn.id, 'ON');
const channelOff = await mkChannel(tenantOff.id, 'OFF');

const app = Fastify();
app.decorate('prisma', prisma as never);
app.decorate('prismaAdmin', prisma as never);
await app.register(cookie);
await app.register(errorHandlerPlugin);
await app.register(authPlugin);
await app.register(authRoutes, { prefix: '/api/v1/auth', loginAttempts: memBindingStore() });
await app.ready();

afterAll(async () => {
  await app.close();
  const tenantIds = [tenantOn.id, tenantOff.id];
  const channelIds = [channelOn.id, channelOff.id];
  const convs = await prisma.conversation.findMany({ where: { channelId: { in: channelIds } }, select: { id: true } });
  await prisma.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await prisma.conversation.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channelIdentity.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.contact.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.agent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  // 入站管線會替租戶建 tenant_settings，要先刪才能刪租戶
  await prisma.tenantSettings.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
const refresh = (agent: { id: string; tenantId: string }) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    cookies: { refreshToken: app.jwt.sign({ agentId: agent.id, tenantId: agent.tenantId, role: 'ADMIN', roleId: null, typ: 'refresh' }) },
  });

test('登入的 token 帶成員所屬的租戶', async () => {
  const res = await login(agentOn.email, PASSWORD);
  assert.equal(res.statusCode, 200, res.body);
  const claims = app.jwt.decode<{ tenantId: string }>(res.json().data.accessToken);
  assert.equal(claims?.tenantId, tenantOn.id);
});

test('停用租戶的成員以正確密碼登入', async () => {
  const res = await login(agentOff.email, PASSWORD);
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'TENANT_DISABLED');
  assert.equal(res.cookies.find((c) => c.name === 'refreshToken'), undefined, '不得設定 refresh token');
});

test('停用租戶的成員密碼錯誤', async () => {
  const res = await login(agentOff.email, 'Wrong-Pass-1');
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(res.json().error.code, 'INVALID_CREDENTIALS');
});

test('停用租戶的成員換發 token', async () => {
  // 對照：啟用中租戶的成員可以換發，確認失敗不是 token 本身的問題
  assert.equal((await refresh(agentOn)).statusCode, 200);
  const res = await refresh(agentOff);
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(res.json().data, undefined, '不得簽發 access token');
});

function signedFb(pageId: string, psid: string) {
  const body = {
    object: 'page',
    entry: [{
      id: pageId,
      time: Date.now(),
      messaging: [{
        sender: { id: psid },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message: { mid: `mid-${psid}`, text: 'hi' },
      }],
    }],
  };
  const raw = Buffer.from(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return { raw, headers: { 'x-hub-signature-256': `sha256=${sig}` } };
}

test('停用租戶的渠道收到訊息', async () => {
  const psidOn = `PSID_ON_${stamp}`;
  const psidOff = `PSID_OFF_${stamp}`;
  const on = signedFb(channelOn.externalAccountId!, psidOn);
  const off = signedFb(channelOff.externalAccountId!, psidOff);
  await processWebhookEvent(prisma, io, channelOn.id, 'FB', on.raw, on.headers);
  await processWebhookEvent(prisma, io, channelOff.id, 'FB', off.raw, off.headers);

  // 對照：啟用中租戶的渠道照常建立渠道身分與對話
  assert.equal(await prisma.channelIdentity.count({ where: { channelId: channelOn.id, uid: psidOn } }), 1);
  assert.equal(await prisma.channelIdentity.count({ where: { uid: psidOff } }), 0);
  assert.equal(await prisma.conversation.count({ where: { channelId: channelOff.id } }), 0);
  assert.equal(await prisma.contact.count({ where: { tenantId: tenantOff.id } }), 0);
});
