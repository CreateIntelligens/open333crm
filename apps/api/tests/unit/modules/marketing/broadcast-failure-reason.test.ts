/**
 * 廣播發送失敗要記錄原因（change broadcast-failure-reason，issue #287）。
 *
 * 修正前：executeBroadcast() 失敗時只把狀態改成 failed，原因只寫進 log；
 * 排程發送由背景執行，行銷人員在後台只看得到「失敗」，看不到為什麼。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  registerChannelPlugin,
  type ChannelPlugin,
  type OutboundPayload,
} from '@open333crm/channel-plugins';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { executeBroadcast } from '#src/modules/marketing/marketing.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'test-credential-encryption-key-32-bytes!!';

const T = 'tenant-a';
const TAG_ID = '22222222-2222-4222-8222-222222222222';
const io = { to: () => ({ emit() {} }) } as never;

type SendResult = { success: boolean; channelMsgId?: string; error?: string };

/** 註冊假渠道 plugin；send 決定每一次送出的結果 */
function registerPlugin(channelType: string, send: (to: string, payload: OutboundPayload) => SendResult) {
  registerChannelPlugin({
    channelType,
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string, payload: OutboundPayload) => send(to, payload),
  } as unknown as ChannelPlugin);
}

function sendDb(
  broadcast: Record<string, unknown>,
  opts: {
    channelType?: string;
    identities?: Array<{ uid: string; contactId: string }>;
    channelError?: Error;
  } = {},
) {
  const state: Record<string, unknown> = {
    id: 'bc-1',
    tenantId: T,
    channelId: 'ch-1',
    materialId: 'mat-1',
    templateId: null,
    createdById: 'agent-1',
    segmentId: null,
    targetConfig: {},
    failureReason: null,
    ...broadcast,
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
      findFirst: async () => {
        if (opts.channelError) throw opts.channelError;
        return {
          id: 'ch-1',
          tenantId: T,
          channelType: opts.channelType ?? 'LINE',
          isActive: true,
          credentialsEncrypted: encryptCredentials({ channelAccessToken: 'fake' }),
        };
      },
    },
    segment: { findFirst: async () => null },
    contact: { findMany: async () => [] },
    channelIdentity: {
      findMany: async () => opts.identities ?? [{ uid: 'u-1', contactId: 'c-1' }, { uid: 'u-2', contactId: 'c-2' }],
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
  return { db: db as never, state };
}

test('Scheduled broadcast with an empty audience：標籤底下沒人，failureReason 是 BROADCAST_NO_RECIPIENTS 的中文原因', async () => {
  registerPlugin('LINE', () => ({ success: true, channelMsgId: 'm' }));
  const { db, state } = sendDb(
    { status: 'scheduled', targetType: 'tags', targetConfig: { tagIds: [TAG_ID] } },
    { identities: [] },
  );
  let message = '';
  await assert.rejects(executeBroadcast(db, io, 'bc-1'), (e: { code?: string; message: string }) => {
    assert.equal(e.code, 'BROADCAST_NO_RECIPIENTS');
    message = e.message;
    return true;
  });
  assert.equal(state.status, 'failed');
  assert.equal(state.failureReason, message);
  assert.match(String(state.failureReason), /所選標籤下沒有可在此渠道發送的對象/);
});

test('Unexpected error during a send：非 AppError 寫通用中文原因，不外露錯誤內容', async () => {
  registerPlugin('LINE', () => ({ success: true, channelMsgId: 'm' }));
  const { db, state } = sendDb(
    { status: 'scheduled', targetType: 'all' },
    { channelError: new Error('connect ECONNREFUSED 10.0.3.7:5432 secret-db-host') },
  );
  await assert.rejects(executeBroadcast(db, io, 'bc-1'));
  assert.equal(state.status, 'failed');
  assert.ok(typeof state.failureReason === 'string' && state.failureReason.length > 0, 'failureReason 應有值');
  assert.match(String(state.failureReason), /[一-鿿]/);
  assert.doesNotMatch(String(state.failureReason), /ECONNREFUSED|secret-db-host/);
});

test('Every recipient fails：LINE 整批被拒，failureReason 含失敗人數與渠道錯誤', async () => {
  registerPlugin('LINE', () => ({ success: false, error: 'Authentication failed. Confirm that the access token is valid.' }));
  const { db, state } = sendDb({ status: 'scheduled', targetType: 'all' });
  await executeBroadcast(db, io, 'bc-1');
  assert.equal(state.status, 'failed');
  assert.match(String(state.failureReason), /2/);
  assert.match(String(state.failureReason), /access token is valid/);
});

test('Every recipient fails：逐人發送全部失敗，failureReason 含失敗人數與第一個渠道錯誤', async () => {
  registerPlugin('FB', (to) => ({ success: false, error: `(#551) This person isn't available right now (${to})` }));
  const { db, state } = sendDb({ status: 'scheduled', targetType: 'all' }, { channelType: 'FB' });
  await executeBroadcast(db, io, 'bc-1');
  assert.equal(state.status, 'failed');
  assert.match(String(state.failureReason), /2/);
  assert.match(String(state.failureReason), /\(#551\).*u-1/);
});

test('Some recipients fail：部分成功為 completed，failureReason 為 null', async () => {
  registerPlugin('FB', (to) => (to === 'u-1' ? { success: true, channelMsgId: 'm' } : { success: false, error: 'blocked' }));
  const { db, state } = sendDb({ status: 'scheduled', targetType: 'all' }, { channelType: 'FB' });
  const result = await executeBroadcast(db, io, 'bc-1');
  assert.equal(result.failed, 1);
  assert.equal(state.status, 'completed');
  assert.equal(state.failureReason, null);
});

test('Resend a failed broadcast successfully：重送成功後不留舊原因', async () => {
  registerPlugin('LINE', () => ({ success: true, channelMsgId: 'm' }));
  const { db, state } = sendDb({ status: 'failed', targetType: 'all', failureReason: '此渠道的憑證無法解密' });
  await executeBroadcast(db, io, 'bc-1');
  assert.equal(state.status, 'completed');
  assert.equal(state.failureReason, null);
});
