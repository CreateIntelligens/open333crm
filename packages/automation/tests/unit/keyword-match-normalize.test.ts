/**
 * 留言比對用的關鍵字比對（change add-comment-keyword-private-reply：comment-reply-rules「關鍵字比對方式」）。
 *
 * 留言比對呼叫 matchKeywords(..., { normalize: 'nfkc' })：比對前把關鍵字與留言都做 NFKC 正規化並轉小寫，
 * 包含比對；any 任一出現即命中、all 全部出現才命中；沒有文字的留言不命中、不丟錯。
 * 關鍵字回覆（matchKeywordTrigger）維持只轉小寫，見 keyword-match.test.ts。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { matchKeywords, normalizeKeywordText } from '#src/keyword/keyword-match.js';

const nfkc = { normalize: 'nfkc' } as const;

test('全形半形與大小寫：關鍵字 +1 與 OK，留言「＋１」或「ok 好」都命中', () => {
  assert.deepEqual(matchKeywords(['+1', 'OK'], 'any', '＋１', nfkc), { matchedKeywords: ['+1'], matchMode: 'any' });
  assert.deepEqual(matchKeywords(['+1', 'OK'], 'any', 'ok 好', nfkc), { matchedKeywords: ['OK'], matchMode: 'any' });
  // 反過來：關鍵字是全形、留言是半形
  assert.deepEqual(matchKeywords(['＋１'], 'any', '我要+1', nfkc), { matchedKeywords: ['＋１'], matchMode: 'any' });
});

test('全部關鍵字才命中：all 模式「我要領券」不命中，「台北領券」命中', () => {
  assert.equal(matchKeywords(['領券', '台北'], 'all', '我要領券', nfkc), null);
  assert.deepEqual(matchKeywords(['領券', '台北'], 'all', '台北領券', nfkc), {
    matchedKeywords: ['領券', '台北'],
    matchMode: 'all',
  });
});

test('短關鍵字包含比對：關鍵字「1」命中「100 元」', () => {
  assert.deepEqual(matchKeywords(['1'], 'any', '100 元', nfkc), { matchedKeywords: ['1'], matchMode: 'any' });
});

test('只有貼圖的留言：沒有文字時不命中，也不丟錯', () => {
  assert.equal(matchKeywords(['+1'], 'any', '', nfkc), null);
  assert.equal(matchKeywords(['+1'], 'any', undefined, nfkc), null);
  assert.equal(matchKeywords(['+1'], 'any', null, nfkc), null);
  assert.equal(matchKeywords(['+1'], 'any', '😀😀', nfkc), null);
});

test('空白或非字串的關鍵字不參與比對（空字串會命中所有留言）', () => {
  assert.equal(matchKeywords(['', '  '], 'any', '任何留言', nfkc), null);
  assert.deepEqual(matchKeywords(['', '領券'], 'all', '我要領券', nfkc), { matchedKeywords: ['領券'], matchMode: 'all' });
});

test('normalizeKeywordText：nfkc 做 NFKC＋小寫，lowercase 只轉小寫', () => {
  assert.equal(normalizeKeywordText('＋１ ＯＫ', 'nfkc'), '+1 ok');
  assert.equal(normalizeKeywordText('＋１ OK', 'lowercase'), '＋１ ok');
});
