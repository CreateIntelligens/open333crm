/**
 * 合併拒絕同渠道雙身分（change enforce-merge-same-channel-guard，spec contact-management
 * 「Merge Rejects Same-Channel Identities」；AUDIT IDENT-03）。
 *
 * 走真實 Postgres：路由層的兩個客服入口，以及兩個合併同時併入同一位聯絡人的並行情境。
 * 並行要兩個各自提交的交易，不能用 rollback 隔離，所以每筆資料都記下 id，afterAll 刪除。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import contactRoutes from '#src/modules/contact/contact.routes.js';
import { identityRoutes } from '#src/modules/canvas/canvas.routes.js';
import { mergeContacts } from '#src/modules/contact/contact-merge.service.js';

loadEnvConfig();
const prisma = new PrismaClient();
const T = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const AGENT_ID = '00000000-0000-4000-8000-0000000000cd';
const stamp = Date.now();

const created = { channels: [] as string[], contacts: [] as string[], roles: [] as string[], suggestions: [] as string[] };

const db = <R>(fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<R>) => withTenant(prisma, T, fn);

async function channel(channelType: 'LINE' | 'FB', displayName: string) {
  const ch = await db((tx) =>
    tx.channel.create({
      data: { tenantId: T, channelType, displayName: `${displayName}-${stamp}`, credentialsEncrypted: 'x', isActive: true },
    }),
  );
  created.channels.push(ch.id);
  return ch;
}

/** 建立一位聯絡人，並在每個指定渠道各有一個身分 */
async function contact(name: string, channels: Array<{ id: string; channelType: string }>) {
  const c = await db(async (tx) => {
    const row = await tx.contact.create({ data: { tenantId: T, displayName: `${name}-${stamp}` } });
    for (const ch of channels) {
      await tx.channelIdentity.create({
        data: { contactId: row.id, channelId: ch.id, channelType: ch.channelType as never, uid: `${name}-${ch.id}-${stamp}` },
      });
    }
    return row;
  });
  created.contacts.push(c.id);
  return c;
}

async function role(slug: string, permissions: string[]) {
  const r = await prisma.role.create({
    data: {
      tenantId: T,
      slug: `ci-${slug}-${stamp}`,
      name: `CI 同渠道合併（${slug}）`,
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
  created.roles.push(r.id);
  return r;
}

async function buildApp(roleId: string) {
  const app = Fastify();
  // 正式錯誤格式 { error: { code, message, details } }；不註冊時 Fastify 預設格式不帶 details
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', prisma);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: AGENT_ID, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(contactRoutes, { prefix: '/api/v1/contacts' });
  await app.register(identityRoutes, { prefix: '/api/v1/identity' });
  await app.ready();
  return app;
}

const errorOf = (res: { json: () => unknown }) => {
  const body = res.json() as { error?: { code?: string; details?: Record<string, unknown> }; code?: string };
  return { code: body.error?.code ?? body.code, details: body.error?.details };
};

const line = await channel('LINE', '同渠道測試 LINE');
const fb = await channel('FB', '同渠道測試粉專');
const mergeRole = await role('merge', ['contact.view', 'contact.merge']);
const reviewRole = await role('review', ['identity.review']);
const mergeApp = await buildApp(mergeRole.id);
const reviewApp = await buildApp(reviewRole.id);

afterAll(async () => {
  await mergeApp.close();
  await reviewApp.close();
  await db(async (tx) => {
    await tx.mergeSuggestion.deleteMany({ where: { tenantId: T, id: { in: created.suggestions } } });
    await tx.contactMergeLog.deleteMany({
      where: { tenantId: T, OR: [{ survivorId: { in: created.contacts } }, { mergedId: { in: created.contacts } }] },
    });
    await tx.channelIdentity.deleteMany({ where: { contactId: { in: created.contacts } } });
    await tx.contact.deleteMany({ where: { tenantId: T, id: { in: created.contacts } } });
    await tx.channel.deleteMany({ where: { tenantId: T, id: { in: created.channels } } });
  });
  await prisma.role.deleteMany({ where: { id: { in: created.roles } } });
  await prisma.$disconnect();
});

test('Agent merges two contacts on the same LINE channel：回 409，A 維持未封存、不寫合併紀錄', async () => {
  const a = await contact('A', [line]);
  const b = await contact('B', [line, fb]);

  const res = await mergeApp.inject({
    method: 'POST',
    url: '/api/v1/contacts/merge',
    payload: { primaryContactId: b.id, secondaryContactId: a.id },
  });

  assert.equal(res.statusCode, 409);
  const err = errorOf(res);
  assert.equal(err.code, 'SAME_CHANNEL_CONFLICT');
  const channels = err.details?.channels as Array<{ id: string; displayName: string }>;
  assert.deepEqual(channels.map((c) => [c.id, c.displayName]), [[line.id, line.displayName]]);

  const after = await db((tx) => tx.contact.findFirst({ where: { tenantId: T, id: a.id }, select: { isArchived: true } }));
  assert.equal(after?.isArchived, false);
  const logs = await db((tx) => tx.contactMergeLog.count({ where: { tenantId: T, mergedId: a.id } }));
  assert.equal(logs, 0);
});

test('Approving a suggestion for two contacts on the same channel：回 409，建議維持 PENDING', async () => {
  const a = await contact('SA', [fb]);
  const b = await contact('SB', [fb, line]);
  const suggestion = await db((tx) =>
    tx.mergeSuggestion.create({
      data: { tenantId: T, primaryContactId: b.id, secondaryContactId: a.id, reason: 'ci 同渠道', confidence: 0.9 },
    }),
  );
  created.suggestions.push(suggestion.id);

  const res = await reviewApp.inject({ method: 'POST', url: `/api/v1/identity/suggestions/${suggestion.id}/approve` });

  assert.equal(res.statusCode, 409);
  assert.equal(errorOf(res).code, 'SAME_CHANNEL_CONFLICT');
  const after = await db((tx) => tx.mergeSuggestion.findFirst({ where: { tenantId: T, id: suggestion.id } }));
  assert.equal(after?.status, 'PENDING');
});

test('Two merges into the same survivor at the same time：只有一個成功，B 在該 LINE 渠道只有一個身分', async () => {
  const b = await contact('CB', [fb]);
  const a1 = await contact('CA1', [line]);
  const a2 = await contact('CA2', [line]);

  const results = await Promise.allSettled(
    [a1, a2].map((a) =>
      db((tx) => mergeContacts(tx, { tenantId: T, survivorId: b.id, mergedId: a.id, source: 'MANUAL' })),
    ),
  );

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, '只有一個合併成功');
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  assert.equal((rejected?.reason as { code?: string })?.code, 'SAME_CHANNEL_CONFLICT');
  const lineIdentities = await db((tx) => tx.channelIdentity.count({ where: { contactId: b.id, channelId: line.id } }));
  assert.equal(lineIdentities, 1);
});
