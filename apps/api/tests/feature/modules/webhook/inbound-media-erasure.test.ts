/**
 * 進站媒體下載完成時，訊息已被匿名化（issue #475，change `skip-media-write-after-erasure`）。
 *
 * 媒體在背景非同步下載，下載完成後寫回訊息。修正前用下載前讀到的內容加上 storageKey 覆寫訊息，
 * 下載期間對這位客人執行匿名化時，`{ redacted: true }` 會被原文覆寫回來，剛上傳的媒體檔也留下。
 *
 * 以真實 Postgres 執行，client 用 app_admin（與正式環境 webhook 的 prismaAdmin 相同）。物件儲存換成記錄呼叫的假實作。
 * 資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeEach, test } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { resolveInboundMedia } from '#src/modules/webhook/inbound-side-effects.js';
import { setStorageProviderForTests } from '#src/modules/storage/storage.service.js';
import type { StorageProvider } from '#src/modules/storage/storage.provider.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const T = TENANT_A;
const MARK = `media-erasure-${Date.now().toString(36)}`;

const uploaded: string[] = [];
const deleted: string[] = [];
setStorageProviderForTests({
  upload: async (_buffer: Buffer, key: string) => {
    uploaded.push(key);
    return { key, url: `https://files.example.test/${key}` };
  },
  delete: async (key: string) => {
    deleted.push(key);
  },
} as unknown as StorageProvider);

const channel = await owner.channel.create({
  data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: 'x' },
});

beforeEach(() => {
  uploaded.length = 0;
  deleted.length = 0;
});

afterAll(async () => {
  setStorageProviderForTests(null);
  await owner.conversation.deleteMany({ where: { tenantId: T, channelId: channel.id } });
  await owner.contact.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.channel.delete({ where: { id: channel.id } });
  await Promise.all([owner.$disconnect(), admin.$disconnect()]);
});

const ORIGINAL = { text: '[圖片]', contentId: 'line-msg-1' };
const REDACTED = { redacted: true };

/** 一位客人的對話與一則等待下載的進站圖片訊息 */
async function createInboundImage() {
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-王小明` } });
  const conversation = await owner.conversation.create({
    data: { tenantId: T, contactId: contact.id, channelId: channel.id, channelType: 'LINE' },
  });
  const message = await owner.message.create({
    data: { conversationId: conversation.id, senderType: 'CONTACT', direction: 'INBOUND', contentType: 'image', content: ORIGINAL },
  });
  return { contact, conversation, message };
}

type Resolver = (
  upload: (buffer: Buffer, filename: string, mime: string) => Promise<{ key: string; url: string }>,
) => Promise<{ url: string; storageKey: string } | null>;

/** 以收訊管線的 ctx 形狀執行下載與寫回（ctx.prisma 是 app_admin） */
function runResolve(subject: Awaited<ReturnType<typeof createInboundImage>>, resolver: Resolver) {
  return resolveInboundMedia({
    plugin: {
      resolveInboundMedia: (_content: unknown, _type: unknown, _credentials: unknown, upload: Parameters<Resolver>[0]) =>
        resolver(upload),
    },
    content: ORIGINAL,
    contentType: 'image',
    credentials: {},
    tenantId: T,
    conversation: subject.conversation,
    message: subject.message,
    prisma: admin,
    io: { to: () => ({ emit: () => true }) },
  } as never);
}

/** 下載：上傳到物件儲存並回傳 storageKey（與 LINE 外掛相同） */
async function download(upload: Parameters<Resolver>[0]) {
  const { key, url } = await upload(Buffer.from('jpg'), 'photo.jpg', 'image/jpeg');
  return { url, storageKey: key };
}

const contentOf = async (id: string) => (await owner.message.findUniqueOrThrow({ where: { id } })).content;

test('下載完成時訊息沒有變動：寫入 storageKey 與儲存網址', async () => {
  const subject = await createInboundImage();
  await runResolve(subject, download);

  assert.equal(uploaded.length, 1);
  const content = (await contentOf(subject.message.id)) as Record<string, unknown>;
  assert.equal(content.storageKey, uploaded[0]);
  assert.equal(content.mediaUrl, `https://files.example.test/${uploaded[0]}`);
  assert.equal(content.text, ORIGINAL.text);
  assert.deepEqual(deleted, [], '寫入成功時不刪檔');
});

test('下載期間訊息被匿名化：不寫回原文，並刪除剛上傳的物件', async () => {
  const subject = await createInboundImage();
  await runResolve(subject, async (upload) => {
    const stored = await download(upload);
    // 下載期間 worker 匿名化這位客人：進站訊息改成 { redacted: true }
    await owner.message.update({ where: { id: subject.message.id }, data: { content: REDACTED } });
    return stored;
  });

  assert.deepEqual(await contentOf(subject.message.id), REDACTED, '訊息維持匿名化後的內容');
  assert.deepEqual(deleted, uploaded, '刪除剛上傳的物件');
});

test('匿名化的交易進行中下載完成：等匿名化 commit 之後放棄寫入，並刪除剛上傳的物件', async () => {
  // 匿名化的交易先鎖住對話（data-erasure.handler 的 lockContactConversations），讀完訊息之後才改寫。
  // 寫回若不等這個鎖，會在「讀訊息」與「改寫」之間寫進 storageKey，接著被改寫蓋掉，物件成為孤兒檔。
  const subject = await createInboundImage();
  let release!: () => void;
  const locked = new Promise<void>((resolve) => (release = resolve));
  let writeStarted!: () => void;
  const started = new Promise<void>((resolve) => (writeStarted = resolve));

  const erasure = owner.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${subject.conversation.id}::uuid FOR UPDATE`;
      // 匿名化讀出訊息（這時還沒有 storageKey，所以不會刪除媒體檔）
      const before = await tx.message.findMany({ where: { conversationId: subject.conversation.id } });
      release();
      await started;
      await new Promise((r) => setTimeout(r, 300)); // 寫回此時已送出，應該在等鎖
      await tx.message.updateMany({ where: { conversationId: subject.conversation.id, direction: 'INBOUND' }, data: { content: REDACTED } });
      return before;
    },
    { timeout: 10_000 },
  );

  await locked;
  const write = runResolve(subject, async (upload) => {
    const stored = await download(upload);
    writeStarted();
    return stored;
  });
  const before = await erasure;
  await write;

  assert.ok(
    before.every((m) => !(m.content as Record<string, unknown>).storageKey),
    '前提：匿名化讀訊息時還沒有 storageKey',
  );
  assert.deepEqual(await contentOf(subject.message.id), REDACTED);
  assert.deepEqual(deleted, uploaded, '寫回放棄時刪除剛上傳的物件，不留下孤兒檔');
});

test('下載失敗時訊息已被匿名化：不把原文與失敗原因寫回', async () => {
  const subject = await createInboundImage();
  await runResolve(subject, async () => {
    await owner.message.update({ where: { id: subject.message.id }, data: { content: REDACTED } });
    throw new Error('LINE 內容下載失敗（404）');
  });

  assert.deepEqual(await contentOf(subject.message.id), REDACTED);
});
