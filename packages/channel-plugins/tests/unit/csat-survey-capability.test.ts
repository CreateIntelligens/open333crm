/**
 * 渠道外掛宣告能不能寄滿意度問卷（issue #339 決定 7，主規格 channel-plugins
 * 「Channel plugins declare whether they can send a CSAT survey」）。
 *
 * 只有客人能在渠道上直接點選分數的外掛實作 buildCsatSurvey()；csat 模組依此判斷要不要寄，
 * 不比對 channelType（AGENTS.md 結構規則 5）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { linePlugin } from '#src/line/index.js';
import { fbPlugin } from '#src/facebook/index.js';
import { threadsPlugin } from '#src/threads.js';
import { webchatPlugin } from '#src/webchat/index.js';
import type { ChannelPlugin } from '#src/index.js';

const CASE_ID = 'b0000000-0000-0000-0000-000000000001';
const options = [1, 2, 3, 4, 5].map((score) => ({
  label: String(score),
  postbackData: `csat:${score}:${CASE_ID}`,
  displayText: `我的評分：${score} 分`,
}));

test('LINE plugin builds a CSAT survey', () => {
  const plugin: ChannelPlugin = linePlugin;
  assert.equal(typeof plugin.buildCsatSurvey, 'function');
  const payload = plugin.buildCsatSurvey!({ question: '請評價此次服務體驗（1-5 分）', options });

  assert.equal(payload.contentType, 'flex');
  const content = payload.content as {
    altText: string;
    contents: { footer: { contents: Array<{ action: { type: string; data: string; displayText: string } }> } };
  };
  assert.equal(content.altText, '請評價此次服務體驗（1-5 分）');
  const actions = content.contents.footer.contents.map((b) => b.action);
  assert.deepEqual(actions.map((a) => a.data), [1, 2, 3, 4, 5].map((n) => `csat:${n}:${CASE_ID}`));
  assert.ok(actions.every((a) => a.type === 'postback'));
  assert.equal(actions[1].displayText, '我的評分：2 分');
});

test('Other plugins cannot send a CSAT survey', () => {
  for (const plugin of [fbPlugin, threadsPlugin, webchatPlugin] as ChannelPlugin[]) {
    assert.equal(plugin.buildCsatSurvey, undefined, plugin.channelType);
  }
});
