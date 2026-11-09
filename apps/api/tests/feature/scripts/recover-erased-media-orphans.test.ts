/**
 * 一次性腳本 scripts/recover-erased-media-orphans.mjs（issue #474）。
 *
 * #329 之前，匿名化把進站訊息改成 { redacted: true } 時沒有先讀出 storageKey，媒體檔留在物件儲存。
 * 腳本找出已完成匿名化的聯絡人的對話，列出 {tenantId}/media/{conversationId}/ 底下的物件，
 * 扣掉仍被訊息引用的 key，只刪 uuid 檔名格式的物件。
 *
 * 資料庫是真的：在 owner 交易內建資料、呼叫腳本匯出的函式，斷言後一律回滾。物件儲存是記錄呼叫的假實作，不連 MinIO。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, Prisma } from '@prisma/client';
import { isConversationMediaKey } from '@open333crm/core';
import { afterAll, beforeAll, test } from 'vitest';
import { repoRoot } from '#tests/support/paths.js';

const owner = new PrismaClient();
const MARK = `ci-media-orphans-${Date.now()}`;
const BUCKET = 'open333crm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let script: any;
let outDir: string;

beforeAll(async () => {
  script = await import(pathToFileURL(resolve(repoRoot, 'scripts/recover-erased-media-orphans.mjs')).href);
  outDir = await mkdtemp(join(tmpdir(), 'media-orphans-'));
});

afterAll(async () => {
  await owner.$disconnect();
  await rm(outDir, { recursive: true, force: true });
});

class Rollback extends Error {}

async function inRolledBackTransaction(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await owner.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
}

/** 假的物件儲存：objects 是 bucket 裡的 key；list 依前綴回傳，delete 記下呼叫 */
function fakeStorage(objects: string[], failing: string[] = []) {
  const listed: string[] = [];
  const deleted: string[] = [];
  return {
    listed,
    deleted,
    list: async (bucket: string, prefix: string) => {
      assert.equal(bucket, BUCKET);
      listed.push(prefix);
      return objects.filter((k) => k.startsWith(prefix));
    },
    delete: async (bucket: string, key: string) => {
      assert.equal(bucket, BUCKET);
      deleted.push(key);
      if (failing.includes(key)) throw new Error('minio down');
    },
  };
}

/**
 * 一個租戶：已匿名化的客人（完成的 anonymize 請求，進站訊息已抹除）、一位沒有刪除請求的客人，
 * 以及一筆完成的硬刪除請求（聯絡人與對話已刪除）。
 */
async function seed(tx: Prisma.TransactionClient) {
  const tenant = await tx.tenant.create({ data: { name: MARK } });
  const T = tenant.id;
  const channel = await tx.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: 'x' },
  });
  const contact = (name: string) => tx.contact.create({ data: { tenantId: T, displayName: name } });
  const conversationOf = (contactId: string) =>
    tx.conversation.create({ data: { tenantId: T, contactId, channelId: channel.id, channelType: 'LINE' } });

  const erased = await contact('[已刪除]');
  const erasedConv = await conversationOf(erased.id);
  const kept = await contact('王小明');
  const keptConv = await conversationOf(kept.id);
  await tx.dataErasureRequest.create({ data: { tenantId: T, contactId: erased.id, mode: 'anonymize', status: 'completed' } });
  await tx.dataErasureRequest.create({ data: { tenantId: T, contactId: kept.id, mode: 'anonymize', status: 'pending' } });
  await tx.dataErasureRequest.create({ data: { tenantId: T, contactId: randomUUID(), mode: 'hard_delete', status: 'completed' } });

  const key = (conversationId: string, name = `${randomUUID()}.jpg`) => `${T}/media/${conversationId}/${name}`;
  const orphan = key(erasedConv.id); // 客人傳的圖片，訊息已抹除
  const agentUpload = key(erasedConv.id, `${randomUUID()}.png`); // 客服上傳，出站訊息仍引用
  const oddName = key(erasedConv.id, 'report.csv'); // 檔名不是 uuid
  const nested = key(erasedConv.id, `x/${randomUUID()}.jpg`); // 多一層路徑
  const keptMedia = key(keptConv.id); // 沒有刪除的客人
  await tx.message.create({
    data: { conversationId: erasedConv.id, senderType: 'CONTACT', direction: 'INBOUND', contentType: 'image', content: { redacted: true } },
  });
  await tx.message.create({
    data: {
      conversationId: erasedConv.id,
      senderType: 'AGENT',
      direction: 'OUTBOUND',
      contentType: 'image',
      content: { url: `https://files.example.test/${BUCKET}/${agentUpload}` },
    },
  });
  return { T, erasedConv, keptConv, orphan, agentUpload, oddName, nested, keptMedia };
}

const collect = (tx: Prisma.TransactionClient, storage: ReturnType<typeof fakeStorage>, tenants: string[]) =>
  script.collectOrphans(tx, storage, { tenants, bucket: BUCKET, isConversationMediaKey });

test('只列出已完成匿名化的對話，扣掉仍被訊息引用的 key，只刪 uuid 檔名的物件', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx);
    const storage = fakeStorage([s.orphan, s.agentUpload, s.oddName, s.nested, s.keptMedia]);
    const report = await collect(tx, storage, [s.T]);

    assert.deepEqual(storage.listed, [`${s.T}/media/${s.erasedConv.id}/`], '沒有刪除請求或請求未完成的客人不列');
    assert.deepEqual(report.toDelete, [{ tenantId: s.T, conversationId: s.erasedConv.id, key: s.orphan }]);
    const [t] = report.tenants;
    assert.equal(t.listed, 4);
    assert.equal(t.referenced, 1, '出站訊息仍引用的客服上傳檔保留');
    assert.deepEqual([...t.skipped].sort(), [s.oddName, s.nested].sort(), '格式不符的略過並計數');
    assert.deepEqual(report.hardDeleteRequests, [{ tenantId: s.T, count: 1 }], '硬刪除只列筆數');
    assert.deepEqual(storage.deleted, [], 'dry-run 不刪除');
  });
});

test('--tenant 只處理指定的租戶', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx);
    const storage = fakeStorage([s.orphan]);
    const report = await collect(tx, storage, [randomUUID()]);
    assert.deepEqual(report.toDelete, []);
    assert.deepEqual(storage.listed, []);
  });
});

test('筆數與 --expect-objects 不同時不刪除，也不寫清單', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx);
    const storage = fakeStorage([s.orphan]);
    const report = await collect(tx, storage, [s.T]);
    await assert.rejects(
      script.applyDeletion(storage, report, { expectObjects: 2, bucket: BUCKET, outDir, fileStamp: 'mismatch' }),
      /不一致/,
    );
    assert.deepEqual(storage.deleted, []);
  });
});

test('--apply：刪除前寫出清單，每個 key 刪一次，失敗的 key 回報、不重試', async () => {
  await inRolledBackTransaction(async (tx) => {
    const s = await seed(tx);
    const second = `${s.T}/media/${s.erasedConv.id}/${randomUUID()}.mp4`;
    const storage = fakeStorage([s.orphan, second, s.agentUpload], [second]);
    const report = await collect(tx, storage, [s.T]);
    const result = await script.applyDeletion(storage, report, { expectObjects: 2, bucket: BUCKET, outDir, fileStamp: 'apply' });

    assert.deepEqual([...storage.deleted].sort(), [s.orphan, second].sort());
    assert.equal(result.deleted, 1);
    assert.deepEqual(result.failed, [second]);
    const csv = await readFile(result.file, 'utf8');
    assert.ok(csv.startsWith('tenantId,conversationId,key\n'));
    assert.ok(csv.includes(s.orphan) && csv.includes(second), '清單列出要刪的 key');
    assert.ok(!csv.includes(s.agentUpload), '保留的 key 不在清單');
  });
});

test('連線身分不能略過 RLS 時直接失敗', async () => {
  const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
  try {
    await assert.rejects(collect(tenantDb as never, fakeStorage([]), []), /略過 RLS/);
  } finally {
    await tenantDb.$disconnect();
  }
});
