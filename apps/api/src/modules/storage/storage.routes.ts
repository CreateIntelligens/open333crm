import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';
import { completePresignedUpload, uploadFile, deleteFile, presignUpload, uploadImagemapBase, UPLOAD_PURPOSES, type UploadPurpose } from './storage.service.js';
import { assertUploadContent } from '../upload/upload-validation.js';
import { UPLOAD_POLICIES } from '../upload/upload-content-detector.js';

const UPLOAD_PURPOSE_NAMES = Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]];

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
      throw new AppError('請選擇要上傳的檔案', 'BAD_REQUEST', 400);
    }

    const buffer = await file.toBuffer();
    const detected = await assertUploadContent(
      { buffer, filename: file.filename, clientMime: file.mimetype },
      UPLOAD_POLICIES.generic,
    );
    const detectedMime = detected.detectedMime ?? file.mimetype;
    const result = await uploadFile(
      buffer,
      file.filename,
      detectedMime,
      request.agent.tenantId,
    );

    return reply.status(201).send(
      success({
        key: result.key,
        url: result.url,
        filename: file.filename,
        mimeType: detectedMime,
        size: buffer.length,
      }),
    );
  });

  // POST /api/v1/files/imagemap-upload — LINE imagemap 底圖上傳（產 5 尺寸）
  // 回傳 baseUrl（不含尺寸/副檔名），供 imagemap body 的 baseImageUrl；LINE 抓圖走公開 route。
  fastify.post('/imagemap-upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError('請選擇要上傳的檔案', 'BAD_REQUEST', 400);
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      throw new AppError('底圖需為 JPEG / PNG / WebP 格式', 'BAD_REQUEST', 400);
    }
    const buffer = await file.toBuffer();
    await assertUploadContent(
      { buffer, filename: file.filename, clientMime: file.mimetype },
      UPLOAD_POLICIES.imagemap,
    );
    const { imageId } = await uploadImagemapBase(buffer, request.agent.tenantId);
    const baseUrl = `${apiPublicUrl()}/line-imagemap/${request.agent.tenantId}/${imageId}`;

    return reply.status(201).send(
      success({
        imageId,
        baseUrl, // 存進 material body 的 baseImageUrl；LINE 會接 /{width} 抓對應尺寸
      }),
    );
  });

  // POST /api/v1/files/presign-upload — 申請直傳網址（大小簽進網址，依用途限制上限）
  fastify.post('/presign-upload', async (request, reply) => {
    const body = z.object({
      filename: z.string().min(1),
      mimeType: z.string().min(1),
      size: z.number().int().positive(),
      purpose: z.enum(UPLOAD_PURPOSE_NAMES).optional(),
      directory: z.enum(['media', 'templates', 'exports', 'avatars']).optional(),
    }).parse(request.body);

    const result = await presignUpload(request.agent.tenantId, body);
    return reply.send(success(result));
  });

  // POST /api/v1/files/complete-upload — 檢查直傳的檔案，通過後轉成正式檔
  fastify.post('/complete-upload', async (request, reply) => {
    const body = z.object({
      key: z.string().min(1),
      filename: z.string().min(1),
      mimeType: z.string().min(1),
      purpose: z.enum(UPLOAD_PURPOSE_NAMES).optional(),
      directory: z.enum(['media', 'templates', 'exports', 'avatars']).optional(),
    }).parse(request.body);

    const result = await completePresignedUpload(request.agent.tenantId, body);
    return reply.status(201).send(success(result));
  });

  // DELETE /api/v1/files/:key — delete a file
  fastify.delete<{ Params: { '*': string } }>('/*', async (request, reply) => {
    const key = (request.params as any)['*'];
    if (!key) {
      throw new AppError('請提供檔案識別碼', 'BAD_REQUEST', 400);
    }

    // Ensure the key belongs to the tenant
    if (!key.startsWith(request.agent.tenantId)) {
      throw new AppError('沒有存取權限', 'FORBIDDEN', 403);
    }

    await deleteFile(key);
    return reply.send(success({ deleted: true, key }));
  });
}
