/**
 * 文字訊息中的網址拆分（change improve-binding-prefill-and-webchat-links，
 * 規格 webchat-widget「Web addresses in text messages are links」）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { splitTextLinks } from '#src/utils/linkify.js';

test('網址前後的文字保留為純文字', () => {
  assert.deepEqual(splitTextLinks('請點 https://m.me/shop?ref=BIND-7K2M9QH4TX 完成綁定'), [
    { type: 'text', value: '請點 ' },
    { type: 'link', value: 'https://m.me/shop?ref=BIND-7K2M9QH4TX' },
    { type: 'text', value: ' 完成綁定' },
  ]);
});

test('結尾標點不算進網址（半形與全形）', () => {
  assert.deepEqual(splitTextLinks('網址：https://example.com/a。'), [
    { type: 'text', value: '網址：' },
    { type: 'link', value: 'https://example.com/a' },
    { type: 'text', value: '。' },
  ]);
  for (const tail of ['.', ',', ')', '，', '）', '!', '?', '」']) {
    const parts = splitTextLinks(`(http://x.test/p${tail}`);
    assert.equal(parts.find((p) => p.type === 'link')?.value, 'http://x.test/p', `結尾 ${tail}`);
  }
});

test('網址緊接中文時在中文前結束', () => {
  assert.deepEqual(splitTextLinks('https://ig.me/m/shop點這裡'), [
    { type: 'link', value: 'https://ig.me/m/shop' },
    { type: 'text', value: '點這裡' },
  ]);
});

test('多個網址與換行', () => {
  const parts = splitTextLinks('A https://a.test\nB http://b.test/x');
  assert.deepEqual(parts.filter((p) => p.type === 'link').map((p) => p.value), ['https://a.test', 'http://b.test/x']);
  assert.equal(parts.map((p) => p.value).join(''), 'A https://a.test\nB http://b.test/x');
});

test('其他 scheme 與 HTML 標籤維持純文字', () => {
  assert.deepEqual(splitTextLinks('javascript:alert(1)'), [{ type: 'text', value: 'javascript:alert(1)' }]);
  assert.deepEqual(splitTextLinks('data:text/html,hi ftp://x.test'), [{ type: 'text', value: 'data:text/html,hi ftp://x.test' }]);
  const parts = splitTextLinks('<a href="https://x.test">x</a>');
  assert.equal(parts.map((p) => p.value).join(''), '<a href="https://x.test">x</a>');
  assert.equal(parts.find((p) => p.type === 'link')?.value, 'https://x.test');
});

test('只有 scheme 沒有主機不算網址；空字串回空陣列', () => {
  assert.deepEqual(splitTextLinks('https://'), [{ type: 'text', value: 'https://' }]);
  assert.deepEqual(splitTextLinks(''), []);
});
