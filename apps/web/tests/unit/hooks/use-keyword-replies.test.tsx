// @vitest-environment jsdom
/**
 * LINE 關鍵字回覆頁的儲存與列表（add-coupon-system A15 15.1、design D25；spec automation-engine
 * 「關鍵字回覆頁保留規則上的其他動作與條件」、coupon-management「關鍵字回覆可以同時發券」）。
 *
 * 修正前：儲存時以固定的 [send_material] 覆蓋整個 actions 與 conditions，規則上的發券、加標籤與其他條件被刪掉；
 * 規則也沒有渠道條件，在 FB、IG、網站客服的對話也會觸發。
 */
import assert from 'node:assert/strict';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import {
  createKeywordReply,
  updateKeywordReply,
  useKeywordReplies,
  type KeywordReply,
} from '#src/hooks/useKeywordReplies.js';

const LINE_CONDITION = { fact: 'conversation.channelType', operator: 'equal', value: 'LINE' };
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

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', materialId: 'm-1', couponId: null, failureText: '' });

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
    name: '詢價', keywords: ['領券'], matchMode: 'any',
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
  await createKeywordReply({ name: '秋季領券', keywords: ['領券'], matchMode: 'any', materialId: 'm-1', couponId: 'coupon-1', failureText: '' });

  const body = api.post.mock.calls.at(-1)?.[1] as Record<string, any>;
  assert.deepEqual(body.actions, [
    { type: 'send_material', params: { materialId: 'm-1' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-1' } },
  ]);
  assert.deepEqual(body.conditions, { all: [LINE_CONDITION] });
});

test('只發券的關鍵字規則：規則只有 issue_coupon，列表列出這條規則', async () => {
  await createKeywordReply({ name: '只發券', keywords: ['領券'], matchMode: 'any', materialId: null, couponId: 'coupon-1', failureText: '' });
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

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', materialId: null, couponId: 'coupon-2', failureText: '' });

  assert.deepEqual(lastPatchBody().actions, [
    { type: 'add_tag', params: { tagName: '詢價' } },
    { type: 'issue_coupon', params: { couponId: 'coupon-2' } },
  ]);
});

test('任一條件群組：LINE 條件與原本的群組都要成立', async () => {
  const [reply] = await loadReplies([ruleDetail({ conditions: { any: [VIP_CONDITION] } })]);

  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', materialId: 'm-1', couponId: null, failureText: '' });

  assert.deepEqual(lastPatchBody().conditions, { all: [LINE_CONDITION, { any: [VIP_CONDITION] }] });
});

// ── 傳送的素材不是 LINE 素材（PR #364 第二輪審查）──────────────────────────
// 修正前：這頁存檔一律加上「對話渠道等於 LINE」。在一般自動化規則建的「關鍵字＋Facebook 素材」規則
// 出現在這頁時，只改關鍵字就存檔，規則會變成只在 LINE 觸發、卻送 Facebook 素材，從此不再送出。

test('傳送 Facebook 素材的規則：標示原因，儲存時擋下，不改規則', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ conditions: { all: [] }, actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  assert.deepEqual(reply.materialIssue, { kind: 'other_channel', channelLabel: 'Facebook' });

  await assert.rejects(
    updateKeywordReply(reply, { name: '詢價', keywords: ['價格', '多少錢'], matchMode: 'any', materialId: 'm-fb', couponId: null, failureText: '' }),
    /Facebook 素材.*自動化規則/,
  );
  assert.equal(api.patch.mock.calls.length, 0, '不送出：不會被加上 LINE 條件而靜默失效');
});

test('傳送 Facebook 素材的規則改選 LINE 素材：可以儲存', async () => {
  materialInfo = { 'm-fb': { channelType: 'fb', isActive: true } };
  const [reply] = await loadReplies([ruleDetail({ actions: [{ type: 'send_material', params: { materialId: 'm-fb' } }] })]);
  await updateKeywordReply(reply, { name: '詢價', keywords: ['價格'], matchMode: 'any', materialId: 'm-1', couponId: null, failureText: '' });
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
    updateKeywordReply(gone, { name: '詢價', keywords: ['價格'], matchMode: 'any', materialId: 'm-gone', couponId: null, failureText: '' }),
    /素材已刪除/,
  );
  assert.equal(api.patch.mock.calls.length, 0);
});

test('LINE 素材的規則：沒有標示，照常儲存', async () => {
  const [reply] = await loadReplies([ruleDetail()]);
  assert.equal(reply.materialIssue, null);
});
