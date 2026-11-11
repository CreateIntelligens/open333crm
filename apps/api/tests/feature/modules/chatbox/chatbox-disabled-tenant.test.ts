/**
 * 停用租戶的網站聊天室（issue #410，AUDIT AUTH-11；change stop-disabled-tenant-activity-410）。
 *
 * 主規格 inbound-message-processing「停用租戶的進站事件直接丟棄」：租戶停用之後，
 * - 既有的聊天室工作階段送訊息、新訪客建立工作階段、訪客 socket 驗證，都比照渠道停用回 404；
 * - 共用入口 processInboundMessage() 也丟棄停用租戶的進站事件，所有渠道共用。
 *
 * 走真實的 chatbox service 與測試資料庫（owner 連線，與正式環境的 prismaAdmin 相同不受 RLS 限制）。
 * 租戶、渠道與工作階段建立的資料以 stamp 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getChannelPlugin, registerChannelPlugin, webchatPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import {
  bootstrapChatboxSession,
  createChatboxSession,
  handleChatboxMessage,
  verifyClaimedChatboxSession,
  type ChatboxClaimRedis,
} from '#src/modules/chatbox/chatbox.service.js';
import { createChatboxMessageRegistry, registerBuiltInChatboxMessageHandlers } from '#src/modules/chatbox/chatbox.registry.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { AppError } from '#src/shared/utils/response.js';

loadEnvConfig();
if (!getChannelPlugin('WEBCHAT')) registerChannelPlugin(webchatPlugin);

const owner = new PrismaClient();
const stamp = `cb-off-${Date.now().toString(36)}`;
const io = { to: () => ({ emit: () => undefined }), emit: () => undefined } as never;
const registry = createChatboxMessageRegistry();
registerBuiltInChatboxMessageHandlers(registry);

function memRedis(): ChatboxClaimRedis {
  const store = new Map<string, string>();
  return {
    async get(key) { return store.get(key) ?? null; },
    async set(key, value) {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
  };
}
const claimRedis = memRedis();
const fingerprint = { browserFamily: 'chrome', osFamily: 'macos', language: 'zh-tw', timezone: 'asia/taipei', screenBucket: 'desktop' };

let tenantId = '';
let channelId = '';
let publicKey = '';

beforeAll(async () => {
  tenantId = (await owner.tenant.create({ data: { name: `CI 停用租戶聊天室 ${stamp}` } })).id;
  publicKey = `pk-${stamp}`;
  channelId = (await owner.channel.create({
    data: {
      tenantId, channelType: 'WEBCHAT', displayName: `CI ${stamp}`, credentialsEncrypted: 'x', publicKey,
      // 不跑 AI 回覆：本檔只看訊息有沒有寫入
      settings: { botConfig: { botMode: 'off' } },
    },
  })).id;
});

beforeEach(async () => {
  await owner.tenant.update({ where: { id: tenantId }, data: { isActive: true } });
});

afterAll(async () => {
  const convs = await owner.conversation.findMany({ where: { channelId }, select: { id: true } });
  const ids = convs.map((c) => c.id);
  await owner.chatboxSession.deleteMany({ where: { channelId } });
  await owner.message.deleteMany({ where: { conversationId: { in: ids } } });
  await owner.conversation.deleteMany({ where: { id: { in: ids } } });
  await owner.channelIdentity.deleteMany({ where: { channelId } });
  await owner.contact.deleteMany({ where: { tenantId } });
  await owner.channel.deleteMany({ where: { id: channelId } });
  await owner.tenantSettings.deleteMany({ where: { tenantId } });
  await owner.tenant.deleteMany({ where: { id: tenantId } });
  await owner.$disconnect();
});

let seq = 0;
const inboundCount = () => owner.message.count({ where: { direction: 'INBOUND', conversation: { channelId } } });

/** 開一個工作階段並在 Redis 認領，回傳送訊息要用的憑證 */
async function openSession() {
  const created = await createChatboxSession(owner, io, { channelPublicKey: publicKey, fingerprint });
  const boot = await bootstrapChatboxSession(owner, { sessionId: created.sessionId, fingerprint }, claimRedis);
  return { sessionId: created.sessionId, claimToken: boot.claimToken };
}

const send = (s: { sessionId: string; claimToken: string }) => handleChatboxMessage(owner, io, registry, {
  ...s, clientMessageId: `${stamp}-${seq++}`, type: 'text', payload: { text: '請問營業時間' }, fingerprint,
} as never, claimRedis);

async function rejects404(fn: () => Promise<unknown>) {
  await assert.rejects(fn, (err: unknown) => {
    assert.ok(err instanceof AppError, String(err));
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, 'NOT_FOUND');
    return true;
  });
}

const disable = () => owner.tenant.update({ where: { id: tenantId }, data: { isActive: false } });

describe('停用租戶的網站聊天室', () => {
  it('啟用中的租戶：訪客送訊息照常寫入（對照組）', async () => {
    const s = await openSession();
    const before = await inboundCount();
    await send(s);
    assert.equal(await inboundCount(), before + 1);
  });

  it('既有的工作階段在租戶停用後送訊息', async () => {
    const s = await openSession();
    await disable();
    const before = await inboundCount();
    await rejects404(() => send(s));
    assert.equal(await inboundCount(), before, '沒有寫入訊息');
  });

  it('租戶停用後新訪客建立工作階段', async () => {
    await disable();
    const contacts = await owner.contact.count({ where: { tenantId } });
    const convs = await owner.conversation.count({ where: { channelId } });
    await rejects404(() => createChatboxSession(owner, io, { channelPublicKey: publicKey, fingerprint }));
    assert.equal(await owner.contact.count({ where: { tenantId } }), contacts, '沒有建立聯絡人');
    assert.equal(await owner.conversation.count({ where: { channelId } }), convs, '沒有建立對話');
  });

  it('租戶停用後訪客 socket 驗證工作階段', async () => {
    const s = await openSession();
    await disable();
    await rejects404(() => verifyClaimedChatboxSession(owner, { ...s, fingerprint }, claimRedis));
  });

  it('共用入口 processInboundMessage 丟棄停用租戶的進站事件', async () => {
    await disable();
    const before = await inboundCount();
    const identities = await owner.channelIdentity.count({ where: { channelId } });
    const result = await processInboundMessage(owner, io, {}, { id: channelId, channelType: 'WEBCHAT' }, tenantId, {
      contactUid: `${stamp}-direct`,
      channelMsgId: `${stamp}-direct-1`,
      timestamp: new Date(),
      contentType: 'text',
      content: { text: '直接進管線' },
      rawPayload: {},
    } as never);
    assert.equal(result, undefined);
    assert.equal(await inboundCount(), before, '沒有寫入訊息');
    assert.equal(await owner.channelIdentity.count({ where: { channelId } }), identities, '沒有建立渠道身分');
  });
});
