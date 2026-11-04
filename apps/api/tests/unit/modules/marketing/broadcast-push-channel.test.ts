/**
 * 群發只能使用能主動推送的渠道（change reject-webchat-push-415，issue #415，AUDIT CHAN-02）。
 *
 * 修正前：網站聊天室的群發與附券廣播回報成功、發券數照算，顧客實際收不到任何訊息。
 * WebChat 外掛的 sendMessage() 只寫 log 就回成功，訪客房間的推送只有收件匣回覆路徑會做。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { registerChannelPlugin, type ChannelPlugin } from '@open333crm/channel-plugins';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { createBroadcast, executeBroadcast } from '#src/modules/marketing/marketing.service.js';
import { claimCouponBroadcast, queueCouponBroadcast } from '#src/modules/marketing/broadcast-coupon.service.js';
import { ALL_CHANNELS } from '#src/services/channel-visibility.js';
import { AppError } from '#src/shared/utils/response.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

const T = 'a0000000-0000-0000-0000-000000000001';
const CHANNEL = '00000000-0000-4000-8000-000000000001';
const MATERIAL = '00000000-0000-4000-8000-000000000002';
const COUPON = '00000000-0000-4000-8000-000000000003';
const io = { to: () => ({ emit() {} }), of: () => ({ to: () => ({ emit() {} }) }) } as never;
const allChannels = async () => ALL_CHANNELS;

/** 每種渠道類型的假外掛：記下送出的對象 */
const sent: Array<{ channelType: string; to: string }> = [];
for (const channelType of ['LINE', 'WEBCHAT']) {
  registerChannelPlugin({
    channelType,
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string) => {
      sent.push({ channelType, to });
      return { success: true, channelMsgId: 'm' };
    },
  } as unknown as ChannelPlugin);
}

const isPushRejection = (err: unknown) => {
  assert.ok(err instanceof AppError, String(err));
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'CHANNEL_PUSH_NOT_SUPPORTED');
  assert.match(err.message, /網站聊天室/);
  return true;
};

const channelRow = (channelType: string) => ({
  id: CHANNEL,
  tenantId: T,
  channelType,
  isActive: true,
  settings: {},
  credentialsEncrypted: encryptCredentials({ channelAccessToken: 'fake' }),
});

// ── 建立 ────────────────────────────────────────────────────────────────

function createDb(channelType: string) {
  const created: unknown[] = [];
  const db = {
    material: { findFirst: async () => ({ id: MATERIAL, channelType: channelType.toLowerCase(), body: { text: 'hi' } }) },
    messageTemplate: { findFirst: async () => null },
    channel: { findFirst: async () => channelRow(channelType) },
    campaign: { findFirst: async () => null },
    segment: { findFirst: async () => null },
    coupon: { findFirst: async () => ({ id: COUPON, name: '秋季九折', status: 'ACTIVE', purpose: 'MARKETING', validityMode: 'AFTER_CLAIM' }) },
    broadcast: {
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: 'b1', ...(args.data as object) };
      },
    },
  };
  return { db: db as never, created };
}

const createInput = {
  name: '週末群發',
  materialId: MATERIAL,
  channelId: CHANNEL,
  targetType: 'contacts' as const,
  targetConfig: { contactIds: ['00000000-0000-4000-8000-0000000000c1'] },
};

describe('群發只能使用能主動推送的渠道', () => {
  it('建立網站聊天室的群發', async () => {
    const { db, created } = createDb('WEBCHAT');
    await assert.rejects(createBroadcast(db, T, 'agent-1', createInput, ALL_CHANNELS), isPushRejection);
    assert.equal(created.length, 0, '不建立廣播');
  });

  it('建立網站聊天室的群發：附券廣播也被拒', async () => {
    const { db, created } = createDb('WEBCHAT');
    await assert.rejects(
      createBroadcast(db, T, 'agent-1', { ...createInput, materialId: undefined, couponId: COUPON }, ALL_CHANNELS),
      isPushRejection,
    );
    assert.equal(created.length, 0, '不建立廣播');
  });

  it('LINE 群發不受影響：照常建立', async () => {
    const { db, created } = createDb('LINE');
    await createBroadcast(db, T, 'agent-1', createInput, ALL_CHANNELS);
    assert.equal(created.length, 1);
  });

  // ── 送出一般群發 ──────────────────────────────────────────────────────

  function sendDb(channelType: string) {
    const state: Record<string, unknown> = {
      id: 'bc-1', tenantId: T, channelId: CHANNEL, materialId: MATERIAL, templateId: null, couponId: null,
      createdById: 'agent-1', segmentId: null, status: 'draft',
      targetType: 'contacts', targetConfig: { contactIds: ['c-1'] }, failureReason: null,
    };
    const db = {
      broadcast: {
        findFirst: async () => state,
        updateMany: async (args: { where: { status?: { in: string[] } }; data: Record<string, unknown> }) => {
          const allowed = args.where.status?.in;
          if (allowed && !allowed.includes(state.status as string)) return { count: 0 };
          Object.assign(state, args.data);
          return { count: 1 };
        },
        update: async (args: { data: Record<string, unknown> }) => Object.assign(state, args.data),
      },
      material: {
        findFirst: async () => ({ id: MATERIAL, tenantId: T, channelType: 'line', contentType: 'text', body: { text: 'hi' }, variables: [] }),
        update: async () => ({}),
      },
      channel: { findFirst: async () => channelRow(channelType) },
      segment: { findFirst: async () => null },
      contact: { findMany: async () => [{ id: 'c-1' }] },
      channelIdentity: { findMany: async () => [{ uid: 'u-1', contactId: 'c-1' }] },
      message: { findMany: async () => [] },
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
    return { db: db as never, state };
  }

  it('送出網站聊天室的舊草稿', async () => {
    sent.length = 0;
    const { db, state } = sendDb('WEBCHAT');
    await assert.rejects(executeBroadcast(db, io, 'bc-1', allChannels), isPushRejection);
    assert.equal(state.status, 'failed', '廣播標為失敗');
    assert.match(String(state.failureReason), /網站聊天室/, '寫入看得到的原因');
    assert.equal(state.successCount, undefined, '沒有回報成功人數');
    assert.deepEqual(sent, [], '沒有呼叫渠道送出');
  });

  it('LINE 群發不受影響：照常送出', async () => {
    sent.length = 0;
    const { db, state } = sendDb('LINE');
    const result = await executeBroadcast(db, io, 'bc-1', allChannels);
    assert.equal(result.success, 1);
    assert.equal(state.status, 'completed');
    assert.deepEqual(sent.map((s) => s.channelType), ['LINE']);
  });

  // ── 附券廣播 ──────────────────────────────────────────────────────────

  function couponCtx(channelType: string, status = 'draft') {
    const updates: unknown[] = [];
    const tx = {
      broadcast: {
        findFirst: async () => ({
          id: 'bc-2', tenantId: T, status, couponId: COUPON, channelId: CHANNEL, materialId: null,
          name: '附券', targetType: 'contacts', segmentId: null, targetConfig: { contactIds: ['c-1'] },
          createdById: 'agent-1', couponIssuedVia: 'broadcast', couponMessage: null, couponIssuedByName: null,
        }),
        updateMany: async (args: unknown) => {
          updates.push(args);
          return { count: 1 };
        },
      },
      coupon: {
        findFirst: async () => ({ id: COUPON, name: '秋季九折', status: 'ACTIVE', claimTagId: null, claimTagTtlDays: null, validityMode: 'AFTER_CLAIM', endAt: null }),
      },
      channel: { findFirst: async () => channelRow(channelType) },
      material: { findFirst: async () => null },
    };
    return { ctx: { tx, tenantId: T } as never, updates };
  }

  it('送出網站聊天室的附券廣播', async () => {
    const { ctx, updates } = couponCtx('WEBCHAT');
    await assert.rejects(queueCouponBroadcast(ctx, 'bc-2'), isPushRejection);
    assert.equal(updates.length, 0, '沒有排入發送');
  });

  it('LINE 附券廣播不受影響：照常排入發送', async () => {
    const { ctx, updates } = couponCtx('LINE');
    const queued = await queueCouponBroadcast(ctx, 'bc-2');
    assert.equal(queued.status, 'scheduled');
    assert.equal(updates.length, 1);
  });

  it('排程到期的網站聊天室附券廣播', async () => {
    const { ctx } = couponCtx('WEBCHAT', 'scheduled');
    const claimed = await claimCouponBroadcast(ctx, 'bc-2');
    assert.equal(claimed.ok, false);
    assert.ok(!claimed.ok && claimed.reason === 'INVALID', '搶占後回設定有問題，由呼叫端標失敗');
    assert.equal(!claimed.ok && claimed.reason === 'INVALID' && claimed.code, 'CHANNEL_PUSH_NOT_SUPPORTED');
    assert.match(!claimed.ok && claimed.reason === 'INVALID' ? claimed.message : '', /網站聊天室/);
  });

  it('LINE 附券廣播不受影響：排程搶占成功', async () => {
    const { ctx } = couponCtx('LINE', 'scheduled');
    const claimed = await claimCouponBroadcast(ctx, 'bc-2');
    assert.equal(claimed.ok, true);
  });
});
