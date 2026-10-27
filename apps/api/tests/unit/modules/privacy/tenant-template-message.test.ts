/**
 * 租戶預先寫好、由系統自動發給顧客的訊息不被去識別化改壞（2026-10-27 UAT 後續）。
 * change add-admin-ai-deidentification，spec ai-input-deidentification
 * 「Tenant-authored automatic wording keeps its authored text」。
 *
 * 去識別化只替換最低層的 HTTP 呼叫（global fetch），模擬 2md 把一般詞誤判成人名；
 * 其餘 mock 只用來決定「現在是營業時間外」與攔下渠道送出，不改變遮罩的行為。
 */
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.JWT_SECRET ||= 'test-tenant-template-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

const delivered = vi.hoisted(() => [] as string[]);
const pluginSent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('#src/modules/settings/office-hours.service.js', () => ({
  getOutsideHoursMessage: async () => '感謝祭期間客服休息中，明天 9 點回覆您。',
}));
vi.mock('#src/modules/conversation/conversation.service.js', () => ({
  deliverToChannel: async (_db: unknown, _conversationId: string, text: string) => {
    delivered.push(text);
    return true;
  },
}));
vi.mock('#src/modules/channel/channel.service.js', () => ({ decryptCredentials: () => ({}) }));
vi.mock('@open333crm/channel-plugins', () => ({
  getChannelPlugin: () => ({
    sendMessage: async (_uid: string, message: { content: Record<string, unknown> }) => {
      pluginSent.push(message.content);
      return { success: true, channelMsgId: 'mid-1' };
    },
  }),
}));

const { sendOutsideHoursAutoReply, sendFirstContactGreeting } = await import('#src/modules/webhook/inbound-side-effects.js');
const { handleCanvasSendMessage } = await import('#src/modules/canvas/canvas.worker.js');
const { readModelMessageContent } = await import('#src/modules/ai/deidentification.service.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const PHONE = '0912345678';
const EMAIL = 'ming@example.com';
/** 「感謝祭」被誤判成「感[姓名]」是 UAT 實際看到的；顧客姓名、電話、email 是真的個資 */
const misjudge = (text: string) => text
  .replace(/謝祭/g, '[姓名]')
  .replace(/小明/g, '[姓名]')
  .replaceAll(PHONE, '[手機]')
  .replaceAll(EMAIL, '[電子郵件]');

beforeEach(() => {
  delivered.length = 0;
  pluginSent.length = 0;
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string) as { text: string };
    return Response.json({ code: 200, data: { status: 'ok', text: misjudge(request.text), mappings: [] } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const io = { to: () => ({ emit: () => {} }) };

function inboundCtx(settings: Record<string, unknown>, messages: Array<Record<string, unknown>>) {
  const prisma = {
    platformSetting: { findUnique: async () => ({ value: { enabled: true } }) },
    channel: { findFirst: async () => ({ settings }) },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messages.push(data);
        return { id: `m${messages.length}`, createdAt: new Date(), ...data };
      },
    },
    conversation: { update: async () => ({}) },
  };
  return {
    prisma,
    io,
    tenantId: TENANT,
    contactId: `contact-${Math.random()}`,
    contactUid: 'U1',
    channel: { id: 'ch1', channelType: 'LINE' },
    conversation: { id: 'conv1' },
    channelIdentity: { contactId: 'c1', contact: { displayName: '小明', phone: PHONE, email: EMAIL } },
    now: new Date(),
    isFirstContact: true,
  } as never;
}

function maskedCopy(metadata: unknown): string {
  return String((metadata as { privacy: { maskedContent: { text: string } } }).privacy.maskedContent.text);
}

test('Tenant-authored automatic wording keeps its authored text: outside-hours reply', async () => {
  const messages: Array<Record<string, unknown>> = [];
  await sendOutsideHoursAutoReply(inboundCtx({}, messages));

  const text = (messages[0].content as { text: string }).text;
  assert.equal(text, '感謝祭期間客服休息中，明天 9 點回覆您。');
  assert.deepEqual(delivered, [text], '送給顧客的是原文');
  assert.equal((messages[0].metadata as { privacy: { mode: string } }).privacy.mode, 'tenant_template');
  assert.equal(maskedCopy(messages[0].metadata), '感[姓名]期間客服休息中，明天 9 點回覆您。');
});

test('Tenant-authored automatic wording keeps its authored text: first-contact greeting with customer variables', async () => {
  const messages: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  const ctx = inboundCtx({ firstContactGreeting: '{{contact.name}} 您好，歡迎參加感謝祭！聯絡電話 {{contact.phone}}、{{contact.email}}' }, messages);
  await sendFirstContactGreeting(ctx, (async (_db: unknown, _c: string, text: string) => { sent.push(text); return true; }) as never);

  const authored = `小明 您好，歡迎參加感謝祭！聯絡電話 ${PHONE}、${EMAIL}`;
  const stored = messages[0].content as { text: string };
  assert.equal(stored.text, authored, '對話紀錄存原文');
  assert.deepEqual(sent, [authored], '顧客本人收到帶入自己資料的原文');
  const masked = maskedCopy(messages[0].metadata);
  assert.equal(masked, '[姓名] 您好，歡迎參加感[姓名]！聯絡電話 [手機]、[電子郵件]');
  assert.equal(readModelMessageContent(stored, messages[0].metadata), masked, 'AI 只讀遮罩副本，看不到顧客個資');
});

test('Tenant-authored automatic wording keeps its authored text: canvas message node', async () => {
  const messages: Array<Record<string, unknown>> = [];
  const prisma = {
    platformSetting: { findUnique: async () => ({ value: { enabled: true } }) },
    conversation: {
      findFirst: async () => ({
        id: 'conv1',
        channelId: 'ch1',
        channel: { channelType: 'LINE', isActive: true, credentialsEncrypted: 'x' },
        contact: { channelIdentities: [{ channelId: 'ch1', uid: 'U1' }] },
      }),
      update: async () => ({}),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        messages.push(data);
        return { id: 'm1', createdAt: new Date(), senderId: null, ...data };
      },
    },
  };

  await handleCanvasSendMessage(prisma as never, io, TENANT, {
    executionId: 'e1', contactId: 'c1', channelType: 'LINE', text: '感謝祭限定：回覆「1」領取折價券',
  });

  assert.deepEqual(pluginSent, [{ text: '感謝祭限定：回覆「1」領取折價券' }], '送給顧客的是原文');
  assert.equal((messages[0].content as { text: string }).text, '感謝祭限定：回覆「1」領取折價券');
  assert.equal(maskedCopy(messages[0].metadata), '感[姓名]限定：回覆「1」領取折價券');
});

test('Masking failure on tenant-authored wording', async () => {
  vi.stubGlobal('fetch', async () => new Response('upstream down', { status: 503 }));
  const messages: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  await sendFirstContactGreeting(
    inboundCtx({ firstContactGreeting: '{{contact.name}} 您好' }, messages),
    (async (_db: unknown, _c: string, text: string) => { sent.push(text); return true; }) as never,
  );
  await sendOutsideHoursAutoReply(inboundCtx({}, messages));
  assert.equal(messages.length, 0, '不寫入對話');
  assert.deepEqual(sent, [], '歡迎詞不送出');
  assert.deepEqual(delivered, [], '營業時間外回覆不送出');
});
