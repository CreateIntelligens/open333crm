/**
 * AI 讀取其他渠道的近期訊息（change add-email-identity-merge，spec ai-cross-channel-context）。
 * 真實 Postgres；每個案例在交易內執行並 rollback。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant, type TenantDb } from '#src/lib/tenant-db.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { loadOtherChannelContext } from '#src/modules/ai/other-channel-context.js';

const prisma = new PrismaClient();
const T = TENANT_A;
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

class Rollback extends Error {}

interface Fixture {
  tx: TenantDb;
  contactId: string;
  conv: (channelType: 'LINE' | 'FB' | 'WEBCHAT', contactId?: string) => Promise<string>;
  say: (conversationId: string, text: string, ago: number, opts?: { direction?: 'INBOUND' | 'OUTBOUND'; metadata?: object }) => Promise<void>;
}

function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try {
      await withTenant(prisma, T, async (tx) => {
        const contact = await tx.contact.create({ data: { tenantId: T, displayName: 'AI 跨渠道' } });
        const f: Fixture = {
          tx,
          contactId: contact.id,
          conv: async (channelType, contactId = contact.id) => {
            const ch = await tx.channel.create({
              data: { tenantId: T, channelType, displayName: `ai-ctx-${channelType}`, credentialsEncrypted: 'x' },
            });
            const c = await tx.conversation.create({ data: { tenantId: T, contactId, channelId: ch.id, channelType } });
            return c.id;
          },
          say: async (conversationId, text, ago, opts = {}) => {
            const direction = opts.direction ?? 'INBOUND';
            await tx.message.create({
              data: {
                conversationId,
                direction,
                senderType: direction === 'INBOUND' ? 'CONTACT' : 'BOT',
                contentType: 'text',
                content: { text },
                metadata: opts.metadata ?? {},
                createdAt: new Date(NOW - ago),
              },
            });
          },
        };
        await fn(f);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  });
}

afterAll(() => prisma.$disconnect());

scenario('歸戶後在另一個渠道發問', async (f) => {
  const line = await f.conv('LINE');
  const fb = await f.conv('FB');
  await f.say(line, '冷氣漏水怎麼處理', 2 * DAY + 60_000);
  await f.say(line, '請先關閉電源', 2 * DAY, { direction: 'OUTBOUND' });
  await f.say(fb, '維修進度如何', 0);
  const ctx = await loadOtherChannelContext(f.tx, T, fb, NOW);
  assert.ok(ctx.includes('[LINE 2 天前] 顧客：冷氣漏水怎麼處理'), ctx);
  assert.ok(ctx.includes('[LINE 2 天前] 客服：請先關閉電源'), ctx);
  assert.ok(!ctx.includes('維修進度如何'), '目前對話的訊息不重複出現');
  assert.ok(ctx.indexOf('冷氣漏水') < ctx.indexOf('請先關閉電源'), '由舊到新');
});

scenario('超過 30 天的訊息', async (f) => {
  const line = await f.conv('LINE');
  const fb = await f.conv('FB');
  await f.say(line, '很久以前的問題', 31 * DAY);
  assert.equal(await loadOtherChannelContext(f.tx, T, fb, NOW), '');
});

scenario('其他渠道訊息超過上限', async (f) => {
  const line = await f.conv('LINE');
  const fb = await f.conv('FB');
  for (let i = 1; i <= 25; i++) await f.say(line, `第${i}則`, (26 - i) * 60_000);
  const ctx = await loadOtherChannelContext(f.tx, T, fb, NOW);
  const lines = ctx.split('\n').filter((l) => l.startsWith('['));
  assert.equal(lines.length, 10);
  assert.ok(lines[0].endsWith('第16則') && lines[9].endsWith('第25則'), lines.join('\n'));
});

scenario('目前對話不重複', async (f) => {
  const line = await f.conv('LINE');
  await f.say(line, '只有這段對話', 60_000);
  assert.equal(await loadOtherChannelContext(f.tx, T, line, NOW), '');
});

scenario('其他聯絡人的對話不讀取', async (f) => {
  const other = await f.tx.contact.create({ data: { tenantId: T, displayName: '別人' } });
  const fb = await f.conv('FB');
  const othersLine = await f.conv('LINE', other.id);
  await f.say(othersLine, '別人的問題', 60_000);
  assert.equal(await loadOtherChannelContext(f.tx, T, fb, NOW), '');
});

scenario('綁定訊息不給 AI', async (f) => {
  const line = await f.conv('LINE');
  const fb = await f.conv('FB');
  await f.say(line, '請選擇要綁定的帳號 BIND-7K2M9QH4TX', 3 * 60_000, { direction: 'OUTBOUND', metadata: { source: 'identity_binding' } });
  await f.say(line, '請點選 https://crm.example.com/bind/email/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ', 2 * 60_000, {
    direction: 'OUTBOUND',
    metadata: { source: 'identity_binding' },
  });
  await f.say(line, '朋友傳給我 https://crm.example.com/bind/email/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ 和 BIND-7K2M9QH4TX', 60_000);
  const ctx = await loadOtherChannelContext(f.tx, T, fb, NOW);
  assert.ok(!ctx.includes('請選擇要綁定') && !ctx.includes('請點選'), '系統發的綁定與登記訊息不提供');
  assert.ok(ctx.includes('朋友傳給我'), ctx);
  assert.ok(!ctx.includes('/bind/email/') && !ctx.includes('BIND-7K2M9QH4TX'), '代碼與登記連結遮蔽');
});

scenario('提示包含個資規則', async (f) => {
  const line = await f.conv('LINE');
  const fb = await f.conv('FB');
  await f.say(line, '我的電話是 0912345678', 60_000);
  const ctx = await loadOtherChannelContext(f.tx, T, fb, NOW);
  assert.ok(ctx.includes('不主動') && ctx.includes('電話') && ctx.includes('地址') && ctx.includes('訂單'), ctx);
});
