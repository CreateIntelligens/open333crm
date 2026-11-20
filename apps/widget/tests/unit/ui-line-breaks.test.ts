// @vitest-environment jsdom
/**
 * 訊息泡泡保留換行。AI 與客服的回覆常分段、列步驟；沒有 `white-space: pre-wrap` 時，
 * 瀏覽器把換行當成空白，整段擠成一行（2026-11-20 UAT 網站聊天室）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { appendMessage, appendVisitorText, injectStyles } from '#src/ui.js';

let container: HTMLElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  injectStyles();
  container = document.createElement('div');
  document.body.appendChild(container);
});

test('客服或機器人的回覆保留換行', () => {
  appendMessage(container, { contentType: 'text', content: { text: '步驟如下：\n1. 開啟設定\n2. 按儲存' } } as never, false);
  const el = container.lastElementChild as HTMLElement;
  assert.equal(el.textContent, '步驟如下：\n1. 開啟設定\n2. 按儲存');
  assert.equal(getComputedStyle(el).whiteSpace, 'pre-wrap');
});

test('含網址的回覆保留換行', () => {
  appendMessage(container, { contentType: 'text', content: { text: '說明\n操作頁面：https://crm.example/a' } } as never, false);
  const el = container.lastElementChild as HTMLElement;
  assert.ok(el.querySelector('a') !== null);
  assert.equal(getComputedStyle(el).whiteSpace, 'pre-wrap');
});

test('訪客送出的多行文字保留換行', () => {
  appendVisitorText(container, '第一行\n第二行');
  const el = container.lastElementChild as HTMLElement;
  assert.equal(getComputedStyle(el).whiteSpace, 'pre-wrap');
});
