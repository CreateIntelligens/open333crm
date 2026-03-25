import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { success } from '../../shared/utils/response.js';
import { AppError } from '../../shared/utils/response.js';
import { uploadFile, deleteFile, presignUpload } from './storage.service.js';

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
