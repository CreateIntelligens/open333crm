/**
 * 規則輸入驗證（change add-comment-keyword-private-reply：comment-reply-rules「建立留言規則」
 * 「公開回覆的設定」「規則建立後不可改渠道」「規則的優先順序」；QA MT-18、PR-07，正反成對）。
 *
 * 驗證失敗丟 AppError VALIDATION_ERROR 400，details.field 指出欄位（spec 要求，不能只回 Zod issues）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { AppError } from '#src/shared/utils/response.js';
import {
  parseRuleInput,
  parseRulePatch,
  parseReorderInput,
  parseLogsQuery,
  parseRuleTestInput,
} from '#src/modules/comment-reply/comment-reply.schemas.js';

const CHANNEL_ID = '0b9d2c3e-1f4a-4c5b-8d6e-7f8091a2b3c4';
const MATERIAL_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

function validInput() {
  return {
    channelId: CHANNEL_ID,
    name: '+1 領券',
    keywords: ['+1', '領券'],
    matchMode: 'any',
    postScope: 'all',
    posts: [],
    content: { type: 'text', text: '感謝留言' },
    dedupePerCommenter: true,
    publicReply: { enabled: true, texts: ['已私訊你', '請查看私訊', '感謝支持'] },
    isActive: true,
  };
}

function expectValidationError(fn: () => unknown, field: string, code = 'VALIDATION_ERROR') {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError, `丟出的不是 AppError：${String(err)}`);
    assert.equal(err.code, code);
    assert.equal(err.statusCode, 400);
    assert.equal(err.details?.field, field);
    return;
  }
  assert.fail(`應該丟出 ${code}（field=${field}）`);
}

test('合法的規則 parse 後值不變', () => {
  const input = validInput();
  assert.deepEqual(parseRuleInput(input), input);
});

test('關鍵字正規化後重複：["+1","＋１"] 回 400，field 是 keywords；不重複時通過', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), keywords: ['+1', '＋１'] }), 'keywords');
  expectValidationError(() => parseRuleInput({ ...validInput(), keywords: ['OK', 'ok'] }), 'keywords');
  assert.deepEqual(parseRuleInput({ ...validInput(), keywords: ['+1', '+2'] }).keywords, ['+1', '+2']);
});

test('關鍵字數量與長度：0 個、21 個、51 字都回 400', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), keywords: [] }), 'keywords');
  expectValidationError(
    () => parseRuleInput({ ...validInput(), keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }),
    'keywords',
  );
  expectValidationError(() => parseRuleInput({ ...validInput(), keywords: ['a'.repeat(51)] }), 'keywords');
  expectValidationError(() => parseRuleInput({ ...validInput(), keywords: ['   '] }), 'keywords');
  assert.equal(parseRuleInput({ ...validInput(), keywords: ['a'.repeat(50)] }).keywords[0].length, 50);
});

test('指定貼文卻沒有貼文：selected＋空陣列回 400，field 是 posts；有 1 篇時通過', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), postScope: 'selected', posts: [] }), 'posts');
  const ok = parseRuleInput({ ...validInput(), postScope: 'selected', posts: [{ postId: '123' }] });
  assert.deepEqual(ok.posts, [{ postId: '123' }]);
  expectValidationError(
    () =>
      parseRuleInput({
        ...validInput(),
        postScope: 'selected',
        posts: Array.from({ length: 51 }, (_, i) => ({ postId: `p${i}` })),
      }),
    'posts',
  );
});

test('貼文的 publishedAt 用前端送的 ISO 字串，parse 成 Date', () => {
  const publishedAt = '2026-11-10T08:00:00.000Z';
  const ok = parseRuleInput({
    ...validInput(),
    postScope: 'selected',
    posts: [{ postId: 'page_1', permalink: 'https://facebook.com/page/posts/1', excerpt: '雙 11', publishedAt }],
  });
  assert.ok(ok.posts[0].publishedAt instanceof Date);
  assert.equal(ok.posts[0].publishedAt?.toISOString(), publishedAt);
  // 沒有發布時間（例如手動輸入的 ID）可以是 null 或不帶
  assert.equal(
    parseRuleInput({ ...validInput(), postScope: 'selected', posts: [{ postId: '1', publishedAt: null }] }).posts[0].publishedAt,
    undefined,
  );
  expectValidationError(
    () => parseRuleInput({ ...validInput(), postScope: 'selected', posts: [{ postId: '1', publishedAt: 'not-a-date' }] }),
    'posts',
  );
});

test('開啟公開回覆但沒有文字：回 400，field 是 publicReply；超過 5 則或單則超過 300 字也是', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), publicReply: { enabled: true, texts: [] } }), 'publicReply');
  expectValidationError(
    () => parseRuleInput({ ...validInput(), publicReply: { enabled: true, texts: ['1', '2', '3', '4', '5', '6'] } }),
    'publicReply',
  );
  expectValidationError(
    () => parseRuleInput({ ...validInput(), publicReply: { enabled: true, texts: ['a'.repeat(301)] } }),
    'publicReply',
  );
  assert.deepEqual(parseRuleInput({ ...validInput(), publicReply: { enabled: true, texts: ['a'.repeat(300)] } }).publicReply, {
    enabled: true,
    texts: ['a'.repeat(300)],
  });
  // 關閉時可以沒有文字
  assert.deepEqual(parseRuleInput({ ...validInput(), publicReply: { enabled: false, texts: [] } }).publicReply, {
    enabled: false,
    texts: [],
  });
});

test('沒帶公開回覆：預設 enabled=false、texts 是空陣列；其他預設值', () => {
  const { publicReply: _p, matchMode: _m, postScope: _s, posts: _ps, dedupePerCommenter: _d, isActive: _a, ...rest } =
    validInput();
  const parsed = parseRuleInput(rest);
  assert.deepEqual(parsed.publicReply, { enabled: false, texts: [] });
  assert.equal(parsed.matchMode, 'any');
  assert.equal(parsed.postScope, 'all');
  assert.deepEqual(parsed.posts, []);
  assert.equal(parsed.dedupePerCommenter, true);
  assert.equal(parsed.isActive, true);
});

test('私訊內容：文字 1～1000 字；素材要 uuid', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), content: { type: 'text', text: '' } }), 'content');
  expectValidationError(() => parseRuleInput({ ...validInput(), content: { type: 'text', text: 'a'.repeat(1001) } }), 'content');
  expectValidationError(() => parseRuleInput({ ...validInput(), content: { type: 'material' } }), 'content');
  assert.deepEqual(parseRuleInput({ ...validInput(), content: { type: 'material', materialId: MATERIAL_ID } }).content, {
    type: 'material',
    materialId: MATERIAL_ID,
  });
});

test('名稱與渠道：名稱必填、最多 200 字；渠道要 uuid', () => {
  expectValidationError(() => parseRuleInput({ ...validInput(), name: '   ' }), 'name');
  expectValidationError(() => parseRuleInput({ ...validInput(), name: 'a'.repeat(201) }), 'name');
  expectValidationError(() => parseRuleInput({ ...validInput(), channelId: 'line-channel' }), 'channelId');
});

test('修改時帶渠道：CHANNEL_IMMUTABLE 400；只改名稱時只回改的欄位', () => {
  expectValidationError(() => parseRulePatch({ channelId: CHANNEL_ID }), 'channelId', 'CHANNEL_IMMUTABLE');
  assert.deepEqual(parseRulePatch({ name: '新名稱' }), { name: '新名稱' });
  expectValidationError(() => parseRulePatch({ keywords: ['+1', '＋１'] }), 'keywords');
  expectValidationError(() => parseRulePatch({ postScope: 'selected', posts: [] }), 'posts');
  expectValidationError(() => parseRulePatch({ publicReply: { enabled: true, texts: [] } }), 'publicReply');
});

test('排序：ids 重複回 400；合法時原樣回傳', () => {
  expectValidationError(() => parseReorderInput({ ids: [CHANNEL_ID, CHANNEL_ID] }), 'ids');
  expectValidationError(() => parseReorderInput({ ids: [] }), 'ids');
  assert.deepEqual(parseReorderInput({ ids: [CHANNEL_ID, MATERIAL_ID] }), { ids: [CHANNEL_ID, MATERIAL_ID] });
});

test('試算：文字 1～2000 字，貼文選填', () => {
  assert.deepEqual(parseRuleTestInput({ channelId: CHANNEL_ID, text: '+1' }), { channelId: CHANNEL_ID, text: '+1' });
  expectValidationError(() => parseRuleTestInput({ channelId: CHANNEL_ID, text: '' }), 'text');
  expectValidationError(() => parseRuleTestInput({ channelId: CHANNEL_ID, text: 'a'.repeat(2001) }), 'text');
});

test('紀錄查詢：日期用 z.coerce.date()、狀態可逗號分隔、limit 預設 50', () => {
  const q = parseLogsQuery({ status: 'FAILED,SKIPPED', from: '2026-11-01', to: '2026-11-13T23:59', countOnly: 'true' });
  assert.deepEqual(q.status, ['FAILED', 'SKIPPED']);
  assert.ok(q.from instanceof Date && q.to instanceof Date);
  assert.equal(q.limit, 50);
  assert.equal(q.countOnly, true);
  assert.deepEqual(parseLogsQuery({ status: ['SENT'] }).status, ['SENT']);
  expectValidationError(() => parseLogsQuery({ status: 'NOPE' }), 'status');
  expectValidationError(() => parseLogsQuery({ limit: '101' }), 'limit');
  expectValidationError(() => parseLogsQuery({ q: 'a'.repeat(101) }), 'q');
});
