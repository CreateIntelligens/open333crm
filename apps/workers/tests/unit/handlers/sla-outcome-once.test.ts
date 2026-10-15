/**
 * SLA 結果每個期限只記錄一次（change fix-sla-outcome-repeat，spec standalone-worker-runtime
 * 「SLA Outcome Recorded Once Per Deadline」）與 SLA 預設通知中文化（S01、S02、S12）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const { notifications } = vi.hoisted(() => ({
  notifications: [] as Array<{ agentId: string; type: string; title: string; body: string }>,
}));

vi.mock('#src/lib/notification-queue', () => ({
  enqueueNotification: async (input: { agentId: string; type: string; title: string; body: string }) => {
    notifications.push(input);
  },
}));
vi.mock('@open333crm/automation', () => ({ evaluateRules: async () => [] }));
vi.mock('#src/lib/socket-bridge', () => ({ publishSocketEvent: async () => undefined }));

import { handleSlaPoll } from '#src/handlers/sla.handler';

const HOUR = 3_600_000;
const T = 'tenant-1';

interface Ev { caseId: string; eventType: string; createdAt: Date }
interface Msg { conversationId: string; direction: string; senderType: string; createdAt: Date; metadata: Record<string, unknown> }

let now: number;
let caseRow: Record<string, any>;
let events: Ev[];
let messages: Msg[];

function inRange(date: Date, cond?: { gte?: Date; gt?: Date }): boolean {
  if (!cond) return true;
  if (cond.gte && date < cond.gte) return false;
  if (cond.gt && date <= cond.gt) return false;
  return true;
}

const prisma: any = {
  case: {
    async findMany() {
      return [caseRow];
    },
    async update({ data }: { data: Record<string, unknown> }) {
      Object.assign(caseRow, data);
      return caseRow;
    },
  },
  slaPolicy: {
    async findFirst() {
      return { firstResponseMinutes: 60, resolutionMinutes: 240, warningBeforeMinutes: 30 };
    },
  },
  caseEvent: {
    async findFirst({ where }: { where: { caseId: string; eventType: string; createdAt?: { gte?: Date; gt?: Date } } }) {
      return (
        events.find(
          (e) => e.caseId === where.caseId && e.eventType === where.eventType && inRange(e.createdAt, where.createdAt),
        ) ?? null
      );
    },
    async count({ where }: { where: { caseId: string; eventType: { in: string[] } } }) {
      return events.filter((e) => e.caseId === where.caseId && where.eventType.in.includes(e.eventType)).length;
    },
    async create({ data }: { data: { caseId: string; eventType: string } }) {
      events.push({ caseId: data.caseId, eventType: data.eventType, createdAt: new Date(now) });
      return data;
    },
  },
  message: {
    async findFirst({ where }: { where: { direction: string } }) {
      const list = messages
        .filter((m) => m.direction === where.direction && m.senderType !== 'CONTACT')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list[0] ? { createdAt: list[0].createdAt } : null;
    },
    async findMany({ where }: { where: { direction: string; createdAt?: { gt?: Date } } }) {
      return messages
        .filter((m) => m.direction === where.direction && inRange(m.createdAt, where.createdAt))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  },
  automationRule: { async findMany() { return []; } },
  agent: { async findMany() { return [{ id: 'supervisor-1' }]; } },
};

beforeEach(() => {
  now = Date.UTC(2026, 9, 15, 0, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  notifications.length = 0;
  events = [];
  messages = [];
  caseRow = {
    id: 'case-1',
    tenantId: T,
    contactId: 'contact-1',
    title: '冷氣不冷',
    status: 'IN_PROGRESS',
    priority: 'URGENT',
    assigneeId: 'agent-1',
    teamId: null,
    slaPolicy: '標準',
    // 首次回應已達成，只測解決期限
    firstResponseAt: new Date(now - 100 * HOUR),
    createdAt: new Date(now - 100 * HOUR),
    slaDueAt: new Date(now - 96 * HOUR),
    contact: { tags: [] },
    conversations: [{ id: 'conv-1' }],
  };
});

test('Breached case is scanned again on a later day：不再寫事件、不再通知', async () => {
  // 期限後已記錄過一次逾期（兩天前）
  events.push({ caseId: 'case-1', eventType: 'sla_breached', createdAt: new Date(now - 48 * HOUR) });

  await handleSlaPoll(prisma, {} as any);

  assert.equal(events.filter((e) => e.eventType === 'sla_breached').length, 1);
  assert.equal(notifications.length, 0);
  vi.useRealTimers();
});

test('Resolution deadline changes after a breach：期限之前的舊事件不擋新的逾期', async () => {
  // 舊的逾期事件發生在目前期限之前（例如重新開啟後重算期限）
  events.push({ caseId: 'case-1', eventType: 'sla_breached', createdAt: new Date(now - 97 * HOUR) });

  await handleSlaPoll(prisma, {} as any);

  assert.equal(events.filter((e) => e.eventType === 'sla_breached').length, 2);
  assert.ok(notifications.some((n) => n.type === 'sla_breached'));
  vi.useRealTimers();
});

test('Customer keeps waiting after an agent reply：客服回覆後再等待，重新記錄一次', async () => {
  caseRow.slaDueAt = null;
  events.push({ caseId: 'case-1', eventType: 'customer_waiting_breached', createdAt: new Date(now - 10 * HOUR) });
  messages.push({ conversationId: 'conv-1', direction: 'OUTBOUND', senderType: 'AGENT', createdAt: new Date(now - 5 * HOUR), metadata: {} });
  for (let i = 1; i <= 3; i++) {
    messages.push({ conversationId: 'conv-1', direction: 'INBOUND', senderType: 'CONTACT', createdAt: new Date(now - i * HOUR), metadata: {} });
  }

  await handleSlaPoll(prisma, {} as any);
  assert.equal(events.filter((e) => e.eventType === 'customer_waiting_breached').length, 2);

  // 同一段等待再掃一次（隔天），不重複
  now += 25 * HOUR;
  vi.setSystemTime(now);
  await handleSlaPoll(prisma, {} as any);
  assert.equal(events.filter((e) => e.eventType === 'customer_waiting_breached').length, 2);
  vi.useRealTimers();
});

test('SLA 預設通知的標題與內容是中文', async () => {
  caseRow.firstResponseAt = null;

  await handleSlaPoll(prisma, {} as any);

  const types = new Set(notifications.map((n) => n.type));
  assert.ok(types.has('first_response_breached'));
  assert.ok(types.has('sla_breached'));
  for (const n of notifications) {
    assert.ok(!/SLA (breached|warning)|Case "/.test(n.title + n.body), `通知仍是英文：${n.title} / ${n.body}`);
    assert.match(n.title, /[一-鿿]/, `標題應為中文：${n.title}`);
  }
  vi.useRealTimers();
});
