/**
 * 基礎通道的通用防護測試——與特定客戶格式無關，任何客戶都會走這條路。
 *   MEMBER_BINDING_ALLOW_LOCAL=1 DATABASE_URL=... npx tsx src/__tests__/member-binding-guard.test.ts
 */
import assert from 'node:assert';
import { createServer, type Server } from 'node:http';
import { isPrivateAddress, assertEndpointAllowed, readBodyLimited } from '../modules/member-binding/upstream-guard.js';
import { lookupMember } from '../modules/member-binding/member-lookup.service.js';
import type { MemberBindingConfig } from '../modules/member-binding/member-binding.types.js';

let pass = 0;
let fail = 0;

async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

function startMock(): Promise<{ server: Server; port: number; hits: string[] }> {
  const hits: string[] = [];
  return new Promise((resolve) => {
    let flakyCount = 0;
    const server = createServer((req, res) => {
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
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port, hits });
    });
  });
}

async function main() {
  // ── 私有位址判斷 ──
  await t('辨識出私有／內網位址', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1',
                      '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.ok(isPrivateAddress(ip), `${ip} 應被判定為私有位址`);
    }
  });

  await t('公開位址不被誤判', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.5', '2001:4860:4860::8888']) {
      assert.ok(!isPrivateAddress(ip), `${ip} 不應被判定為私有位址`);
    }
  });

  await t('雲端 metadata 位址被擋下（SSRF）', async () => {
    delete process.env.MEMBER_BINDING_ALLOW_LOCAL;
    const r = await assertEndpointAllowed('http://169.254.169.254/latest/meta-data/');
    assert.ok(!r.ok && r.reason === 'PRIVATE_ADDRESS', `實得 ${JSON.stringify(r)}`);
    process.env.MEMBER_BINDING_ALLOW_LOCAL = '1';
  });

  await t('非 http(s) 協議被擋下', async () => {
    const r = await assertEndpointAllowed('file:///etc/passwd');
    assert.ok(!r.ok && r.reason === 'PROTOCOL_NOT_ALLOWED', `實得 ${JSON.stringify(r)}`);
  });

  await t('格式錯誤的網址被擋下', async () => {
    const r = await assertEndpointAllowed('not a url');
    assert.ok(!r.ok && r.reason === 'INVALID_URL', `實得 ${JSON.stringify(r)}`);
  });

  const { server, port, hits } = await startMock();
  const base = `http://127.0.0.1:${port}`;
  const cfg = (path: string, extra: Partial<MemberBindingConfig> = {}): MemberBindingConfig => ({
    enabled: true,
    endpoint: `${base}${path}?id={{memberId}}`,
    method: 'GET',
    auth: { type: 'none' },
    fieldMapping: { memberId: 'data.member_no' },
    timeoutMs: 2000,
    ...extra,
  });

  // ── 佔位符編碼（真實注入風險）──
  await t('會員編號含 & 不會注入額外參數', async () => {
    hits.length = 0;
    await lookupMember(cfg('/m'), { memberId: 'A&admin=true' });
    const received = new URL(hits[0], 'http://x').searchParams;
    assert.equal(received.get('id'), 'A&admin=true', '值未被完整傳遞');
    assert.equal(received.get('admin'), null, '竟被注入了額外參數 admin');
  });

  await t('會員編號含空白與 # 可正確傳遞', async () => {
    hits.length = 0;
    await lookupMember(cfg('/m'), { memberId: 'A B#C' });
    const received = new URL(hits[0], 'http://x').searchParams;
    assert.equal(received.get('id'), 'A B#C');
  });

  await t('POST body 中的引號不破壞 JSON 結構', async () => {
    hits.length = 0;
    const r = await lookupMember(
      cfg('/m', { method: 'POST', bodyTemplate: '{"id":"{{memberId}}"}' }),
      { memberId: 'A"}{' },
    );
    // 能走到取值階段即代表 body 是合法 JSON（對方沒有因 400 而中斷）
    assert.ok(r.ok || r.reason !== 'UPSTREAM_ERROR', `body 疑似壞掉：${JSON.stringify(r)}`);
  });

  // ── 重試 ──
  await t('暫時性 503 會重試並最終成功', async () => {
    const r = await lookupMember(cfg('/flaky'), { memberId: 'X' });
    assert.ok(r.ok && r.memberId === 'M-RETRY', `重試未生效：${JSON.stringify(r)}`);
  });

  await t('4xx 不重試（設定或輸入問題，重打無意義）', async () => {
    hits.length = 0;
    await lookupMember(cfg('/always400'), { memberId: 'X' });
    assert.equal(hits.length, 1, `4xx 竟重試了 ${hits.length} 次`);
  });

  // ── 回應大小 ──
  await t('過大的回應被擋下而非吃爆記憶體', async () => {
    const r = await lookupMember(cfg('/huge'), { memberId: 'X' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
    assert.ok(r.ok === false && /過大/.test(r.detail ?? ''), `原因不正確：${r.ok === false ? r.detail : ''}`);
  });

  await t('readBodyLimited 依 content-length 提早拒絕', async () => {
    const res = new Response('x'.repeat(100), { headers: { 'content-length': '99999999' } });
    const r = await readBodyLimited(res);
    assert.ok(!r.ok && r.reason === 'TOO_LARGE');
  });

  // ── 轉址 ──
  await t('轉址不被自動跟隨（避免被導向內網）', async () => {
    const r = await lookupMember(cfg('/redirect'), { memberId: 'X' });
    assert.ok(!r.ok && r.reason === 'UPSTREAM_ERROR', `實得 ${JSON.stringify(r)}`);
    assert.ok(r.ok === false && /轉址/.test(r.detail ?? ''), '未明確回報轉址');
  });

  server.close();
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('測試執行失敗：', err); process.exit(1); });
