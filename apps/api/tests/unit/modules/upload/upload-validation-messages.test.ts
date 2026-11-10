/**
 * 上傳被內容偵測拒絕時，回給使用者的訊息是中文、依原因區分；英文原因留在 details 供除錯
 * （issue #470，spec upload-content-detection「Rejected uploads explain the reason in Chinese」）。
 * 偵測器（Magika）換成假的，其餘判斷用真的 detectUploadContent。
 */
import assert from 'node:assert/strict';
import { beforeAll, describe, test } from 'vitest';
import { loadEnvConfig } from '#src/config/env.js';
import { UPLOAD_POLICIES, type UploadMagikaClient } from '#src/modules/upload/upload-content-detector.js';
import { assertUploadContent } from '#src/modules/upload/upload-validation.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAF/gL+3xO+VQAAAABJRU5ErkJggg==',
  'base64',
);
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');

function fakeMagika(label: string, score = 0.99): UploadMagikaClient {
  return { identifyBytes: async () => ({ status: 'ok', prediction: { output: { label }, score } }) };
}

interface RejectedError {
  message: string;
  code: string;
  statusCode: number;
  details?: { reason?: string; detectedMime?: string };
}

async function rejectionOf(promise: Promise<unknown>): Promise<RejectedError> {
  try {
    await promise;
  } catch (error) {
    return error as RejectedError;
  }
  assert.fail('上傳應該被拒絕');
}

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/open333',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'test-jwt-secret-12345',
    CREDENTIAL_ENCRYPTION_KEY: '12345678901234567890123456789012',
    MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
    UPLOAD_CONTENT_DETECTION_ENABLED: 'true',
  });
  loadEnvConfig();
});

describe('Rejected uploads explain the reason in Chinese', () => {
  test('空檔案：提示檔案是空的，details.reason 保留英文原因', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: Buffer.alloc(0), filename: 'logo.png', clientMime: 'image/png' },
      UPLOAD_POLICIES.generic,
      fakeMagika('png'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, '檔案是空的，請重新選擇檔案');
    assert.equal(error.details?.reason, 'empty file');
  });

  test('無法辨識內容：提示無法辨識並列出允許的格式', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: Buffer.from([0, 1, 2, 3, 255, 254, 253, 252]), filename: 'cover.png', clientMime: 'image/png' },
      UPLOAD_POLICIES.conversationImage,
      fakeMagika('unknown'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.message, '無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（JPG、PNG）');
    assert.equal(error.details?.reason, 'file content type is unknown');
  });

  test('偵測信心不足：與無法辨識同一則訊息', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'logo.png', clientMime: 'image/png' },
      UPLOAD_POLICIES.conversationImage,
      fakeMagika('png', 0.2),
    ));
    assert.equal(error.message, '無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（JPG、PNG）');
    assert.equal(error.details?.reason, 'Magika confidence is too low');
  });

  test('類型不允許：說出偵測到的類型與這裡允許的格式', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: pdf, filename: 'manual.pdf', clientMime: 'application/pdf' },
      UPLOAD_POLICIES.imagemap,
      fakeMagika('pdf'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.message, '這裡不接受 PDF 檔案，請改用 JPG、PNG、WEBP');
    assert.equal(error.details?.reason, 'type application/pdf is not allowed for line-imagemap');
    assert.equal(error.details?.detectedMime, 'application/pdf');
  });

  test('內容與副檔名不符：提示副檔名不符', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'document.pdf', clientMime: 'image/png' },
      UPLOAD_POLICIES.generic,
      fakeMagika('png'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.message, '檔案內容（PNG）與副檔名不符，請確認檔案格式或改正副檔名');
    assert.equal(error.details?.reason, 'filename extension does not match image/png');
  });

  test('副檔名正確、只有宣告的類型不符：提示與上傳時標示的類型不符，不說副檔名', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'logo.png', clientMime: 'application/pdf' },
      UPLOAD_POLICIES.generic,
      fakeMagika('png'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.message, '檔案內容（PNG）與上傳時標示的檔案類型不符，請重新選擇檔案');
    assert.equal(error.details?.reason, 'client MIME application/pdf does not match detected MIME image/png');
  });

  test('副檔名與宣告的類型都不符：優先提示副檔名不符', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'photo.pdf', clientMime: 'application/pdf' },
      UPLOAD_POLICIES.generic,
      fakeMagika('png'),
    ));
    assert.equal(error.code, 'INVALID_FILE_TYPE');
    assert.equal(error.message, '檔案內容（PNG）與副檔名不符，請確認檔案格式或改正副檔名');
    assert.equal(error.details?.reason, 'filename extension does not match image/png');
  });

  test('副檔名相符、只有宣告的類型不符（photo.png 宣告 application/pdf）：仍提示與上傳時標示的類型不符', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'photo.png', clientMime: 'application/pdf' },
      UPLOAD_POLICIES.generic,
      fakeMagika('png'),
    ));
    assert.equal(error.message, '檔案內容（PNG）與上傳時標示的檔案類型不符，請重新選擇檔案');
    assert.equal(error.details?.reason, 'client MIME application/pdf does not match detected MIME image/png');
  });

  // PR #492 bot 疑慮：catch 會不會把 400 改成 503。catch 第一行把 AppError 原樣丟出，這裡逐一確認
  test('偵測器正常、檔案被拒時一律回 400 INVALID_FILE_TYPE，不是 503', async () => {
    const cases = [
      { buffer: Buffer.alloc(0), filename: 'a.png', clientMime: 'image/png', label: 'png' },
      { buffer: Buffer.from([0, 1, 2, 3, 255, 254, 253, 252]), filename: 'a.png', clientMime: 'image/png', label: 'unknown' },
      { buffer: pdf, filename: 'a.pdf', clientMime: 'application/pdf', label: 'pdf' },
      { buffer: png, filename: 'a.pdf', clientMime: 'image/png', label: 'png' },
      { buffer: png, filename: 'a.png', clientMime: 'image/jpeg', label: 'png' },
    ];
    for (const c of cases) {
      const error = await rejectionOf(assertUploadContent(
        { buffer: c.buffer, filename: c.filename, clientMime: c.clientMime },
        UPLOAD_POLICIES.imagemap,
        fakeMagika(c.label),
      ));
      assert.equal(error.statusCode, 400, `${c.filename} ${c.clientMime}`);
      assert.equal(error.code, 'INVALID_FILE_TYPE');
    }
  });

  test('偵測暫時無法使用：回 503 中文訊息，錯誤碼不變', async () => {
    const error = await rejectionOf(assertUploadContent(
      { buffer: png, filename: 'logo.png', clientMime: 'image/png' },
      UPLOAD_POLICIES.generic,
      { identifyBytes: async () => { throw new Error('detector internal failure'); } },
    ));
    assert.equal(error.code, 'FILE_TYPE_DETECTION_UNAVAILABLE');
    assert.equal(error.statusCode, 503);
    assert.equal(error.message, '暫時無法檢查檔案內容，請稍後再試');
  });
});
