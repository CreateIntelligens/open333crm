/**
 * 知識庫 flow 的副作用時機（change migrate-knowledge-tenant-ctx，spec km-ingestion）。
 *
 * prisma.$transaction 以 mock 模擬，見 tests/support/flow-harness.ts。向量化與儲存服務以注入的函式取代。
 * 單元測試沒有載入內容偵測的模型，所以內容偵測換成接受附件的假函式（測試只送合法的 PDF；feature 測試用真的）。
 */
import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';

vi.mock('#src/modules/upload/upload-validation.js', () => ({
  assertUploadContent: async (input: { clientMime: string }) => ({ accepted: true, detectedMime: input.clientMime, reason: 'test' }),
}));
import { logger } from '@open333crm/core';
import { createFlowLog, mockTransactionPrisma, type FlowLog } from '#tests/support/flow-harness.js';
import { createArticleFlow, ingestPartnerDocFlow } from '#src/modules/knowledge/knowledge.flow.js';
import type { KnowledgeEffects } from '#src/modules/knowledge/knowledge-effects.js';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
const actor = { tenantId: TENANT_ID, agentId: 'agent-1' };
const data = { title: '退貨規則', content: '七天內可退貨' };

/** 建立文章時記一筆 'create' */
function articleTx(log: FlowLog) {
  return {
    kmArticle: {
      create: async () => {
        log.entries.push('create');
        return { id: 'article-1', tenantId: TENANT_ID, ...data };
      },
    },
  };
}

/** callback 跑完之後 commit 失敗（例如序列化衝突），交易 rollback */
function failingCommitPrisma(log: FlowLog, tx: Record<string, unknown>) {
  return {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      await cb({ $executeRaw: async () => 1, ...tx });
      log.entries.push('rollback');
      throw new Error('commit failed');
    },
  } as never;
}

function recordingEffects(log: FlowLog, embedResult: () => Promise<void> = async () => {}) {
  const embed = vi.fn((tenantId: string, articleId: string) => {
    log.entries.push(`embed:${tenantId}:${articleId}`);
    return embedResult();
  });
  const remove = vi.fn(async (key: string) => {
    log.entries.push(`remove:${key}`);
  });
  const upload = vi.fn(async () => ({ key: 'k', url: 'u' }));
  return { effects: { embed, storage: { upload, remove } } as unknown as KnowledgeEffects, embed, remove, upload };
}

afterEach(() => vi.restoreAllMocks());

test('commit 之後開始向量化', async () => {
  const log = createFlowLog();
  const { effects, embed } = recordingEffects(log);

  const article = await createArticleFlow({ prisma: mockTransactionPrisma(log, articleTx(log)), effects }, actor, data);

  assert.equal(article.id, 'article-1');
  assert.deepEqual(log.entries, ['create', 'commit', `embed:${TENANT_ID}:article-1`]);
  assert.equal(embed.mock.calls.length, 1);
});

test('rollback 時不開始向量化', async () => {
  const log = createFlowLog();
  const { effects, embed } = recordingEffects(log);

  await assert.rejects(
    createArticleFlow({ prisma: failingCommitPrisma(log, articleTx(log)), effects }, actor, data),
    /commit failed/,
  );

  assert.deepEqual(log.entries, ['create', 'rollback']);
  assert.equal(embed.mock.calls.length, 0);
});

test('向量化失敗不影響回應', async () => {
  const log = createFlowLog();
  const { effects } = recordingEffects(log, async () => {
    throw new Error('embedding service down');
  });
  const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger);

  const article = await createArticleFlow({ prisma: mockTransactionPrisma(log, articleTx(log)), effects }, actor, data);
  await vi.waitFor(() => assert.equal(logged.mock.calls.length, 1));

  assert.equal(article.id, 'article-1');
  assert.match(String(logged.mock.calls[0][0]), /article-1/);
});

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const partnerInput = {
  cmd: 'UPDATE' as const,
  docId: 'DOC-1',
  ver: 2,
  verCreatTime: '',
  aiQ: '問題',
  aiA: '答案',
  source: 'test',
  isAttached: true,
  attachments: [{ buffer: PDF, filename: 'new.pdf', mimeType: 'application/pdf' }],
};

/** 合作方推送：既有的文章 Ver 1、有附件 old-key；交易 2 寫入文章時丟錯 */
function partnerTx(log: FlowLog, opts: { failWrite?: boolean } = {}) {
  return {
    kmArticle: {
      findUnique: async () => ({ id: 'article-1', externalVer: 1, status: 'PUBLISHED' }),
      update: async () => {
        log.entries.push('update');
        if (opts.failWrite) throw new Error('write failed');
        return { id: 'article-1' };
      },
    },
    kmArticleAttachment: {
      findMany: async () => [{ storageKey: 'old-key' }],
      deleteMany: async () => ({ count: 1 }),
      createMany: async () => ({ count: 1 }),
    },
  };
}

test('寫入文章失敗', async () => {
  const log = createFlowLog();
  const { effects, embed, remove, upload } = recordingEffects(log);
  vi.spyOn(logger, 'info').mockImplementation(() => logger);

  await assert.rejects(
    ingestPartnerDocFlow({ prisma: mockTransactionPrisma(log, partnerTx(log, { failWrite: true })), effects }, actor, partnerInput),
    /write failed/,
  );

  assert.equal(upload.mock.calls.length, 1, '附件在交易外上傳');
  assert.equal(remove.mock.calls.length, 0, '沒有刪除檔案');
  assert.equal(embed.mock.calls.length, 0, '沒有開始向量化');
  assert.deepEqual(log.entries, ['commit', 'update', 'rollback']);
});

test('刪除檔案失敗', async () => {
  const log = createFlowLog();
  const { effects, remove } = recordingEffects(log);
  remove.mockImplementation(async (key: string) => {
    log.entries.push(`remove:${key}`);
    throw new Error('storage unavailable');
  });
  vi.spyOn(logger, 'info').mockImplementation(() => logger);
  const logged = vi.spyOn(logger, 'error').mockImplementation(() => logger);

  const result = await ingestPartnerDocFlow({ prisma: mockTransactionPrisma(log, partnerTx(log)), effects }, actor, partnerInput);
  await vi.waitFor(() => assert.equal(logged.mock.calls.length, 1));

  assert.equal(result.status, 'updated');
  assert.deepEqual(remove.mock.calls.map((c) => c[0]), ['old-key']);
  assert.match(String(logged.mock.calls[0][0]), /old-key/);
});

test('寫入失敗時不刪除舊檔案', async () => {
  const log = createFlowLog();
  const { effects, remove, embed } = recordingEffects(log);
  vi.spyOn(logger, 'info').mockImplementation(() => logger);

  // 交易 2 的寫入都完成、拿到舊附件的 key 之後，commit 失敗（例如序列化衝突）
  let txCount = 0;
  const prisma = {
    async $transaction(cb: (t: unknown) => Promise<unknown>) {
      txCount++;
      const result = await cb({ $executeRaw: async () => 1, ...partnerTx(log) });
      if (txCount === 2) {
        log.entries.push('rollback');
        throw new Error('commit failed');
      }
      log.entries.push('commit');
      return result;
    },
  } as never;

  await assert.rejects(ingestPartnerDocFlow({ prisma, effects }, actor, partnerInput), /commit failed/);

  assert.deepEqual(log.entries, ['commit', 'update', 'rollback']);
  assert.equal(remove.mock.calls.length, 0);
  assert.equal(embed.mock.calls.length, 0);
});
