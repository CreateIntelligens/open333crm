// @vitest-environment jsdom
/**
 * Embedding 設定頁的「向量化服務」選項（change add-gemini-embedding-provider，design D6）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('#src/lib/api.js', () => ({ default: api }));

import { EmbeddingSettings } from '#src/components/knowledge/EmbeddingSettings.js';

function response(provider: 'ollama' | 'gemini') {
  return {
    settings: {
      provider,
      baseUrl: 'http://open333crm-ollama:11434',
      model: provider === 'gemini' ? 'gemini-embedding-001' : 'bge-m3',
      topK: 5,
      threshold: 0.3,
    },
    health: { ok: true, reachable: true, modelInstalled: true, currentModel: provider === 'gemini' ? 'gemini-embedding-001' : 'bge-m3' },
    models: provider === 'gemini' ? [{ name: 'gemini-embedding-001' }] : [{ name: 'bge-m3:latest' }],
    stats: { total: 3, embedded: 3, missing: 0 },
    vectorDim: 1024,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
  vi.stubGlobal('alert', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('選 Gemini 時隱藏網址欄位，模型固定是 gemini-embedding-001', async () => {
  api.get.mockResolvedValue({ data: { data: response('ollama') } });
  render(<EmbeddingSettings />);
  const select = await screen.findByLabelText('向量化服務');
  assert.ok(screen.queryByText('Ollama Base URL') !== null);

  fireEvent.change(select, { target: { value: 'gemini' } });

  assert.ok(screen.queryByText('Ollama Base URL') === null, '網址欄位隱藏');
  assert.ok(screen.queryByText('gemini-embedding-001') !== null, '顯示固定的模型');
  assert.ok(screen.queryByText(/計入 AI 用量/) !== null, '顯示用量說明');
});

test('換成 Gemini 儲存時確認後送出 provider 與模型', async () => {
  api.get.mockResolvedValue({ data: { data: response('ollama') } });
  api.put.mockResolvedValue({ data: { data: { modelChanged: true } } });
  render(<EmbeddingSettings />);
  fireEvent.change(await screen.findByLabelText('向量化服務'), { target: { value: 'gemini' } });

  fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0]);
  fireEvent.click(await screen.findByRole('button', { name: '確認切換' }));

  await waitFor(() => assert.equal(api.put.mock.calls.length, 1));
  const [url, body] = api.put.mock.calls[0];
  assert.equal(url, '/settings/embedding');
  assert.equal(body.provider, 'gemini');
  assert.equal(body.model, 'gemini-embedding-001');
});

test('目前是 Gemini 時，狀態卡片不寫 Ollama', async () => {
  api.get.mockResolvedValue({ data: { data: response('gemini') } });
  render(<EmbeddingSettings />);
  await screen.findByLabelText('向量化服務');
  assert.ok(screen.queryByText('Ollama 服務狀態') === null);
  assert.ok(screen.queryByText('向量化服務狀態') !== null);
});
