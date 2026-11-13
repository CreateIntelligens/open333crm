/**
 * data-erasure worker 不重新處理已結束的請求（change outbox-event-delivery：tenant-data-erasure
 * 「worker 不重新處理已結束的刪除請求」）。
 *
 * 第一個測試重現 bug：同一個硬刪除工作執行兩次時，第二次把 completed 改成 failed。
 * 完成稽核與通知（change keep-completion-audit-for-purged-requester）：稽核在刪除交易內寫入、
 * 發起的成員已被永久刪除時記下快照不送通知、通知送不進佇列時工作不失敗。
 * 留言自動私訊（change add-comment-keyword-private-reply，design D27）：匿名化清除留言者對應與觸發紀錄的個資、
 * 硬刪除先刪紀錄再刪聯絡人（紀錄對留言者是 Restrict，假實作在刪聯絡人時檢查）。
 * 資料庫是記憶體裡的假實作：沒有特別處理的查詢回傳空結果；交易丟錯時還原請求、聯絡人與稽核。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const notified = vi.hoisted(() => [] as string[]);
const queue = vi.hoisted(() => ({ down: false }));
const storage = vi.hoisted(() => ({ remove: async (_bucket: string, _key: string): Promise<void> => undefined }));
vi.mock('@open333crm/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@open333crm/core')>()),
  MinioStorageProvider: class {
    delete = (bucket: string, key: string) => storage.remove(bucket, key);
  },
}));
vi.mock('#src/lib/notification-queue.js', () => ({
  enqueueNotification: async (input: { type: string }) => {
    if (queue.down) throw new Error('redis down');
    notified.push(input.type);
  },
}));

const { handleDataErasureJob } = await import('#src/handlers/data-erasure.handler.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const REQUEST = 'f0000000-0000-0000-0000-00000000000f';
const CONTACT = 'c0000000-0000-0000-0000-00000000000c';
const CONVERSATION = 'd0000000-0000-0000-0000-00000000000d';

const REQUESTER = 'b0000000-0000-0000-0000-00000000000b';

interface AuditRow {
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: unknown;
}

interface State {
  request: {
    id: string;
    tenantId: string;
    status: string;
    error: string | null;
    affected: unknown;
    requestedByName: string | null;
    requestedByEmail: string | null;
  };
  contact: { id: string; tenantId: string; displayName: string } | null;
  /** 發起的成員還在（同租戶的 agents 有這筆） */
  requesterExists: boolean;
  audits: string[];
  auditPayloads: unknown[];
  auditRows: AuditRow[];
  messages: { direction: string; content: unknown }[];
  /** 交易 commit 之後補寫 affected 的 updateMany 丟錯 */
  failAffectedWriteBack?: boolean;
  /** 寫完成稽核時丟錯 */
  failAuditCreate?: boolean;
  commentAuthors: CommentAuthorRow[];
  commentReplyLogs: CommentReplyLogRow[];
}

interface CommentAuthorRow {
  id: string;
  tenantId: string;
  contactId: string;
  externalUserId: string;
  displayName: string | null;
  username: string | null;
  psid: string | null;
}

interface CommentReplyLogRow {
  id: string;
  tenantId: string;
  commentAuthorId: string;
  commentId: string;
  status: string;
  commenterId: string | null;
  commenterName: string | null;
  commenterUsername: string | null;
  commentText: string | null;
  recipientUid: string | null;
  dedupeKey: string | null;
  sentContentSnapshot: unknown;
}

type IdFilter = string | { in: string[] };
const matchId = (value: string, filter: IdFilter | undefined) =>
  filter === undefined || (typeof filter === 'string' ? value === filter : filter.in.includes(value));
/** Prisma.DbNull 寫進 Json 欄位就是 SQL NULL */
const dbValue = (v: unknown) => (v !== null && typeof v === 'object' && v.constructor?.name === 'DbNull' ? null : v);

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
          // 交易內寫 affected 用 update；updateMany 帶 affected 只有 commit 之後的補寫
          if (state.failAffectedWriteBack && 'affected' in data) throw new Error('db down');
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
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
          const r = state.request;
          return r.id === where.id && r.tenantId === where.tenantId
            ? { requestedByName: r.requestedByName, requestedByEmail: r.requestedByEmail }
            : null;
        },
      },
      agent: {
        // 同 Prisma：where 的 id 是 undefined 時不篩選，回傳同租戶的任何一位成員
        findFirst: async ({ where }: { where: { id?: string; tenantId: string } }) =>
          where.tenantId === TENANT && (where.id === undefined || (state.requesterExists && where.id === REQUESTER))
            ? { id: where.id ?? 'other-agent' }
            : null,
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
          // comment_reply_logs.commentAuthorId 是 Restrict：聯絡人連帶刪留言者對應時，還有紀錄就失敗
          const authorIds = state.commentAuthors.filter((a) => a.contactId === CONTACT).map((a) => a.id);
          if (state.commentReplyLogs.some((l) => authorIds.includes(l.commentAuthorId))) {
            throw new Error('violates foreign key constraint comment_reply_logs_commentAuthorId_tenantId_fkey');
          }
          const prevAuthors = [...state.commentAuthors];
          state.commentAuthors = state.commentAuthors.filter((a) => a.contactId !== CONTACT);
          record(() => (state.commentAuthors = prevAuthors));
          const prev = state.contact;
          record(() => (state.contact = prev));
          state.contact = null;
          return {};
        },
      },
      message: emptyModel({ findMany: async () => state.messages }),
      commentAuthor: emptyModel({
        findMany: async ({ where }: { where: { tenantId: string; contactId?: IdFilter; id?: IdFilter } }) =>
          state.commentAuthors.filter(
            (a) => a.tenantId === where.tenantId && matchId(a.contactId, where.contactId) && matchId(a.id, where.id),
          ),
        updateMany: async ({ where, data }: { where: { tenantId: string; id?: IdFilter }; data: Partial<CommentAuthorRow> }) => {
          const rows = state.commentAuthors.filter((a) => a.tenantId === where.tenantId && matchId(a.id, where.id));
          for (const row of rows) {
            const prev = { ...row };
            record(() => Object.assign(row, prev));
            Object.assign(row, data);
          }
          return { count: rows.length };
        },
        deleteMany: async ({ where }: { where: { tenantId: string; id?: IdFilter; contactId?: IdFilter } }) => {
          const hit = (a: CommentAuthorRow) =>
            a.tenantId === where.tenantId && matchId(a.id, where.id) && matchId(a.contactId, where.contactId);
          const ids = state.commentAuthors.filter(hit).map((a) => a.id);
          if (state.commentReplyLogs.some((l) => ids.includes(l.commentAuthorId))) {
            throw new Error('violates foreign key constraint comment_reply_logs_commentAuthorId_tenantId_fkey');
          }
          const prev = [...state.commentAuthors];
          record(() => (state.commentAuthors = prev));
          state.commentAuthors = state.commentAuthors.filter((a) => !hit(a));
          return { count: ids.length };
        },
      }),
      commentReplyLog: emptyModel({
        count: async ({ where }: { where: { tenantId: string; commentAuthorId: IdFilter } }) =>
          state.commentReplyLogs.filter((l) => l.tenantId === where.tenantId && matchId(l.commentAuthorId, where.commentAuthorId)).length,
        updateMany: async ({ where, data }: { where: { tenantId: string; commentAuthorId: IdFilter }; data: Record<string, unknown> }) => {
          const rows = state.commentReplyLogs.filter(
            (l) => l.tenantId === where.tenantId && matchId(l.commentAuthorId, where.commentAuthorId),
          );
          for (const row of rows) {
            const prev = { ...row };
            record(() => Object.assign(row, prev));
            for (const [k, v] of Object.entries(data)) (row as unknown as Record<string, unknown>)[k] = dbValue(v);
          }
          return { count: rows.length };
        },
        deleteMany: async ({ where }: { where: { tenantId: string; commentAuthorId: IdFilter } }) => {
          const hit = (l: CommentReplyLogRow) => l.tenantId === where.tenantId && matchId(l.commentAuthorId, where.commentAuthorId);
          const count = state.commentReplyLogs.filter(hit).length;
          const prev = [...state.commentReplyLogs];
          record(() => (state.commentReplyLogs = prev));
          state.commentReplyLogs = state.commentReplyLogs.filter((l) => !hit(l));
          return { count };
        },
      }),
      tenantAuditLog: {
        create: async ({ data }: { data: AuditRow }) => {
          if (state.failAuditCreate) throw new Error('audit write failed');
          const index = state.audits.length;
          state.audits.push(data.action);
          state.auditPayloads.push(data.payload);
          state.auditRows.push({
            action: data.action,
            actorId: data.actorId ?? null,
            actorName: data.actorName ?? null,
            actorEmail: data.actorEmail ?? null,
            payload: data.payload,
          });
          record(() => {
            state.audits.splice(index, 1);
            state.auditPayloads.splice(index, 1);
            state.auditRows.splice(index, 1);
          });
          return { id: `audit-${index}` };
        },
        updateMany: async ({ where, data }: { where: { id: string; tenantId: string }; data: { payload: unknown } }) => {
          const index = Number(where.id.replace('audit-', ''));
          if (where.tenantId !== TENANT || !state.auditRows[index]) return { count: 0 };
          const prev = state.auditPayloads[index];
          record(() => {
            state.auditPayloads[index] = prev;
            state.auditRows[index].payload = prev;
          });
          state.auditPayloads[index] = data.payload;
          state.auditRows[index].payload = data.payload;
          return { count: 1 };
        },
      },
    };
  }

  function client(journal: Array<() => void> | null): unknown {
    const models = makeModels(journal);
    return new Proxy(models, {
      get: (target, prop: string) => {
        // 鎖對話的查詢回傳這位聯絡人的對話；鎖留言者對應的查詢回傳這位聯絡人的留言者；其他 raw 查詢（頭像）回空結果
        if (prop === '$queryRaw') {
          return async (sql: TemplateStringsArray) => {
            const text = sql.join('?');
            if (text.includes('FROM comment_authors')) {
              return state.commentAuthors.filter((a) => a.contactId === CONTACT).map((a) => ({ id: a.id }));
            }
            return text.includes('FROM conversations') && state.messages.length > 0 ? [{ id: CONVERSATION }] : [];
          };
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
  return { data: { requestId: REQUEST, tenantId: TENANT, contactId: CONTACT, mode, requestedBy: REQUESTER } } as never;
}

function state(status: string, contact = true): State {
  return {
    request: { id: REQUEST, tenantId: TENANT, status, error: null, affected: null, requestedByName: null, requestedByEmail: null },
    contact: contact ? { id: CONTACT, tenantId: TENANT, displayName: '王小明' } : null,
    requesterExists: true,
    audits: [],
    auditPayloads: [],
    auditRows: [],
    messages: [],
    commentAuthors: [],
    commentReplyLogs: [],
  };
}

const AUTHOR = 'e1000000-0000-0000-0000-0000000000a1';

/** 這位聯絡人有一位留言者對應與 2 筆個資欄位都有值的觸發紀錄 */
function withCommentData(s: State): State {
  s.commentAuthors = [
    { id: AUTHOR, tenantId: TENANT, contactId: CONTACT, externalUserId: 'ASID_1', displayName: '王小明', username: 'ming', psid: 'PSID_1' },
  ];
  s.commentReplyLogs = [1, 2].map((n) => ({
    id: `e2000000-0000-0000-0000-00000000000${n}`,
    tenantId: TENANT,
    commentAuthorId: AUTHOR,
    commentId: `POST_1_${n}`,
    status: 'SENT',
    commenterId: 'ASID_1',
    commenterName: '王小明',
    commenterUsername: 'ming',
    commentText: '我要優惠',
    recipientUid: 'PSID_1',
    dedupeKey: `rule:ASID_1`,
    sentContentSnapshot: { text: '優惠資訊' },
  }));
  return s;
}

const redis = { publish: async () => 1 } as never;

beforeEach(() => {
  notified.length = 0;
  queue.down = false;
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

test('發起的成員還在時記下他並通知他：稽核的 actorId 是發起的成員，快照欄位是空值', async () => {
  const s = state('pending');
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);

  assert.equal(s.request.status, 'completed');
  assert.equal(s.auditRows.length, 1);
  assert.equal(s.auditRows[0].actorId, REQUESTER);
  assert.equal(s.auditRows[0].actorName, null);
  assert.equal(s.auditRows[0].actorEmail, null);
  assert.deepEqual(notified, ['data_erasure_done']);
});

test('發起的成員已被永久刪除時，完成稽核記下快照、不送通知', async () => {
  const s = state('pending');
  s.requesterExists = false;
  s.request.requestedByName = '發起者';
  s.request.requestedByEmail = 'requester@example.test';
  await handleDataErasureJob(job('hard_delete'), fakeDb(s) as never, redis);

  assert.equal(s.request.status, 'completed');
  assert.equal(s.contact, null);
  assert.deepEqual(s.auditRows.map((r) => [r.action, r.actorId, r.actorName, r.actorEmail]), [
    ['data.erasure.complete', null, '發起者', 'requester@example.test'],
  ]);
  assert.deepEqual(notified, []);
});

test('工作內容沒有 requestedBy 時視為發起的成員不在，不拿同租戶其他成員當操作者', async () => {
  const s = state('pending');
  const noRequester = { data: { requestId: REQUEST, tenantId: TENANT, contactId: CONTACT, mode: 'anonymize' } } as never;
  await handleDataErasureJob(noRequester, fakeDb(s) as never, redis);

  assert.equal(s.request.status, 'completed');
  assert.equal(s.auditRows[0].actorId, null);
  assert.deepEqual(notified, []);
});

test('完成稽核寫不進去時：刪除 rollback，請求是 failed，不送通知', async () => {
  const s = state('pending');
  s.failAuditCreate = true;
  await assert.rejects(handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis), /audit write failed/);

  assert.equal(s.contact!.displayName, '王小明', '匿名化與稽核一起 rollback');
  assert.equal(s.request.status, 'failed');
  assert.match(s.request.error ?? '', /audit write failed/);
  assert.deepEqual(s.audits, []);
  assert.deepEqual(notified, []);
});

test('完成通知送不進佇列時：工作不失敗，請求與稽核已經 commit', async () => {
  const s = state('pending');
  queue.down = true;
  await assert.doesNotReject(handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis));

  assert.equal(s.request.status, 'completed');
  assert.deepEqual(s.audits, ['data.erasure.complete']);
});

test('匿名化清除留言自動私訊的個資：留言者對應與紀錄的個資是 null，commentId 與狀態不變', async () => {
  const s = withCommentData(state('pending'));
  await handleDataErasureJob(job('anonymize'), fakeDb(s) as never, redis);

  assert.equal(s.request.status, 'completed', s.request.error ?? '');
  assert.deepEqual(s.commentAuthors, [
    { id: AUTHOR, tenantId: TENANT, contactId: CONTACT, externalUserId: `erased:${AUTHOR}`, displayName: null, username: null, psid: null },
  ]);
  assert.equal(s.commentReplyLogs.length, 2);
  for (const [i, log] of s.commentReplyLogs.entries()) {
    assert.equal(log.commentId, `POST_1_${i + 1}`);
    assert.equal(log.status, 'SENT');
    for (const field of ['commenterId', 'commenterName', 'commenterUsername', 'commentText', 'recipientUid', 'dedupeKey', 'sentContentSnapshot'] as const) {
      assert.equal(log[field], null, field);
    }
  }
  const affected = s.request.affected as Record<string, number>;
  assert.equal(affected.commentAuthors, 1);
  assert.equal(affected.commentReplyLogs, 2);
});

test('硬刪除刪除留言自動私訊紀錄：先刪紀錄，聯絡人刪除成功，affected.commentReplyLogs 是 2', async () => {
  const s = withCommentData(state('pending'));
  // 刪除失敗時 handler 記下失敗再丟錯；這裡只看請求與資料的結果
  await handleDataErasureJob(job('hard_delete'), fakeDb(s) as never, redis).catch(() => {});

  assert.equal(s.request.status, 'completed', s.request.error ?? '');
  assert.equal(s.contact, null);
  assert.deepEqual(s.commentReplyLogs, []);
  assert.deepEqual(s.commentAuthors, []);
  const affected = s.request.affected as Record<string, number>;
  assert.equal(affected.commentReplyLogs, 2);
  assert.equal(affected.commentAuthors, 1);
});
