/**
 * 維運告警的合併（change queue-monitoring：ops-alert「同一個合併鍵在 10 分鐘內只送一則」）。
 *
 * Redis 換成記憶體裡的假實作，以 now 模擬時間；佇列換成記錄 add() 的假實作。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { sendOpsAlert, type OpsAlert, type OpsAlertDeps } from '#src/modules/ops-alert/ops-alert.service.js';

function fakeDeps() {
  let now = 0;
  const store = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now) store.delete(key);
    return store.get(key);
  };
  const redis = {
    async set(key: string, value: string, _px: 'PX', ttl: number, _nx: 'NX') {
      if (live(key)) return null;
      store.set(key, { value, expiresAt: now + ttl });
      return 'OK';
    },
    async incr(key: string) {
      const entry = live(key);
      const value = String(Number(entry?.value ?? 0) + 1);
      store.set(key, { value, expiresAt: entry?.expiresAt ?? Infinity });
      return Number(value);
    },
    async pexpire(key: string, ttl: number) {
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = now + ttl;
      return 1;
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async incrby(key: string, by: number) {
      const entry = live(key);
      const value = String(Number(entry?.value ?? 0) + by);
      store.set(key, { value, expiresAt: entry?.expiresAt ?? Infinity });
      return Number(value);
    },
    async getdel(key: string) {
      const entry = live(key);
      store.delete(key);
      return entry?.value ?? null;
    },
  };
  const added: Array<{ name: string; data: Record<string, unknown> }> = [];
  let failNextAdd = false;
  const queue = {
    async add(name: string, data: Record<string, unknown>) {
      if (failNextAdd) {
        failNextAdd = false;
        throw new Error('redis down');
      }
      added.push({ name, data });
    },
  };
  return {
    deps: { redis, queue } as unknown as OpsAlertDeps,
    added,
    advance(ms: number) {
      now += ms;
    },
    failNextAdd() {
      failNextAdd = true;
    },
  };
}

const alert = (key: string): OpsAlert => ({
  key,
  title: '佇列 job 重試用完',
  fields: { 佇列: key.replace('queue-failed:', ''), 'job id': 'j1' },
  link: 'https://crm.example/api/v1/platform/queues',
});

test('短時間內大量失敗', async () => {
  const { deps, added, advance } = fakeDeps();
  for (let i = 0; i < 50; i++) {
    await sendOpsAlert(alert('queue-failed:event-webhook'), deps);
    advance(1_000);
  }

  assert.equal(added.length, 1);
  assert.equal(added[0].data.title, '佇列 job 重試用完');
  assert.equal(added[0].data.suppressedCount, 0);
});

test('下一段期間的告警帶上次數', async () => {
  const { deps, added, advance } = fakeDeps();
  for (let i = 0; i < 50; i++) {
    await sendOpsAlert(alert('queue-failed:event-webhook'), deps);
    advance(1_000);
  }
  advance(600_000);
  await sendOpsAlert(alert('queue-failed:event-webhook'), deps);

  assert.equal(added.length, 2);
  assert.equal(added[1].data.suppressedCount, 49);
});

test('不同合併鍵', async () => {
  const { deps, added } = fakeDeps();
  await sendOpsAlert(alert('queue-failed:event-webhook'), deps);
  await sendOpsAlert(alert('queue-failed:automation'), deps);

  assert.equal(added.length, 2);
  assert.equal(added[1].data.fields && (added[1].data.fields as Record<string, unknown>)['佇列'], 'automation');
});

test('告警放不進佇列：不留下合併鍵，下一則照常送出並帶上次數', async () => {
  const { deps, added, advance, failNextAdd } = fakeDeps();
  await sendOpsAlert(alert('queue-failed:event-webhook'), deps);
  for (let i = 0; i < 5; i++) await sendOpsAlert(alert('queue-failed:event-webhook'), deps);
  advance(600_000);

  failNextAdd();
  await assert.rejects(sendOpsAlert(alert('queue-failed:event-webhook'), deps), /redis down/);
  const sent = await sendOpsAlert(alert('queue-failed:event-webhook'), deps);

  assert.equal(sent, true);
  assert.equal(added.length, 2);
  assert.equal(added[1].data.suppressedCount, 5);
});
