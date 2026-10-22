/**
 * Email 登記的驗證碼（add-coupon-system design D15；spec email-identity-merge「Email 登記須驗證信箱擁有權」）。
 * 路由層整合測試，真實 Postgres；資料以唯一標記建立，afterAll 清除。寄信以注入函式取代。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import emailRegistrationRoutes from '#src/modules/identity-binding/email-registration.routes.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { issueEmailRegistrationLink } from '#src/modules/identity-binding/email-registration.service.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = TENANT_A;
const stamp = `ev-route-${Date.now()}`;
const clock = { now: Date.now() };
const store = memBindingStore(clock);
const sent: Array<{ conversationId: string; text: string }> = [];
const deliver = async (_db: unknown, conversationId: string, text: string) => {
  sent.push({ conversationId, text });
  return true;
};
const mails: Array<{ to: string; code: string }> = [];
let mailFails = false;
/** 寄信耗時（模擬 SMTP），讓同時送出的兩個請求真的重疊 */
let mailDelayMs = 0;
const sendVerificationEmail = async (to: string, code: string) => {
  if (mailDelayMs) await new Promise((r) => setTimeout(r, mailDelayMs));
  if (mailFails) throw new Error('SMTP 逾時');
  mails.push({ to, code });
};

const original = await withTenant(prisma, T, (tx) =>
  tx.tenantSettings.findFirst({ where: { tenantId: T }, select: { identityBinding: true } }),
);
await withTenant(prisma, T, (tx) =>
  tx.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { emailEnabled: true } },
    update: { identityBinding: { emailEnabled: true } },
  }),
);
invalidateIdentityBindingSettings();

const fixture = await withTenant(prisma, T, async (tx) => {
  const channel = await tx.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: stamp, credentialsEncrypted: 'x', settings: { bindingHandleAuto: '@verify1234' } },
  });
  const contact = await tx.contact.create({ data: { tenantId: T, displayName: stamp } });
  const identity = await tx.channelIdentity.create({
    data: { contactId: contact.id, channelId: channel.id, channelType: 'LINE', uid: stamp, profileName: '小明' },
  });
  const conversation = await tx.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: 'LINE' },
  });
  return { channel, contact, identity, conversation };
});

async function newToken(): Promise<string> {
  await withTenant(prisma, T, (tx) =>
    issueEmailRegistrationLink(
      tx,
      { store, deliver, webBaseUrl: 'https://crm.example.com', now: () => clock.now },
      {
        tenantId: T,
        channelId: fixture.channel.id,
        channelType: 'LINE',
        channelIdentityId: fixture.identity.id,
        uid: stamp,
        contactId: fixture.contact.id,
        conversationId: fixture.conversation.id,
      },
      'agent',
    ),
  );
  return /\/bind\/email\/([A-Za-z0-9_-]+)/.exec(sent.at(-1)!.text)![1];
}

const app = Fastify();
await app.register(errorHandlerPlugin);
app.decorate('prisma', prisma);
app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
await app.register(emailRegistrationRoutes, {
  prefix: '/api/v1/public/email-registration',
  store,
  deliver,
  sendVerificationEmail,
  now: () => clock.now,
});
await app.ready();

// 公開端點依 IP 限流（每分鐘 20 次）：每個測試用不同的來源 IP
let ip = 0;
const url = (token: string) => `/api/v1/public/email-registration/${token}`;
const submit = (token: string, email: string) => app.inject({ method: 'POST', url: url(token), payload: { email }, remoteAddress: `10.0.0.${ip}` });
const verify = (token: string, code: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `${url(token)}/verify`, payload: { code, ...extra }, remoteAddress: `10.0.0.${ip}` });
const contactEmail = async () =>
  (await withTenant(prisma, T, (tx) => tx.contact.findFirst({ where: { id: fixture.contact.id }, select: { email: true } })))?.email ?? null;
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeEach(async () => {
  // 每個測試各取新連結：快轉一小時，避開「每小時最多 5 個連結」
  clock.now += 61 * 60 * 1000;
  ip += 1;
  mails.length = 0;
  mailFails = false;
  await withTenant(prisma, T, (tx) => tx.contact.updateMany({ where: { id: fixture.contact.id }, data: { email: null } }));
});

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, async (tx) => {
    await tx.message.deleteMany({ where: { conversationId: fixture.conversation.id } });
    await tx.conversation.deleteMany({ where: { id: fixture.conversation.id } });
    await tx.channelIdentity.deleteMany({ where: { id: fixture.identity.id } });
    await tx.contact.deleteMany({ where: { id: fixture.contact.id } });
    await tx.channel.deleteMany({ where: { id: fixture.channel.id } });
    if (original) {
      await tx.tenantSettings.updateMany({ where: { tenantId: T }, data: { identityBinding: (original.identityBinding ?? {}) as object } });
    } else {
      await tx.tenantSettings.deleteMany({ where: { tenantId: T } });
    }
  });
  invalidateIdentityBindingSettings();
  await prisma.$disconnect();
});

test('送出 email 後寄出驗證碼', async () => {
  const token = await newToken();
  const res = await submit(token, ` ${stamp.toUpperCase()}@Example.com `);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.status, 'code_sent');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, `${stamp}@example.com`);
  assert.match(mails[0].code, /^\d{6}$/);
  assert.equal(await contactEmail(), null, '寄碼時不寫入');
});

test('驗證碼正確才寫入', async () => {
  const token = await newToken();
  await submit(token, `${stamp}@example.com`);
  const res = await verify(token, mails[0].code);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.status, 'registered');
  assert.equal(await contactEmail(), `${stamp}@example.com`);
  // 連結使用後失效
  assert.equal((await submit(token, `${stamp}@example.com`)).statusCode, 410);
  assert.equal((await verify(token, mails[0].code)).statusCode, 410);
});

test('驗證碼錯誤', async () => {
  const token = await newToken();
  await submit(token, `${stamp}@example.com`);
  const res = await verify(token, wrongCode(mails[0].code));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'INVALID_VERIFICATION_CODE');
  assert.equal(res.json().error.details.remainingAttempts, 4);
  assert.equal(await contactEmail(), null);
  assert.equal((await app.inject({ method: 'GET', url: url(token), remoteAddress: `10.0.0.${ip}` })).statusCode, 200, '連結仍有效');
});

test('錯 5 次後驗證碼作廢', async () => {
  const token = await newToken();
  await submit(token, `${stamp}@example.com`);
  for (let i = 0; i < 5; i++) assert.equal((await verify(token, wrongCode(mails[0].code))).statusCode, 400);
  const res = await verify(token, mails[0].code);
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().error.code, 'VERIFICATION_CODE_LOCKED');
  assert.equal(await contactEmail(), null);
  // 重新送出 email 取得新的驗證碼後可以完成
  await submit(token, `${stamp}@example.com`);
  assert.equal((await verify(token, mails[1].code)).statusCode, 200);
});

test('驗證碼過期', async () => {
  const token = await newToken();
  await submit(token, `${stamp}@example.com`);
  clock.now += 11 * 60 * 1000;
  try {
    const res = await verify(token, mails[0].code);
    assert.equal(res.statusCode, 410, res.body);
    assert.equal(res.json().error.code, 'VERIFICATION_CODE_EXPIRED');
    assert.equal(await contactEmail(), null);
    assert.equal((await submit(token, `${stamp}@example.com`)).statusCode, 200, '連結仍可重新送出');
  } finally {
    clock.now -= 11 * 60 * 1000;
  }
});

test('同一個連結最多寄 3 次', async () => {
  const token = await newToken();
  for (let i = 0; i < 3; i++) assert.equal((await submit(token, `${stamp}@example.com`)).statusCode, 200);
  const res = await submit(token, `${stamp}@example.com`);
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().error.code, 'TOO_MANY_VERIFICATION_EMAILS');
  assert.equal(mails.length, 3);
});

test('寄信失敗', async () => {
  const token = await newToken();
  mailFails = true;
  const res = await submit(token, `${stamp}@example.com`);
  assert.equal(res.statusCode, 502, res.body);
  assert.equal(res.json().error.code, 'VERIFICATION_EMAIL_FAILED');
  mailFails = false;
  assert.equal((await submit(token, `${stamp}@example.com`)).statusCode, 200, '連結仍可再次送出');
});

test('驗證碼不能換成別的 email', async () => {
  const token = await newToken();
  await submit(token, `${stamp}@example.com`);
  const res = await verify(token, mails[0].code, { email: `${stamp}-other@example.com` });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(await contactEmail(), `${stamp}@example.com`);
});

test('重新送出 email 後，舊的驗證碼不能用', async () => {
  const token = await newToken();
  await submit(token, `${stamp}-first@example.com`);
  await submit(token, `${stamp}@example.com`);
  assert.equal((await verify(token, mails[0].code)).statusCode, mails[0].code === mails[1].code ? 200 : 400);
  if (mails[0].code !== mails[1].code) {
    assert.equal((await verify(token, mails[1].code)).statusCode, 200);
    assert.equal(await contactEmail(), `${stamp}@example.com`);
  }
});

test('格式錯誤不寄驗證碼', async () => {
  const token = await newToken();
  const res = await submit(token, 'amy@');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_EMAIL');
  assert.equal(mails.length, 0);
});

test('同時送出兩次：只寄出一封，寄出的驗證碼可以用', async () => {
  const token = await newToken();
  mailDelayMs = 50;
  const [a, b] = await Promise.all([submit(token, `${stamp}@example.com`), submit(token, `${stamp}@example.com`)]).finally(() => {
    mailDelayMs = 0;
  });
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.equal(mails.length, 1);
  assert.equal((await verify(token, mails[0].code)).statusCode, 200);
});

