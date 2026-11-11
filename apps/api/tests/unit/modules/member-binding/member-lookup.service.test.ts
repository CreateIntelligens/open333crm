/**
 * 會員查詢的失敗分類與取值（design D5、tasks 5.6）。
 *
 * 用本機 http server 模擬客戶的會員 API —— 三種失敗情境
 * （無回應／回錯／查無會員）必須真的走過網路層才測得到分類是否正確。
 * 不需 PostgreSQL/Redis；綁定寫入的案例在 tests/feature/modules/member-binding/。
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, it } from 'vitest';
import { lookupMember } from '#src/modules/member-binding/member-lookup.service.js';
import type { MemberBindingConfig } from '#src/modules/member-binding/member-binding.types.js';

// 模擬 API 跑在 127.0.0.1，需允許本機位址
const originalAllowLocal = process.env.MEMBER_BINDING_ALLOW_LOCAL;
process.env.MEMBER_BINDING_ALLOW_LOCAL = '1';

let server: Server;
let base = '';

/** 模擬客戶的會員 API，涵蓋各種回應樣態。 */
function startMockApi(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
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

beforeAll(async () => {
  const started = await startMockApi();
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  // /slow 的請求不會回應，強制關閉連線讓 server 能結束
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalAllowLocal === undefined) delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
  else process.env.MEMBER_BINDING_ALLOW_LOCAL = originalAllowLocal;
});

// ── 三種失敗分類（tasks 5.6）──
it('外部無回應（逾時）回報 UPSTREAM_UNREACHABLE', async () => {
  const r = await lookupMember(config('/slow'), { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_UNREACHABLE', `實得 ${JSON.stringify(r)}`);
});

it('連線失敗回報 UPSTREAM_UNREACHABLE', async () => {
  const bad = { ...config(), endpoint: 'http://127.0.0.1:1/x?id={{memberId}}' };
  const r = await lookupMember(bad, { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_UNREACHABLE', `實得 ${JSON.stringify(r)}`);
});

it('外部回 500 回報 UPSTREAM_ERROR', async () => {
  const r = await lookupMember(config('/error'), { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
});

it('回應非 JSON 回報 UPSTREAM_ERROR', async () => {
  const r = await lookupMember(config('/notjson'), { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
});

it('外部回 404 回報 MEMBER_NOT_FOUND', async () => {
  const r = await lookupMember(config('/404'), { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
});

it('200 但資料為空回報 MEMBER_NOT_FOUND（非 404 的查無）', async () => {
  const r = await lookupMember(config(), { memberId: 'MISSING' });
  assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
});

it('未啟用時回報 NOT_CONFIGURED', async () => {
  const r = await lookupMember({ ...config(), enabled: false }, { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'NOT_CONFIGURED', `實得 ${JSON.stringify(r)}`);
});

it('查詢成功並依 fieldMapping 取值', async () => {
  const r = await lookupMember(config(), { memberId: 'A1' });
  assert.ok(r.ok, `查詢失敗：${JSON.stringify(r)}`);
  assert.equal(r.memberId, 'M-A1');
  assert.equal(r.attributes.name, '王小明');
  assert.equal(r.attributes.level, 'GOLD');
});

it('fieldMapping 取不到 memberId 時不建立不完整綁定', async () => {
  const bad = { ...config(), fieldMapping: { memberId: 'data.wrong_field' } };
  const r = await lookupMember(bad, { memberId: 'A1' });
  assert.ok(!r.ok && r.reason === 'MEMBER_NOT_FOUND', `實得 ${JSON.stringify(r)}`);
});
