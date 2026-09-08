import assert from 'node:assert/strict';
import { loadEnvConfig } from '../config/env.js';
import { preloadUploadContentDetector } from '../modules/upload/upload-content-detector.js';
import {
  buildQuarantineKey,
  completePresignedUpload,
  setStorageProviderForTests,
} from '../modules/storage/storage.service.js';

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
const objects = new Map<string, { buffer: Buffer; contentType?: string }>();
const uploaded: string[] = [];
const deleted: string[] = [];

setStorageProviderForTests({
  upload: async (buffer, key, mimeType) => {
    uploaded.push(key);
    objects.set(key, { buffer, contentType: mimeType });
    return { key, url: `https://storage.example/${key}` };
  },
  getSignedUrl: async (key) => `https://storage.example/signed/${key}`,
  getPublicUrl: (key) => `https://storage.example/${key}`,
  getObject: async (key) => objects.get(key) ?? null,
  delete: async (key) => {
    deleted.push(key);
    objects.delete(key);
  },
  ensureBucket: async () => {},
  presignUpload: async (key) => ({ key, uploadUrl: `https://storage.example/upload/${key}` }),
} as never);

const acceptedKey = buildQuarantineKey(tenantId, 'README.md', 'media');
objects.set(acceptedKey, { buffer: Buffer.from('# Open333\nKnowledge base'), contentType: 'text/markdown' });
const accepted = await completePresignedUpload(tenantId, acceptedKey, 'README.md', 'text/markdown');
assert.match(accepted.key, new RegExp(`^${tenantId}/media/`));
assert.equal(accepted.detectedMime, 'text/markdown');
assert.equal(objects.has(acceptedKey), false);
assert.equal(deleted.includes(acceptedKey), true);

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+3xO+VQAAAABJRU5ErkJggg==', 'base64');
const rejectedKey = buildQuarantineKey(tenantId, 'document.pdf', 'media');
objects.set(rejectedKey, { buffer: png, contentType: 'image/png' });
await assert.rejects(
  completePresignedUpload(tenantId, rejectedKey, 'document.pdf', 'image/png'),
  (error: unknown) => (error as { code?: string }).code === 'INVALID_FILE_TYPE',
);
assert.equal(objects.has(rejectedKey), false);
assert.equal(uploaded.some((key) => key.endsWith('.pdf')), false);

setStorageProviderForTests(null);
process.exit(0);
