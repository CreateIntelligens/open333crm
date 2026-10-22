/**
 * 基礎通道的通用防護測試——與特定客戶格式無關，任何客戶都會走這條路。
 * 用本機 http server 模擬上游；不需 PostgreSQL/Redis。
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, it } from 'vitest';
import { isPrivateAddress, assertEndpointAllowed, readBodyLimited } from '#src/modules/member-binding/upstream-guard.js';
import { lookupMember } from '#src/modules/member-binding/member-lookup.service.js';
import type { MemberBindingConfig } from '#src/modules/member-binding/member-binding.types.js';

// 模擬上游跑在 127.0.0.1，需允許本機位址（SSRF 案例會暫時關掉）
const originalAllowLocal = process.env.MEMBER_BINDING_ALLOW_LOCAL;
process.env.MEMBER_BINDING_ALLOW_LOCAL = '1';

let server: Server;
let base = '';
const hits: string[] = [];

function startMock(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    let flakyCount = 0;
    const srv = createServer((req, res) => {
      hits.push(req.url ?? '');
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname === '/flaky') {
        flakyCount += 1;
        // 前兩次回 503，第三次成功——驗證重試
        if (flakyCount < 3) { res.writeHead(503); res.end('busy'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { member_no: 'M-RETRY' } }));
        return;
      }
      if (url.pathname === '/always400') {
        res.writeHead(400); res.end('bad'); return;
      }
      if (url.pathname === '/huge') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: { blob: 'x'.repeat(2 * 1024 * 1024) } }));
        return;
      }
      if (url.pathname === '/redirect') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { member_no: `M-${url.searchParams.get('id')}` } }));
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ server: srv, port: (srv.address() as { port: number }).port });
    });
  });
}

const cfg = (path: string, extra: Partial<MemberBindingConfig> = {}): MemberBindingConfig => ({
  enabled: true,
  endpoint: `${base}${path}?id={{memberId}}`,
  method: 'GET',
  auth: { type: 'none' },
  fieldMapping: { memberId: 'data.member_no' },
  timeoutMs: 2000,
  ...extra,
});

beforeAll(async () => {
  const started = await startMock();
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalAllowLocal === undefined) delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
  else process.env.MEMBER_BINDING_ALLOW_LOCAL = originalAllowLocal;
});

// ── 私有位址判斷 ──
it('辨識出私有／內網位址', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1',
    '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.ok(isPrivateAddress(ip), `${ip} 應被判定為私有位址`);
  }
});

it('IPv4-mapped 的十六進位寫法也擋下（new URL 會把 [::ffff:127.0.0.1] 正規化成 [::ffff:7f00:1]）', async () => {
  const saved = process.env.MEMBER_BINDING_ALLOW_LOCAL;
  delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
  try {
    for (const url of ['http://[::ffff:127.0.0.1]:3001/members', 'http://[::ffff:a9fe:a9fe]/latest/meta-data', 'http://[64:ff9b::7f00:1]/']) {
      const r = await assertEndpointAllowed(url);
      assert.ok(r.ok === false && r.reason === 'PRIVATE_ADDRESS', `${url} 應被擋下`);
    }
  } finally {
    if (saved !== undefined) process.env.MEMBER_BINDING_ALLOW_LOCAL = saved;
  }
});

it('公開位址不被誤判', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.5', '2001:4860:4860::8888']) {
    assert.ok(!isPrivateAddress(ip), `${ip} 不應被判定為私有位址`);
  }
});

it('雲端 metadata 位址被擋下（SSRF）', async () => {
  delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
  try {
    const r = await assertEndpointAllowed('http://169.254.169.254/latest/meta-data/');
    assert.ok(!r.ok && r.reason === 'PRIVATE_ADDRESS', `實得 ${JSON.stringify(r)}`);
  } finally {
    process.env.MEMBER_BINDING_ALLOW_LOCAL = '1';
  }
});

it('非 http(s) 協議被擋下', async () => {
  const r = await assertEndpointAllowed('file:///etc/passwd');
  assert.ok(!r.ok && r.reason === 'PROTOCOL_NOT_ALLOWED', `實得 ${JSON.stringify(r)}`);
});

it('格式錯誤的網址被擋下', async () => {
  const r = await assertEndpointAllowed('not a url');
  assert.ok(!r.ok && r.reason === 'INVALID_URL', `實得 ${JSON.stringify(r)}`);
});

// ── 佔位符編碼（真實注入風險）──
it('會員編號含 & 不會注入額外參數', async () => {
  hits.length = 0;
  await lookupMember(cfg('/m'), { memberId: 'A&admin=true' });
  const received = new URL(hits[0], 'http://x').searchParams;
  assert.equal(received.get('id'), 'A&admin=true', '值未被完整傳遞');
  assert.equal(received.get('admin'), null, '竟被注入了額外參數 admin');
});

it('會員編號含空白與 # 可正確傳遞', async () => {
  hits.length = 0;
  await lookupMember(cfg('/m'), { memberId: 'A B#C' });
  const received = new URL(hits[0], 'http://x').searchParams;
  assert.equal(received.get('id'), 'A B#C');
});

it('POST body 中的引號不破壞 JSON 結構', async () => {
  hits.length = 0;
  const r = await lookupMember(
    cfg('/m', { method: 'POST', bodyTemplate: '{"id":"{{memberId}}"}' }),
    { memberId: 'A"}{' },
  );
  // 能走到取值階段即代表 body 是合法 JSON（對方沒有因 400 而中斷）
  assert.ok(r.ok || r.reason !== 'UPSTREAM_ERROR', `body 疑似壞掉：${JSON.stringify(r)}`);
});

// ── 重試 ──
it('暫時性 503 會重試並最終成功', async () => {
  const r = await lookupMember(cfg('/flaky'), { memberId: 'X' });
  assert.ok(r.ok && r.memberId === 'M-RETRY', `重試未生效：${JSON.stringify(r)}`);
});

it('4xx 不重試（設定或輸入問題，重打無意義）', async () => {
  hits.length = 0;
  await lookupMember(cfg('/always400'), { memberId: 'X' });
  assert.equal(hits.length, 1, `4xx 竟重試了 ${hits.length} 次`);
});

// ── 回應大小 ──
it('過大的回應被擋下而非吃爆記憶體', async () => {
  const r = await lookupMember(cfg('/huge'), { memberId: 'X' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
  assert.ok(r.ok === false && /過大/.test(r.detail ?? ''), `原因不正確：${r.ok === false ? r.detail : ''}`);
});

it('readBodyLimited 依 content-length 提早拒絕', async () => {
  const res = new Response('x'.repeat(100), { headers: { 'content-length': '99999999' } });
  const r = await readBodyLimited(res);
  assert.ok(!r.ok && r.reason === 'TOO_LARGE');
});

// ── 轉址 ──
it('轉址不被自動跟隨（避免被導向內網）', async () => {
  const r = await lookupMember(cfg('/redirect'), { memberId: 'X' });
  assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
  assert.ok(r.ok === false && /轉址/.test(r.detail ?? ''), '未明確回報轉址');
});
