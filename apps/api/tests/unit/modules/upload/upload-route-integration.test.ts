import assert from 'node:assert/strict';
import Fastify, { type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { loadEnvConfig } from '../config/env.js';
import { AppError } from '../shared/utils/response.js';
import storageRoutes from '../modules/storage/storage.routes.js';
import { preloadUploadContentDetector } from '../modules/upload/upload-content-detector.js';
import { setStorageProviderForTests } from '../modules/storage/storage.service.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-12345',
  CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
  MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
  UPLOAD_CONTENT_DETECTION_ENABLED: 'true',
});
loadEnvConfig();
await preloadUploadContentDetector();

const tenantId = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+3xO+VQAAAABJRU5ErkJggg==',
  'base64',
);
const uploaded: string[] = [];

setStorageProviderForTests({
  upload: async (_buffer, key) => {
    uploaded.push(key);
    return { key, url: `https://storage.example/${key}` };
  },
  getSignedUrl: async (key) => `https://storage.example/signed/${key}`,
  getPublicUrl: (key) => `https://storage.example/${key}`,
  getObject: async () => null,
  delete: async () => {},
  ensureBucket: async () => {},
  presignUpload: async (key) => ({ key, uploadUrl: `https://storage.example/upload/${key}` }),
});

function multipartFile(filename: string, mimeType: string, buffer: Buffer) {
  const boundary = '----open333crm-upload-integration';
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([prefix, buffer, suffix]),
  };
}

async function createApp() {
  const app = Fastify();
  await app.register(multipart);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: 'agent-1', tenantId, role: 'AGENT' };
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: error.message });
  });
  await app.register(storageRoutes, { prefix: '/files' });
  return app;
}

const app = await createApp();

const genericRejected = await app.inject({
  method: 'POST',
  url: '/files/upload',
  ...multipartFile('document.pdf', 'image/png', png),
});
assert.equal(genericRejected.statusCode, 400);
assert.equal(genericRejected.json().code, 'INVALID_FILE_TYPE');
assert.equal(uploaded.length, 0);

const imagemapRejected = await app.inject({
  method: 'POST',
  url: '/files/imagemap-upload',
  ...multipartFile('document.pdf', 'image/png', png),
});
assert.equal(imagemapRejected.statusCode, 400);
assert.equal(imagemapRejected.json().code, 'INVALID_FILE_TYPE');
assert.equal(uploaded.length, 0);

const accepted = await app.inject({
  method: 'POST',
  url: '/files/upload',
  ...multipartFile('image.png', 'image/png', png),
});
assert.equal(accepted.statusCode, 201);
assert.equal(uploaded.length, 1);

setStorageProviderForTests(null);
await app.close();
console.log('upload route integration tests passed');
process.exit(0);
