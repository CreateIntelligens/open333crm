/**
 * 副作用的認領（change outbox-event-delivery：side-effect-claims「一個認領鍵只能認領一次」）。
 *
 * 假的交易以記憶體裡的唯一鍵模擬 createMany({ skipDuplicates: true })：鍵已存在時回傳 count 0。
 * 對真實 PostgreSQL 的行為（交易不失效、兩個交易同時認領）見 apps/api/tests/feature/lib/side-effect-claims.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { claimSideEffect, hasSideEffectClaim } from '#src/outbox/claims.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const MESSAGE = '11111111-1111-1111-1111-111111111111';
const EVENT = '22222222-2222-2222-2222-222222222222';

type Row = { tenantId: string; kind: string; sourceId: string; subKey?: string };

function fakeTx() {
  const keys = new Set<string>();
  const rows: Row[] = [];
  const keyOf = (r: Row) => `${r.kind}|${r.sourceId}|${r.subKey ?? ''}`;
  const tx = {
    sideEffectClaim: {
      async createMany(args: { data: Row[]; skipDuplicates?: boolean }) {
        assert.equal(args.skipDuplicates, true, '認領要用 skipDuplicates，撞到唯一鍵時不讓交易失效');
        let count = 0;
        for (const row of args.data) {
          if (keys.has(keyOf(row))) continue;
          keys.add(keyOf(row));
          rows.push(row);
          count++;
        }
        return { count };
      },
      async count(args: { where: Row }) {
        return keys.has(keyOf(args.where)) ? 1 : 0;
      },
    },
  };
  return { tx, rows };
}

test('第一次認領', async () => {
  const { tx, rows } = fakeTx();
  const claimed = await claimSideEffect(tx as never, { tenantId: TENANT, kind: 'bot_reply', sourceId: MESSAGE });
  assert.equal(claimed, true);
  assert.deepEqual(rows, [{ tenantId: TENANT, kind: 'bot_reply', sourceId: MESSAGE, subKey: '' }]);
});

test('已經認領過', async () => {
  const { tx } = fakeTx();
  await claimSideEffect(tx as never, { tenantId: TENANT, kind: 'bot_reply', sourceId: MESSAGE });
  const again = await claimSideEffect(tx as never, { tenantId: TENANT, kind: 'bot_reply', sourceId: MESSAGE });
  assert.equal(again, false);
});

test('子鍵不同', async () => {
  const { tx } = fakeTx();
  await claimSideEffect(tx as never, { tenantId: TENANT, kind: 'automation_action', sourceId: EVENT, subKey: 'R1#0' });
  const other = await claimSideEffect(tx as never, {
    tenantId: TENANT,
    kind: 'automation_action',
    sourceId: EVENT,
    subKey: 'R1#1',
  });
  assert.equal(other, true);
});

test('hasSideEffectClaim：認領之後查得到，之前查不到', async () => {
  const { tx } = fakeTx();
  const key = { tenantId: TENANT, kind: 'sentiment' as const, sourceId: MESSAGE };
  assert.equal(await hasSideEffectClaim(tx as never, key), false);
  await claimSideEffect(tx as never, key);
  assert.equal(await hasSideEffectClaim(tx as never, key), true);
});
