// @vitest-environment jsdom
/**
 * 觸發紀錄分頁（tasks 11.4；planning/01-ux.md §4；design D8 狀態與原因代碼）。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FB_ID, makeRule, ok } from './fixtures';

const { api, auth, nav } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  auth: { granted: new Set<string>() },
  nav: { search: '', replace: vi.fn(), push: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({ usePermission: (code: string) => auth.granted.has(code) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => '/dashboard/comment-replies',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { CommentReplyLogs } from '#src/components/comment-replies/CommentReplyLogs.js';

function absent(el: Element | null, message = '元素不應存在') {
  assert.ok(el === null, `${message}：${el?.outerHTML.slice(0, 200)}`);
}

const channels = [{ channelId: FB_ID, channelType: 'FB', displayName: '品牌粉專' }];
const rules = [makeRule({ id: 'r1' })];

function log(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    reasonCode: null,
    commentId: `c-${id}`,
    commentText: `留言 ${id} +1`,
    commentCreatedAt: '2026-11-13T06:02:00.000Z',
    commenterName: `顧客${id}`,
    matchedKeywords: ['+1'],
    post: { postId: '999_1', excerpt: '雙 11 留言 +1 抽第二杯半價' },
    rule: { id: 'r1', name: '雙 11 留 +1' },
    channel: { id: FB_ID, channelType: 'FB', displayName: '品牌粉專' },
    retryable: false,
    ...extra,
  };
}

let items: Array<ReturnType<typeof log>> = [];
let detail: Record<string, unknown> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  nav.search = 'tab=logs';
  auth.granted = new Set(['comment_reply.view']);
  items = [];
  detail = null;
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/comment-replies/logs/summary')) return ok({ counts: { SENT: 1204, FAILED: 12, EXPIRED: 3, SKIPPED_DUPLICATE: 380 }, failed24h: 3 });
    const one = url.match(/^\/comment-replies\/logs\/([^/?]+)$/);
    if (one) return ok(detail ?? items.find((i) => i.id === one[1]));
    if (url.startsWith('/comment-replies/logs')) {
      if (url.includes('countOnly=true')) return ok({ count: 0 });
      return ok({ items, nextCursor: null });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  api.post.mockImplementation(() => ok({ status: 'PENDING' }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function renderLogs(canManage = false) {
  await act(async () => {
    render(<CommentReplyLogs channels={channels} rules={rules} canManage={canManage} />);
  });
}

function logRequests(): string[] {
  return api.get.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith('/comment-replies/logs?'));
}

describe('狀態顯示', () => {
  test('7 種狀態、排隊中與可能已送達各自的文字', async () => {
    items = [
      log('1', 'PENDING'),
      log('2', 'PENDING', { reasonCode: 'RATE_LIMIT_QUEUED' }),
      log('3', 'SENDING'),
      log('4', 'SENT'),
      log('5', 'SENT', { reasonCode: 'SENT_UNCONFIRMED' }),
      log('6', 'FAILED', { reasonCode: 'USER_UNAVAILABLE' }),
      log('7', 'EXPIRED', { reasonCode: 'WINDOW_EXPIRED' }),
      log('8', 'SKIPPED', { reasonCode: 'MATERIAL_UNAVAILABLE' }),
      log('9', 'SKIPPED_DUPLICATE'),
    ];
    await renderLogs();
    const table = screen.getByRole('table');
    const pills = within(table).getAllByTestId('cr-status-pill').map((el) => el.textContent);
    assert.deepEqual(pills, ['處理中', '排隊中', '處理中', '已送出', '可能已送達', '失敗', '已過期', '略過', '已私訊過']);
    within(table).getByText('顧客無法接收訊息（可能已封鎖粉專或關閉訊息功能）');
    within(table).getByText('留言超過 7 天，無法再私訊');
  });

  test('未知原因代碼顯示通用失敗文字', async () => {
    items = [log('1', 'FAILED', { reasonCode: 'SOMETHING_NEW' })];
    await renderLogs();
    within(screen.getByRole('table')).getByText('送出失敗');
  });

  test('留言內容含 <script> 時以純文字顯示', async () => {
    items = [log('1', 'SENT', { commentText: '<script>window.__x=1</script>+1', matchedKeywords: ['+1'] })];
    await renderLogs();
    absent(document.querySelector('table script'));
    assert.ok(screen.getByRole('table').textContent?.includes('<script>window.__x=1</script>'));
  });

  test('摘要列與空結果提示', async () => {
    await renderLogs();
    screen.getByText(/已送出 1,204/);
    screen.getByText(/還沒有任何留言觸發規則/);
  });
});

describe('篩選', () => {
  test('網址的篩選帶入第一次查詢', async () => {
    nav.search = 'tab=logs&status=EXPIRED&ruleId=r1';
    await renderLogs();
    const first = logRequests()[0];
    assert.ok(first.includes('status=EXPIRED'), first);
    assert.ok(first.includes('ruleId=r1'), first);
  });

  test('切換狀態篩選時同步到網址並重新查詢', async () => {
    await renderLogs();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '失敗', pressed: false }));
    });
    const url = String(nav.replace.mock.calls.at(-1)?.[0]);
    assert.ok(url.startsWith('/dashboard/comment-replies?'), url);
    const params = new URLSearchParams(url.split('?')[1]);
    assert.equal(params.get('tab'), 'logs');
    assert.equal(params.get('status'), 'FAILED');
    assert.ok(logRequests().at(-1)?.includes('status=FAILED'));
  });

  test('處理中篩選同時查 PENDING 與 SENDING', async () => {
    await renderLogs();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '處理中', pressed: false }));
    });
    const last = logRequests().at(-1) ?? '';
    assert.ok(last.includes('status=PENDING') && last.includes('status=SENDING'), last);
  });
});

describe('詳情與重試', () => {
  async function openDetail(name: string) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `查看 ${name} 的紀錄` }));
    });
    return screen.findByRole('dialog', { name: '留言紀錄' });
  }

  test('可重試的失敗且有管理權限時顯示重試，確認文案後送出', async () => {
    items = [log('1', 'FAILED', { reasonCode: 'RATE_LIMITED', retryable: true })];
    await renderLogs(true);
    const drawer = await openDetail('顧客1');
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: '重試' }));
    });
    assert.equal(
      vi.mocked(window.confirm).mock.calls[0][0],
      '確定重新私訊這位留言者？Meta 每則留言只允許私訊一次，若先前其實已送達，這次會失敗。',
    );
    assert.equal(api.post.mock.calls[0][0], '/comment-replies/logs/1/retry');
    await screen.findByText('已重新排入處理');
  });

  test('被月額度略過的紀錄也可以重試', async () => {
    items = [log('1', 'SKIPPED', { reasonCode: 'PLAN_QUOTA_EXCEEDED', retryable: true })];
    await renderLogs(true);
    const drawer = await openDetail('顧客1');
    within(drawer).getByRole('button', { name: '重試' });
  });

  test('不可重試的失敗不顯示重試', async () => {
    items = [log('1', 'FAILED', { reasonCode: 'USER_UNAVAILABLE', retryable: false })];
    await renderLogs(true);
    const drawer = await openDetail('顧客1');
    absent(within(drawer).queryByRole('button', { name: '重試' }));
  });

  test('只有檢視權限時不顯示重試', async () => {
    items = [log('1', 'FAILED', { reasonCode: 'RATE_LIMITED', retryable: true })];
    await renderLogs(false);
    const drawer = await openDetail('顧客1');
    absent(within(drawer).queryByRole('button', { name: '重試' }));
  });

  test('有 inbox.view 時顯示「到收件匣查看對話」', async () => {
    auth.granted.add('inbox.view');
    items = [log('1', 'SENT')];
    detail = { ...log('1', 'SENT'), conversationId: 'conv-1', customerReplied: true, customerRepliedAt: '2026-11-13T06:20:00.000Z' };
    await renderLogs();
    const drawer = await openDetail('顧客1');
    const link = within(drawer).getByRole('link', { name: '到收件匣查看對話' });
    assert.equal(link.getAttribute('href'), '/dashboard/inbox?conv=conv-1');
  });

  test('沒有 inbox.view 時只顯示顧客已回覆，沒有連結', async () => {
    items = [log('1', 'SENT')];
    // 後端在沒有 inbox.view 時不回 conversationId；前端也不能只靠後端
    detail = { ...log('1', 'SENT'), conversationId: 'conv-1', customerReplied: true, customerRepliedAt: '2026-11-13T06:20:00.000Z' };
    await renderLogs();
    const drawer = await openDetail('顧客1');
    within(drawer).getByText(/顧客已回覆/);
    absent(within(drawer).queryByRole('link', { name: '到收件匣查看對話' }));
  });

  test('網址帶 logId 時直接開啟詳情', async () => {
    nav.search = 'tab=logs&logId=1';
    items = [log('1', 'SENT')];
    await renderLogs();
    await screen.findByRole('dialog', { name: '留言紀錄' });
  });
});
