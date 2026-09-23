/**
 * 送出失敗要在後台留下可見紀錄。
 *   npx tsx apps/workers/src/__tests__/delivery-failure-record.test.ts
 *
 * 背景（2026-09-23）：測試人員回報「AI bot 模式下不觸發 LINE 關鍵字素材」。
 * 查下來關鍵字其實有觸發——同一支規則的文字素材使用者有收到——
 * 真正的問題是影片素材的 videoUrl 用了 Google Drive 分享連結，
 * LINE 拒收（要求可直接下載的 mp4）。
 *
 * 但這件事**後台完全看不出來**：失敗只寫進 worker 的 log，
 * 訊息也不會寫進 DB（原本的程式碼在送出失敗時直接 return false，
 * 根本走不到 message.create）。使用者只覺得「沒反應」，
 * 查的時候 log 早就輪替掉了，只能從 DB 反推。
 *
 * 所以：送出失敗也要寫一則訊息，標記 metadata.deliveryFailed，
 * 讓它出現在收件匣裡。這則訊息沒有真的送到使用者端，只給客服看。
 */
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ChannelPlugin } from '@open333crm/channel-plugins';
import { deliverToChannelFromWorker } from '../lib/channel-delivery';

const ALGORITHM = 'aes-256-gcm';

function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(
    process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key',
    'open333crm-credentials',
    32,
  );
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

type CreatedMessage = { data: Record<string, unknown> };

function makePrisma(created: CreatedMessage[]) {
  return {
    conversation: {
      async findUnique() {
        return {
          id: 'conversation-1',
          tenantId: 'tenant-1',
          channel: {
            id: 'channel-1',
            channelType: 'LINE',
            isActive: true,
            credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }),
          },
          contact: { channelIdentities: [{ channelId: 'channel-1', uid: 'line-user-1' }] },
        };
      },
      async update() {
        return {};
      },
    },
    message: {
      async create(args: CreatedMessage) {
        created.push(args);
        return { id: 'message-1', metadata: args.data.metadata };
      },
    },
  };
}

const redis = { async publish() { return 1; } };

/** 送出失敗的 plugin：模擬 LINE 拒收影片（Drive 連結不是影片檔）。 */
const failingPlugin: ChannelPlugin = {
  channelType: 'LINE',
  verifySignature: () => true,
  parseWebhook: async () => [],
  getProfile: async (uid: string) => ({ uid, displayName: uid }),
  sendMessage: async () => ({
    success: false,
    error:
      'Request failed 400 {"message":"The request body has 1 error(s)","details":[{"message":"May not be empty","property":"/messages/0/originalContentUrl"}]}',
  }),
};

async function testFailureIsRecorded() {
  const created: CreatedMessage[] = [];
  const ok = await deliverToChannelFromWorker(
    makePrisma(created) as never,
    redis as never,
    new Map([['LINE', failingPlugin]]),
    'conversation-1',
    { contentType: 'line_video', content: { videoUrl: 'https://drive.google.com/file/d/x/view' } },
  );

  assert.equal(ok, false, '送出失敗應回傳 false');
  assert.equal(created.length, 1, '失敗時仍應寫下一則可見紀錄（原本完全不寫）');

  const meta = created[0].data.metadata as Record<string, unknown>;
  assert.equal(meta.deliveryFailed, true, '未標記 deliveryFailed，前端無從分辨');
  assert.equal(
    created[0].data.contentType,
    'line_video',
    '應保留原本的 contentType，客服才知道是哪種內容沒送出',
  );
  assert.ok(
    typeof meta.deliveryError === 'string' && meta.deliveryError.length > 0,
    '未帶失敗原因',
  );
  // 原因要是人看得懂的，不是整包 JSON
  assert.ok(
    (meta.deliveryError as string).includes('May not be empty'),
    `未抽出 LINE 的具體原因，實際為：${String(meta.deliveryError)}`,
  );
  assert.ok(
    !(meta.deliveryError as string).startsWith('{'),
    '不該把整包 JSON 原樣塞進去',
  );
}

async function testSuccessIsNotMarked() {
  const created: CreatedMessage[] = [];
  const okPlugin: ChannelPlugin = {
    ...failingPlugin,
    sendMessage: async () => ({ success: true, channelMsgId: 'line-1' }),
  };
  const ok = await deliverToChannelFromWorker(
    makePrisma(created) as never,
    redis as never,
    new Map([['LINE', okPlugin]]),
    'conversation-1',
    { contentType: 'line_text', content: { text: 'hi' } },
  );

  assert.equal(ok, true);
  assert.equal(created.length, 1);
  const meta = created[0].data.metadata as Record<string, unknown>;
  assert.ok(!meta.deliveryFailed, '成功的訊息不該被標記為失敗');
}

/** 寫紀錄本身失敗，不可以把原本的錯誤蓋掉或讓整個流程炸掉。 */
async function testRecordFailureIsSafe() {
  const prisma = {
    ...makePrisma([]),
    message: {
      async create() {
        throw new Error('DB 也掛了');
      },
    },
  };
  const ok = await deliverToChannelFromWorker(
    prisma as never,
    redis as never,
    new Map([['LINE', failingPlugin]]),
    'conversation-1',
    { contentType: 'line_video', content: {} },
  );
  assert.equal(ok, false, '仍應正常回報失敗，而不是往外拋');
}

async function main() {
  await testFailureIsRecorded();
  await testSuccessIsNotMarked();
  await testRecordFailureIsSafe();
  console.log('delivery-failure-record tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
