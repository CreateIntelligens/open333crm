/**
 * 方案種子的內容（issue #411，change enable-channels-on-trial-light-411）。
 * 渠道（LINE、FB、IG、WebChat）是每個方案的基本功能：channel.* 權限碼屬於 channels feature，
 * 方案不含 channels 時，租戶管理員看不到也建不了任何渠道。
 * seed 不在 src/ 裡，所以這裡用相對路徑匯入。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SEED_PLANS } from '../../../prisma/seed-data/plans.js';

const plan = (slug: string) => {
  const found = SEED_PLANS.find((p) => p.slug === slug);
  assert.ok(found, `seed 應有 ${slug} 方案`);
  return found;
};

test('試用與輕量版方案可以使用渠道：trial、light 的 features 含 channels', () => {
  assert.ok(plan('trial').features.includes('channels'), `trial features：${plan('trial').features.join(',')}`);
  assert.ok(plan('light').features.includes('channels'), `light features：${plan('light').features.join(',')}`);
});

test('每個 seed 方案都含 channels', () => {
  for (const p of SEED_PLANS) assert.ok(p.features.includes('channels'), `${p.slug} 缺 channels`);
});

test('seed 方案的渠道數上限不是 0：能看到渠道頁就能建立渠道', () => {
  for (const p of SEED_PLANS) {
    const max = p.limits.maxChannels;
    assert.ok(max === undefined || max === null || max > 0, `${p.slug} 的 maxChannels 是 ${max}`);
  }
});
