// @vitest-environment jsdom
/**
 * AI 設定頁（Embedding、Chat & Prompt）的載入失敗、儲存失敗與滑桿說明。
 * 問題清單 A01、A06、A07。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { ChatPromptSettings } from '#src/components/knowledge/ChatPromptSettings.js';
import { EmbeddingSettings } from '#src/components/knowledge/EmbeddingSettings.js';

const forbidden = () =>
  Object.assign(new Error('403'), {
    response: {
      status: 403,
      data: { success: false, error: { code: 'FORBIDDEN', message: '權限不足' } },
    },
  });

const chatResponse = {
  settings: {
    provider: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: 'http://open333crm-ollama:11434',
    temperature: 0.3,
    maxTokens: 500,
    chatSystemPrompt: '',
    summarizeSystemPrompt: '',
    clarifySystemPrompt: '',
    modelGuideSystemPrompt: '',
    clarifyThreshold: 0.5,
    clarifyMaxAttempts: 2,
  },
  providers: [{ id: 'ollama', label: 'Ollama' }],
  models: [{ id: 'qwen2.5:3b', label: 'qwen2.5:3b' }],
  health: { ok: true, reachable: true, modelInstalled: true, currentModel: 'qwen2.5:3b' },
  defaults: { chatSystemPrompt: 'd', summarizeSystemPrompt: 'd', clarifySystemPrompt: 'd', modelGuideSystemPrompt: 'd' },
};

function mockChatLoad() {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/settings/chat') return { data: { data: chatResponse } };
    if (url === '/settings/gemini-key') return { data: { data: { configured: false, masked: null } } };
    throw new Error(`unexpected GET ${url}`);
  });
}

let alertSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  alertSpy = vi.fn();
  vi.stubGlobal('alert', alertSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── A01 ──
test('多輪追問門檻滑桿：0 端是很少追問，1 端是幾乎每次追問', async () => {
  mockChatLoad();
  render(<ChatPromptSettings />);
  await screen.findByText('多輪追問（Clarify）');
  // 實際邏輯：相似度 < 門檻 才追問（kb-autoreply.service.ts），所以門檻越高越常追問
  assert.ok(screen.queryByText('0.00（總是追問）') === null);
  assert.ok(screen.queryByText('1.00（從不追問）') === null);
  assert.ok(screen.getByText('0.00（只在查無文章時追問）'));
  assert.ok(screen.getByText('1.00（幾乎每次都追問）'));
});

// ── A06 ──
test('Chat & Prompt 讀取被拒時顯示沒有權限，不顯示寫死的預設值', async () => {
  api.get.mockRejectedValue(forbidden());
  render(<ChatPromptSettings />);
  await screen.findByRole('heading', { name: '沒有權限' });
  assert.ok(screen.queryByText('Provider 與模型') === null);
  assert.ok(screen.queryByDisplayValue('http://localhost:11434') === null);
});

test('Embedding 讀取被拒時顯示沒有權限，不顯示寫死的預設值', async () => {
  api.get.mockRejectedValue(forbidden());
  render(<EmbeddingSettings />);
  await screen.findByRole('heading', { name: '沒有權限' });
  assert.ok(screen.queryByText('模型設定') === null);
  assert.ok(screen.queryByDisplayValue('http://localhost:11434') === null);
});

test('Embedding 讀取因其他原因失敗時顯示原因與重新載入', async () => {
  api.get.mockRejectedValueOnce(
    Object.assign(new Error('500'), {
      response: { status: 500, data: { success: false, error: { code: 'INTERNAL_ERROR', message: '系統發生錯誤' } } },
    }),
  );
  render(<EmbeddingSettings />);
  await screen.findByText(/系統發生錯誤/);
  assert.ok(screen.getByRole('button', { name: '重新載入' }));
  assert.ok(screen.queryByText('模型設定') === null);
});

// ── A07 ──
test('Chat & Prompt 儲存被驗證擋下時，顯示後端給的欄位原因', async () => {
  mockChatLoad();
  api.put.mockRejectedValue(
    Object.assign(new Error('400'), {
      response: {
        status: 400,
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: '輸入內容有誤，請檢查後重新送出',
            details: { issues: [{ path: 'chatSystemPrompt', message: '提示詞不可超過 8000 字' }] },
          },
        },
      },
    }),
  );
  render(<ChatPromptSettings />);
  await screen.findByText('多輪追問（Clarify）');
  fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0]);
  await waitFor(() => assert.equal(alertSpy.mock.calls.length, 1));
  const msg = String(alertSpy.mock.calls[0][0]);
  assert.match(msg, /提示詞不可超過 8000 字/);
});

test('Chat & Prompt 儲存因權限不足失敗時，顯示權限原因', async () => {
  mockChatLoad();
  api.put.mockRejectedValue(forbidden());
  render(<ChatPromptSettings />);
  await screen.findByText('多輪追問（Clarify）');
  fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0]);
  await waitFor(() => assert.equal(alertSpy.mock.calls.length, 1));
  assert.match(String(alertSpy.mock.calls[0][0]), /權限不足/);
});
