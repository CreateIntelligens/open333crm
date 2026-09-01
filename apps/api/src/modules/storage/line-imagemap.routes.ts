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
 */

import type { FastifyInstance } from 'fastify';
import { getObject, imagemapSizeKey, IMAGEMAP_WIDTHS } from './storage.service.js';

const ALLOWED_WIDTHS = new Set<number>(IMAGEMAP_WIDTHS);

export default async function lineImagemapRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { tenantId: string; imageId: string; width: string } }>(
    '/:tenantId/:imageId/:width',
    async (request, reply) => {
      const { tenantId, imageId, width } = request.params;
      // LINE 有時會帶副檔名（如 .../1040.png）；去掉再解析。
      const w = Number(width.replace(/\.(png|jpe?g|webp)$/i, ''));
      if (!ALLOWED_WIDTHS.has(w)) {
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
