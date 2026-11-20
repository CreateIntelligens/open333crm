// @vitest-environment jsdom
/**
 * 後台助理面板（change add-dashboard-guide-assistant，規格 dashboard-guide-assistant）。
 * 替換 API、路由、登入成員的權限與導覽執行器。導覽執行器本身的行為在 tests/unit/lib/guide/guide-runner.test.ts。
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, auth, router, runner } = vi.hoisted(() => ({
  api: { post: vi.fn() },
  auth: { canUse: true },
  router: { push: vi.fn() },
  runner: { runGuide: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  usePermission: (code: string) => (code === 'assistant.use' ? auth.canUse : false),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/dashboard/inbox' }));
vi.mock('#src/lib/guide/guide-runner.js', () => runner);

import { GuideAssistantPanel } from '#src/components/ai/GuideAssistantPanel.js';

const GUIDE = {
  id: 'keyword-reply.create',
  title: '新增關鍵字自動回覆',
  route: '/dashboard/line/keyword-replies',
  requiredPermission: 'automation.manage',
  steps: [{ target: 'keyword-reply.keyword', action: 'highlight', note: '輸入關鍵字' }],
};

function answer(guide: typeof GUIDE | null) {
  api.post.mockResolvedValueOnce({
    data: { data: { answer: '到關鍵字回覆頁按新增。', guide, sources: [{ id: 'a1', title: '關鍵字自動回覆' }] } },
  });
}

async function askQuestion() {
  fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
  fireEvent.change(screen.getByLabelText('輸入問題'), { target: { value: '怎麼設定關鍵字自動回覆？' } });
  fireEvent.click(screen.getByRole('button', { name: '送出問題' }));
  await screen.findByText('到關鍵字回覆頁按新增。');
}

beforeEach(() => {
  auth.canUse = true;
  api.post.mockReset();
  router.push.mockReset();
  runner.runGuide.mockReset();
});

describe('員工按下「帶我去」後才執行導覽', () => {
  test('回應有導覽時顯示帶我去', async () => {
    answer(GUIDE);
    render(<GuideAssistantPanel />);
    await askQuestion();
    const [, body] = api.post.mock.calls[0];
    assert.equal(body.message, '怎麼設定關鍵字自動回覆？');
    assert.equal(body.currentPath, '/dashboard/inbox');
    assert.ok(screen.getByRole('button', { name: '帶我去' }));
    assert.equal(router.push.mock.calls.length, 0, '按下按鈕前不切換頁面');
    assert.equal(runner.runGuide.mock.calls.length, 0, '按下按鈕前不執行導覽');
  });

  test('回應沒有導覽時不顯示帶我去', async () => {
    answer(null);
    render(<GuideAssistantPanel />);
    await askQuestion();
    assert.ok(screen.queryByRole('button', { name: '帶我去' }) === null);
  });

  test('按下帶我去後執行導覽', async () => {
    answer(GUIDE);
    runner.runGuide.mockResolvedValueOnce({ ok: true });
    render(<GuideAssistantPanel />);
    await askQuestion();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    });
    assert.equal(runner.runGuide.mock.calls.length, 1);
    const [guide, deps] = runner.runGuide.mock.calls[0];
    assert.equal(guide.id, 'keyword-reply.create');
    assert.equal(deps.currentPath, '/dashboard/inbox');
    deps.navigate('/dashboard/line/keyword-replies');
    assert.deepEqual(router.push.mock.calls[0], ['/dashboard/line/keyword-replies']);
  });

  test('找不到欄位', async () => {
    answer(GUIDE);
    runner.runGuide.mockResolvedValueOnce({ ok: false, missingTarget: 'keyword-reply.keyword' });
    render(<GuideAssistantPanel />);
    await askQuestion();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    });
    await waitFor(() => assert.ok(screen.getByText('找不到這個欄位，請依上面的步驟操作。')));
  });
});

describe('沒有 assistant.use 時不顯示助理', () => {
  test('沒有權限的員工', () => {
    auth.canUse = false;
    render(<GuideAssistantPanel />);
    assert.ok(screen.queryByRole('button', { name: '開啟助理' }) === null);
  });
});
