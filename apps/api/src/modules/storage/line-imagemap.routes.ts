/**
 * LINE imagemap 公開圖端（無認證）。Prefix: /line-imagemap
 *
 * GET /line-imagemap/:tenantId/:imageId/:width
 *   LINE 抓 imagemap 底圖走這裡（LINE 匿名抓，不帶我們的 JWT，故此 route 公開）。
 *   對應 storage 裡 {tenantId}/imagemap/{imageId}/{width} 的物件，回 image/jpeg。
 *   width 限 LINE 規範的 5 種（240/300/460/700/1040）；其餘回 400。
 *
 * baseUrl（存進 material.baseImageUrl）= {API_PUBLIC_URL}/line-imagemap/{tenantId}/{imageId}
 * LINE 會自動接 /{width}。
 *
 * GET /line-imagemap/demo/:width
 *   編輯器新建圖文訊息時預設帶入的示範底圖（spec material-system「圖文訊息的示範底圖符合 LINE imagemap 規格」）。
 *   圖檔是 apps/api/assets/imagemap-demo/{width}.jpg，比例與預設版型相同（1040:700）。
 */

import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { getObject, imagemapSizeKey, IMAGEMAP_WIDTHS } from './storage.service.js';

const ALLOWED_WIDTHS = new Set<number>(IMAGEMAP_WIDTHS);

/** LINE 有時會帶副檔名（如 .../1040.png）；去掉再解析。不是規定的寬度回 null */
function parseWidth(width: string): number | null {
  const w = Number(width.replace(/\.(png|jpe?g|webp)$/i, ''));
  return ALLOWED_WIDTHS.has(w) ? w : null;
}

const demoImages = new Map<number, Buffer>();

/** 讀取示範底圖（src 與 dist 到 assets 的相對路徑相同）；讀過就留在記憶體 */
async function readDemoImage(width: number): Promise<Buffer> {
  let image = demoImages.get(width);
  if (!image) {
    image = await readFile(new URL(`../../../assets/imagemap-demo/${width}.jpg`, import.meta.url));
    demoImages.set(width, image);
  }
  return image;
}

export default async function lineImagemapRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { width: string } }>('/demo/:width', async (request, reply) => {
    const w = parseWidth(request.params.width);
    if (w === null) {
      return reply.code(400).send({ error: 'invalid width' });
    }
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(await readDemoImage(w));
  });

  fastify.get<{ Params: { tenantId: string; imageId: string; width: string } }>(
    '/:tenantId/:imageId/:width',
    async (request, reply) => {
      const { tenantId, imageId, width } = request.params;
      const w = parseWidth(width);
      if (w === null) {
        return reply.code(400).send({ error: 'invalid width' });
      }

      const obj = await getObject(imagemapSizeKey(tenantId, imageId, w));
      if (!obj) {
        return reply.code(404).send({ error: 'not found' });
      }

      return reply
        .header('Content-Type', obj.contentType || 'image/jpeg')
        .header('Cache-Control', 'public, max-age=86400')
        .send(obj.buffer);
    },
  );
}
