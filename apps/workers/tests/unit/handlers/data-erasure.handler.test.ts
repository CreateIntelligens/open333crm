/**
 * data-erasure worker 不重新處理已結束的請求（change outbox-event-delivery：tenant-data-erasure
 * 「worker 不重新處理已結束的刪除請求」）。
 *
 * 第一個測試重現 bug：同一個硬刪除工作執行兩次時，第二次把 completed 改成 failed。
 * 資料庫是記憶體裡的假實作：沒有特別處理的查詢回傳空結果；交易丟錯時還原請求與聯絡人。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const notified = vi.hoisted(() => [] as string[]);
const storage = vi.hoisted(() => ({ remove: async (_bucket: string, _key: string): Promise<void> => undefined }));
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    delete = (bucket: string, key: string) => storage.remove(bucket, key);
  },
}));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { type: string }) => {
    notified.push(input.type);
  },
}));

const { handleDataErasureJob } = await import('#src/handlers/data-erasure.handler.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const REQUEST = 'f0000000-0000-0000-0000-00000000000f';
const CONTACT = 'c0000000-0000-0000-0000-00000000000c';
const CONVERSATION = 'd0000000-0000-0000-0000-00000000000d';

interface State {
  request: { id: string; tenantId: string; status: string; error: string | null; affected: unknown };
  contact: { id: string; tenantId: string; displayName: string } | null;
  audits: string[];
  auditPayloads: unknown[];
  messages: { direction: string; content: unknown }[];
  /** 交易 commit 之後補寫 affected 的 updateMany 丟錯 */
  failAffectedWriteBack?: boolean;
}

function matchesStatus(status: string, where: { status?: string | { in: string[] } }) {
  if (!where.status) return true;
  return typeof where.status === 'string' ? where.status === status : where.status.in.includes(status);
}

/** 沒有特別處理的 model 方法回傳空結果 */
function emptyModel(methods: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(methods, {
    get: (t, method: string) =>
      t[method] ??
      (async () => (method === 'findMany' ? [] : method === 'count' ? 0 : method.endsWith('Many') ? { count: 0 } : {})),
  });
}

function fakeDb(state: State) {
  const yieldOnce = () => new Promise((r) => setTimeout(r, 1));
  /** journal：交易內的寫入記下還原方式，交易丟錯時只還原這個交易寫過的資料 */
  function makeModels(journal: Array<() => void> | null): Record<string, unknown> {
    const record = (undo: () => void) => journal?.push(undo);
    return {
      dataErasureRequest: {
        updateMany: async ({ where, data }: { where: { id: string; tenantId: string; status?: string | { in: string[] } }; data: Record<string, unknown> }) => {
          await yieldOnce();
          if (state.failAffectedWriteBack && journal === null && 'affected' in data) throw new Error('db down');
          const r = state.request;
          if (r.id !== where.id || r.tenantId !== where.tenantId || !matchesStatus(r.status, where)) return { count: 0 };
          const prev = { ...r };
          record(() => Object.assign(r, prev));
          Object.assign(r, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          const prev = { ...state.request };
          record(() => Object.assign(state.request, prev));
          return Object.assign(state.request, data);
        },
      },
      contact: {
        findFirst: async () => {
          await yieldOnce();
          return state.contact ? { id: state.contact.id } : null;
        },
        update: async ({ data }: { data: { displayName: string } }) => {
          const prev = state.contact!.displayName;
          record(() => (state.contact!.displayName = prev));
          state.contact!.displayName = data.displayName;
          return state.contact;
        },
        delete: async () => {
          const prev = state.contact;
          record(() => (state.contact = prev));
          state.contact = null;
          return {};
        },
      },
      message: emptyModel({ findMany: async () => state.messages }),
      tenantAuditLog: {
        create: async ({ data }: { data: { action: string; payload: unknown } }) => {
          state.audits.push(data.action);
          state.auditPayloads.push(data.payload);
          return data;
        },
      },
    };
  }

  function client(journal: Array<() => void> | null): unknown {
    const models = makeModels(journal);
    return new Proxy(models, {
      get: (target, prop: string) => {
        // 鎖對話的查詢回傳這位聯絡人的對話；其他 raw 查詢（頭像）回空結果
        if (prop === '$queryRaw') {
          return async (sql: TemplateStringsArray) =>
            sql.join('?').includes('FROM conversations') && state.messages.length > 0 ? [{ id: CONVERSATION }] : [];
        }
        if (prop === '$transaction') {
          return async (fn: (tx: unknown) => Promise<unknown>) => {
            const txJournal: Array<() => void> = [];
            try {
              return await fn(client(txJournal));
            } catch (err) {
              for (const undo of txJournal.reverse()) undo();
              throw err;
            }
          };
        }
        return target[prop] ?? (target[prop] = emptyModel());
      },
    });
  }
  return client(null);
}

function job(mode: 'hard_delete' | 'anonymize') {
  return { data: { requestId: REQUEST, tenantId: TENANT, contactId: CONTACT, mode, requestedBy: 'agent-1' } } as never;
}

function state(status: string, contact = true): State {
  return {
    request: { id: REQUEST, tenantId: TENANT, status, error: null, affected: null },
    contact: contact ? { id: CONTACT, tenantId: TENANT, displayName: '王小明' } : null,
    audits: [],
    auditPayloads: [],
    messages: [],
  };
}

const redis = { publish: async () => 1 } as never;

beforeEach(() => {
  notified.length = 0;
  storage.remove = async () => undefined;
});

test('已完成的請求再執行一次：請求仍是 completed，error 是空值，不寫新的稽核或通知', async () => {
  // 第一次執行已刪除聯絡人並完成
  const s = state('completed', false);
  await handleDataErasureJob(job('hard_delete'), fakeDb(s) as never, redis).catch(() => {});
  assert.equal(s.request.status, 'completed');
  assert.equal(s.request.error, null);
  assert.deepEqual(s.audits, []);
  assert.deepEqual(notified, []);
});

test('上一次執行中途結束：processing 的請求重新處理，聯絡人被匿名化，請求是 completed', async () => {
  const s = state('processing');
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);
  assert.notEqual(s.contact!.displayName, '王小明');
  assert.equal(s.request.status, 'completed');
  assert.deepEqual(notified, ['data_erasure_done']);
});

test('兩次同時執行：請求是 completed，error 是空值，只送出一則完成通知', async () => {
  const s = state('pending');
  const db = fakeDb(s);
  await Promise.all([
    handleDataErasureJob(job('hard_delete'), db as never, redis).catch(() => {}),
    handleDataErasureJob(job('hard_delete'), db as never, redis).catch(() => {}),
  ]);
  assert.equal(s.request.status, 'completed');
  assert.equal(s.request.error, null);
  assert.deepEqual(notified, ['data_erasure_done']);
  assert.deepEqual(s.audits, ['data.erasure.complete']);
});

test('物件刪除失敗時請求仍然完成：affected.mediaObjectsFailed 記失敗筆數，與完成稽核一致', async () => {
  const s = state('pending');
  const key = `${TENANT}/media/${CONVERSATION}/e0000000-0000-0000-0000-00000000000e.jpg`;
  s.messages = [{ direction: 'INBOUND', content: { storageKey: key } }];
  const attempts: string[] = [];
  storage.remove = async (_bucket, k) => {
    attempts.push(k);
    throw new Error('minio down');
  };
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);

  assert.deepEqual(attempts, [key], '最多刪一次，不重試');
  assert.equal(s.request.status, 'completed');
  const affected = s.request.affected as Record<string, number>;
  assert.equal(affected.mediaObjects, 1);
  assert.equal(affected.mediaObjectsFailed, 1);
  assert.equal(affected.avatarObjectsFailed, 0);
  assert.deepEqual((s.auditPayloads[0] as { affected: unknown }).affected, affected);
});

test('物件刪除失敗、補寫失敗筆數也失敗時：完成稽核的 affected 與請求保存的 affected 相同', async () => {
  const s = state('pending');
  const key = `${TENANT}/media/${CONVERSATION}/e0000000-0000-0000-0000-00000000000e.jpg`;
  s.messages = [{ direction: 'INBOUND', content: { storageKey: key } }];
  s.failAffectedWriteBack = true;
  storage.remove = async () => {
    throw new Error('minio down');
  };
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);

  assert.equal(s.request.status, 'completed');
  const affected = s.request.affected as Record<string, number>;
  assert.equal(affected.mediaObjectsFailed, 0, '補寫沒有成功，請求保存的仍是交易內寫入的 0');
  assert.deepEqual((s.auditPayloads[0] as { affected: unknown }).affected, affected);
});

test('檔名不是標準 UUID 的媒體檔不刪：只有 36 個連字號或段落長度不對時計入 mediaObjectsSkipped', async () => {
  const s = state('pending');
  const prefix = `${TENANT}/media/${CONVERSATION}`;
  const valid = `${prefix}/e0000000-0000-0000-0000-00000000000e.jpg`;
  s.messages = [
    { direction: 'INBOUND', content: { storageKey: valid } },
    { direction: 'INBOUND', content: { storageKey: `${prefix}/${'-'.repeat(36)}.jpg` } },
    { direction: 'INBOUND', content: { storageKey: `${prefix}/e00000000000-0000-0000-0000-00000000.jpg` } },
  ];
  const removed: string[] = [];
  storage.remove = async (_bucket, k) => {
    removed.push(k);
  };
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);

  assert.deepEqual(removed, [valid]);
  const affected = s.request.affected as Record<string, number>;
  assert.equal(affected.mediaObjects, 1);
  assert.equal(affected.mediaObjectsSkipped, 2);
});
