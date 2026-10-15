/**
 * 客服手動回覆送到渠道失敗時，後台要看得到（S08）：
 * 訊息寫入 metadata.deliveryFailed／deliveryError（與自動化送出失敗同一組欄位，MessageBubble 依此顯示紅框），
 * 回傳的訊息帶著失敗標示，並再發一次 message.new 讓聊天視窗更新。
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';

process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import { registerChannelPlugin } from '@open333crm/channel-plugins';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { sendMessage } from '#src/modules/conversation/conversation.service.js';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
let pluginResult: { success: boolean; error?: string };

registerChannelPlugin({
  channelType: 'FB',
  async sendMessage() {
    return pluginResult;
  },
} as never);

let messageRow: Record<string, unknown>;
let emitted: Array<{ room: string; event: string; payload: any }>;

function setup(opts: { isActive?: boolean; identity?: boolean } = {}) {
  const conversation = { id: 'conv-1', tenantId: 'tenant-1', channelId: CHANNEL_ID, caseId: null };
  const prisma = {
    conversation: {
      findFirst: async () => conversation,
      update: async () => ({}),
      findUnique: async () => ({
        ...conversation,
        channel: {
          id: CHANNEL_ID,
          channelType: 'FB',
          isActive: opts.isActive ?? true,
          credentialsEncrypted: encryptCredentials({}),
        },
        contact: { channelIdentities: opts.identity === false ? [] : [{ channelId: CHANNEL_ID, uid: 'psid-1' }] },
      }),
    },
    message: {
      count: async () => 0,
      create: async (args: { data: Record<string, unknown> }) => {
        messageRow = { id: 'msg-1', ...args.data, metadata: {}, sender: null };
        return messageRow;
      },
      update: async (args: { data: Record<string, unknown> }) => {
        messageRow = { ...messageRow, ...args.data };
        return messageRow;
      },
    },
  };
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
        return true;
      },
    }),
    of: () => ({ to: () => ({ emit: () => true }) }),
  };
  return { prisma, io };
}

beforeEach(() => {
  emitted = [];
  pluginResult = { success: true };
});

async function send(opts?: { isActive?: boolean; identity?: boolean }) {
  const { prisma, io } = setup(opts);
  return sendMessage(prisma as never, io as never, 'conv-1', 'agent-1', 'tenant-1', {
    contentType: 'text',
    content: { text: '您好' },
  });
}

test('渠道回報送出失敗：訊息標示失敗與原因，並再推一次 message.new', async () => {
  pluginResult = { success: false, error: '(#551) This person isn\'t available right now.' };
  const { message } = await send();

  const metadata = (message as { metadata: Record<string, unknown> }).metadata;
  assert.equal(metadata.deliveryFailed, true);
  assert.match(String(metadata.deliveryError), /This person isn't available/);
  const last = emitted.filter((e) => e.event === 'message.new').at(-1)!;
  assert.equal(last.payload.message.metadata.deliveryFailed, true);
});

test('渠道已停用：訊息標示失敗並說明渠道已停用', async () => {
  const { message } = await send({ isActive: false });
  const metadata = (message as { metadata: Record<string, unknown> }).metadata;
  assert.equal(metadata.deliveryFailed, true);
  assert.match(String(metadata.deliveryError), /渠道已停用/);
});

test('聯絡人在這個渠道沒有身分：訊息標示失敗', async () => {
  const { message } = await send({ identity: false });
  const metadata = (message as { metadata: Record<string, unknown> }).metadata;
  assert.equal(metadata.deliveryFailed, true);
  assert.ok(String(metadata.deliveryError).length > 0);
});

test('送出成功：不標示失敗', async () => {
  const { message } = await send();
  const metadata = ((message as { metadata?: Record<string, unknown> }).metadata ?? {});
  assert.notEqual(metadata.deliveryFailed, true);
});
