/**
 * Broadcast 發送邏輯測試
 *
 * 重點：
 *   - LINE 渠道、無 per-recipient 變數 → 走 multicast 路徑（一次 API call、recipientUids 帶整批）
 *   - LINE 渠道、有變數 → 走 for loop push（每人 sendMessage 一次）
 *   - FB 渠道 → 永遠 for loop（無 multicast API）
 *   - 0 受眾 → 明確回 BROADCAST_NO_RECIPIENTS 並標 failed
 *   - 全部失敗 → status=failed；部分失敗 → completed
 *
 * 用 sandbox：替換 channel-plugins registry + mock prisma + 真正的 encryptCredentials。
 * 跑：tsx src/__tests__/broadcast.service.test.ts
 */

import assert from 'node:assert/strict';
import {
  registerChannelPlugin,
  type ChannelPlugin,
  type OutboundPayload,
} from '@open333crm/channel-plugins';
import { encryptCredentials } from '../modules/channel/channel.service.js';
import { executeBroadcast } from '../modules/marketing/marketing.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

// ─── Mock helpers ──────────────────────────────────────────────────────

type MockFn<TArgs extends unknown[] = unknown[], TReturn = unknown> =
  ((...args: TArgs) => TReturn) & { calls: TArgs[] };

function mockFn<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  impl?: (...args: TArgs) => TReturn,
): MockFn<TArgs, TReturn> {
  const fn = ((...args: TArgs) => {
    fn.calls.push(args);
    return impl ? impl(...args) : (undefined as TReturn);
  }) as MockFn<TArgs, TReturn>;
  fn.calls = [];
  return fn;
}

function createIoMock() {
  return {
    to() {
      return { emit() {} };
    },
  };
}

interface SendRecord {
  to: string;
  payload: OutboundPayload;
}

/**
 * 工廠：建立 mock channel plugin，記錄每次 sendMessage 呼叫。
 *
 * behavior 可以是：
 *   - 'success' / 'fail'：所有呼叫都一致
 *   - 函式 (callIndex: number) => 'success' | 'fail'：依第幾次呼叫決定（partial fail 測試用）
 */
type PluginBehavior = 'success' | 'fail' | ((callIndex: number) => 'success' | 'fail');

function makeMockPlugin(channelType: string, behavior: PluginBehavior = 'success'): ChannelPlugin & { sends: SendRecord[] } {
  const sends: SendRecord[] = [];
  const plugin = {
    channelType,
    sends,
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string, message: OutboundPayload) => {
      sends.push({ to, payload: message });
      const decision = typeof behavior === 'function' ? behavior(sends.length - 1) : behavior;
      return decision === 'success'
        ? { success: true, channelMsgId: 'msg-' + sends.length }
        : { success: false, error: 'mock fail' };
    },
  };
  registerChannelPlugin(plugin as ChannelPlugin);
  return plugin as ChannelPlugin & { sends: SendRecord[] };
}

// ─── DB fixture ────────────────────────────────────────────────────────

interface BroadcastFixture {
  channelType: 'LINE' | 'FB';
  identitiesCount: number;
  /** 內容是否含 {{var}} 變數 */
  hasVariable?: boolean;
  /** plugin 是否要失敗（可給函式做 per-call 控制） */
  pluginBehavior?: PluginBehavior;
}

function setupFixture({
  channelType,
  identitiesCount,
  hasVariable = false,
  pluginBehavior = 'success',
}: BroadcastFixture) {
  const broadcastId = 'bc-' + Math.random().toString(36).slice(2, 8);
  const channelId = 'ch-1';
  const tenantId = 'tenant-1';
  const materialId = 'mat-1';

  const body: Record<string, unknown> = hasVariable
    ? { text: 'Hi {{contact.name}}!' }
    : { text: 'Hello everyone' };

  const broadcast = {
    id: broadcastId,
    tenantId,
    channelId,
    materialId,
    templateId: null,
    status: 'scheduled',
    createdById: 'agent-1',
    targetType: 'all',
    targetConfig: {},
    campaignId: null,
    segmentId: null,
    name: 'test',
    successCount: 0,
    failedCount: 0,
    totalCount: 0,
  };

  const material = {
    id: materialId,
    tenantId,
    contentType: channelType === 'LINE' ? 'line_text' : 'fb_text',
    body,
    variables: hasVariable ? [{ key: 'contact.name' }] : [],
    usageCount: 0,
    lastUsedAt: null,
  };

  const channel = {
    id: channelId,
    tenantId,
    channelType,
    isActive: true,
    credentialsEncrypted: encryptCredentials({ pageAccessToken: 'fake', channelAccessToken: 'fake' }),
  };

  const identities = Array.from({ length: identitiesCount }, (_, i) => ({
    contactId: `contact-${i}`,
    uid: `uid-${i}`,
  }));

  const broadcastUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const recipientCreates: Array<Record<string, unknown>> = [];
  const recipientCreateMany: Array<{ data: unknown[] }> = [];
  const deliveryAttempts = new Map<string, Record<string, unknown>>();

  const currentBroadcastState = { ...broadcast };

  const prisma = {
    broadcast: {
      findFirst: mockFn(async () => currentBroadcastState),
      update: mockFn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        broadcastUpdates.push(args);
        Object.assign(currentBroadcastState, args.data);
        return currentBroadcastState;
      }),
    },
    material: {
      findFirst: mockFn(async () => material),
      update: mockFn(async () => material),
    },
    channel: {
      findFirst: mockFn(async () => channel),
    },
    channelIdentity: {
      findMany: mockFn(async () => identities),
    },
    contactTag: {
      findMany: mockFn(async () => []),
    },
    contact: {
      findMany: mockFn(async () => identities.map((i) => ({ id: i.contactId, channelIdentities: [{ channelId, uid: i.uid }] }))),
      findFirst: mockFn(async () => null),
      findUnique: mockFn(async () => null),
    },
    contactAttribute: {
      findMany: mockFn(async () => []),
    },
    broadcastRecipient: {
      create: mockFn(async (args: { data: Record<string, unknown> }) => {
        recipientCreates.push(args.data);
        return args.data;
      }),
      createMany: mockFn(async (args: { data: unknown[] }) => {
        recipientCreateMany.push(args);
        return { count: args.data.length };
      }),
    },
    broadcastDeliveryAttempt: {
      findFirst: mockFn(async (args: { where: { batchIndex: number } }) =>
        deliveryAttempts.get(`${broadcastId}:${args.where.batchIndex}`) ?? null),
      create: mockFn(async (args: { data: Record<string, unknown> }) => {
        const attempt = {
          id: `attempt-${args.data.batchIndex}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
        };
        deliveryAttempts.set(`${broadcastId}:${args.data.batchIndex}`, attempt);
        return attempt;
      }),
      updateMany: mockFn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const attempt = [...deliveryAttempts.values()].find((item) => item.id === args.where.id);
        if (attempt) Object.assign(attempt, args.data, { updatedAt: new Date() });
        return { count: attempt ? 1 : 0 };
      }),
    },
  };

  return {
    broadcastId,
    prisma,
    plugin: makeMockPlugin(channelType, pluginBehavior),
    broadcastUpdates,
    recipientCreates,
    recipientCreateMany,
    deliveryAttempts,
    currentBroadcastState,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

async function testLineMulticastWhenNoVariable() {
  const f = setupFixture({ channelType: 'LINE', identitiesCount: 3, hasVariable: false });
  const io = createIoMock();

  const result = await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  // multicast 路徑：plugin.sendMessage 只應被呼叫 1 次
  assert.equal(f.plugin.sends.length, 1, `expected 1 sendMessage call, got ${f.plugin.sends.length}`);

  // 確認 strategy + recipientUids
  const payload = f.plugin.sends[0].payload;
  assert.equal((payload.content as Record<string, unknown>).strategy, 'multicast');
  assert.deepEqual((payload.content as Record<string, unknown>).recipientUids, ['uid-0', 'uid-1', 'uid-2']);

  // recipient 應該用 createMany 而非個別 create
  assert.equal(f.recipientCreateMany.length, 1, 'should use createMany for multicast');
  assert.equal(f.recipientCreates.length, 0, 'should NOT use individual create for multicast');
  assert.equal(f.recipientCreateMany[0].data.length, 3);

  // 統計：全成功
  assert.equal(result.total, 3);
  assert.equal(result.success, 3);
  assert.equal(result.failed, 0);

  // 最終狀態：completed
  const finalUpdate = f.broadcastUpdates[f.broadcastUpdates.length - 1];
  assert.equal(finalUpdate.data.status, 'completed');
}

async function testLineForLoopWhenHasVariable() {
  const f = setupFixture({ channelType: 'LINE', identitiesCount: 3, hasVariable: true });
  const io = createIoMock();

  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  // 有變數 → for loop push，3 個受眾 = 3 次 sendMessage
  assert.equal(f.plugin.sends.length, 3, `expected 3 sendMessage calls, got ${f.plugin.sends.length}`);

  // 每次的 content 不應帶 strategy / recipientUids
  for (const send of f.plugin.sends) {
    assert.equal((send.payload.content as Record<string, unknown>).strategy, undefined);
    assert.equal((send.payload.content as Record<string, unknown>).recipientUids, undefined);
  }

  // recipient 應該用個別 create（3 次）
  assert.equal(f.recipientCreates.length, 3);
  assert.equal(f.recipientCreateMany.length, 0);
}

async function testFbAlwaysForLoop() {
  // FB 即使沒變數，也走 for loop（FB 沒 multicast API）
  const f = setupFixture({ channelType: 'FB', identitiesCount: 3, hasVariable: false });
  const io = createIoMock();

  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  assert.equal(f.plugin.sends.length, 3, 'FB should always use for loop');
  for (const send of f.plugin.sends) {
    assert.equal((send.payload.content as Record<string, unknown>).strategy, undefined);
  }
  assert.equal(f.recipientCreates.length, 3);
  assert.equal(f.recipientCreateMany.length, 0);
}

async function testZeroAudience() {
  const f = setupFixture({ channelType: 'LINE', identitiesCount: 0 });
  const io = createIoMock();

  await assert.rejects(
    () => executeBroadcast(f.prisma as never, io as never, f.broadcastId),
    (error: unknown) => (error as { code?: string }).code === 'BROADCAST_NO_RECIPIENTS',
  );

  assert.equal(f.plugin.sends.length, 0);

  // 0 受眾是明確失敗，不讓使用者誤以為已完成發送。
  const finalUpdate = f.broadcastUpdates[f.broadcastUpdates.length - 1];
  assert.equal(finalUpdate.data.status, 'failed');
}

async function testPluginFailureMarksFailed() {
  const f = setupFixture({ channelType: 'LINE', identitiesCount: 3, pluginBehavior: 'fail' });
  const io = createIoMock();

  const result = await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  // multicast 1 次失敗 → 整批 3 人全標失敗
  assert.equal(result.total, 3);
  assert.equal(result.success, 0);
  assert.equal(result.failed, 3);

  const finalUpdate = f.broadcastUpdates[f.broadcastUpdates.length - 1];
  assert.equal(finalUpdate.data.status, 'failed');
}

async function testMulticastChunking499() {
  // 600 個受眾 → service 應自己拆批 499 / 101，呼叫 plugin 2 次
  const f = setupFixture({ channelType: 'LINE', identitiesCount: 600, hasVariable: false });
  const io = createIoMock();

  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  // 2 批：第 1 批 499 人，第 2 批 101 人
  assert.equal(f.plugin.sends.length, 2, `expected 2 chunks, got ${f.plugin.sends.length}`);

  const batch1 = (f.plugin.sends[0].payload.content as Record<string, unknown>).recipientUids as string[];
  const batch2 = (f.plugin.sends[1].payload.content as Record<string, unknown>).recipientUids as string[];
  assert.equal(batch1.length, 499, 'first chunk should be 499');
  assert.equal(batch2.length, 101, 'second chunk should be 101');

  // recipient createMany 也應該被呼叫 2 次（每批一次）
  assert.equal(f.recipientCreateMany.length, 2);
  assert.equal(f.recipientCreateMany[0].data.length, 499);
  assert.equal(f.recipientCreateMany[1].data.length, 101);
}

async function testMulticastPartialFailure() {
  // 600 人廣播：第 1 批 (499) 成功、第 2 批 (101) 失敗
  // 預期：successCount=499, failedCount=101, status=completed（部分成功）
  // 而非整批 600 都標 failed（之前的 bug）
  const f = setupFixture({
    channelType: 'LINE',
    identitiesCount: 600,
    hasVariable: false,
    pluginBehavior: (callIdx) => (callIdx === 0 ? 'success' : 'fail'),
  });
  const io = createIoMock();

  const result = await executeBroadcast(f.prisma as never, io as never, f.broadcastId);

  assert.equal(result.total, 600);
  assert.equal(result.success, 499, `expected 499 success, got ${result.success}`);
  assert.equal(result.failed, 101, `expected 101 failed, got ${result.failed}`);

  // status：有人成功 → completed（即使部分失敗）
  const finalUpdate = f.broadcastUpdates[f.broadcastUpdates.length - 1];
  assert.equal(finalUpdate.data.status, 'completed');

  // recipient 標記：第 1 批 499 人標 sent、第 2 批 101 人標 failed
  const batch1Recipients = f.recipientCreateMany[0].data as Array<Record<string, unknown>>;
  const batch2Recipients = f.recipientCreateMany[1].data as Array<Record<string, unknown>>;
  assert.equal(batch1Recipients[0].deliveryStatus, 'sent');
  assert.equal(batch2Recipients[0].deliveryStatus, 'failed');
}

async function testMulticastRetryReusesAttemptKeyAndRotatesAfter24Hours() {
  let shouldFail = true;
  const f = setupFixture({
    channelType: 'LINE',
    identitiesCount: 3,
    pluginBehavior: () => (shouldFail ? 'fail' : 'success'),
  });
  const io = createIoMock();

  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);
  const firstKey = (f.plugin.sends[0].payload.delivery as { retryKey: string }).retryKey;
  const attempt = f.deliveryAttempts.get(`${f.broadcastId}:0`)!;
  assert.equal(attempt.status, 'failed');

  shouldFail = false;
  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);
  const secondKey = (f.plugin.sends[1].payload.delivery as { retryKey: string }).retryKey;
  assert.equal(secondKey, firstKey);
  assert.equal(f.deliveryAttempts.size, 1);

  attempt.updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  attempt.status = 'failed';
  f.currentBroadcastState.status = 'failed';
  await executeBroadcast(f.prisma as never, io as never, f.broadcastId);
  const thirdKey = (f.plugin.sends[2].payload.delivery as { retryKey: string }).retryKey;
  assert.notEqual(thirdKey, secondKey);
}

// ─── Runner ────────────────────────────────────────────────────────────

const tests: Array<[string, () => Promise<void>]> = [
  ['LINE multicast 當無變數', testLineMulticastWhenNoVariable],
  ['LINE for-loop 當有變數', testLineForLoopWhenHasVariable],
  ['FB 永遠 for-loop', testFbAlwaysForLoop],
  ['0 受眾 → BROADCAST_NO_RECIPIENTS / status=failed', testZeroAudience],
  ['plugin 失敗 → status=failed', testPluginFailureMarksFailed],
  ['multicast 600 人拆批 499 / 101', testMulticastChunking499],
  ['multicast 部分失敗：第 1 批成功、第 2 批失敗', testMulticastPartialFailure],
  ['multicast retry 重用 key，超過 24 小時後輪替', testMulticastRetryReusesAttemptKeyAndRotatesAfter24Hours],
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err);
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  // Marketing service 載入時連 Redis 等資源 → 顯式 exit 避免 hang
  process.exit(failed > 0 ? 1 : 0);
}

main();
