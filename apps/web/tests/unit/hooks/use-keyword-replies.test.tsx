// @vitest-environment jsdom
/**
 * 關鍵字回覆頁的儲存與列表（add-coupon-system A15 15.1、design D25；spec automation-engine
 * 「關鍵字回覆頁保留規則上的其他動作與條件」、coupon-management「關鍵字回覆可以同時發券」）。
 *
 * 修正前：儲存時以固定的 [send_material] 覆蓋整個 actions 與 conditions，規則上的發券、加標籤與其他條件被刪掉；
 * 規則也沒有渠道條件，在 FB、IG、網站客服的對話也會觸發。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import {
  createKeywordReply,
  keywordReplySaveBlock,
  updateKeywordReply,
  useKeywordReplies,
  type KeywordReply,
} from '#src/hooks/useKeywordReplies.js';

const LINE_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' };
const FB_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'FB' };
const IG_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'THREADS' };
const VIP_CONDITION = { fact: 'contact.tags', operator: 'contains', value: 'VIP' };

function ruleDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: '詢價',
    isActive: true,
    priority: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    trigger: { type: 'keyword.matched', keywords: ['價格'], match_mode: 'any' },
    conditions: { all: [VIP_CONDITION] },
    actions: [
      { type: 'send_material', params: { materialId: 'm-1' } },
      { type: 'add_tag', params: { tagName: '詢價' } },
    ],
    ...overrides,
  };
}

/** 素材的渠道與狀態（GET /marketing/materials/:id）；沒列在這裡的素材視為 LINE、啟用中 */
let materialInfo: Record<string, { channelType: string; isActive: boolean } | 'not_found'> = {};

function mockRules(details: Array<Record<string, unknown>>) {
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/marketing/materials/')) {
      const id = url.split('/').pop()!;
      const info = materialInfo[id] ?? { channelType: 'line', isActive: true };
      if (info === 'not_found') throw Object.assign(new Error('404'), { response: { status: 404 } });
      return { data: { success: true, data: { id, name: `素材 ${id}`, ...info } } };
    }
    if (url.startsWith('/automation/rules/')) {
      const id = url.split('/').pop();
      return { data: { success: true, data: details.find((d) => d.id === id) } };
    }
    if (url.startsWith('/automation/rules')) {
      return { data: { success: true, data: details.map(({ actions: _a, conditions: _c, ...rest }) => rest), meta: { totalPages: 1 } } };
    }
    throw new Error(`unexpected ${url}`);
  });
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

async function loadReplies(details: Array<Record<string, unknown>>): Promise<KeywordReply[]> {
  mockRules(details);
  const { result } = renderHook(() => useKeywordReplies(), { wrapper });
  await waitFor(() => assert.equal(result.current.replies.length, details.length));
  return result.current.replies;
}

beforeEach(() => {
  materialInfo = {};
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({ data: { success: true } });
  api.patch.mockReset().mockResolvedValue({ data: { success: true } });
});
afterEach(cleanup);

const lastPatchBody = () => api.patch.mock.calls.at(-1)?.[1] as Record<string, any>;

test('編輯含其他動作的關鍵字回覆：保留加標籤與其他條件，多了「對話渠道等於 LINE」', async () => {
  const [reply] = await loadReplies([ruleDetail()]);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', channel: 'LINE', materialId: 'm-1', couponId: null, failureText: '' });

  const body = lastPatchBody();
  assert.equal(api.patch.mock.calls.at(-1)?.[0], '/automation/rules/r1');
  assert.deepEqual(body.trigger, { type: 'keyword.matched', keywords: ['價格', '多少錢'], match_mode: 'any' });
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-1' } },
    { type: 'add_tag', params: { tagName: '詢價' } },
  ]);
  assert.deepEqual(body.conditions, { all: [VIP_CONDITION, LINE_CONDITION] });
});

test('編輯含發券動作的關鍵字回覆：仍有發送優惠券動作，couponId 不變', async () => {
  const [reply] = await loadReplies([
    ruleDetail({
      conditions: { all: [LINE_CONDITION] },
      actions: [
        { type: 'send_material', params: { materialId: 'm-1' } },
        { type: 'issue_coupon', params: { couponId: 'coupon-1', failureText: '您已經領過這張券囉' } },
      ],
    }),
  ]);
  assert.equal(reply.couponId, 'coupon-1');
  assert.equal(reply.failureText, '您已經領過這張券囉');

  await updateKeywordReply(reply, {
    name: '詢價', keywords: ['領券'], matchMode: 'any', channel: 'LINE',
    materialId: reply.materialId, couponId: reply.couponId, failureText: reply.failureText,
  });

  const body = lastPatchBody();
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-1' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-1', failureText: '您已經領過這張券囉' } },
  ]);
  assert.deepEqual(body.conditions, { all: [LINE_CONDITION] }, '已有 LINE 條件時不重複加');
});

test('從清單選券：建立的規則有 issue_coupon，並帶條件「對話渠道等於 LINE」', async () => {
  await createKeywordReply({ name: '秋季領券', keywords: ['領券'], matchMode: 'any', channel: 'LINE', materialId: 'm-1', couponId: 'coupon-1', failureText: '' });

  const body = api.post.mock.calls.at(-1)?.[1] as Record<string, any>;
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-1' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-1' } },
  ]);
  assert.deepEqual(body.conditions, { all: [LINE_CONDITION] });
});

test('只發券的關鍵字規則：規則只有 issue_coupon，列表列出這條規則', async () => {
  await createKeywordReply({ name: '只發券', keywords: ['領券'], matchMode: 'any', channel: 'LINE', materialId: null, couponId: 'coupon-1', failureText: '' });
  const body = api.post.mock.calls.at(-1)?.[1] as Record<string, any>;
  assert.deepEqual(body.actions, [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }]);

  const replies = await loadReplies([
    ruleDetail({ id: 'r2', name: '只發券', actions: [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }] }),
  ]);
  assert.equal(replies[0].name, '只發券');
  assert.equal(replies[0].materialId, null);
  assert.equal(replies[0].couponId, 'coupon-1');
});

test('拿掉素材：只移除傳送素材，其他動作保留', async () => {
  const [reply] = await loadReplies([
    ruleDetail({
      actions: [
        { type: 'send_material', params: { materialId: 'm-1' } },
        { type: 'add_tag', params: { tagName: '詢價' } },
        { type: 'issue_coupon', params: { couponId: 'coupon-1' } },
      ],
    }),
  ]);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'LINE', materialId: null, couponId: 'coupon-2', failureText: '' });

  assert.deepEqual(lastPatchBody().actions, [
    { type: 'add_tag', params: { tagName: '詢價' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-2' } },
  ]);
});

test('任一條件群組：LINE 條件與原本的群組都要成立', async () => {
  const [reply] = await loadReplies([ruleDetail({ conditions: { any: [VIP_CONDITION] } })]);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'LINE', materialId: 'm-1', couponId: null, failureText: '' });

  assert.deepEqual(lastPatchBody().conditions, { all: [LINE_CONDITION, { any: [VIP_CONDITION] }] });
});

// ── 傳送的素材不是 LINE 素材（PR #364 第二輪審查）──────────────────────────
// 修正前：這頁存檔一律加上「對話渠道等於 LINE」。在一般自動化規則建的「關鍵字＋Facebook 素材」規則
// 出現在這頁時，只改關鍵字就存檔，規則會變成只在 LINE 觸發、卻送 Facebook 素材，從此不再送出。

test('傳送 Facebook 素材的規則不能在這頁存檔：規則限定 LINE、素材是 Facebook，標示原因並擋下，不改規則', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [LINE_CONDITION] }, actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  assert.equal(reply.channel, 'LINE');
  assert.deepEqual(reply.materialIssue, { kind: 'other_channel', channelLabel: 'Facebook', ruleChannelLabel: 'LINE' });

  await assert.rejects(
    updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', channel: 'LINE', materialId: 'm-fb', couponId: null, failureText: '' }),
    /這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯/,
  );
  assert.equal(api.patch.mock.calls.length, 0, '不送出：規則沒有被修改');
});

test('傳送 Facebook 素材的規則改選 LINE 素材：可以儲存', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'LINE', materialId: 'm-1', couponId: null, failureText: '' });
  assert.deepEqual(lastPatchBody().actions, [{ type: 'send_material', params: { materialId: 'm-1' } }]);
});

test('素材已刪除或已停用：標示原因，沒有改選素材就不能儲存', async () => {
  materialInfo = { 'm-gone': 'not_found', 'm-off': { channelType: 'line', isActive: false } };
  const replies = await loadReplies([
    ruleDetail({ id: 'r-gone', actions: [{ type: 'send_material', params: { materialId: 'm-gone' } }] }),
    ruleDetail({ id: 'r-off', actions: [{ type: 'send_material', params: { materialId: 'm-off' } }] }),
  ]);
  const gone = replies.find((r) => r.id === 'r-gone')!;
  const off = replies.find((r) => r.id === 'r-off')!;
  assert.deepEqual(gone.materialIssue, { kind: 'missing' });
  assert.deepEqual(off.materialIssue, { kind: 'inactive' });
  await assert.rejects(
    updateKeywordReply(gone, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'LINE', materialId: 'm-gone', couponId: null, failureText: '' }),
    /素材已刪除/,
  );
  assert.equal(api.patch.mock.calls.length, 0);
});

test('LINE 素材的規則：沒有標示，照常儲存', async () => {
  const [reply] = await loadReplies([ruleDetail()]);
  assert.equal(reply.materialIssue, null);
});

// ── 列表在切換或存檔後立即更新（change add-fb-ig-keyword-coupon design D6）──────────────
// 修正前：畫面的啟用狀態、關鍵字來自規則明細的快取（key 只看規則 id），切換或存檔後頁面只重新載入列表，
// 規則 id 沒變，明細沿用快取，要重新整理才更新（PR #364 bot 審查「規則明細快取在更新或刪除後沒有失效」）。

test('停用後列表顯示停用：重新載入後顯示後端的新狀態', async () => {
  const rules: Array<Record<string, unknown>> = [ruleDetail()];
  mockRules(rules);
  const { result } = renderHook(() => useKeywordReplies(), { wrapper });
  await waitFor(() => assert.equal(result.current.replies.length, 1));
  assert.equal(result.current.replies[0].isActive, true);

  rules[0] = { ...rules[0], isActive: false }; // 後端已停用
  await act(async () => { await result.current.mutate(); });

  await waitFor(() => assert.equal(result.current.replies[0]?.isActive, false));
});

test('存檔後列表顯示新的關鍵字：重新載入後顯示規則明細的新內容', async () => {
  const rules: Array<Record<string, unknown>> = [ruleDetail()];
  mockRules(rules);
  const { result } = renderHook(() => useKeywordReplies(), { wrapper });
  await waitFor(() => assert.equal(result.current.replies.length, 1));

  rules[0] = { ...rules[0], trigger: { type: 'keyword.matched', keywords: ['價格', '多少錢'], match_mode: 'any' } };
  await act(async () => { await result.current.mutate(); });

  await waitFor(() => assert.deepEqual(result.current.replies[0]?.keywords, ['價格', '多少錢']));
});

// ── 關鍵字回覆依所選渠道觸發（change add-fb-ig-keyword-coupon design D2、D4、D5）─────────────
// 修正前：這頁存檔一律加上「對話渠道等於 LINE」，FB 與 Instagram 無處設定關鍵字發券。

test('建立時選 Facebook：規則有條件「對話渠道等於 FB」', async () => {
  await createKeywordReply({ name: 'FB 領券', keywords: ['領券'], matchMode: 'any', channel: 'FB', materialId: 'm-fb', couponId: 'coupon-1', failureText: '' });
  const body = api.post.mock.calls.at(-1)?.[1] as Record<string, any>;
  assert.deepEqual(body.conditions, { all: [FB_CONDITION] });
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-fb' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-1' } },
  ]);
});

test('Instagram 的關鍵字回覆只發券：規則只有 issue_coupon，條件為「對話渠道等於 THREADS」', async () => {
  await createKeywordReply({ name: 'IG 領券', keywords: ['領券'], matchMode: 'any', channel: 'THREADS', materialId: null, couponId: 'coupon-1', failureText: '' });
  const body = api.post.mock.calls.at(-1)?.[1] as Record<string, any>;
  assert.deepEqual(body.conditions, { all: [IG_CONDITION] });
  assert.deepEqual(body.actions, [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }]);
});

test('編輯 Facebook 的關鍵字回覆：條件仍只有一個「對話渠道等於 FB」，沒有被加上 LINE 條件', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [FB_CONDITION] }, actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  assert.equal(reply.channel, 'FB');
  assert.equal(reply.materialIssue, null);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', channel: 'FB', materialId: 'm-fb', couponId: null, failureText: '' });
  assert.deepEqual(lastPatchBody().conditions, { all: [FB_CONDITION] });
});

test('已有渠道的規則不能改渠道：換成別的渠道就擋下，不送出', async () => {
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [LINE_CONDITION] } })]);
  await assert.rejects(
    updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'FB', materialId: null, couponId: 'coupon-1', failureText: '' }),
    /渠道建立後不能更改/,
  );
  assert.equal(api.patch.mock.calls.length, 0);
});

test('沒有渠道條件的舊規則：預設為素材的渠道 LINE，儲存後多了 LINE 條件，素材與其他動作不變', async () => {
  const [reply] = await loadReplies([ruleDetail()]);
  assert.equal(reply.channel, null);
  assert.equal(reply.defaultChannel, 'LINE');

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: reply.defaultChannel, materialId: 'm-1', couponId: null, failureText: '' });
  const body = lastPatchBody();
  assert.deepEqual(body.conditions, { all: [VIP_CONDITION, LINE_CONDITION] });
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-1' } },
    { type: 'add_tag', params: { tagName: '詢價' } },
  ]);
});

test('沒有渠道條件的舊規則、沒有素材：預設為 LINE', async () => {
  const [reply] = await loadReplies([ruleDetail({ conditions: null, actions: [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }] })]);
  assert.equal(reply.defaultChannel, 'LINE');
});

test('沒有渠道條件、傳送 Facebook 素材的舊規則：預設為 Facebook，只改關鍵字就能儲存，多了 FB 條件', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [] }, actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  assert.equal(reply.channel, null);
  assert.equal(reply.defaultChannel, 'FB');
  assert.equal(reply.materialIssue, null);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', channel: 'FB', materialId: 'm-fb', couponId: null, failureText: '' });
  assert.deepEqual(lastPatchBody().conditions, { all: [FB_CONDITION] });
});

test('沒有渠道條件、傳送 Facebook 素材的舊規則改選 LINE 渠道卻沒改素材：擋下並說明', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [] }, actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  assert.equal(
    keywordReplySaveBlock(reply, { channel: 'LINE', materialId: 'm-fb' }),
    '這條規則傳送的是 Facebook 素材，與所選渠道 LINE 不符，請改選素材或到自動化規則編輯',
  );
  assert.equal(keywordReplySaveBlock(reply, { channel: 'FB', materialId: 'm-fb' }), null);
});

test('渠道條件這頁無法辨識：標示原因，儲存時擋下，不改規則', async () => {
  const webchat = { fact: 'conversation.channelType', operator: 'equal', value: 'WEBCHAT' };
  const replies = await loadReplies([
    ruleDetail({ id: 'r-web', conditions: { all: [webchat] } }),
    ruleDetail({ id: 'r-two', conditions: { all: [LINE_CONDITION, FB_CONDITION] } }),
    ruleDetail({ id: 'r-not', conditions: { all: [{ ...LINE_CONDITION, operator: 'notEqual' }] } }),
  ]);
  for (const reply of replies) {
    assert.equal(reply.channel, null, reply.id);
    assert.equal(reply.channelIssue, true, reply.id);
    await assert.rejects(
      updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', channel: 'LINE', materialId: 'm-1', couponId: null, failureText: '' }),
      /這條規則的渠道條件這頁不能編輯，請到自動化規則編輯/,
    );
  }
  assert.equal(api.patch.mock.calls.length, 0);
});

test('列表顯示每條規則的渠道：hook 讀出 LINE、FB、THREADS 與未限定渠道', async () => {
  const replies = await loadReplies([
    ruleDetail({ id: 'r-line', conditions: { all: [LINE_CONDITION] } }),
    ruleDetail({ id: 'r-fb', conditions: { all: [FB_CONDITION] }, actions: [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }] }),
    ruleDetail({ id: 'r-ig', conditions: { all: [IG_CONDITION, VIP_CONDITION] }, actions: [{ type: 'issue_coupon', params: { couponId: 'coupon-1' } }] }),
    ruleDetail({ id: 'r-none', conditions: null }),
  ]);
  const channelOf = (id: string) => replies.find((r) => r.id === id)!.channel;
  assert.equal(channelOf('r-line'), 'LINE');
  assert.equal(channelOf('r-fb'), 'FB');
  assert.equal(channelOf('r-ig'), 'THREADS');
  assert.equal(channelOf('r-none'), null);
  assert.equal(replies.find((r) => r.id === 'r-ig')!.channelIssue, false);
});
