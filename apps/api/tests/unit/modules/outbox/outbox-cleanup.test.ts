/**
 * outbox-cleanup 排程（change outbox-event-delivery：event-delivery「清理已送出的事件」、
 * side-effect-claims「認領紀錄受租戶隔離並保存 30 天」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { runOutboxCleanup } from '#src/modules/outbox/outbox.scheduler.js';
import { fakeOutboxDb, type FakeRow } from './fake-outbox-db.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function row(id: string, createdDaysAgo: number, dispatchedDaysAgo: number | null): FakeRow {
  return {
    id,
    tenantId: 'a0000000-0000-0000-0000-000000000001',
    kind: 'event',
    name: 'case.resolved',
    queueName: null,
    payload: {},
    jobOptions: null,
    createdAt: ago(createdDaysAgo),
    dispatchedAt: dispatchedDaysAgo === null ? null : ago(dispatchedDaysAgo),
  };
}

test('已送出 8 天：刪除', async () => {
  const rows = [row('e1', 8, 8)];
  await runOutboxCleanup(fakeOutboxDb(rows) as never, NOW);
  assert.deepEqual(rows, []);
});

test('已送出 6 天：保留', async () => {
  const rows = [row('e2', 6, 6)];
  await runOutboxCleanup(fakeOutboxDb(rows) as never, NOW);
  assert.equal(rows.length, 1);
});

test('未送出的事件：建立 8 天仍保留', async () => {
  const rows = [row('e3', 8, null)];
  await runOutboxCleanup(fakeOutboxDb(rows) as never, NOW);
  assert.equal(rows.length, 1);
});

test('建立 31 天的認領紀錄：刪除', async () => {
  const claims = [{ id: 'c1', createdAt: ago(31) }];
  await runOutboxCleanup(fakeOutboxDb([], claims) as never, NOW);
  assert.deepEqual(claims, []);
});

test('建立 29 天的認領紀錄：保留', async () => {
  const claims = [{ id: 'c2', createdAt: ago(29) }];
  await runOutboxCleanup(fakeOutboxDb([], claims) as never, NOW);
  assert.equal(claims.length, 1);
});
