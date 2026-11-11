/**
 * update_case_status worker 動作維護 resolvedAt（issue #417，AUDIT AUTO-10）。
 * 與 API 的 transitionCase() 用同一個規則（@open333crm/shared 的 caseTransitionTimestamps）：
 * 轉成 RESOLVED 寫入解決時間；RESOLVED → CLOSED 保留；直接關閉不寫；重開清除。
 *
 * issue #469（spec case-management「Automation Case Status Changes Follow The Transition Rules」）：
 * 不合法的轉換不改工單、時間軸寫略過紀錄；合法的轉換寫 status_changed 與 case.resolved／case.closed。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

// outbox 的快路徑送進佇列：這裡只看 outbox，佇列換成不做事的假實作
vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {}
  },
}));

interface FakeCase {
  id: string;
  tenantId: string;
  status: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

interface Written {
  caseEvents: Array<Record<string, any>>;
  outbox: Array<Record<string, any>>;
}

let written: Written;

const RESOLVED_AT = new Date('2026-01-02T00:00:00Z');

function makePrisma(row: FakeCase) {
  const matches = (where: Record<string, unknown>) =>
    where.id === row.id &&
    (where.tenantId === undefined || where.tenantId === row.tenantId) &&
    (where.status === undefined || where.status === row.status);
  const apply = (data: Record<string, unknown>) => Object.assign(row, data);
  const extra = { contactId: 'contact-1', channelId: 'channel-1', title: '退貨', assigneeId: null, priority: 'MEDIUM', conversations: [{ id: 'conv-1' }] };
  const prisma: Record<string, unknown> = {
    caseEvent: {
      async create({ data }: { data: Record<string, unknown> }) {
        written.caseEvents.push(data);
        return data;
      },
    },
    outbox: {
      async create({ data }: { data: Record<string, unknown> }) {
        const created = { id: `outbox-${written.outbox.length + 1}`, ...data, queueName: null, jobOptions: null, createdAt: new Date() };
        written.outbox.push(created);
        return created;
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    case: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return matches(where) ? { ...row, ...extra } : null;
      },
      async findUnique({ where }: { where: Record<string, unknown> }) {
        return matches(where) ? { ...row } : null;
      },
      async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        if (!matches(where)) throw new Error('not found');
        return apply(data);
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        if (!matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      },
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  return prisma;
}

const published: string[] = [];
beforeEach(() => {
  written = { caseEvents: [], outbox: [] };
  published.length = 0;
});
const redisPublisher = {
  publish: async (_channel: string, message: string) => {
    published.push(message);
    return 1;
  },
};

async function run(row: FakeCase, status: string, tenantId = 'tenant-1') {
  await executeWorkerAutomationActions(
    makePrisma(row) as never,
    redisPublisher as never,
    [{ type: 'update_case_status', params: { status } } as never],
    { tenantId, caseId: row.id, ruleId: 'rule-1', ruleName: '建立工單時結案' } as never,
  );
}

const caseOf = (status: string, resolvedAt: Date | null): FakeCase => ({
  id: 'case-1',
  tenantId: 'tenant-1',
  status,
  resolvedAt,
  closedAt: null,
});

test('規則轉成 RESOLVED：寫入 resolvedAt', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'RESOLVED');
  assert.equal(row.status, 'RESOLVED');
  assert.ok(row.resolvedAt instanceof Date);
});

test('規則把 RESOLVED 改回 IN_PROGRESS：清除 resolvedAt', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'IN_PROGRESS');
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(row.resolvedAt, null);
});

test('規則把 CLOSED 改回 OPEN：清除 resolvedAt', async () => {
  const row = caseOf('CLOSED', RESOLVED_AT);
  await run(row, 'OPEN');
  assert.equal(row.resolvedAt, null);
});

test('規則直接關閉：不寫 resolvedAt，寫 closedAt', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'CLOSED');
  assert.equal(row.status, 'CLOSED');
  assert.equal(row.resolvedAt, null);
  assert.ok(row.closedAt instanceof Date);
});

test('規則把 RESOLVED 改成 CLOSED：保留 resolvedAt', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'CLOSED');
  assert.equal(row.resolvedAt, RESOLVED_AT);
  assert.ok(row.closedAt instanceof Date);
});

test('其他租戶的工單：不改', async () => {
  const row = caseOf('RESOLVED', RESOLVED_AT);
  await run(row, 'IN_PROGRESS', 'tenant-2');
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.resolvedAt, RESOLVED_AT);
});

test('Automation cannot resolve an open case：OPEN 不能直接改成 RESOLVED，工單不變，時間軸寫略過紀錄', async () => {
  const row = caseOf('OPEN', null);
  await run(row, 'RESOLVED');
  assert.equal(row.status, 'OPEN');
  assert.equal(row.resolvedAt, null);
  assert.deepEqual(written.caseEvents, [
    {
      caseId: 'case-1',
      actorType: 'automation',
      actorId: null,
      eventType: 'automation_status_skipped',
      payload: { from: 'OPEN', to: 'RESOLVED', reason: 'invalid_transition', ruleId: 'rule-1', ruleName: '建立工單時結案' },
    },
  ]);
  assert.equal(written.outbox.length, 0);
  assert.equal(published.length, 0);
});

test('Automation cannot resolve an open case：不存在的狀態值（例如舊規則的 FOO）也不寫入', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'FOO');
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(written.caseEvents[0]?.eventType, 'automation_status_skipped');
});

test('Automation records a valid status change：寫 status_changed、case.resolved，socket 的 source 是 automation', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'RESOLVED');
  assert.equal(row.status, 'RESOLVED');
  assert.deepEqual(written.caseEvents, [
    {
      caseId: 'case-1',
      actorType: 'automation',
      actorId: null,
      eventType: 'status_changed',
      payload: { from: 'IN_PROGRESS', to: 'RESOLVED', source: 'automation', ruleId: 'rule-1', ruleName: '建立工單時結案' },
    },
  ]);
  assert.equal(written.outbox.length, 1);
  assert.equal(written.outbox[0]!.name, 'case.resolved');
  assert.equal(written.outbox[0]!.tenantId, 'tenant-1');
  assert.deepEqual(written.outbox[0]!.payload, {
    caseId: 'case-1', contactId: 'contact-1', channelId: 'channel-1', assigneeId: null, title: '退貨', conversationId: 'conv-1',
  });
  const socket = published.map((m) => JSON.parse(m)).find((m) => m.event === 'case.updated');
  assert.equal(socket?.data.source, 'automation');
  assert.equal(socket?.data.status, 'RESOLVED');
});

test('Automation closes a case：發 case.closed', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'CLOSED');
  assert.deepEqual(written.outbox.map((r) => r.name), ['case.closed']);
});

test('轉成處理中：寫 status_changed，不發 case.resolved／case.closed', async () => {
  const row = caseOf('OPEN', null);
  await run(row, 'IN_PROGRESS');
  assert.equal(row.status, 'IN_PROGRESS');
  assert.deepEqual(written.caseEvents.map((e) => e.eventType), ['status_changed']);
  assert.equal(written.outbox.length, 0);
});

/**
 * issue #339（csat-survey「工單重新解決時的問卷」）：與 API 的 transitionCase() 共用 caseTransitionCsatFields()。
 * 沒評分的工單重新解決時清除上一輪的問卷寄出時間，問卷排程再寄一份；已評分的保留。
 */
test('自動化重新解決工單時同樣處理問卷', async () => {
  const sentAt = new Date('2026-01-01T00:00:00Z');
  const row = Object.assign(caseOf('IN_PROGRESS', null), { csatScore: null, csatSentAt: sentAt, csatRespondedAt: null });
  await run(row, 'RESOLVED');
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.csatSentAt, null, '清除上一輪的寄出時間');
  assert.equal(row.csatRespondedAt, null);
});

test('自動化重新解決已評分的工單：保留問卷欄位', async () => {
  const sentAt = new Date('2026-01-01T00:00:00Z');
  const row = Object.assign(caseOf('IN_PROGRESS', null), { csatScore: 4, csatSentAt: sentAt, csatRespondedAt: sentAt });
  await run(row, 'RESOLVED');
  assert.equal(row.csatSentAt, sentAt);
  assert.equal(row.csatScore, 4);
});

test('Automation sets the current status：狀態相同時不改、不寫任何紀錄', async () => {
  const row = caseOf('IN_PROGRESS', null);
  await run(row, 'IN_PROGRESS');
  assert.equal(row.status, 'IN_PROGRESS');
  assert.equal(written.caseEvents.length, 0);
  assert.equal(written.outbox.length, 0);
  assert.equal(published.length, 0);
});
