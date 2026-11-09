/**
 * 進站媒體下載後寫回訊息（issue #206）。
 * LINE 外掛把 mediaUrl 設為 `line-content:<id>`，下載完成後原本只寫入 content.url；
 * 前端優先讀 mediaUrl，拿到瀏覽器打不開的網址，LINE 的圖片與影片在收件匣顯示不出來。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveInboundMedia, resolveInboundMediaAsync } from '#src/modules/webhook/inbound-side-effects.js';

/**
 * 假的 prisma：寫回在交易內以條件更新（#475），條件成立時把寫入的內容交給 onWrite。
 * matched 為 false 時模擬「訊息在下載期間被改寫」：更新 0 筆。
 */
function fakePrisma(onWrite: (content: Record<string, unknown>) => void, matched = true) {
  const tx = {
    $queryRaw: async () => [],
    message: {
      updateMany: async (args: { data: { content: Record<string, unknown> } }) => {
        if (!matched) return { count: 0 };
        onWrite(args.data.content);
        return { count: 1 };
      },
    },
  };
  return { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
}

function run(resolveInboundMedia: () => Promise<unknown>, content: Record<string, unknown>) {
  let resolveUpdate!: (content: Record<string, unknown>) => void;
  const updated = new Promise<Record<string, unknown>>((r) => (resolveUpdate = r));
  const emitted: string[] = [];
  resolveInboundMediaAsync({
    plugin: { resolveInboundMedia },
    content,
    contentType: 'file',
    credentials: {},
    tenantId: 'tenant-1',
    conversation: { id: 'conv-1' },
    message: { id: 'msg-1', conversationId: 'conv-1', content, createdAt: new Date(0) },
    prisma: fakePrisma(resolveUpdate),
    io: { to: () => ({ emit: (event: string) => emitted.push(event) }) },
  } as never);
  return { updated, emitted };
}

test('Image downloaded on receive / Media URL never expires：mediaUrl 改為儲存後的網址', async () => {
  let resolveUpdate!: (content: Record<string, unknown>) => void;
  const updated = new Promise<Record<string, unknown>>((r) => (resolveUpdate = r));
  const content = { text: '[圖片]', contentId: 'm1', mediaUrl: 'line-content:m1' };

  resolveInboundMediaAsync({
    plugin: {
      resolveInboundMedia: async () => ({ url: 'https://cdn.example.com/m1.jpg', storageKey: 'media/m1.jpg' }),
    },
    content,
    contentType: 'image',
    credentials: {},
    tenantId: 'tenant-1',
    conversation: { id: 'conv-1' },
    message: { id: 'msg-1', conversationId: 'conv-1', content, createdAt: new Date(0) },
    prisma: fakePrisma(resolveUpdate),
    io: { to: () => ({ emit: () => undefined }) },
  } as never);

  assert.deepEqual(await updated, {
    text: '[圖片]',
    contentId: 'm1',
    mediaUrl: 'https://cdn.example.com/m1.jpg',
    url: 'https://cdn.example.com/m1.jpg',
    storageKey: 'media/m1.jpg',
  });
});

/* 失敗原本只寫 logger.error：客服分不出「還在下載」與「下載失敗」，LINE 的內容過期後就再也拿不到 */
test('下載失敗：原因寫進訊息並推送給收件匣', async () => {
  const { updated, emitted } = run(async () => {
    throw new Error('檔案超過 25 MB，未下載');
  }, { text: '[檔案] big.zip', contentId: 'm2', fileName: 'big.zip' });
  assert.deepEqual(await updated, {
    text: '[檔案] big.zip',
    contentId: 'm2',
    fileName: 'big.zip',
    mediaError: '檔案超過 25 MB，未下載',
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(emitted.includes('message.new'), '要推送更新，收件匣才看得到失敗');
});

test('訊息內容是字串時：包成 { text } 再寫入，不展開成逐字元的鍵', async () => {
  const { updated } = run(async () => {
    throw new Error('LINE 內容下載失敗（404）');
  }, 'hi' as never);
  assert.deepEqual(await updated, { text: 'hi', mediaError: 'LINE 內容下載失敗（404）' });
});

test('訊息在下載期間被改寫（條件更新 0 筆）：不推送 message.new', async () => {
  const content = { text: '[檔案] a.pdf', contentId: 'm3' };
  const emitted: string[] = [];
  const writes: unknown[] = [];
  await resolveInboundMedia({
    plugin: { resolveInboundMedia: async () => ({ url: 'https://cdn.example.com/a.pdf', storageKey: 'media/a.pdf' }) },
    content,
    contentType: 'file',
    credentials: {},
    tenantId: 'tenant-1',
    conversation: { id: 'conv-1' },
    message: { id: 'msg-1', conversationId: 'conv-1', content, createdAt: new Date(0) },
    prisma: fakePrisma((c) => writes.push(c), false),
    io: { to: () => ({ emit: (event: string) => emitted.push(event) }) },
  } as never);
  assert.deepEqual(writes, []);
  assert.deepEqual(emitted, [], '沒有寫入就不推送');
});
