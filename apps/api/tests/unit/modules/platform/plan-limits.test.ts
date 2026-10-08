/** 有效上限解析（主規格 plan-limits-core「有效上限解析」） */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveEffectiveLimit } from '#src/modules/platform/plan-limits.service.js';

test('覆寫優先：方案 maxAgents=3、租戶覆寫 5，有效上限是 5', () => {
  const tenant = { limitOverrides: { maxAgents: 5 }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), 5);
});

test('沒有覆寫時採用方案的值：limitOverrides 沒有 maxAgents，有效上限是方案的 3', () => {
  const tenant = { limitOverrides: { maxChannels: 1 }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), 3);
});

test('無 plan 無上限：租戶沒有方案時，每個上限都是 null', () => {
  const tenant = { limitOverrides: {}, plan: null };
  for (const key of ['maxAgents', 'maxTags', 'monthlyTokens', 'maxChannels'] as const) {
    assert.equal(resolveEffectiveLimit(tenant, key), null, key);
  }
});

test('覆寫成 null 時沒有上限：不採用方案的 3', () => {
  const tenant = { limitOverrides: { maxAgents: null }, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxAgents'), null);
});

test('方案沒有設定這個上限：方案的 limits 沒有 maxChannels，結果是無上限', () => {
  const tenant = { limitOverrides: {}, plan: { limits: { maxAgents: 3 } } };
  assert.equal(resolveEffectiveLimit(tenant, 'maxChannels'), null);
});
