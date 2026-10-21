/**
 * 會員綁定寫入測試（design D5、tasks 5.6）。
 *
 * 用本機 http server 模擬客戶的會員 API；綁定結果寫入真實 Postgres。
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 * service 以 app_tenant 連線呼叫（RLS 生效）；建立與清理資料用 owner 連線。
 * 本檔建立的聯絡人帶唯一標記，於 afterAll 刪除；租戶 A 的 memberBinding 設定於 afterAll 還原。
 * 查詢失敗分類的案例在 tests/unit/modules/member-binding/member-lookup.service.test.ts。
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  saveBindingConfig,
  bindMember,
  getBinding,
  getBindingConfig,
  unbindMember,
} from '#src/modules/member-binding/member-binding.service.js';
import type { MemberBindingConfig } from '#src/modules/member-binding/member-binding.types.js';

// 模擬 API 跑在 127.0.0.1，需允許本機位址
const originalAllowLocal = process.env.MEMBER_BINDING_ALLOW_LOCAL;
process.env.MEMBER_BINDING_ALLOW_LOCAL = '1';

const owner = new PrismaClient();
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const tenantId = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const MARK = `member-binding-test-${Date.now()}`;

let server: Server;
let base = '';
let contactA = '';
let contactB = '';
/** 測試前租戶 A 的 tenant_settings；null 表示原本沒有這一列 */
let originalSettings: { memberBinding: Prisma.JsonValue } | null = null;

/** 模擬客戶的會員 API：MISSING 回 200 + 空資料（查無），其餘回會員資料。 */
function startMockApi(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const id = url.searchParams.get('id') ?? '';
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
    srv.listen(0, '127.0.0.1', () => {
      resolve({ server: srv, port: (srv.address() as { port: number }).port });
    });
  });
}

const config = (path = '/member'): MemberBindingConfig => ({
  enabled: true,
  endpoint: `${base}${path}?id={{memberId}}`,
  method: 'GET',
  auth: { type: 'bearer', credential: 'secret' },
  fieldMapping: { memberId: 'data.member_no', name: 'data.name', level: 'data.level' },
  notFoundWhen: { fieldIsEmpty: 'data' },
  timeoutMs: 1000,
});

async function mkContact(name: string): Promise<string> {
  const c = await owner.contact.create({ data: { tenantId, displayName: `${MARK}-${name}` } });
  return c.id;
}

beforeAll(async () => {
  const started = await startMockApi();
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
  originalSettings = await owner.tenantSettings.findUnique({ where: { tenantId }, select: { memberBinding: true } });
  contactA = await mkContact('顧客A');
  contactB = await mkContact('顧客B');
  await saveBindingConfig(tenantDb, tenantId, config());
});

afterAll(async () => {
  const contacts = { tenantId, displayName: { startsWith: MARK } };
  await owner.contactAttribute.deleteMany({ where: { contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  if (originalSettings) {
    await owner.tenantSettings.update({
      where: { tenantId },
      data: { memberBinding: (originalSettings.memberBinding ?? Prisma.JsonNull) as Prisma.InputJsonValue },
    });
  } else {
    await owner.tenantSettings.deleteMany({ where: { tenantId } });
  }
  await owner.$disconnect();
  await tenantDb.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalAllowLocal === undefined) delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
  else process.env.MEMBER_BINDING_ALLOW_LOCAL = originalAllowLocal;
});

it('綁定成功寫入 ContactAttribute（不新建表）', async () => {
  const r = await bindMember(tenantDb, tenantId, contactA, { memberId: 'A1' });
  assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
  const rows = await owner.contactAttribute.findMany({ where: { contactId: contactA }, orderBy: { key: 'asc' } });
  const keys = rows.map((x) => x.key);
  assert.ok(keys.includes('member_id'), `缺 member_id，實得 ${keys.join(',')}`);
  assert.ok(keys.includes('member_name'), '缺對應的其他欄位');
});

it('可查詢綁定狀態', async () => {
  const r = await getBinding(tenantDb, tenantId, contactA);
  assert.ok(r.bound && r.memberId === 'M-A1', `實得 ${JSON.stringify(r)}`);
});

it('同一會員編號不可綁到第二個聯絡人', async () => {
  const r = await bindMember(tenantDb, tenantId, contactB, { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'ALREADY_BOUND_TO_OTHER', `實得 ${JSON.stringify(r)}`);
  const b = await getBinding(tenantDb, tenantId, contactB);
  assert.ok(!b.bound, '衝突時竟仍寫入綁定');
});

it('不同會員編號可各自綁定', async () => {
  const r = await bindMember(tenantDb, tenantId, contactB, { memberId: 'B2' });
  assert.ok(r.ok, `綁定失敗：${JSON.stringify(r)}`);
});

it('查無會員時不寫入任何 attribute', async () => {
  const c = await mkContact('顧客C');
  const r = await bindMember(tenantDb, tenantId, c, { memberId: 'MISSING' });
  assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND');
  const n = await owner.contactAttribute.count({ where: { contactId: c } });
  assert.equal(n, 0, '查無會員竟寫入了 attribute');
});

it('憑證加密入庫，DB 中不存明文', async () => {
  const row = await owner.tenantSettings.findUnique({ where: { tenantId }, select: { memberBinding: true } });
  const raw = JSON.stringify(row?.memberBinding);
  assert.ok(!raw.includes('secret'), 'DB 中竟存有明文憑證');
  assert.ok(raw.includes('credentialEnc'), '未使用加密欄位');
});

it('讀回設定時憑證可正確解密', async () => {
  const c = await getBindingConfig(tenantDb, tenantId);
  assert.equal(c?.auth.credential, 'secret', '憑證未能正確解密還原');
});

it('解除綁定移除會員欄位', async () => {
  const r = await unbindMember(tenantDb, tenantId, contactA);
  assert.ok(r.removed > 0, '未移除任何欄位');
  const after = await getBinding(tenantDb, tenantId, contactA);
  assert.ok(!after.bound, '解除後仍顯示已綁定');
});

it('兩位聯絡人同時綁同一個會員編號，只有一位成功', async () => {
  for (let round = 0; round < 8; round++) {
    const contacts = await Promise.all([0, 1, 2, 3].map((i) => mkContact(`同時${round}-${i}`)));
    const results = await Promise.all(contacts.map((c) => bindMember(tenantDb, tenantId, c, { memberId: `RACE${round}` })));
    assert.equal(results.filter((r) => r.ok).length, 1, `第 ${round + 1} 輪：${JSON.stringify(results)}`);
  }
});
