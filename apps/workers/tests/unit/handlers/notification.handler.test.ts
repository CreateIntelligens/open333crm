import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import { logger } from '@open333crm/core';
import { handleNotificationJob } from '#src/handlers/notification.handler';

/**
 * notification:dispatch 的處理函式（standalone-worker-runtime「Notification Job Handling」）。
 * 寫入通知是 job 的成敗；推播是最多一次、可以遺失的副作用，失敗只記 log。
 */

const jobData = {
  tenantId: 't1',
  agentId: 'a1',
  type: 'case.assigned',
  title: '新案件',
  body: '案件已指派給你',
};

const job = { id: 'n1', name: 'notification:dispatch', data: jobData } as unknown as Job;

type Recipient = 'active' | 'inactive' | 'deleted';

/**
 * 模擬 createNotificationForActiveAgent 的條件寫入（INSERT … SELECT … FROM agents WHERE …）：
 * 成員不在、租戶或 ID 不符，或 SQL 帶啟用條件而成員已停用時寫入 0 筆；否則經 create 寫入一筆並回傳。
 * 參數順序：type、title、body、clickUrl、agentId、tenantId。
 */
function makePrisma(create: (args: { data: Record<string, unknown> }) => Promise<unknown>, recipient: Recipient = 'active') {
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const [type, title, body, clickUrl, agentId, tenantId] = values;
    const sql = strings.join('?');
    if (recipient === 'deleted') return [];
    if (agentId !== jobData.agentId || tenantId !== jobData.tenantId) return [];
    if (recipient === 'inactive' && /"isActive" = true/.test(sql)) return [];
    return [await create({ data: { tenantId, agentId, type, title, body, clickUrl } })];
  };
  return { $queryRaw } as unknown as PrismaClient;
}

function makeRedis(publish: (channel: string, message: string) => Promise<number>) {
  return { publish } as unknown as IORedis;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleNotificationJob', () => {
  test('Database write succeeds but Redis publish fails', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const prisma = makePrisma(async ({ data }) => ({ id: 'notif-1', ...data }));
    const redis = makeRedis(async () => {
      throw new Error('Redis down');
    });

    await assert.doesNotReject(handleNotificationJob(job, prisma, redis));

    assert.equal(errorLog.mock.calls.length, 1);
    assert.match(String(errorLog.mock.calls[0][0]), /notif-1/);
  });

  test('Notification job consumed by worker', async () => {
    const created: Record<string, unknown>[] = [];
    const published: { channel: string; message: string }[] = [];
    const prisma = makePrisma(async ({ data }) => {
      created.push(data);
      return { id: 'notif-1', ...data };
    });
    const redis = makeRedis(async (channel, message) => {
      published.push({ channel, message });
      return 1;
    });

    await handleNotificationJob(job, prisma, redis);

    assert.equal(created.length, 1);
    assert.equal(created[0].agentId, 'a1');
    assert.equal(published.length, 1);
    const payload = JSON.parse(published[0].message);
    assert.equal(payload.room, 'agent:a1');
    assert.equal(payload.event, 'notification.new');
    assert.equal(payload.data.id, 'notif-1');
  });

  test('Database write fails', async () => {
    let publishCalls = 0;
    const prisma = makePrisma(async () => {
      throw new Error('DB down');
    });
    const redis = makeRedis(async () => {
      publishCalls++;
      return 1;
    });

    await assert.rejects(handleNotificationJob(job, prisma, redis), /DB down/);
    assert.equal(publishCalls, 0);
  });

  test('Worker stops after the record is written', async () => {
    // BullMQ 重新執行同一個 job：處理函式不去重，客服人員收到兩則相同的通知
    const created: Record<string, unknown>[] = [];
    let seq = 0;
    const prisma = makePrisma(async ({ data }) => {
      created.push(data);
      seq++;
      return { id: `notif-${seq}`, ...data };
    });
    const redis = makeRedis(async () => 1);

    await handleNotificationJob(job, prisma, redis);
    await handleNotificationJob(job, prisma, redis);

    assert.equal(created.length, 2);
    assert.deepEqual(created[0], created[1]);
  });

  // issue #484：通知排隊期間收件成員被永久刪除或停用，寫入會撞外鍵或送給不該收的人
  for (const recipient of ['deleted', 'inactive'] as const) {
    const name = recipient === 'deleted' ? '收件成員已被永久刪除' : '收件成員已停用';
    test(name, async () => {
      const infoLog = vi.spyOn(logger, 'info').mockImplementation(() => logger);
      let createCalls = 0;
      let publishCalls = 0;
      const prisma = makePrisma(async ({ data }) => {
        createCalls++;
        // 真實資料庫：刪除的成員會撞 notifications.agentId 外鍵；停用的成員寫得進去
        if (recipient === 'deleted') throw new Error('Foreign key constraint violated: notifications_agent_id_fkey');
        return { id: 'notif-1', ...data };
      }, recipient);
      const redis = makeRedis(async () => {
        publishCalls++;
        return 1;
      });

      await assert.doesNotReject(handleNotificationJob(job, prisma, redis));

      assert.equal(createCalls, 0);
      assert.equal(publishCalls, 0);
      assert.ok(infoLog.mock.calls.some(([msg]) => /a1/.test(String(msg)) && /略過/.test(String(msg))));
    });
  }

  test('查詢通過後收件成員被永久刪除', async () => {
    // 查成員時還在，寫入前被 purgeAgent 刪掉：真實資料庫的條件寫入寫入 0 筆；舊寫法撞外鍵 P2003
    const fk = Object.assign(new Error('Foreign key constraint violated: notifications_agentId_fkey'), { code: 'P2003' });
    let publishCalls = 0;
    const prisma = {
      agent: { findFirst: async () => ({ id: jobData.agentId }) },
      notification: { create: async () => { throw fk; } },
      $queryRaw: async () => [],
    } as unknown as PrismaClient;
    const redis = makeRedis(async () => {
      publishCalls++;
      return 1;
    });

    await assert.doesNotReject(handleNotificationJob(job, prisma, redis));
    assert.equal(publishCalls, 0);
  });
});
