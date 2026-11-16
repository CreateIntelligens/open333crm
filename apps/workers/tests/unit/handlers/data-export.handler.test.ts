/**
 * data-export worker 不重新處理已結束的請求（change outbox-event-delivery：tenant-data-export
 * 「worker 不重新處理已結束的匯出請求」）。
 *
 * 發起的成員已被永久刪除時不送通知（change keep-completion-audit-for-purged-requester）。
 *
 * 匯出含留言自動私訊資料（change add-comment-keyword-private-reply，design D27）：規則、觸發紀錄（不含送出內容快照）、
 * 留言者對應三類的 CSV 與 JSON，manifest 有筆數。
 *
 * 物件儲存與通知換成記錄呼叫的假實作；資料庫是記憶體裡的假實作，沒有特別給資料的表都是空的。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ uploads: [] as string[], notified: [] as string[], buffers: [] as Buffer[] }));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { type: string }) => {
    calls.notified.push(input.type);
  },
}));
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    async upload(_bucket: string, key: string, data: Buffer) {
      calls.buffers.push(data);
      // 讓出執行權：兩次執行同時進行時，都先上傳才寫入完成狀態
      await new Promise((r) => setTimeout(r, 2));
      calls.uploads.push(key);
    }
  },
}));

const { handleDataExportJob } = await import('#src/handlers/data-export.handler.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const REQUEST = 'f0000000-0000-0000-0000-00000000000f';

interface Request {
  id: string;
  tenantId: string;
  status: string;
  fileKey: string | null;
  expiresAt: Date | null;
}

function matchesStatus(status: string, where: { status?: string | { in: string[] } }) {
  if (!where.status) return true;
  return typeof where.status === 'string' ? where.status === status : where.status.in.includes(status);
}

const REQUESTER = 'b0000000-0000-0000-0000-00000000000b';

function fakeDb(request: Request, requesterExists = true, tables: Record<string, Array<Record<string, unknown>>> = {}) {
  const models: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(tables).map(([model, rows]) => [
        model,
        {
          // 只回本租戶、cursor 之後的資料（與 Prisma 的 cursor + skip: 1 相同）
          findMany: async ({ where, cursor }: { where: { tenantId: string }; cursor?: { id: string } }) => {
            const own = rows.filter((r) => r.tenantId === where.tenantId);
            return cursor ? own.slice(own.findIndex((r) => r.id === cursor.id) + 1) : own;
          },
        },
      ]),
    ),
    agent: {
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
        requesterExists && where.id === REQUESTER && where.tenantId === TENANT ? { id: REQUESTER } : null,
    },
    dataExportRequest: {
      findFirst: async () => ({ id: request.id, status: request.status }),
      updateMany: async ({ where, data }: { where: { id: string; tenantId: string; status?: string | { in: string[] } }; data: Record<string, unknown> }) => {
        if (request.id !== where.id || request.tenantId !== where.tenantId || !matchesStatus(request.status, where)) {
          return { count: 0 };
        }
        Object.assign(request, data);
        return { count: 1 };
      },
    },
  };
  return new Proxy(models, {
    get: (target, prop: string) => target[prop] ?? { findMany: async () => [] },
  });
}

function request(status: string, fileKey: string | null = null): Request {
  return { id: REQUEST, tenantId: TENANT, status, fileKey, expiresAt: fileKey ? new Date('2026-11-01T00:00:00Z') : null };
}

const job = { data: { requestId: REQUEST, tenantId: TENANT, requestedBy: REQUESTER } } as never;
const redis = { publish: async () => 1 } as never;

beforeEach(() => {
  calls.uploads.length = 0;
  calls.notified.length = 0;
  calls.buffers.length = 0;
});

/** SimpleZip 只用 store（不壓縮）：依本地檔頭逐一讀出檔名與內容 */
function readZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    files.set(buffer.toString('utf8', offset + 30, offset + 30 + nameLength), buffer.toString('utf8', start, start + size));
    offset = start + size;
  }
  return files;
}

test('已完成的請求再執行一次：fileKey 與 expiresAt 不變，不送第二則完成通知', async () => {
  const r = request('completed', 'export/old.zip');
  const expiresAt = r.expiresAt;
  await handleDataExportJob(job, fakeDb(r) as never, redis);
  assert.equal(r.status, 'completed');
  assert.equal(r.fileKey, 'export/old.zip');
  assert.equal(r.expiresAt, expiresAt);
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.notified, []);
});

test('上一次執行中途結束：processing 的請求重新處理，請求是 completed 並有 fileKey，送出一則完成通知', async () => {
  const r = request('processing');
  await handleDataExportJob(job, fakeDb(r) as never, redis);
  assert.equal(r.status, 'completed');
  assert.equal(r.fileKey, `export/${TENANT}/${REQUEST}.zip`);
  assert.deepEqual(calls.notified, ['data_export_ready']);
});

test('兩次同時執行：請求是 completed，只送出一則完成通知', async () => {
  const r = request('pending');
  const db = fakeDb(r);
  await Promise.all([handleDataExportJob(job, db as never, redis), handleDataExportJob(job, db as never, redis)]);
  assert.equal(r.status, 'completed');
  assert.deepEqual(calls.notified, ['data_export_ready']);
});

test('發起的成員已被永久刪除時完成匯出、不送通知', async () => {
  const r = request('pending');
  await handleDataExportJob(job, fakeDb(r, false) as never, redis);
  assert.equal(r.status, 'completed');
  assert.equal(r.fileKey, `export/${TENANT}/${REQUEST}.zip`);
  assert.deepEqual(calls.notified, []);
});

test('匯出含留言自動私訊資料：三類的 CSV 與 JSON 只含本租戶，紀錄不含送出內容快照', async () => {
  const OTHER = 'a0000000-0000-0000-0000-000000000002';
  const tables = {
    commentReplyRule: [
      { id: 'r1', tenantId: TENANT, name: '優惠規則', keywords: ['優惠'] },
      { id: 'r2', tenantId: OTHER, name: '別人的規則', keywords: ['x'] },
    ],
    commentReplyLog: [1, 2, 3].map((n) => ({
      id: `l${n}`,
      tenantId: TENANT,
      commentId: `POST_1_${n}`,
      commentText: '我要優惠',
      sentContentSnapshot: { text: '快照原文' },
    })),
    commentAuthor: [{ id: 'a1', tenantId: TENANT, externalUserId: 'ASID_1', displayName: '王小明' }],
  };
  tables.commentReplyLog.push({ id: 'l9', tenantId: OTHER, commentId: 'X', commentText: '別人的', sentContentSnapshot: { text: 'x' } });
  await handleDataExportJob(job, fakeDb(request('pending'), true, tables) as never, redis);

  const files = readZip(calls.buffers[0]);
  for (const name of ['comment_reply_rules', 'comment_reply_logs', 'comment_authors']) {
    assert.ok(files.has(`json/${name}.json`) && files.has(`csv/${name}.csv`), `有 ${name} 的 JSON 與 CSV`);
  }
  const json = (name: string) => JSON.parse(files.get(`json/${name}.json`)!) as Array<Record<string, unknown>>;
  assert.deepEqual(json('comment_reply_rules').map((r) => r.id), ['r1']);
  assert.deepEqual(json('comment_reply_logs').map((r) => r.id), ['l1', 'l2', 'l3']);
  assert.deepEqual(json('comment_authors').map((r) => r.id), ['a1']);
  assert.ok(json('comment_reply_logs').every((l) => !('sentContentSnapshot' in l)));
  assert.ok(![...files.values()].some((f) => f.includes('快照原文')), '不含快照原文');
  const { counts } = JSON.parse(files.get('manifest.json')!);
  assert.equal(counts.commentReplyRules, 1);
  assert.equal(counts.commentReplyLogs, 3);
  assert.equal(counts.commentAuthors, 1);
});
