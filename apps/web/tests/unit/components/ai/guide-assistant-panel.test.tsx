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
  auth: { canUse: true, canViewKnowledge: true },
  router: { push: vi.fn() },
  runner: { runGuide: vi.fn() },
}));
vi.mock('#src/lib/api.js', () => ({ default: api }));
vi.mock('#src/providers/AuthProvider.js', () => ({
  usePermission: (code: string) =>
    code === 'assistant.use' ? auth.canUse : code === 'knowledge.view' ? auth.canViewKnowledge : false,
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
  auth.canViewKnowledge = true;
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
    runner.runGuide.mockResolvedValueOnce({ ok: false, reason: 'missing', missingTarget: 'keyword-reply.keyword' });
    render(<GuideAssistantPanel />);
    await askQuestion();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    });
    await waitFor(() => assert.ok(screen.getByText('找不到這個欄位，請依上面的步驟操作。')));
  });
});

describe('導覽逐步顯示說明卡', () => {
  test('每一步顯示說明卡，完成後關閉', async () => {
    answer(GUIDE);
    let deps!: { showStep: (el: HTMLElement, step: unknown, progress: unknown) => Promise<string> };
    runner.runGuide.mockImplementationOnce(async (_guide, d) => {
      deps = d;
      return new Promise(() => {});
    });
    render(<GuideAssistantPanel />);
    await askQuestion();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    });
    const field = document.createElement('input');
    document.body.appendChild(field);
    let outcome!: Promise<string>;
    await act(async () => {
      outcome = deps.showStep(field, GUIDE.steps[0], { index: 1, total: 1 });
    });
    assert.ok(await screen.findByText('第 1 / 1 步'));
    assert.ok(screen.getByText('輸入關鍵字'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '完成' }));
    });
    assert.equal(await outcome, 'next');
    assert.ok(screen.queryByText('第 1 / 1 步') === null, '說明卡關閉');
    field.remove();
  });

  test('員工中途結束導覽', async () => {
    answer(GUIDE);
    runner.runGuide.mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
    render(<GuideAssistantPanel />);
    await askQuestion();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    });
    assert.ok(screen.queryByRole('region', { name: '後台助理' }) === null, '面板不重新打開');
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    assert.ok(screen.queryByText('找不到這個欄位，請依上面的步驟操作。') === null);
  });
});

describe('面板的對話', () => {
  test('關閉面板後不顯示舊請求的回覆', async () => {
    let resolve!: (value: unknown) => void;
    api.post.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<GuideAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    fireEvent.change(screen.getByLabelText('輸入問題'), { target: { value: '怎麼設定關鍵字自動回覆？' } });
    fireEvent.click(screen.getByRole('button', { name: '送出問題' }));
    fireEvent.click(screen.getByRole('button', { name: '關閉助理' }));
    await act(async () => {
      resolve({ data: { data: { answer: '舊的答案', guide: null, sources: [] } } });
    });
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    assert.ok(screen.queryByText('舊的答案') === null);
    assert.ok(screen.queryByText('怎麼設定關鍵字自動回覆？') === null);
  });

  test('導覽期間關閉面板後，導覽失敗不重新打開面板', async () => {
    answer(GUIDE);
    let finish!: (value: unknown) => void;
    runner.runGuide.mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(<GuideAssistantPanel />);
    await askQuestion();
    fireEvent.click(screen.getByRole('button', { name: '帶我去' }));
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    fireEvent.click(screen.getByRole('button', { name: '關閉助理' }));
    await act(async () => {
      finish({ ok: false, reason: 'missing', missingTarget: 'keyword-reply.keyword' });
    });
    assert.ok(screen.queryByRole('region', { name: '後台助理' }) === null, '面板維持關閉');
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    assert.ok(screen.queryByText('找不到這個欄位，請依上面的步驟操作。') === null);
  });

  test('歷史訊息每則最多 2000 字', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { answer: '長'.repeat(3000), guide: null, sources: [] } } });
    render(<GuideAssistantPanel />);
    fireEvent.click(screen.getByRole('button', { name: '開啟助理' }));
    fireEvent.change(screen.getByLabelText('輸入問題'), { target: { value: '第一題' } });
    fireEvent.click(screen.getByRole('button', { name: '送出問題' }));
    await screen.findByText('長'.repeat(3000));
    answer(null);
    fireEvent.change(screen.getByLabelText('輸入問題'), { target: { value: '第二題' } });
    fireEvent.click(screen.getByRole('button', { name: '送出問題' }));
    await screen.findByText('到關鍵字回覆頁按新增。');
    const [, body] = api.post.mock.calls[1];
    assert.ok(body.history.every((h: { content: string }) => h.content.length <= 2000));
    assert.equal(body.history.length, 2);
  });
});

describe('沒有 assistant.use 時不顯示助理', () => {
  test('沒有權限的員工', () => {
    auth.canUse = false;
    render(<GuideAssistantPanel />);
    assert.ok(screen.queryByRole('button', { name: '開啟助理' }) === null);
  });

  test('沒有 knowledge.view 的員工', () => {
    auth.canViewKnowledge = false;
    render(<GuideAssistantPanel />);
    assert.ok(screen.queryByRole('button', { name: '開啟助理' }) === null);
  });
});
