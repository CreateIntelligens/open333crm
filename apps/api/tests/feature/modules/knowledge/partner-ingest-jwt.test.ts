/**
 * 成員以 access token 呼叫合作方推送（change fix-partner-ingest-jwt-role，spec km-ingestion
 * 「成員以 JWT 呼叫合作方推送時依角色權限判斷」）。走真實的 auth.plugin 與 requirePermission。
 */
import assert from 'node:assert/strict';
import { afterAll, describe, test } from 'vitest';
import { createKnowledgeFixture, partnerForm } from './knowledge-test-app.js';

const fx = await createKnowledgeFixture('partner-jwt');
afterAll(() => fx.cleanup());

const url = '/api/v1/knowledge/partner-ingest';

async function ingestAs(built: Awaited<ReturnType<typeof fx.buildApp>>, docId: string) {
  const form = partnerForm({ cmd: 'CREATE', DocID: docId, Ver: '1', AI_Q: '問題', AI_A: '答案', Source: 'test' });
  const res = await built.app.inject({
    method: 'POST',
    url,
    headers: { ...form.headers, authorization: `Bearer ${built.token}` },
    payload: form.payload,
  });
  return { status: res.statusCode, body: res.json() as { data: any; error?: { code: string; details?: any } } };
}

describe('成員以 JWT 呼叫合作方推送時依角色權限判斷', () => {
  test('有知識庫進階權限的成員推送文件', async () => {
    const built = await fx.buildApp(fx.A, 'jwt-admin', ['knowledge.view', 'knowledge.manage', 'knowledge.admin'], { realAuth: true });
    const docId = `jwt-admin-${Date.now()}`;
    const res = await ingestAs(built, docId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'created');
    assert.equal(await fx.owner.kmArticle.count({ where: { tenantId: fx.A, externalDocId: docId } }), 1);
  });

  test('沒有知識庫進階權限的成員推送文件', async () => {
    const built = await fx.buildApp(fx.A, 'jwt-manager', ['knowledge.view', 'knowledge.manage'], { realAuth: true });
    const docId = `jwt-manager-${Date.now()}`;
    const res = await ingestAs(built, docId);
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, 'FORBIDDEN');
    assert.equal(res.body.error?.details?.requiredPermission, 'knowledge.admin');
    assert.equal(await fx.owner.kmArticle.count({ where: { tenantId: fx.A, externalDocId: docId } }), 0);
  });
});
