/** 建立渠道時的渠道數量上限（主規格 granular-plan-entitlement「渠道數量上限」） */
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createChannel } from '#src/modules/channel/channel.service.js';
import { AppError } from '#src/shared/utils/response.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

/** 只實作 createChannel 用到的 Prisma 方法；channels 是租戶既有的渠道 */
function createDb(opts: {
  limits: Record<string, number | null>;
  limitOverrides?: Record<string, number | null>;
  channels: Array<{ isActive: boolean }>;
}) {
  const created: unknown[] = [];
  const prisma = {
    tenant: {
      findUnique: async () => ({
        limitOverrides: opts.limitOverrides ?? {},
        plan: { limits: opts.limits, allowedChannelTypes: [] },
      }),
    },
    channel: {
      count: async ({ where }: { where: { isActive?: boolean } }) =>
        opts.channels.filter((c) => where.isActive === undefined || c.isActive === where.isActive).length,
      create: async (args: unknown) => {
        created.push(args);
        return { id: 'channel-new' };
      },
      update: async () => ({ id: 'channel-new' }),
    },
    agent: { findMany: async () => [{ id: 'agent-1' }] },
    agentChannelAccess: { createMany: async () => ({ count: 1 }) },
  };
  return { prisma: prisma as never, created };
}

const create = (db: ReturnType<typeof createDb>) =>
  createChannel(db.prisma, TENANT, { channelType: 'LINE', displayName: 'LINE 2', credentials: { channelSecret: 's' } });

test('達渠道數上限擋新建：maxChannels=1、已有 1 個渠道時回 403 PLAN_LIMIT_EXCEEDED，不建立渠道', async () => {
  const db = createDb({ limits: { maxChannels: 1 }, channels: [{ isActive: true }] });

  await assert.rejects(create(db), (err: unknown) => {
    assert.ok(err instanceof AppError);
    assert.equal(err.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(err.statusCode, 403);
    assert.deepEqual(err.details, { limitKey: 'maxChannels', current: 1, max: 1 });
    return true;
  });
  assert.equal(db.created.length, 0);
});

test('無上限不擋：maxChannels 是 null 時建立渠道', async () => {
  const db = createDb({ limits: { maxChannels: null }, channels: [{ isActive: true }, { isActive: true }] });

  await create(db);
  assert.equal(db.created.length, 1);
});

test('停用的渠道不計數：maxChannels=1、唯一的渠道已停用時建立渠道', async () => {
  const db = createDb({ limits: { maxChannels: 1 }, channels: [{ isActive: false }] });

  await create(db);
  assert.equal(db.created.length, 1);
});

test('租戶覆寫渠道數上限：方案 maxChannels=1、覆寫為 2、已有 1 個渠道時建立渠道', async () => {
  const db = createDb({ limits: { maxChannels: 1 }, limitOverrides: { maxChannels: 2 }, channels: [{ isActive: true }] });

  await create(db);
  assert.equal(db.created.length, 1);
});
