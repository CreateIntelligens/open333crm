import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';
import { uploadFile, deleteFile, presignUpload, uploadImagemapBase } from './storage.service.js';

/** API 對外可達的 base URL（imagemap baseUrl 用；隧道測試時設 API_PUBLIC_URL 指向 ngrok）。 */
function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL || process.env.API_BASE_URL || `http://localhost:${process.env.API_PORT || 3001}`).replace(/\/$/, '');
}

export default async function storageRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // POST /api/v1/files/upload — multipart file upload
  fastify.post('/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError('No file uploaded', 'BAD_REQUEST', 400);
    }

    const buffer = await file.toBuffer();
    const result = await uploadFile(
      buffer,
      file.filename,
      file.mimetype,
      request.agent.tenantId,
    );

    return reply.status(201).send(
      success({
        key: result.key,
        url: result.url,
        filename: file.filename,
        mimeType: file.mimetype,
        size: buffer.length,
      }),
    );
  });

  // POST /api/v1/files/imagemap-upload — LINE imagemap 底圖上傳（產 5 尺寸）
  // 回傳 baseUrl（不含尺寸/副檔名），供 imagemap body 的 baseImageUrl；LINE 抓圖走公開 route。
  fastify.post('/imagemap-upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError('No file uploaded', 'BAD_REQUEST', 400);
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      throw new AppError('底圖需為 JPEG / PNG / WebP 格式', 'BAD_REQUEST', 400);
    }
    const buffer = await file.toBuffer();
    const { imageId } = await uploadImagemapBase(buffer, request.agent.tenantId);
    const baseUrl = `${apiPublicUrl()}/line-imagemap/${request.agent.tenantId}/${imageId}`;

    return reply.status(201).send(
      success({
        imageId,
        baseUrl, // 存進 material body 的 baseImageUrl；LINE 會接 /{width} 抓對應尺寸
      }),
    );
  });

  // POST /api/v1/files/presign-upload — get presigned PUT URL for direct upload
  fastify.post('/presign-upload', async (request, reply) => {
    const body = z.object({
      filename: z.string().min(1),
      mimeType: z.string().min(1),
      directory: z.enum(['media', 'templates', 'exports', 'avatars']).optional(),
    }).parse(request.body);

    const result = await presignUpload(
      request.agent.tenantId,
      body.filename,
      body.mimeType,
      body.directory,
    );

    return reply.send(success(result));
  });

  // DELETE /api/v1/files/:key — delete a file
  fastify.delete<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const key = (request.params as any)['*'];
    if (!key) {
      throw new AppError('File key is required', 'BAD_REQUEST', 400);
    }

    // Ensure the key belongs to the tenant
    if (!key.startsWith(request.agent.tenantId)) {
      throw new AppError('Access denied', 'FORBIDDEN', 403);
    }

    await deleteFile(key);
    return reply.send(success({ deleted: true, key }));
  });
}
