/**
 * data-export worker 不重新處理已結束的請求（change outbox-event-delivery：tenant-data-export
 * 「worker 不重新處理已結束的匯出請求」）。
 *
 * 物件儲存與通知換成記錄呼叫的假實作；資料庫是記憶體裡的假實作，匯出的資料表都是空的。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const calls = vi.hoisted(() => ({ uploads: [] as string[], notified: [] as string[] }));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { type: string }) => {
    calls.notified.push(input.type);
  },
}));
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    async upload(_bucket: string, key: string) {
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

function fakeDb(request: Request) {
  const models: Record<string, unknown> = {
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

const job = { data: { requestId: REQUEST, tenantId: TENANT, requestedBy: 'agent-1' } } as never;
const redis = { publish: async () => 1 } as never;

beforeEach(() => {
  calls.uploads.length = 0;
  calls.notified.length = 0;
});

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
