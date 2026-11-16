/**
 * 留言擴充在 API 與 workers 兩邊的 registry 都拿得到（change add-comment-keyword-private-reply，tasks 1.7、design D5）。
 * spec channel-plugins「Unified channel plugin interface」› Scenario「Comment extension available in both registries」。
 *
 * API（apps/api/src/index.ts）以 registerChannelPlugin() 註冊 linePlugin、fbPlugin、webchatPlugin、threadsPlugin；
 * workers 以 createWorkerPluginRegistry() 另建一份。兩邊必須是同一個外掛實例，留言擴充才不會只有一邊有。
 * 本功能的消費者在 API 行程，workers 不呼叫留言方法；這個測試防止日後有人把 workers 改成另建實例而漏掉擴充。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  fbPlugin,
  getChannelPlugin,
  linePlugin,
  registerChannelPlugin,
  threadsPlugin,
  webchatPlugin,
} from '@open333crm/channel-plugins';
import { createWorkerPluginRegistry } from '#src/lib/plugin-registry';

test('Comment extension available in both registries', () => {
  // API 的共用 registry：照 apps/api/src/index.ts 註冊同樣的四個外掛
  for (const plugin of [linePlugin, fbPlugin, webchatPlugin, threadsPlugin]) registerChannelPlugin(plugin);
  const workers = createWorkerPluginRegistry();

  for (const type of ['FB', 'THREADS']) {
    const api = getChannelPlugin(type);
    const worker = workers.get(type);
    assert.ok(api?.extensions?.comments, `API registry 的 ${type} 要有 extensions.comments`);
    assert.ok(worker?.extensions?.comments, `workers registry 的 ${type} 要有 extensions.comments`);
    assert.equal(worker.extensions.comments, api.extensions.comments, `${type} 兩邊是同一個擴充實例`);
  }

  assert.equal(getChannelPlugin('LINE')?.extensions?.comments, undefined, 'LINE 沒有留言擴充');
  assert.equal(workers.get('LINE')?.extensions?.comments, undefined, 'workers 的 LINE 沒有留言擴充');
  assert.equal(getChannelPlugin('WEBCHAT')?.extensions?.comments, undefined, 'WebChat 沒有留言擴充');
});
