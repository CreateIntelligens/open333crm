/**
 * Gemini 向量化的 client（spec embedding-settings「Gemini 向量化」）。
 *
 * 外部呼叫的最低邊界是 fetch，所以測試換掉 fetch，保留 embedText() 的真實程式。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import { embedText, type EmbeddingTarget } from '#src/modules/embedding/embedding-client.js';

const OFF = { enabled: false };
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

type Call = { url: string; headers: Record<string, string>; body: any };
let calls: Call[];
let responses: Array<() => Response>;

function vector(n = 1024): number[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 0.5 : 0));
}

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses.shift();
    return next ? next() : Response.json({ embedding: { values: vector() } });
  });
});

afterEach(() => vi.unstubAllGlobals());

function gemini(purpose: EmbeddingTarget['purpose'], apiKey = 'tenant-key'): EmbeddingTarget {
  return { provider: 'gemini', baseUrl: 'http://ollama:11434', model: 'gemini-embedding-001', apiKey, purpose };
}

describe('Gemini 向量化', () => {
  test('文章以 Gemini 向量化', async () => {
    const v = await embedText(gemini('document'), OFF, '標題: 怎麼建立自動化規則');
    assert.equal(v.length, 1024);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GEMINI_URL);
    assert.equal(calls[0].headers['x-goog-api-key'], 'tenant-key');
    assert.equal(calls[0].body.outputDimensionality, 1024);
    assert.equal(calls[0].body.taskType, 'RETRIEVAL_DOCUMENT');
    assert.equal(calls[0].body.content.parts[0].text, '標題: 怎麼建立自動化規則');
  });

  test('搜尋以 Gemini 向量化查詢文字', async () => {
    await embedText(gemini('query'), OFF, '怎麼設定關鍵字回覆');
    assert.equal(calls[0].body.taskType, 'RETRIEVAL_QUERY');
  });

  test('長文章只送前 2000 字', async () => {
    const text = '字'.repeat(3000);
    const v = await embedText(gemini('document'), OFF, text);
    assert.equal(v.length, 1024);
    assert.equal(calls[0].body.content.parts[0].text.length, 2000);
  });

  test('Gemini 回錯誤時丟錯而且不重試', async () => {
    responses.push(() => new Response('{"error":{"message":"bad"}}', { status: 400 }));
    await assert.rejects(embedText(gemini('document'), OFF, 'x'), /Gemini embed failed \(400\)/);
    assert.equal(calls.length, 1);
  });

  test('Gemini 回 429 時重試 1 次', async () => {
    responses.push(() => new Response('rate limited', { status: 429 }));
    const v = await embedText(gemini('document'), OFF, 'x');
    assert.equal(v.length, 1024);
    assert.equal(calls.length, 2);
  });

  test('向量長度不是 1024 時丟錯', async () => {
    responses.push(() => Response.json({ embedding: { values: vector(768) } }));
    await assert.rejects(embedText(gemini('document'), OFF, 'x'), /1024/);
  });

  test('沒有金鑰時不呼叫 Gemini', async () => {
    await assert.rejects(
      embedText({ ...gemini('document'), apiKey: undefined }, OFF, 'x'),
      /Gemini 金鑰/,
    );
    assert.equal(calls.length, 0);
  });

  test('Ollama 照舊呼叫 /api/embed', async () => {
    responses.push(() => Response.json({ embeddings: [vector()] }));
    await embedText(
      { provider: 'ollama', baseUrl: 'http://ollama:11434', model: 'bge-m3', purpose: 'document' },
      OFF,
      'x',
    );
    assert.equal(calls[0].url, 'http://ollama:11434/api/embed');
    assert.deepEqual(calls[0].body, { model: 'bge-m3', input: 'x' });
  });
});
