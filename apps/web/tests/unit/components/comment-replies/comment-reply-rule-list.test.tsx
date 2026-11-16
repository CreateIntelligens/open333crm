// @vitest-environment jsdom
/**
 * 留言自動私訊規則列表（tasks 11.2；planning/01-ux.md §3.1、§8.1；design D15 OVER_PLAN_LIMIT）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FB_ID, IG_ID, apiError, makeRule, ok } from './fixtures';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { CommentReplyRuleList } from '#src/components/comment-replies/CommentReplyRuleList.js';

function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const rules = [
  makeRule({ id: 'r1', name: '雙 11 留 +1', priority: 0 }),
  makeRule({
    id: 'r2', name: '詢問價格', priority: 1, channelId: IG_ID,
    channel: { id: IG_ID, channelType: 'THREADS', displayName: '@brand_official' },
    content: { type: 'text', text: '您好，方案價格請看官網' },
  }),
];

const onChanged = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  api.put.mockImplementation(() => ok({ ok: true }));
  api.patch.mockImplementation(() => ok(makeRule()));
  api.delete.mockImplementation(() => Promise.resolve({ status: 204 }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

test('只有檢視權限時沒有建立、排序、刪除與狀態切換', () => {
  render(<CommentReplyRuleList rules={rules.map((r) => ({ ...r, canEdit: false }))} canManage={false} onChanged={onChanged} />);
  absent(screen.queryByRole('link', { name: /建立規則/ }));
  absent(screen.queryByRole('button', { name: /上移/ }));
  absent(screen.queryByRole('button', { name: /下移/ }));
  absent(screen.queryByRole('button', { name: /刪除/ }));
  absent(screen.queryByRole('button', { name: /停用規則|啟用規則/ }));
  assert.equal(screen.getAllByRole('link', { name: '查看' }).length, 2);
  assert.equal(screen.getAllByRole('link', { name: '查看紀錄' }).length, 2);
});

test('有管理權限時可以排序，送出可編輯規則的完整順序', async () => {
  render(<CommentReplyRuleList rules={rules} canManage onChanged={onChanged} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '下移「雙 11 留 +1」' }));
  });
  assert.equal(api.put.mock.calls[0][0], '/comment-replies/rules/order');
  assert.deepEqual(api.put.mock.calls[0][1], { ids: ['r2', 'r1'] });
  assert.equal(onChanged.mock.calls.length, 1);
});

test('排序時清單已變更（409）提示重新整理', async () => {
  api.put.mockRejectedValueOnce(apiError(409, 'RULE_ORDER_MISMATCH', '規則清單已變更'));
  render(<CommentReplyRuleList rules={rules} canManage onChanged={onChanged} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '上移「詢問價格」' }));
  });
  screen.getByText('規則清單已變更，已重新載入，請再調整一次順序');
});

test('切換啟用狀態呼叫 /rules/:id/active，上限錯誤顯示原因', async () => {
  api.patch.mockRejectedValueOnce(
    apiError(403, 'PLAN_LIMIT_EXCEEDED', '啟用中的留言規則已達方案上限', { limitKey: 'maxCommentReplyRules', current: 3, max: 3 }),
  );
  render(<CommentReplyRuleList rules={[makeRule({ id: 'r9', isActive: false })]} canManage onChanged={onChanged} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '啟用規則「雙 11 留 +1」' }));
  });
  assert.equal(api.patch.mock.calls[0][0], '/comment-replies/rules/r9/active');
  assert.deepEqual(api.patch.mock.calls[0][1], { isActive: true });
  screen.getByText(/已達方案上限（3 條）/);
});

test('空狀態 F：有管理權限時提供建立第一條規則', () => {
  render(<CommentReplyRuleList rules={[]} canManage onChanged={onChanged} />);
  screen.getByText('尚未建立任何留言自動私訊規則');
  screen.getByText('顧客在貼文留言出現關鍵字時，系統會自動私訊他一則訊息。');
  const link = screen.getByRole('link', { name: '建立第一條規則' });
  assert.equal(link.getAttribute('href'), '/dashboard/comment-replies/new');
});

test('空狀態 F：只有檢視權限時不顯示建立按鈕', () => {
  render(<CommentReplyRuleList rules={[]} canManage={false} onChanged={onChanged} />);
  screen.getByText('尚未建立任何留言自動私訊規則');
  absent(screen.queryByRole('link', { name: '建立第一條規則' }));
});

test('OVER_PLAN_LIMIT 警示顯示在規則名稱下方', () => {
  render(<CommentReplyRuleList rules={[makeRule({ warnings: ['OVER_PLAN_LIMIT'] })]} canManage onChanged={onChanged} />);
  screen.getByText('啟用中的規則已超過方案上限：既有規則照常生效，但不能再啟用其他規則');
});

test('近 7 天的數字可點，跳到觸發紀錄並帶入規則與狀態篩選', () => {
  render(<CommentReplyRuleList rules={[rules[0]]} canManage onChanged={onChanged} />);
  const row = screen.getByText('雙 11 留 +1').closest('tr') as HTMLElement;
  const failed = within(row).getByRole('link', { name: '失敗 2' });
  assert.equal(failed.getAttribute('href'), '/dashboard/comment-replies?tab=logs&ruleId=r1&status=FAILED');
  within(row).getByRole('link', { name: '送出 128' });
});

test('渠道篩選只顯示該渠道的規則', () => {
  render(<CommentReplyRuleList rules={rules} canManage onChanged={onChanged} channelFilter={FB_ID} />);
  screen.getByText('雙 11 留 +1');
  absent(screen.queryByText('詢問價格'));
});

test('刪除前確認，送出 DELETE', async () => {
  render(<CommentReplyRuleList rules={[rules[0]]} canManage onChanged={onChanged} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '刪除「雙 11 留 +1」' }));
  });
  assert.ok(vi.mocked(window.confirm).mock.calls.length === 1);
  assert.equal(api.delete.mock.calls[0][0], '/comment-replies/rules/r1');
});
