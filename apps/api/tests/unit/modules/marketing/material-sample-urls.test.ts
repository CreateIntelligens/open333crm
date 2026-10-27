/**
 * LINE 素材儲存時把示範圖換成公開網址（change line-sample-images-public-url，spec material-system
 * 「LINE 素材儲存時只把示範圖換成公開網址」）；FB 素材的站內路徑也換成公開網址（change
 * fix-fb-material-site-path-urls，spec material-system「FB 素材儲存時把站內路徑換成公開網址」）。
 * 編輯器預設帶入的示範圖是站內路徑，LINE 驗證只收 https 公開網址；示範圖本來就由 web 公開提供。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/open333crm';
process.env.JWT_SECRET ||= 'test-material-sample-urls-secret';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
process.env.WEB_BASE_URL = 'https://uat.example.com/';
process.env.API_PUBLIC_URL = 'https://uat.example.com';

vi.mock('#src/modules/channel/channel.service.js', () => ({
  decryptCredentials: () => ({ channelAccessToken: 'test-token' }),
}));

const { loadEnvConfig } = await import('#src/config/env.js');
loadEnvConfig();
const { createMaterial, updateMaterial } = await import('#src/modules/marketing/material.service.js');

const T = 'tenant-a';
/** 送給 LINE validate 的 messages */
const sentToLine: unknown[] = [];

beforeEach(() => {
  sentToLine.length = 0;
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    sentToLine.push(JSON.parse(String(init?.body)).messages[0]);
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

function fakeDb(existing?: Record<string, unknown>) {
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    channel: { findFirst: async () => ({ credentialsEncrypted: 'x' }) },
    material: {
      findFirst: async () => existing ?? null,
      findUnique: async () => existing ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: 'm1', ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { ...existing, ...data };
      },
    },
    materialVersion: { findFirst: async () => null, create: async () => ({}) },
    materialTag: { findMany: async () => [], deleteMany: async () => ({}), createMany: async () => ({}) },
  };
  return { db: db as never, writes };
}

const save = (contentType: string, body: Record<string, unknown>, channelType = 'line') => {
  const { db, writes } = fakeDb();
  return createMaterial(db, T, { name: 'm', channelType, contentType, body }).then(() => writes[0].body as Record<string, any>);
};

test('圖片、影片與卡片訊息的示範圖換成公開網址', async () => {
  const image = await save('line_image', { mediaUrl: '/material-samples/cafe.jpeg' });
  assert.equal(image.mediaUrl, 'https://uat.example.com/material-samples/cafe.jpeg');
  assert.equal((sentToLine[0] as any).originalContentUrl, 'https://uat.example.com/material-samples/cafe.jpeg', '送 LINE 驗證的也是公開網址');

  const video = await save('line_video', {
    videoUrl: 'https://cdn.example.com/v.mp4',
    previewImageUrl: '/material-samples/promo-banner.jpeg',
  });
  assert.equal(video.previewImageUrl, 'https://uat.example.com/material-samples/promo-banner.jpeg', '影片預覽圖不是 imagemap，照一般示範圖處理');

  const carousel = await save('line_carousel', {
    pageType: 'product',
    pages: [{ imageUrl: '/material-samples/product.jpeg', title: 't' }],
  });
  assert.equal(carousel.pages[0].imageUrl, 'https://uat.example.com/material-samples/product.jpeg');
});

test('圖文訊息的舊示範底圖換成示範底圖端點', async () => {
  const body = { baseImageUrl: '/material-samples/promo-banner.jpeg', width: 1040, height: 700, areas: [] };
  assert.equal((await save('line_imagemap', body)).baseImageUrl, 'https://uat.example.com/line-imagemap/demo');
  const absolute = { ...body, baseImageUrl: 'https://uat.example.com/material-samples/promo-banner.jpeg' };
  assert.equal((await save('line_imagemap', absolute)).baseImageUrl, 'https://uat.example.com/line-imagemap/demo', '換成完整網址的舊示範底圖也換');
});

test('不是示範圖的網址不變', async () => {
  const own = await save('line_image', { mediaUrl: 'https://cdn.example.com/a.jpg' });
  assert.equal(own.mediaUrl, 'https://cdn.example.com/a.jpg');
  const sitePath = await save('line_image', { mediaUrl: '/uploads/a.jpg' });
  assert.equal(sitePath.mediaUrl, '/uploads/a.jpg');
  const text = await save('line_text', { text: '請看 /material-samples/cafe.jpeg' });
  assert.equal(text.text, '請看 /material-samples/cafe.jpeg', '只換整個值就是示範圖路徑的欄位');
  const exact = await save('line_text', { text: '/material-samples/cafe.jpeg' });
  assert.equal(exact.text, '/material-samples/cafe.jpeg', '文字欄位就算整段是示範圖路徑也不換，只換網址欄位');
});

test('更新素材時一樣轉換', async () => {
  const { db, writes } = fakeDb({ id: 'm1', tenantId: T, channelType: 'line', contentType: 'line_image', body: {} });
  await updateMaterial(db, 'm1', T, { body: { mediaUrl: '/material-samples/cafe.jpeg' } });
  assert.equal((writes[0].body as any).mediaUrl, 'https://uat.example.com/material-samples/cafe.jpeg');
});

test('更新 Flex 素材時一樣轉換', async () => {
  const { db, writes } = fakeDb({ id: 'm2', tenantId: T, channelType: 'line', contentType: 'line_flex_template', body: {} });
  const flex = {
    type: 'flex',
    altText: 'a',
    contents: { type: 'bubble', hero: { type: 'image', url: '/material-samples/cafe.jpeg' } },
  };
  await updateMaterial(db, 'm2', T, { body: flex });
  assert.equal((writes[0].body as any).contents.hero.url, 'https://uat.example.com/material-samples/cafe.jpeg');
});

test('FB 素材的示範圖換成公開網址', async () => {
  // 2026-10-27 UAT：FB 商品輪播沿用示範圖，Facebook 回「image_url should represent a valid URL」整批失敗
  const generic = await save(
    'fb_generic',
    { elements: [{ title: 't', image_url: '/material-samples/product.jpeg' }] },
    'fb',
  );
  assert.equal(generic.elements[0].image_url, 'https://uat.example.com/material-samples/product.jpeg');
  const image = await save('fb_image', { url: '/material-samples/cafe.jpeg' }, 'fb');
  assert.equal(image.url, 'https://uat.example.com/material-samples/cafe.jpeg');
  const media = await save('fb_media', { media_type: 'image', url: '/material-samples/product.jpeg' }, 'fb');
  assert.equal(media.url, 'https://uat.example.com/material-samples/product.jpeg');
  const coupon = await save('fb_coupon', { title: '8 折', image_url: '/material-samples/coupon.jpeg' }, 'fb');
  assert.equal(coupon.image_url, 'https://uat.example.com/material-samples/coupon.jpeg');
});

test('FB 素材的其他站內路徑也換成公開網址', async () => {
  const fb = await save(
    'fb_generic',
    {
      elements: [{
        title: '/material-samples/product.jpeg',
        image_url: '/uploads/a.jpg',
        buttons: [{ type: 'web_url', title: '看看', url: '/promo' }],
      }],
    },
    'fb',
  );
  assert.equal(fb.elements[0].image_url, 'https://uat.example.com/uploads/a.jpg');
  assert.equal(fb.elements[0].buttons[0].url, 'https://uat.example.com/promo');
  assert.equal(fb.elements[0].title, '/material-samples/product.jpeg', '文字欄位不換');
  const own = await save('fb_image', { url: 'https://cdn.example.com/a.jpg' }, 'fb');
  assert.equal(own.url, 'https://cdn.example.com/a.jpg', '使用者自己的網址不變');
});

test('更新 FB 素材時一樣轉換', async () => {
  const { db, writes } = fakeDb({ id: 'm3', tenantId: T, channelType: 'fb', contentType: 'fb_generic', body: {} });
  await updateMaterial(db, 'm3', T, { body: { elements: [{ title: 't', image_url: '/material-samples/product.jpeg' }] } });
  assert.equal((writes[0].body as any).elements[0].image_url, 'https://uat.example.com/material-samples/product.jpeg');
});
