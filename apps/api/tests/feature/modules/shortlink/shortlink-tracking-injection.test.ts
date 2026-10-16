/**
 * GET /s/:slug 的中轉頁放入租戶的追蹤碼（change restore-tenant-tracking-pixels-specs，
 * shortlink-ua-strategy「中轉頁放入租戶的追蹤碼」）。走真實的 shortlink-redirect 路由與測試資料庫，
 * 確認路由依短連結所屬的租戶讀取追蹤設定，再交給各來源的策略輸出。
 * 結束時刪除建立的資料，並還原兩個租戶的追蹤設定。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import shortlinkRedirectRoutes from '#src/modules/shortlink/shortlink-redirect.routes.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';

loadEnvConfig();
const prisma = new PrismaClient();
const stamp = Date.now();

const GA_ID = 'G-ABC123XYZ9';
const PIXEL_ID = '123456789012345';
const LIFF_ID = '1234567890-AbCdEfGh';

const UA = {
  browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
};

const select = { gaId: true, metaPixelId: true } as const;
const originals = await prisma.tenantSettings.findMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } }, select: { tenantId: true, ...select } });

async function setTracking(tenantId: string, data: { gaId: string | null; metaPixelId: string | null }) {
  await prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
}
// 租戶 A 設定兩個 ID，租戶 B 只設定 Pixel
await setTracking(TENANT_A, { gaId: GA_ID, metaPixelId: PIXEL_ID });
await setTracking(TENANT_B, { gaId: null, metaPixelId: PIXEL_ID });

const agentA = await prisma.agent.create({
  data: { tenantId: TENANT_A, email: `ci-sl-track-a-${stamp}@example.test`, name: 'CI 短連結 A', passwordHash: 'x' },
});
const agentB = await prisma.agent.create({
  data: { tenantId: TENANT_B, email: `ci-sl-track-b-${stamp}@example.test`, name: 'CI 短連結 B', passwordHash: 'x' },
});
const lineChannel = await prisma.channel.create({
  data: {
    tenantId: TENANT_A,
    channelType: 'LINE',
    displayName: `CI 短連結 LIFF ${stamp}`,
    credentialsEncrypted: 'x',
    settings: { liffConfig: { liffId: LIFF_ID } },
  },
});

const slugA = `ci-track-a-${stamp}`;
const slugLiff = `ci-track-liff-${stamp}`;
const slugB = `ci-track-b-${stamp}`;
await prisma.shortLink.createMany({
  data: [
    { tenantId: TENANT_A, slug: slugA, targetUrl: 'https://example.com/a', createdById: agentA.id },
    { tenantId: TENANT_A, slug: slugLiff, targetUrl: 'https://example.com/liff', createdById: agentA.id, lineChannelId: lineChannel.id },
    { tenantId: TENANT_B, slug: slugB, targetUrl: 'https://example.com/b', createdById: agentB.id },
  ],
});

const app = Fastify();
app.decorate('prismaAdmin', prisma);
await app.register(shortlinkRedirectRoutes, { prefix: '/s' });
await app.ready();

afterAll(async () => {
  await app.close();
  await prisma.shortLink.deleteMany({ where: { slug: { in: [slugA, slugLiff, slugB] } } });
  await prisma.channel.deleteMany({ where: { id: lineChannel.id } });
  await prisma.agent.deleteMany({ where: { id: { in: [agentA.id, agentB.id] } } });
  for (const tenantId of [TENANT_A, TENANT_B]) {
    const o = originals.find((r) => r.tenantId === tenantId);
    await setTracking(tenantId, { gaId: o?.gaId ?? null, metaPixelId: o?.metaPixelId ?? null });
  }
  await prisma.$disconnect();
});

async function open(slug: string, ua: string) {
  const res = await app.inject({ method: 'GET', url: `/s/${slug}`, headers: { 'user-agent': ua } });
  assert.equal(res.statusCode, 200, res.body);
  return res;
}

function assertHasGa(html: string) {
  assert.ok(html.includes(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`), html);
  assert.ok(html.includes(`gtag('config', '${GA_ID}')`), html);
}

function assertHasPixel(html: string) {
  assert.ok(html.includes(`fbq('init', '${PIXEL_ID}')`), html);
  assert.ok(html.includes(`fbq('track', 'PageView')`), html);
}

test('一般瀏覽器的中轉頁含追蹤碼', async () => {
  const res = await open(slugA, UA.browser);
  assert.equal(res.headers['x-shortlink-source'], 'EXTERNAL_BROWSER');
  assertHasGa(res.body);
  assertHasPixel(res.body);
});

test('Facebook 內建瀏覽器的中轉頁含追蹤碼', async () => {
  const res = await open(slugA, UA.facebook);
  assert.equal(res.headers['x-shortlink-source'], 'FB_WEBVIEW');
  assertHasGa(res.body);
  assertHasPixel(res.body);
});

test('LIFF 中轉頁含追蹤碼', async () => {
  const res = await open(slugLiff, UA.line);
  assert.equal(res.headers['x-shortlink-source'], 'LINE_WEBVIEW');
  assert.ok(res.body.includes(`https://liff.line.me/${LIFF_ID}?`), res.body);
  assertHasGa(res.body);
  assertHasPixel(res.body);
});

test('沒有設定的 ID 不放入 script', async () => {
  const res = await open(slugB, UA.browser);
  assertHasPixel(res.body);
  assert.ok(!res.body.includes('googletagmanager.com'), res.body);
});
