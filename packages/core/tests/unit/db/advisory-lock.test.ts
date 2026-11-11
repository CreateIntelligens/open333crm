/**
 * advisory lock 鎖鍵的正規化（issue #403）：uuid 大小寫不同仍是同一把鎖，其他段落維持分大小寫。
 * 對真實 PostgreSQL 的互斥行為見 apps/api/tests/feature/modules/coupon/coupon-lock-case.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { advisoryLockKey, advisoryXactLock } from '#src/db/advisory-lock.js';

const ID = '0b5e7c1a-3f2d-4e6b-9a8c-1d2e3f4a5b6c';

test('uuid 大小寫不同，鎖鍵相同', () => {
  assert.equal(advisoryLockKey(ID.toUpperCase()), advisoryLockKey(ID));
  assert.equal(advisoryLockKey('sla', ID.toUpperCase(), 'SLA_BREACHED'), advisoryLockKey('sla', ID, 'SLA_BREACHED'));
});

test('只有一段時就是那一段，與既有的券鎖鍵相同', () => {
  assert.equal(advisoryLockKey(ID.toUpperCase()), ID);
});

test('多段以冒號串接，與既有的鎖鍵格式相同', () => {
  assert.equal(advisoryLockKey('member-binding', ID, 'M001'), `member-binding:${ID}:M001`);
});

test('不是 uuid 的段落維持原樣，大小寫不同就是不同的鎖', () => {
  assert.notEqual(advisoryLockKey('member-binding', ID, 'abc'), advisoryLockKey('member-binding', ID, 'ABC'));
  assert.equal(advisoryLockKey('shortlink-click', ID, 'U1A2B3'), `shortlink-click:${ID}:U1A2B3`);
});

test('advisoryXactLock 以正規化的鎖鍵呼叫 pg_advisory_xact_lock', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return Promise.resolve(1);
    },
  };
  await advisoryXactLock(tx as never, 'coupon', ID.toUpperCase());
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pg_advisory_xact_lock\(hashtextextended\(\?, 0\)\)/);
  assert.deepEqual(calls[0].values, [`coupon:${ID}`]);
});
