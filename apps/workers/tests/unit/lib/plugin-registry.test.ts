/**
 * workers 註冊 IG 外掛（change fix-keyword-yield-ig-delivery，spec threads-channel「Threads Plugin Registration」）。
 * 沒註冊時，規則在 IG 對話的「傳送訊息」「傳送素材」都會記成「No plugin」送出失敗。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { threadsPlugin } from '@open333crm/channel-plugins';
import { createWorkerPluginRegistry } from '#src/lib/plugin-registry';

test('Workers send to Instagram', () => {
  const registry = createWorkerPluginRegistry();
  assert.equal(registry.get('THREADS'), threadsPlugin);
  assert.ok(registry.get('LINE') && registry.get('FB'), 'LINE、FB 維持註冊');
});
