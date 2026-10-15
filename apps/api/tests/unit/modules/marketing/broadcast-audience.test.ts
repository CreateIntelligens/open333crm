/**
 * 廣播受眾 fail-closed 與立即發送不可重複（change fix-broadcast-audience-fail-closed，
 * spec broadcast-audience）。
 *
 * 修正前：依標籤／手動選擇的名單為空、分群沒選或已刪除、分群沒有有效條件時，
 * resolveAudience() 不加任何條件，等於發給該渠道全部聯絡人；executeBroadcast()
 * 允許 sending 狀態再次發送，且「檢查狀態→改成 sending」不是原子操作。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  registerChannelPlugin,
  type ChannelPlugin,
  type OutboundPayload,
} from '@open333crm/channel-plugins';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { createBroadcast, executeBroadcast } from '#src/modules/marketing/marketing.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

const T = 'tenant-a';
const SEGMENT_ID = '11111111-1111-4111-8111-111111111111';
const TAG_ID = '22222222-2222-4222-8222-222222222222';

type AppErr = { statusCode?: number; code?: string; details?: { issues?: Array<{ path: string }> } };

function hasIssue(e: AppErr, path: string) {
  return Boolean(e.details?.issues?.some((i) => i.path === path));
}

// ─── createBroadcast ────────────────────────────────────────────────────

function createDb(opts: { segment?: Record<string, unknown> | null; materialChannelType?: string; channelType?: string } = {}) {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    material: {
      findFirst: async () => ({ id: 'mat-1', tenantId: T, channelType: opts.materialChannelType ?? 'line' }),
    },
    channel: {
      findFirst: async () => ({ id: 'ch-1', tenantId: T, isActive: true, channelType: opts.channelType ?? 'LINE' }),
    },
    segment: {
      findFirst: async () => (opts.segment === undefined ? null : opts.segment),
    },
    broadcast: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'b1', ...data };
      },
    },
  };
  return { db: db as never, created };
}

const base = { name: 'x', materialId: 'mat-1', channelId: 'ch-1' };

test('Tags target without tags：沒有 tagIds 回 400 INVALID_AUDIENCE，不建立', async () => {
  const { db, created } = createDb();
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, targetType: 'tags' }),
    (e: AppErr) => {
      assert.equal(e.statusCode, 400);
      assert.equal(e.code, 'INVALID_AUDIENCE');
      assert.ok(hasIssue(e, 'targetConfig.tagIds'), '錯誤應指出 targetConfig.tagIds');
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('Contacts target without contacts：contactIds 為空陣列回 400 INVALID_AUDIENCE', async () => {
  const { db, created } = createDb();
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, targetType: 'contacts', targetConfig: { contactIds: [] } }),
    (e: AppErr) => {
      assert.equal(e.code, 'INVALID_AUDIENCE');
      assert.ok(hasIssue(e, 'targetConfig.contactIds'));
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('Segment target without segment：沒有 segmentId 回 400 INVALID_AUDIENCE', async () => {
  const { db, created } = createDb();
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, targetType: 'segment' }),
    (e: AppErr) => {
      assert.equal(e.code, 'INVALID_AUDIENCE');
      assert.ok(hasIssue(e, 'segmentId'));
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('Segment without conditions：分群沒有有值的條件回 400 INVALID_AUDIENCE', async () => {
  const { db, created } = createDb({
    segment: { id: SEGMENT_ID, tenantId: T, rules: { logic: 'AND', conditions: [{ field: 'channelType', operator: 'eq', value: '' }] } },
  });
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, targetType: 'segment', segmentId: SEGMENT_ID }),
    (e: AppErr) => {
      assert.equal(e.code, 'INVALID_AUDIENCE');
      assert.ok(hasIssue(e, 'segmentId'));
      return true;
    },
  );
  assert.equal(created.length, 0);
});

test('Tags target with tags：有一個標籤時建立成功', async () => {
  const { db, created } = createDb();
  await createBroadcast(db, T, 'agent-1', { ...base, targetType: 'tags', targetConfig: { tagIds: [TAG_ID] } });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].targetConfig, { tagIds: [TAG_ID] });
});

test('FB material on a LINE channel：素材渠道不符回 400 MATERIAL_CHANNEL_MISMATCH', async () => {
  const { db, created } = createDb({ materialChannelType: 'fb', channelType: 'LINE' });
  await assert.rejects(
    createBroadcast(db, T, 'agent-1', { ...base, targetType: 'all' }),
    (e: AppErr) => {
      assert.equal(e.statusCode, 400);
      assert.equal(e.code, 'MATERIAL_CHANNEL_MISMATCH');
      assert.ok(hasIssue(e, 'materialId'));
      return true;
    },
  );
  assert.equal(created.length, 0);
});

// ─── executeBroadcast ───────────────────────────────────────────────────

function makePlugin() {
  const sends: Array<{ to: string; payload: OutboundPayload }> = [];
  registerChannelPlugin({
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string, payload: OutboundPayload) => {
      sends.push({ to, payload });
      return { success: true, channelMsgId: 'm' };
    },
  } as unknown as ChannelPlugin);
  return sends;
}

function sendDb(broadcast: Record<string, unknown>, opts: { segment?: Record<string, unknown> | null; claimFails?: boolean } = {}) {
  const state = {
    id: 'bc-1',
    tenantId: T,
    channelId: 'ch-1',
    materialId: 'mat-1',
    templateId: null,
    createdById: 'agent-1',
    segmentId: null,
    targetConfig: {},
    ...broadcast,
  };
  const identityQueries: unknown[] = [];
  const db = {
    broadcast: {
      findFirst: async () => state,
      updateMany: async (args: { where: { status?: { in: string[] } }; data: Record<string, unknown> }) => {
        if (opts.claimFails) return { count: 0 };
        const allowed = args.where.status?.in;
        if (allowed && !allowed.includes(state.status as string)) return { count: 0 };
        Object.assign(state, args.data);
        return { count: 1 };
      },
      update: async (args: { data: Record<string, unknown> }) => {
        Object.assign(state, args.data);
        return state;
      },
    },
    material: {
      findFirst: async () => ({ id: 'mat-1', tenantId: T, channelType: 'line', contentType: 'line_text', body: { text: 'hi' }, variables: [] }),
      update: async () => ({}),
    },
    channel: {
      findFirst: async () => ({
        id: 'ch-1',
        tenantId: T,
        channelType: 'LINE',
        isActive: true,
        credentialsEncrypted: encryptCredentials({ channelAccessToken: 'fake' }),
      }),
    },
    segment: { findFirst: async () => (opts.segment === undefined ? null : opts.segment) },
    contact: { findMany: async () => [{ id: 'c-1' }] },
    channelIdentity: {
      findMany: async (args: unknown) => {
        identityQueries.push(args);
        return [{ uid: 'u-1', contactId: 'c-1' }, { uid: 'u-2', contactId: 'c-2' }];
      },
    },
    broadcastDeliveryAttempt: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'a-1', updatedAt: new Date(), ...data }),
      updateMany: async () => ({ count: 1 }),
    },
    broadcastRecipient: {
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
      create: async () => ({}),
    },
  };
  return { db: db as never, state, identityQueries };
}

const io = { to: () => ({ emit() {} }) } as never;

test('Segment deleted before a scheduled send：分群已刪除，不發送、標 failed、INVALID_AUDIENCE', async () => {
  const sends = makePlugin();
  const { db, state, identityQueries } = sendDb({ status: 'scheduled', targetType: 'segment', segmentId: SEGMENT_ID }, { segment: null });
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => {
    assert.equal(e.code, 'INVALID_AUDIENCE');
    return true;
  });
  assert.equal(sends.length, 0, '不可發送任何訊息');
  assert.equal(identityQueries.length, 0, '不可查渠道全部身分');
  assert.equal(state.status, 'failed');
});

test('Legacy broadcast with an empty tag list：舊草稿標籤名單為空，不發送、標 failed', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb({ status: 'draft', targetType: 'tags', targetConfig: {} });
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => e.code === 'INVALID_AUDIENCE');
  assert.equal(sends.length, 0);
  assert.equal(state.status, 'failed');
});

test('Legacy broadcast with an empty contact list：舊草稿聯絡人名單為空，不發送', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb({ status: 'draft', targetType: 'contacts', targetConfig: { contactIds: [] } });
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => e.code === 'INVALID_AUDIENCE');
  assert.equal(sends.length, 0);
  assert.equal(state.status, 'failed');
});

test('Segment without conditions at send time：分群條件全為空值，不發送、標 failed', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb(
    { status: 'draft', targetType: 'segment', segmentId: SEGMENT_ID },
    { segment: { id: SEGMENT_ID, tenantId: T, rules: { logic: 'AND', conditions: [{ field: 'tag', operator: 'eq', value: '' }] } } },
  );
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => e.code === 'INVALID_AUDIENCE');
  assert.equal(sends.length, 0);
  assert.equal(state.status, 'failed');
});

test('Send a broadcast that is sending：發送中的廣播再發回 409 BROADCAST_ALREADY_SENDING', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb({ status: 'sending', targetType: 'all' });
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => {
    assert.equal(e.statusCode, 409);
    assert.equal(e.code, 'BROADCAST_ALREADY_SENDING');
    return true;
  });
  assert.equal(sends.length, 0);
  assert.equal(state.status, 'sending', '不可把正在發送的廣播改成 failed');
});

test('Two send requests at the same time：條件更新搶不到時回 409 且不發送', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb({ status: 'draft', targetType: 'all' }, { claimFails: true });
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: AppErr) => e.statusCode === 409 && e.code === 'BROADCAST_ALREADY_SENDING');
  assert.equal(sends.length, 0);
  assert.equal(state.status, 'draft');
});

test('Retry a failed broadcast：失敗的廣播可以重新發送', async () => {
  const sends = makePlugin();
  const { db, state } = sendDb({ status: 'failed', targetType: 'all' });
  const result = await executeBroadcast(db, io, 'bc-1');
  assert.equal(result.total, 2);
  assert.equal(sends.length, 1);
  assert.equal(state.status, 'completed');
});

test('依標籤篩選：只查有該標籤的聯絡人', async () => {
  makePlugin();
  const { db, identityQueries } = sendDb({ status: 'draft', targetType: 'tags', targetConfig: { tagIds: [TAG_ID] } });
  await executeBroadcast(db, io, 'bc-1');
  const where = (identityQueries[0] as { where: { contact: { tags?: unknown } } }).where;
  assert.deepEqual(where.contact.tags, { some: { tagId: { in: [TAG_ID] } } });
});
