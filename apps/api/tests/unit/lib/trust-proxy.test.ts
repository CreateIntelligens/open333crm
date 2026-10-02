/**
 * request.ip 只信任私有網段的代理（change add-login-brute-force-protection，AUDIT SEC-04）。
 * 部署路徑：使用者 → 主機 nginx（附加真實 IP）→ Caddy → api。
 */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test } from 'vitest';
import { TRUSTED_PROXIES } from '#src/lib/trust-proxy.js';

async function ipFor(remoteAddress: string, xff?: string): Promise<string> {
  const app = Fastify({ trustProxy: TRUSTED_PROXIES });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} });
  await app.close();
  return res.json().ip;
}

test('經 nginx → Caddy：取 nginx 附加的真實 IP，忽略使用者自己帶的偽造值', async () => {
  // 使用者偽造 1.1.1.1；nginx 附加真實 IP 203.0.113.9；Caddy 附加 docker 閘道 172.18.0.1
  assert.equal(await ipFor('172.18.0.9', '1.1.1.1, 203.0.113.9, 172.18.0.1'), '203.0.113.9');
});

test('直接連到 api 的公網連線：不採信 X-Forwarded-For', async () => {
  assert.equal(await ipFor('198.51.100.7', '1.1.1.1'), '198.51.100.7');
});

test('沒有代理標頭：用連線來源', async () => {
  assert.equal(await ipFor('172.18.0.9'), '172.18.0.9');
});
