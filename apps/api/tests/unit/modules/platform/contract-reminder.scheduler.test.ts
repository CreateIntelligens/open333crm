/**
 * 合約到期前提醒平台帳號（change add-contract-expiry-reminder，需求「合約到期前提醒平台帳號」）。
 *
 * 以 mock executor 執行 runContractReminders()：tenant 的 findMany 依 isActive 與 contractEndDate.gte 篩選，
 * updateMany 依條件（id、isActive、contractEndDate、contractRemindersSent）更新，與資料庫的條件更新一致。
 * 寄信一律 mock，不真的寄出。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const sent: { to: string; subject: string; html: string }[] = [];
vi.mock('#src/modules/email/email.service.js', () => ({
  sendEmail: async (input: { to: string; subject: string; html: string }) => void sent.push(input),
}));

const { runContractReminders } = await import('#src/modules/platform/contract-reminder.scheduler.js');

const DAY = 86_400_000;
// 台灣時間 2026-11-10 12:00
const NOW = Date.parse('2026-11-10T04:00:00Z');
const opts = { now: NOW, webBaseUrl: 'https://crm.example.test' };
// 迄日以 date input 存成該日 UTC 00:00
const endInDays = (n: number) => new Date(Date.parse('2026-11-10T00:00:00Z') + n * DAY);

interface Row {
  id: string;
  name: string;
  isActive: boolean;
  contractEndDate: Date | null;
  contractRemindersSent: number[];
}

function fakeDb(tenants: Row[], settings: Record<string, unknown> = {}) {
  const platformUsers = [
    { email: 'ops-a@example.test', name: '營運 A', isActive: true },
    { email: 'ops-b@example.test', name: '營運 B', isActive: true },
    { email: 'ops-off@example.test', name: '已停用', isActive: false },
  ];
  const db = {
    tenant: {
      findMany: async ({ where }: { where: { isActive?: boolean; contractEndDate?: { gte?: Date } } }) =>
        tenants
          .filter((t) => where.isActive === undefined || t.isActive === where.isActive)
          .filter((t) => {
            const gte = where.contractEndDate?.gte;
            return t.contractEndDate !== null && (!gte || t.contractEndDate >= gte);
          })
          .map((t) => ({ ...t, contractRemindersSent: [...t.contractRemindersSent] })),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; isActive?: boolean; contractEndDate?: Date; contractRemindersSent?: { equals: number[] } };
        data: { contractRemindersSent: number[] };
      }) => {
        const t = tenants.find((x) => x.id === where.id);
        const ok =
          t !== undefined &&
          (where.isActive === undefined || t.isActive === where.isActive) &&
          (where.contractEndDate === undefined || t.contractEndDate?.getTime() === where.contractEndDate.getTime()) &&
          (where.contractRemindersSent === undefined ||
            JSON.stringify(t.contractRemindersSent) === JSON.stringify(where.contractRemindersSent.equals));
        if (!ok) return { count: 0 };
        t.contractRemindersSent = data.contractRemindersSent;
        return { count: 1 };
      },
    },
    platformUser: {
      findMany: async ({ where }: { where: { isActive?: boolean } }) =>
        platformUsers.filter((u) => where.isActive === undefined || u.isActive === where.isActive),
    },
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in settings ? { key: where.key, value: settings[where.key] } : null,
    },
  };
  return db as unknown as PrismaClient;
}

const tenant = (over: Partial<Row>): Row => ({
  id: 't1',
  name: '測試租戶',
  isActive: true,
  contractEndDate: endInDays(7),
  contractRemindersSent: [],
  ...over,
});

beforeEach(() => {
  sent.length = 0;
});

test('到達檔位時寄給所有啟用中的平台帳號', async () => {
  const rows = [tenant({})];
  await runContractReminders(fakeDb(rows), opts);

  assert.deepEqual(sent.map((m) => m.to).sort(), ['ops-a@example.test', 'ops-b@example.test']);
  for (const m of sent) {
    assert.ok(m.html.includes('測試租戶'), '信中有租戶名稱');
    assert.ok(m.html.includes('2026/11/17'), '信中有迄日');
    assert.ok(m.html.includes('<strong>7</strong> 天後到期'), '信中有剩餘天數');
    assert.match(m.html, /href="https:\/\/crm\.example\.test\/admin\/tenants\/t1"/, '信中的按鈕連到租戶詳細頁');
  }
  assert.deepEqual(rows[0]!.contractRemindersSent, [30, 7]);
});

test('同一檔位只寄一次', async () => {
  const rows = [tenant({})];
  const db = fakeDb(rows);
  await runContractReminders(db, opts);
  sent.length = 0;

  await runContractReminders(db, opts);
  assert.equal(sent.length, 0);
});

test('跳過的檔位不補寄', async () => {
  const rows = [tenant({ contractEndDate: endInDays(5) })];
  const db = fakeDb(rows);
  await runContractReminders(db, opts);
  await runContractReminders(db, opts);

  assert.equal(sent.length, 2, '只寄一輪（兩個啟用中的平台帳號各一封）');
  assert.deepEqual([...rows[0]!.contractRemindersSent].sort((a, b) => a - b), [7, 30]);
});

test('未到檔位、已過期或停用不寄', async () => {
  const rows = [
    tenant({ id: 'far', contractEndDate: endInDays(40) }),
    tenant({ id: 'expired', contractEndDate: endInDays(-1) }),
    tenant({ id: 'disabled', isActive: false }),
  ];
  await runContractReminders(fakeDb(rows), opts);

  assert.equal(sent.length, 0);
  for (const r of rows) assert.deepEqual(r.contractRemindersSent, []);
});

test('迄日當天仍寄 1 天檔', async () => {
  const rows = [tenant({ contractEndDate: endInDays(0), contractRemindersSent: [30, 7] })];
  await runContractReminders(fakeDb(rows), opts);

  assert.equal(sent.length, 2);
  assert.deepEqual(rows[0]!.contractRemindersSent, [30, 7, 1]);
});

test('檔位依平台設定', async () => {
  const rows = [tenant({ contractEndDate: endInDays(10) })];
  await runContractReminders(fakeDb(rows, { 'contract.reminderDaysBefore': [14] }), opts);

  assert.equal(sent.length, 2);
  assert.deepEqual(rows[0]!.contractRemindersSent, [14]);
});

test('平台設定不合法時用預設檔位', async () => {
  const rows = [tenant({})];
  await runContractReminders(fakeDb(rows, { 'contract.reminderDaysBefore': ['x', -1] }), opts);

  assert.equal(sent.length, 2);
  assert.deepEqual(rows[0]!.contractRemindersSent, [30, 7]);
});
