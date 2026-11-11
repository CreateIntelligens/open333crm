/**
 * workers 註冊 IG 外掛（change fix-keyword-yield-ig-delivery，spec threads-channel「Threads Plugin Registration」）。
 * 沒註冊時，規則在 IG 對話的「傳送訊息」「傳送素材」都會記成「No plugin」送出失敗。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AUTOMATION_DELIVERY_CHANNEL_TYPES, linePlugin, threadsPlugin } from '@open333crm/channel-plugins';
import { createWorkerPluginRegistry } from '#src/lib/plugin-registry';

test('Workers send to Instagram', () => {
  const registry = createWorkerPluginRegistry();
  assert.equal(registry.get('THREADS'), threadsPlugin);
  assert.ok(registry.get('LINE') && registry.get('FB'), 'LINE、FB 維持註冊');
});

// issue #339 決定 7（主規格 channel-plugins「Channel plugins declare whether they can send a CSAT survey」）
test('Workers registry has the same capability', () => {
  const registry = createWorkerPluginRegistry();
  assert.equal(registry.get('LINE'), linePlugin, 'workers 用同一個 LINE 外掛物件');
  assert.equal(typeof registry.get('LINE')?.buildCsatSurvey, 'function');
  for (const [type, plugin] of registry) {
    if (type !== 'LINE') assert.equal(plugin.buildCsatSurvey, undefined, type);
  }
});

test('workers 的外掛清單與 API 判斷規則能否回覆的渠道一致', () => {
  // API 的 hasMatchingKeywordRule 依 AUTOMATION_DELIVERY_CHANNEL_TYPES 決定 AI 是否讓步
  assert.deepEqual([...createWorkerPluginRegistry().keys()].sort(), [...AUTOMATION_DELIVERY_CHANNEL_TYPES].sort());
});
