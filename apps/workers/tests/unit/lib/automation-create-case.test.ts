/**
 * create_case worker 動作（AUDIT AUTO-01 補實作）：條件命中時自動建立工單，行為與手動建立一致。
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

const T = 'tenant-1';
interface Conv { id: string; tenantId: string; contactId: string; channelId: string; caseId: string | null }
interface Case { id: string; tenantId: string; status: string; [k: string]: unknown }

let convs: Conv[];
let cases: Case[];
let events: Array<Record<string, unknown>>;
let published: Array<{ channel: string; msg: any }>;
let outbox: Array<{ tenantId: string; name: string; payload: any }>;

beforeEach(() => {
  convs = [
    { id: 'conv-1', tenantId: T, contactId: 'contact-1', channelId: 'channel-1', caseId: null },
    { id: 'conv-other-tenant', tenantId: 'tenant-2', contactId: 'contact-9', channelId: 'channel-9', caseId: null },
  ];
  cases = [];
  events = [];
  published = [];
  outbox = [];
});

const prisma: any = {
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    // 交易失敗時回滾：還原工單、對話與 outbox
    const snapshot = { cases: [...cases], convs: convs.map((c) => ({ ...c })), outbox: [...outbox] };
    try {
      return await fn(prisma);
    } catch (err) {
      cases = snapshot.cases;
      convs = snapshot.convs;
      outbox = snapshot.outbox;
      throw err;
    }
  },
  outbox: {
    async create({ data }: { data: { tenantId: string; name: string; payload: any; kind: string } }) {
      const row = { id: `outbox-${outbox.length + 1}`, ...data, queueName: null, jobOptions: null, createdAt: new Date() };
      outbox.push(row);
      return row;
    },
    async updateMany() {
      return { count: 1 };
    },
  },
  conversation: {
    async findFirst({ where }: { where: { id: string; tenantId: string } }) {
      return convs.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
    },
    async updateMany({ where, data }: { where: { id: string; tenantId: string; OR?: Array<{ caseId: string | null }> }; data: { caseId: string } }) {
      const c = convs.find(
        (x) => x.id === where.id && x.tenantId === where.tenantId && (!where.OR || where.OR.some((o) => o.caseId === x.caseId)),
      );
      if (c) c.caseId = data.caseId;
      return { count: c ? 1 : 0 };
    },
  },
  case: {
    async findFirst({ where }: { where: { id: string; tenantId: string } }) {
      return cases.find((c) => c.id === where.id && c.tenantId === where.tenantId) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const c = { id: `case-${cases.length + 1}`, ...data } as Case;
      cases.push(c);
      return c;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const c = cases.find((x) => x.id === where.id)!;
      Object.assign(c, data);
      return c;
    },
    async updateMany({ where, data }: { where: { id: string; tenantId: string }; data: Record<string, unknown> }) {
      const c = cases.find((x) => x.id === where.id && x.tenantId === where.tenantId);
      if (c) Object.assign(c, data);
      return { count: c ? 1 : 0 };
    },
  },
  slaPolicy: {
    async findFirst({ where }: { where: { tenantId: string; priority: string } }) {
      return where.tenantId === T && where.priority === 'HIGH' ? { name: '高優先 SLA', resolutionMinutes: 120 } : null;
    },
  },
  caseEvent: {
    async create({ data }: { data: Record<string, unknown> }) {
      events.push(data);
      return data;
    },
  },
};
const redisPublisher = {
  async publish(channel: string, message: string) {
    published.push({ channel, msg: JSON.parse(message) });
    return 1;
  },
};
const run = (actions: Array<Record<string, unknown>>, ctx: Record<string, unknown>) =>
  executeWorkerAutomationActions(prisma as any, redisPublisher as any, actions as any, { tenantId: T, ...ctx } as any);

const createCase = (params: Record<string, unknown> = {}) => ({ type: 'create_case', params: { title: '客訴', ...params } });

test('收到訊息時建立工單：關聯對話、套用 SLA、寫事件、推播，並在同一個交易把 case.created 寫進 outbox', async () => {
  const before = Date.now();
  await run([createCase({ priority: 'HIGH', category: '投訴建議' })], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 1);
  const c = cases[0]!;
  assert.equal(c.tenantId, T);
  assert.equal(c.contactId, 'contact-1');
  assert.equal(c.channelId, 'channel-1');
  assert.equal(c.title, '客訴');
  assert.equal(c.priority, 'HIGH');
  assert.equal(c.category, '投訴建議');
  assert.equal(c.status, 'OPEN');
  assert.equal(c.slaPolicy, '高優先 SLA');
  const due = (c.slaDueAt as Date).getTime();
  assert.ok(due >= before + 120 * 60_000 && due <= Date.now() + 120 * 60_000);
  assert.equal(convs[0]!.caseId, c.id, '對話要關聯到新工單');
  assert.equal(events.length, 1);
  assert.equal(events[0]!.actorType, 'automation');
  assert.equal(events[0]!.eventType, 'created');
  const socket = published.find((p) => p.msg.event === 'case.created');
  assert.ok(socket, '要推播 case.created');
  assert.equal(socket!.msg.room, `tenant:${T}`);
  // 建立工單與事件一起寫入（change outbox-event-delivery）：不再經 Redis domain:event 轉發
  assert.equal(published.some((p) => p.channel === 'domain:event'), false);
  const domain = outbox.filter((o) => o.name === 'case.created');
  assert.equal(domain.length, 1, '要發出 case.created 讓通知與後續規則運作');
  assert.equal(domain[0]!.tenantId, T);
  assert.equal(domain[0]!.payload.caseId, c.id);
  assert.equal(domain[0]!.payload.conversationId, 'conv-1');
});

test('沒指定優先度：MEDIUM、沒有對應 SLA 政策時不設 SLA', async () => {
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases[0]!.priority, 'MEDIUM');
  assert.equal(cases[0]!.slaPolicy, null);
  assert.equal(cases[0]!.slaDueAt, null);
});

test('同一條規則的後續動作作用在新工單上', async () => {
  await run([createCase(), { type: 'assign_agent', params: { agentId: 'agent-7' } }], {
    trigger: 'message.received',
    conversationId: 'conv-1',
    contactId: 'contact-1',
  });
  assert.equal(cases[0]!.assigneeId, 'agent-7');
});

test('對話已有未結案的工單：不重複開', async () => {
  cases.push({ id: 'case-old', tenantId: T, status: 'IN_PROGRESS' });
  convs[0]!.caseId = 'case-old';
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 1);
  assert.equal(convs[0]!.caseId, 'case-old');
});

test('對話原本的工單已結案：開新單並改關聯', async () => {
  cases.push({ id: 'case-old', tenantId: T, status: 'CLOSED' });
  convs[0]!.caseId = 'case-old';
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 2);
  assert.equal(convs[0]!.caseId, cases[1]!.id);
});

test('沒有對話、對話屬於其他租戶：不建立', async () => {
  await run([createCase()], { trigger: 'message.received', contactId: 'contact-1' });
  await run([createCase()], { trigger: 'message.received', conversationId: 'conv-other-tenant', contactId: 'contact-9' });
  assert.equal(cases.length, 0);
});

test('工單或 SLA 事件觸發的規則：不建立工單（避免工單開工單的迴圈）', async () => {
  for (const trigger of ['case.created', 'case.status_changed', 'sla.first_response_breached']) {
    await run([createCase()], { trigger, conversationId: 'conv-1', contactId: 'contact-1', caseId: 'case-x' });
  }
  assert.equal(cases.length, 0);
});

test('分類不在系統清單：不寫入分類（工單照開）', async () => {
  await run([createCase({ category: '亂填的分類' })], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  assert.equal(cases.length, 1);
  assert.equal(cases[0]!.category, null);
});

test('建單期間對話已被別的工作關聯到未結案工單（並行）：不留下多餘的工單', async () => {
  const originalFindFirst = prisma.conversation.findFirst;
  // 讀取時對話還沒有工單，寫入關聯前被另一個 worker 搶先關聯
  prisma.conversation.findFirst = async (args: any) => {
    const found = await originalFindFirst(args);
    const snapshot = found ? { ...found } : null;
    if (found) found.caseId = 'case-raced';
    return snapshot;
  };
  cases.push({ id: 'case-raced', tenantId: T, status: 'OPEN' });
  try {
    await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  } finally {
    prisma.conversation.findFirst = originalFindFirst;
  }
  assert.deepEqual(cases.map((c) => c.id), ['case-raced'], '交易回滾，不留孤兒工單');
  assert.equal(convs[0]!.caseId, 'case-raced');
  // 建立工單失敗：這次的 case.created 隨交易 rollback
  assert.deepEqual(outbox, []);
});

test('原工單已結案、建單期間對話被別人改關聯到新工單：回滾，不開第二張', async () => {
  cases.push({ id: 'case-old', tenantId: T, status: 'CLOSED' }, { id: 'case-other', tenantId: T, status: 'OPEN' });
  convs[0]!.caseId = 'case-old';
  const originalFindFirst = prisma.conversation.findFirst;
  prisma.conversation.findFirst = async (args: any) => {
    const found = await originalFindFirst(args);
    const snapshot = found ? { ...found } : null;
    if (found) found.caseId = 'case-other';
    return snapshot;
  };
  try {
    await run([createCase()], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
  } finally {
    prisma.conversation.findFirst = originalFindFirst;
  }
  assert.deepEqual(cases.map((c) => c.id), ['case-old', 'case-other']);
  assert.equal(convs[0]!.caseId, 'case-other');
});

test('同優先級有多條政策時套用預設（sla-policy-selection，G20）', async () => {
  const original = prisma.slaPolicy.findFirst;
  const policies = [
    { name: '較早的政策', isDefault: false, createdAt: new Date('2026-01-01'), resolutionMinutes: 60 },
    { name: '預設政策', isDefault: true, createdAt: new Date('2026-02-01'), resolutionMinutes: 240 },
  ];
  // 模擬資料庫：依 orderBy 排序，沒有 orderBy 時回傳第一筆
  prisma.slaPolicy.findFirst = async ({ orderBy }: { orderBy?: Array<Record<string, 'asc' | 'desc'>> }) => {
    const rows = [...policies];
    if (orderBy) {
      rows.sort((a: any, b: any) => {
        for (const k of orderBy) {
          const [f, dir] = Object.entries(k)[0]!;
          const av = Number(a[f]);
          const bv = Number(b[f]);
          if (av !== bv) return dir === 'asc' ? av - bv : bv - av;
        }
        return 0;
      });
    }
    return rows[0];
  };
  try {
    await run([createCase({ priority: 'HIGH' })], { trigger: 'message.received', conversationId: 'conv-1', contactId: 'contact-1' });
    assert.equal(cases[0]!.slaPolicy, '預設政策');
  } finally {
    prisma.slaPolicy.findFirst = original;
  }
});
