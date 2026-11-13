/**
 * 私訊內容的渲染與公開回覆文字的選擇（change add-comment-keyword-private-reply：
 * comment-private-reply「私訊內容的渲染」「公開回覆留言」「送出前重新檢查」；QA DM-05、06、07、PR-06）。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  commenterDisplayName,
  pickPublicReplyText,
  renderCommentReplyContent,
  type CommentReplyContentCapabilities,
} from '#src/modules/comment-reply/comment-reply-content.js';

const FB: CommentReplyContentCapabilities = {
  privateReplyContentTypes: ['text', 'image', 'fb_button_template'],
  materialChannelType: 'FB',
};
const IG: CommentReplyContentCapabilities = { privateReplyContentTypes: ['text'], materialChannelType: null };

function material(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    channelType: 'FB',
    contentType: 'text',
    isActive: true,
    body: { text: '{commenter.name} 你好，{{coupon_name}}{{no_default}}！' },
    variables: [{ key: 'coupon_name', defaultValue: '春季券' }, { key: 'no_default' }],
    ...overrides,
  };
}

test('素材含留言者名稱與變數：代入名稱與預設值，沒有預設值留空，不含 {{ 或 }}', () => {
  const r = renderCommentReplyContent({
    content: { type: 'material', material: material() },
    commenter: { name: '王小明' },
    capabilities: FB,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload, { contentType: 'text', content: { text: '王小明 你好，春季券！' } });
  const text = String(r.payload.content.text);
  assert.ok(!text.includes('{{') && !text.includes('}}'));
  assert.ok(!text.includes('{commenter.name}'));
});

test('素材內的 {{commenter.name}} 與巢狀欄位也會代入', () => {
  const r = renderCommentReplyContent({
    content: {
      type: 'material',
      material: material({
        contentType: 'fb_button_template',
        body: { text: 'Hi {{commenter.name}}', buttons: [{ title: '看 {{unknown}}', url: '/s/abc' }] },
        variables: [],
      }),
    },
    commenter: { name: 'Amy' },
    capabilities: FB,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload.content, { text: 'Hi Amy', buttons: [{ title: '看 ', url: '/s/abc' }] });
});

test('留言者名稱內的大括號原樣保留，不會被當成變數清掉', () => {
  const r = renderCommentReplyContent({
    content: { type: 'text', text: '{commenter.name} 感謝留言' },
    commenter: { name: '小{{x}}明' },
    capabilities: FB,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload, { contentType: 'text', content: { text: '小{{x}}明 感謝留言' } });
});

test('文字規則：代入留言者名稱，未知的 {{變數}} 留空；沒有名稱時留空', () => {
  const r = renderCommentReplyContent({
    content: { type: 'text', text: '{commenter.name}您好{{foo}}，感謝留言' },
    commenter: {},
    capabilities: IG,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload, { contentType: 'text', content: { text: '您好，感謝留言' } });
});

test('額外變數（例如 storage.base_url）由呼叫端提供', () => {
  const r = renderCommentReplyContent({
    content: {
      type: 'material',
      material: material({ contentType: 'image', body: { url: '{{storage.base_url}}/a.png' }, variables: [] }),
    },
    commenter: { name: 'A' },
    capabilities: FB,
    extraVariables: { 'storage.base_url': 'https://cdn.example.com' },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.payload.content, { url: 'https://cdn.example.com/a.png' });
});

test('IG 規則資料被改成素材（繞過 API）：MATERIAL_UNSUPPORTED，不產生內容', () => {
  const r = renderCommentReplyContent({
    content: { type: 'material', material: material() },
    commenter: { name: 'A' },
    capabilities: IG,
  });
  assert.deepEqual(r, { ok: false, reason: 'MATERIAL_UNSUPPORTED' });
});

test('素材類型不在外掛宣告內、或是收據／券／意見範本：MATERIAL_UNSUPPORTED', () => {
  for (const contentType of ['video', 'fb_receipt', 'fb_coupon', 'fb_feedback']) {
    const caps = { ...FB, privateReplyContentTypes: [...FB.privateReplyContentTypes, contentType] };
    const allowed = contentType === 'video' ? FB : caps;
    const r = renderCommentReplyContent({
      content: { type: 'material', material: material({ contentType }) },
      commenter: {},
      capabilities: allowed,
    });
    assert.deepEqual(r, { ok: false, reason: 'MATERIAL_UNSUPPORTED' }, contentType);
  }
  const lineMaterial = renderCommentReplyContent({
    content: { type: 'material', material: material({ channelType: 'LINE' }) },
    commenter: {},
    capabilities: FB,
  });
  assert.deepEqual(lineMaterial, { ok: false, reason: 'MATERIAL_UNSUPPORTED' });
});

test('排隊期間素材被停用或刪除：MATERIAL_UNAVAILABLE', () => {
  assert.deepEqual(
    renderCommentReplyContent({ content: { type: 'material', material: material({ isActive: false }) }, commenter: {}, capabilities: FB }),
    { ok: false, reason: 'MATERIAL_UNAVAILABLE' },
  );
  assert.deepEqual(
    renderCommentReplyContent({ content: { type: 'material', material: null }, commenter: {}, capabilities: FB }),
    { ok: false, reason: 'MATERIAL_UNAVAILABLE' },
  );
});

test('留言者名稱：FB 用名稱，IG 用 @帳號，都沒有時是空字串', () => {
  assert.equal(commenterDisplayName({ commenterName: '王小明', commenterUsername: 'wang' }), '王小明');
  assert.equal(commenterDisplayName({ commenterName: null, commenterUsername: 'wang' }), '@wang');
  assert.equal(commenterDisplayName({}), '');
});

test('同一則留言重算選到同一則文字：3 則文字、30 則不同留言，至少用到 2 則', () => {
  const texts = ['感謝留言，已私訊你', '已傳訊息給你，請查看', '謝謝支持，請看私訊'];
  const picked = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const commentId = `1203948576_${1000 + i * 7}`;
    const first = pickPublicReplyText(texts, commentId);
    assert.ok(first !== null && texts.includes(first));
    assert.equal(pickPublicReplyText(texts, commentId), first);
    picked.add(first);
  }
  assert.ok(picked.size >= 2, `只用到 ${picked.size} 則文字`);
});

test('沒有公開回覆文字時回傳 null；只有 1 則時固定選它', () => {
  assert.equal(pickPublicReplyText([], 'c1'), null);
  assert.equal(pickPublicReplyText(['只有一則'], 'c1'), '只有一則');
});
