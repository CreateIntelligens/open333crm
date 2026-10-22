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
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { type: string }) => {
    notified.push(input.type);
  },
}));

const { handleDataErasureJob } = await import('#src/handlers/data-erasure.handler.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const REQUEST = 'f0000000-0000-0000-0000-00000000000f';
const CONTACT = 'c0000000-0000-0000-0000-00000000000c';

interface State {
  request: { id: string; tenantId: string; status: string; error: string | null; affected: unknown };
  contact: { id: string; tenantId: string; displayName: string } | null;
  audits: string[];
}

function matchesStatus(status: string, where: { status?: string | { in: string[] } }) {
  if (!where.status) return true;
  return typeof where.status === 'string' ? where.status === status : where.status.in.includes(status);
}

/** 沒有特別處理的 model 方法回傳空結果 */
function emptyModel(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: (_t, method: string) => async () =>
        method === 'findMany' ? [] : method === 'count' ? 0 : method.endsWith('Many') ? { count: 0 } : {},
    },
  );
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
      tenantAuditLog: {
        create: async ({ data }: { data: { action: string } }) => {
          state.audits.push(data.action);
          return data;
        },
      },
    };
  }

  function client(journal: Array<() => void> | null): unknown {
    const models = makeModels(journal);
    return new Proxy(models, {
      get: (target, prop: string) => {
        if (prop === '$queryRaw') return async () => [];
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
  };
}

const redis = { publish: async () => 1 } as never;

beforeEach(() => {
  notified.length = 0;
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
