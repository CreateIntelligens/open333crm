/**
 * Email 登記公開端點（路由層整合測試，真實 Postgres；資料以唯一標記建立，afterAll 清除）。
 * 對應 spec email-identity-merge：開啟登記頁、連結使用後失效、不存在的連結、格式錯誤、公開登記端點須限制頻率。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
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
const stamp = `er-route-${Date.now()}`;
const store = memBindingStore();
const sent: Array<{ conversationId: string; text: string }> = [];
let deliverThrows = false;
const deliver = async (_db: unknown, conversationId: string, text: string) => {
  if (deliverThrows) throw new Error('推播逾時');
  sent.push({ conversationId, text });
  return true;
};

const original = await withTenant(prisma, T, (tx) =>
  tx.tenantSettings.findFirst({ where: { tenantId: T }, select: { identityBinding: true } }),
);
async function setEmailEnabled(emailEnabled: boolean) {
  await withTenant(prisma, T, (tx) =>
    tx.tenantSettings.upsert({
      where: { tenantId: T },
      create: { tenantId: T, identityBinding: { emailEnabled } },
      update: { identityBinding: { emailEnabled } },
    }),
  );
  invalidateIdentityBindingSettings();
}
await setEmailEnabled(true);

const fixture = await withTenant(prisma, T, async (tx) => {
  const channel = await tx.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: stamp, credentialsEncrypted: 'x', settings: { bindingHandleAuto: '@route1234' } },
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
      { store, deliver, webBaseUrl: 'https://crm.example.com' },
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
await app.register(emailRegistrationRoutes, { prefix: '/api/v1/public/email-registration', store, deliver });
await app.ready();

const url = (token: string) => `/api/v1/public/email-registration/${token}`;

afterAll(async () => {
  await app.close();
  await withTenant(prisma, T, async (tx) => {
    await tx.message.deleteMany({ where: { conversationId: fixture.conversation.id } });
    await tx.conversation.deleteMany({ where: { id: fixture.conversation.id } });
    await tx.channelIdentity.deleteMany({ where: { id: fixture.identity.id } });
    await tx.contact.deleteMany({ where: { id: fixture.contact.id } });
    await tx.channel.deleteMany({ where: { id: fixture.channel.id } });
    await tx.tenantSettings.updateMany({
      where: { tenantId: T },
      data: { identityBinding: (original?.identityBinding ?? {}) as object },
    });
  });
  invalidateIdentityBindingSettings();
  await prisma.$disconnect();
});

test('開啟登記頁', async () => {
  const res = await app.inject({ method: 'GET', url: url(await newToken()) });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().data, { channelType: 'LINE', channelLabel: 'LINE（@route1234）', profileName: '小明' });
});

test('不存在的連結', async () => {
  const res = await app.inject({ method: 'GET', url: url('A'.repeat(43)) });
  assert.equal(res.statusCode, 410);
  assert.equal(res.json().error.code, 'EMAIL_REGISTRATION_EXPIRED');
  assert.ok(!res.body.includes(T), '不透露租戶');
});

test('格式錯誤', async () => {
  const token = await newToken();
  const res = await app.inject({ method: 'POST', url: url(token), payload: { email: 'amy@' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'INVALID_EMAIL');
  assert.equal((await app.inject({ method: 'GET', url: url(token) })).statusCode, 200, '連結仍有效');
});

test('連結使用後失效', async () => {
  const token = await newToken();
  const ok = await app.inject({ method: 'POST', url: url(token), payload: { email: `${stamp}@example.com` } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().data.status, 'registered');
  const contact = await withTenant(prisma, T, (tx) => tx.contact.findFirst({ where: { id: fixture.contact.id } }));
  assert.equal(contact?.email, `${stamp}@example.com`);
  assert.ok(sent.some((s) => s.conversationId === fixture.conversation.id && s.text === '已登記您的 email。'), '對話收到登記完成');
  const again = await app.inject({ method: 'POST', url: url(token), payload: { email: `${stamp}@example.com` } });
  assert.equal(again.statusCode, 410);
});

test('通知送出時發生錯誤，登記結果仍回傳成功', async () => {
  const token = await newToken();
  deliverThrows = true;
  try {
    const res = await app.inject({ method: 'POST', url: url(token), payload: { email: `${stamp}-2@example.com` } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.status, 'registered');
  } finally {
    deliverThrows = false;
  }
});

test('租戶關閉 email 登記後，已發出的連結失效', async () => {
  const token = await newToken();
  await setEmailEnabled(false);
  try {
    assert.equal((await app.inject({ method: 'GET', url: url(token) })).statusCode, 410);
    assert.equal((await app.inject({ method: 'POST', url: url(token), payload: { email: 'x@example.com' } })).statusCode, 410);
  } finally {
    await setEmailEnabled(true);
  }
});

test('短時間大量送出', async () => {
  const codes: number[] = [];
  for (let i = 0; i < 25; i++) {
    codes.push((await app.inject({ method: 'GET', url: url('B'.repeat(43)) })).statusCode);
  }
  assert.ok(codes.includes(429), `應出現 429，實際 ${[...new Set(codes)].join(',')}`);
});
