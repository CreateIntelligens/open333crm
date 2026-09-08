import assert from 'node:assert/strict';
import { loadEnvConfig, parseEnvConfig } from '../config/env.js';
import {
  detectUploadContent,
  UPLOAD_POLICIES,
} from '../modules/upload/upload-content-detector.js';
import { assertUploadContent } from '../modules/upload/upload-validation.js';

const requiredEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-12345',
  CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
  MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
  UPLOAD_CONTENT_DETECTION_ENABLED: 'true',
};

Object.assign(process.env, requiredEnv);
assert.equal(parseEnvConfig(requiredEnv).UPLOAD_CONTENT_DETECTION_ENABLED, true);
assert.equal(parseEnvConfig({ ...requiredEnv, UPLOAD_CONTENT_DETECTION_ENABLED: 'false' }).UPLOAD_CONTENT_DETECTION_ENABLED, false);
loadEnvConfig();

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const docx = Buffer.from('504b0304' + '00000000'.repeat(4) + '5b436f6e74656e745f54797065735d2e786d6c' + '776f72642f646f63756d656e742e786d6c', 'hex');
const xlsx = Buffer.from('504b0304' + '00000000'.repeat(4) + '5b436f6e74656e745f54797065735d2e786d6c' + '786c2f776f726b626f6f6b2e786d6c', 'hex');
const fakeMagika = (label: string, score = 0.99) => ({
  identifyBytes: async () => ({ status: 'ok', prediction: { output: { label }, score } }),
});

const pngResult = await detectUploadContent({
  buffer: png,
  filename: 'logo.png',
  clientMime: 'image/png',
  policy: UPLOAD_POLICIES.generic,
}, fakeMagika('png'));
assert.equal(pngResult.accepted, true);
assert.equal(pngResult.detectedMime, 'image/png');

const forgedMime = await detectUploadContent({
  buffer: png,
  filename: 'logo.png',
  clientMime: 'application/pdf',
  policy: UPLOAD_POLICIES.generic,
}, fakeMagika('png'));
assert.equal(forgedMime.accepted, false);
assert.match(forgedMime.reason, /MIME|mimetype/i);

const mismatchedExtension = await detectUploadContent({
  buffer: png,
  filename: 'document.pdf',
  clientMime: 'image/png',
  policy: UPLOAD_POLICIES.generic,
}, fakeMagika('png'));
assert.equal(mismatchedExtension.accepted, false);
assert.match(mismatchedExtension.reason, /extension/i);

const pdfResult = await detectUploadContent({
  buffer: pdf,
  filename: 'manual.pdf',
  clientMime: 'application/pdf',
  policy: UPLOAD_POLICIES.knowledge,
}, fakeMagika('pdf'));
assert.equal(pdfResult.accepted, true);
assert.equal(pdfResult.detectedMime, 'application/pdf');

const docxResult = await detectUploadContent({
  buffer: docx,
  filename: 'manual.docx',
  clientMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  policy: UPLOAD_POLICIES.knowledge,
}, fakeMagika('docx'));
assert.equal(docxResult.accepted, true);
assert.equal(docxResult.detectedMime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

const xlsxResult = await detectUploadContent({
  buffer: xlsx,
  filename: 'faq.xlsx',
  clientMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  policy: UPLOAD_POLICIES.knowledge,
}, fakeMagika('xlsx'));
assert.equal(xlsxResult.accepted, true);
assert.equal(xlsxResult.detectedMime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

const textResult = await detectUploadContent({
  buffer: Buffer.from('# Open333\n\nKnowledge base'),
  filename: 'README.md',
  clientMime: 'text/markdown',
  policy: UPLOAD_POLICIES.knowledge,
}, fakeMagika('markdown'));
assert.equal(textResult.accepted, true);

const lowConfidence = await detectUploadContent({
  buffer: png,
  filename: 'logo.png',
  clientMime: 'image/png',
  policy: UPLOAD_POLICIES.generic,
}, fakeMagika('png', 0.2));
assert.equal(lowConfidence.accepted, false);

const unknownResult = await detectUploadContent({
  buffer: Buffer.from([0, 1, 2, 3, 255, 254, 253, 252]),
  filename: 'payload.bin',
  clientMime: 'application/octet-stream',
  policy: UPLOAD_POLICIES.generic,
}, fakeMagika('unknown', 0.1));
assert.equal(unknownResult.accepted, false);

await assert.rejects(
  assertUploadContent(
    { buffer: Buffer.from('secret file bytes'), filename: 'broken.txt', clientMime: 'text/plain' },
    UPLOAD_POLICIES.knowledge,
    { identifyBytes: async () => { throw new Error('detector internal failure'); } },
  ),
  (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'FILE_TYPE_DETECTION_UNAVAILABLE');
    assert.equal((error as { statusCode?: number }).statusCode, 503);
    assert.equal((error as Error).message.includes('secret file bytes'), false);
    return true;
  },
);

process.exit(0);
