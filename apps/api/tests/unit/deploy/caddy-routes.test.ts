/**
 * API 掛在根路徑（不在 /api 底下）的路由，Caddy 必須轉給 api。
 *
 * 2026-10-12 UAT E2E 發現：LINE 圖文訊息的底圖網址 /line-imagemap/... 沒有轉給 api，
 * 落到 web 回 404，素材存檔成功、發出去卻是破圖。部署設定沒有行為測試可以涵蓋，
 * 所以這裡直接比對 index.ts 的路由前綴與兩份反向代理設定：Caddyfile.local（docker-compose 掛進 caddy）
 * 與 nginx/nginx.conf.template（docker-compose.prod.yml 的 nginx）。只認沒有被註解掉的設定行。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { apiSrc, repoRoot } from '#tests/support/paths.js';

const indexTs = readFileSync(join(apiSrc, 'index.ts'), 'utf8');
const caddyfile = readFileSync(join(repoRoot, 'Caddyfile.local'), 'utf8');
/** docker-compose.prod.yml 的 nginx 用這份範本產生設定 */
const nginxTemplate = readFileSync(join(repoRoot, 'nginx/nginx.conf.template'), 'utf8');

const escapeRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** index.ts 中以 prefix 註冊、不在 /api 底下的路由前綴，例如 /s、/line-imagemap */
const rootPrefixes = [...indexTs.matchAll(/prefix:\s*'(\/[^']*)'/g)]
  .map((m) => m[1])
  .filter((p) => p !== '/api' && !p.startsWith('/api/'));

test('index.ts 至少有一個根路徑前綴（確認比對有效）', () => {
  assert.ok(rootPrefixes.includes('/s'), `找到的前綴：${rootPrefixes.join(', ')}`);
});

test('每個根路徑前綴在 Caddyfile.local 都轉給 api:3001', () => {
  const missing = rootPrefixes.filter(
    (p) => !new RegExp(`^\\s*reverse_proxy\\s+${escapeRe(p)}/\\*\\s+api:3001`, 'm').test(caddyfile),
  );
  assert.deepEqual(missing, [], `這些 API 路由沒有轉給 api，會落到 web 回 404：${missing.join(', ')}`);
});

test('每個根路徑前綴在 nginx.conf.template 都有轉給 api 的 location', () => {
  const missing = rootPrefixes.filter((p) => {
    const m = new RegExp(`^\\s*location\\s+${escapeRe(p)}/\\s*\\{([^}]*)\\}`, 'm').exec(nginxTemplate);
    return !m || !/proxy_pass\s+http:\/\/api_upstream/.test(m[1]);
  });
  assert.deepEqual(missing, [], `nginx 沒有轉給 api 的路由：${missing.join(', ')}`);
});

test('被註解掉的設定行不算數', () => {
  const commented = '    # reverse_proxy /line-imagemap/* api:3001\n';
  assert.equal(new RegExp(`^\\s*reverse_proxy\\s+/line-imagemap/\\*\\s+api:3001`, 'm').test(commented), false);
});
