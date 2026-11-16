/**
 * 手動輸入的貼文 ID 或網址離線正規化（change add-comment-keyword-private-reply，tasks 1.5）。
 * spec channel-plugins「Comment post references are normalized offline」。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { fbPlugin } from '#src/facebook/index.js';
import { threadsPlugin } from '#src/threads.js';

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  assert.equal(fetchSpy.mock.calls.length, 0, '離線正規化不可發出任何網路請求');
  vi.unstubAllGlobals();
});

const fbParse = (input: string, accountId = '999') => {
  const ext = fbPlugin.extensions?.comments;
  assert.ok(ext, 'FB 外掛要有 extensions.comments');
  return ext.parsePostReference(input, { accountId });
};
const igParse = (input: string, accountId = '17840000000000001') => {
  const ext = threadsPlugin.extensions?.comments;
  assert.ok(ext, 'IG 外掛要有 extensions.comments');
  return ext.parsePostReference(input, { accountId });
};

test('Numeric post ID', () => {
  assert.equal(fbParse('123'), '999_123');
});

test('Unrecognized input', () => {
  assert.equal(fbParse('hello'), null);
  assert.equal(fbParse(''), null);
  assert.equal(fbParse('   '), null);
  assert.equal(fbParse('https://evil.example/posts/abc'), null);
});

test('{pageId}_{id} 原樣接受（前後空白去掉）', () => {
  assert.equal(fbParse(' 999_123 '), '999_123');
});

test('別的粉專的 {pageId}_{id} 不接受', () => {
  assert.equal(fbParse('888_123'), null);
});

test('/posts/<數字> 網址', () => {
  assert.equal(fbParse('https://www.facebook.com/mypage/posts/123456789'), '999_123456789');
  assert.equal(fbParse('https://m.facebook.com/999/posts/123456789/?comment_id=1'), '999_123456789');
});

test('story_fbid= 網址', () => {
  assert.equal(fbParse('https://www.facebook.com/permalink.php?story_fbid=555&id=999'), '999_555');
});

test('fbid= 網址', () => {
  assert.equal(fbParse('https://www.facebook.com/photo.php?fbid=777&set=a.1'), '999_777');
});

test('pfbid 網址無法離線換算，回 null（交給 resolvePostUrl 查 Graph API）', () => {
  assert.equal(fbParse('https://www.facebook.com/mypage/posts/pfbid02abcDEF'), null);
});

test('非 facebook.com 的網址不接受', () => {
  assert.equal(fbParse('https://example.com/posts/123'), null);
  assert.equal(fbParse('https://example.com/?story_fbid=123'), null);
});

test('IG 接受數字 media id，其他回 null', () => {
  assert.equal(igParse('18000000000000001'), '18000000000000001');
  assert.equal(igParse(' 18000000000000001 '), '18000000000000001');
  assert.equal(igParse('https://www.instagram.com/p/Cabc123/'), null, 'shortcode 無法離線換算');
  assert.equal(igParse('hello'), null);
});
