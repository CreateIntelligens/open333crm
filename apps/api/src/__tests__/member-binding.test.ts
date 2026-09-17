/**
 * 會員綁定測試（design D5、tasks 5.6）。跑法：
 *   DATABASE_URL=... npx tsx src/__tests__/member-binding.test.ts
 *
 * 用本機 http server 模擬客戶的會員 API —— 三種失敗情境
 * （無回應／回錯／查無會員）必須真的走過網路層才測得到分類是否正確。
 */
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { lookupMember } from '../modules/member-binding/member-lookup.service.js';
import {
  saveBindingConfig,
  bindMember,
  getBinding,
  unbindMember,
} from '../modules/member-binding/member-binding.service.js';
import type { MemberBindingConfig } from '../modules/member-binding/member-binding.types.js';

const prisma = new PrismaClient();
let pass = 0;
let fail = 0;

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

/** 模擬客戶的會員 API，涵蓋各種回應樣態。 */
function startMockApi(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const id = url.searchParams.get('id') ?? '';

      if (url.pathname === '/slow') {
        // 不回應，觸發逾時
        return;
      }
      if (url.pathname === '/error') {
        res.writeHead(500); res.end('boom'); return;
      }
      if (url.pathname === '/notjson') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not json'); return;
      }
      if (url.pathname === '/404') {
        res.writeHead(404); res.end('{}'); return;
      }
      // 200 + 空資料表示查無（常見於實際客戶 API）
      if (id === 'MISSING') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', data: null })); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        data: { member_no: `M-${id}`, name: '王小明', level: 'GOLD' },
      }));
    });
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

async function main() {
  const { server, port } = await startMockApi();
  const base = `http://127.0.0.1:${port}`;

  const config = (path = '/member'): MemberBindingConfig => ({
    enabled: true,
    endpoint: `${base}${path}?id={{memberId}}`,
    method: 'GET',
    auth: { type: 'bearer', credential: 'secret' },
    fieldMapping: { memberId: 'data.member_no', name: 'data.name', level: 'data.level' },
    notFoundWhen: { fieldIsEmpty: 'data' },
    timeoutMs: 1000,
  });

  // ── 三種失敗分類（tasks 5.6）──
  await t('外部無回應（逾時）回報 UPSTREAM_UNREACHABLE', async () => {
    const r = await lookupMember(config('/slow'), { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_UNREACHABLE', `實得 ${JSON.stringify(r)}`);
  });

  await t('連線失敗回報 UPSTREAM_UNREACHABLE', async () => {
    const bad = { ...config(), endpoint: 'http://127.0.0.1:1/x?id={{memberId}}' };
    const r = await lookupMember(bad, { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_UNREACHABLE', `實得 ${JSON.stringify(r)}`);
  });

  await t('外部回 500 回報 UPSTREAM_ERROR', async () => {
    const r = await lookupMember(config('/error'), { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
  });

  await t('回應非 JSON 回報 UPSTREAM_ERROR', async () => {
    const r = await lookupMember(config('/notjson'), { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
  });

  await t('外部回 404 回報 MEMBER_NOT_FOUND', async () => {
    const r = await lookupMember(config('/404'), { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
  });

  await t('200 但資料為空回報 MEMBER_NOT_FOUND（非 404 的查無）', async () => {
    const r = await lookupMember(config(), { memberId: 'MISSING' });
    assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
  });

  await t('未啟用時回報 NOT_CONFIGURED', async () => {
    const r = await lookupMember({ ...config(), enabled: false }, { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'NOT_CONFIGURED', `實得 ${JSON.stringify(r)}`);
  });

  await t('查詢成功並依 fieldMapping 取值', async () => {
    const r = await lookupMember(config(), { memberId: 'A1' });
    assert.ok(r.ok, `查詢失敗：${JSON.stringify(r)}`);
    assert.equal(r.memberId, 'M-A1');
    assert.equal(r.attributes.name, '王小明');
    assert.equal(r.attributes.level, 'GOLD');
  });

  await t('fieldMapping 取不到 memberId 時不建立不完整綁定', async () => {
    const bad = { ...config(), fieldMapping: { memberId: 'data.wrong_field' } };
    const r = await lookupMember(bad, { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
  });

  // ── 綁定寫入 ──
  const tenantId = randomUUID();
  const contactA = randomUUID();
  const contactB = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO tenants (id, name, "updatedAt") VALUES ($1::uuid,$2,now())`, tenantId, '綁定測試租戶');
  for (const [cid, nm] of [[contactA, '顧客A'], [contactB, '顧客B']] as const) {
    await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, cid, tenantId, nm);
  }
  await saveBindingConfig(prisma, tenantId, config());

  await t('綁定成功寫入 ContactAttribute（不新建表）', async () => {
    const r = await bindMember(prisma, tenantId, contactA, { memberId: 'A1' });
    assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
    const rows = await prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
      `SELECT key, value FROM contact_attributes WHERE "contactId" = $1::uuid ORDER BY key`, contactA);
    const keys = rows.map((x) => x.key);
    assert.ok(keys.includes('member_id'), `缺 member_id，實得 ${keys.join(',')}`);
    assert.ok(keys.includes('member_name'), '缺對應的其他欄位');
  });

  await t('可查詢綁定狀態', async () => {
    const r = await getBinding(prisma, tenantId, contactA);
    assert.ok(r.bound && r.memberId === 'M-A1', `實得 ${JSON.stringify(r)}`);
  });

  await t('同一會員編號不可綁到第二個聯絡人', async () => {
    const r = await bindMember(prisma, tenantId, contactB, { memberId: 'A1' });
    assert.ok(!r.ok && r.reason === 'ALREADY_BOUND_TO_OTHER', `實得 ${JSON.stringify(r)}`);
    const b = await getBinding(prisma, tenantId, contactB);
    assert.ok(!b.bound, '衝突時竟仍寫入綁定');
  });

  await t('不同會員編號可各自綁定', async () => {
    const r = await bindMember(prisma, tenantId, contactB, { memberId: 'B2' });
    assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
  });

  await t('查無會員時不寫入任何 attribute', async () => {
    const c = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO contacts (id, "tenantId", "displayName", "updatedAt") VALUES ($1::uuid,$2::uuid,$3,now())`, c, tenantId, '顧客C');
    const r = await bindMember(prisma, tenantId, c, { memberId: 'MISSING' });
    assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND');
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM contact_attributes WHERE "contactId" = $1::uuid`, c);
    assert.equal(Number(rows[0].n), 0, '查無會員竟寫入了 attribute');
  });

  await t('憑證加密入庫，DB 中不存明文', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ mb: unknown }>>(
      `SELECT "memberBinding" AS mb FROM tenant_settings WHERE "tenantId" = $1::uuid`, tenantId);
    const raw = JSON.stringify(rows[0].mb);
    assert.ok(!raw.includes('secret'), 'DB 中竟存有明文憑證');
    assert.ok(raw.includes('credentialEnc'), '未使用加密欄位');
  });

  await t('讀回設定時憑證可正確解密', async () => {
    const { getBindingConfig } = await import('../modules/member-binding/member-binding.service.js');
    const c = await getBindingConfig(prisma, tenantId);
    assert.equal(c?.auth.credential, 'secret', '憑證未能正確解密還原');
  });

  await t('解除綁定移除會員欄位', async () => {
    const r = await unbindMember(prisma, tenantId, contactA);
    assert.ok(r.removed > 0, '未移除任何欄位');
    const after = await getBinding(prisma, tenantId, contactA);
    assert.ok(!after.bound, '解除後仍顯示已綁定');
  });

  await prisma.$executeRawUnsafe(`DELETE FROM contact_attributes WHERE "contactId" IN (SELECT id FROM contacts WHERE "tenantId" = $1::uuid)`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenant_settings WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM contacts WHERE "tenantId" = $1::uuid`, tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, tenantId);

  server.close();
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('測試執行失敗：', err);
  await prisma.$disconnect();
  process.exit(1);
});
