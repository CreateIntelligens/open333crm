/**
 * 圖文訊息的示範底圖（spec material-system「圖文訊息的示範底圖符合 LINE imagemap 規格」）。
 * LINE 依 baseUrl/{寬度} 匿名抓圖，所以端點公開、只接受五種寬度，比例要與預設版型 1040:700 相同。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-line-imagemap-demo-secret';

const { default: lineImagemapRoutes } = await import('#src/modules/storage/line-imagemap.routes.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(lineImagemapRoutes, { prefix: '/line-imagemap' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('示範底圖提供 LINE 規定的五種寬度', async () => {
  for (const width of [240, 300, 460, 700, 1040]) {
    const res = await app.inject({ method: 'GET', url: `/line-imagemap/demo/${width}` });
    assert.equal(res.statusCode, 200, `寬度 ${width}`);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    const meta = await sharp(res.rawPayload).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, width);
    assert.equal(meta.height, Math.round((width * 700) / 1040), `寬度 ${width} 的高度要符合 1040:700`);
  }

  const withExt = await app.inject({ method: 'GET', url: '/line-imagemap/demo/1040.jpg' });
  assert.equal(withExt.statusCode, 200, 'LINE 有時帶副檔名');
  assert.equal((await sharp(withExt.rawPayload).metadata()).width, 1040);
});

test('其他寬度不提供', async () => {
  const res = await app.inject({ method: 'GET', url: '/line-imagemap/demo/500' });
  assert.equal(res.statusCode, 400);
});
