/**
 * Storage Service — S3-compatible file storage (MinIO/S3)
 *
 * Uses StorageProvider pattern internally. Public API remains backward-compatible.
 */

import { getConfig } from '../../config/env.js';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { S3StorageProvider } from './s3.provider.js';
import type { StorageProvider } from './storage.provider.js';
import { assertUploadContent } from '../upload/upload-validation.js';
import { UPLOAD_POLICIES } from '../upload/upload-content-detector.js';
import { AppError } from '../../shared/utils/response.js';
import { logger } from '@open333crm/core';
import { LINE_VIDEO_MAX_BYTES } from '@open333crm/shared';
import type { UploadDetectionPolicy } from '../upload/upload-content-detector.js';

let _provider: StorageProvider | null = null;

function getProvider(): StorageProvider {
  if (_provider) return _provider;
  const config = getConfig();
  _provider = new S3StorageProvider({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    bucket: config.S3_BUCKET,
    publicUrl: config.S3_PUBLIC_URL,
    setAcl: config.S3_SET_ACL === 1,
  });
  return _provider;
}

/** Test-only provider override so quarantine lifecycle tests do not need MinIO. */
export function setStorageProviderForTests(provider: StorageProvider | null): void {
  _provider = provider;
}

export type StorageDirectory = 'media' | 'templates' | 'exports' | 'avatars' | 'imagemap';
export type QuarantineDirectory = StorageDirectory | 'knowledge';

/**
 * 直傳的用途：大小上限與允許的內容類型（spec upload-content-detection「Presigned upload limits by purpose」）。
 * generic 與 multipart 上傳（@fastify/multipart fileSize）同為 25MB；line-video 是 LINE 影片訊息的上限。
 */
export const UPLOAD_PURPOSES = {
  generic: { maxBytes: 25 * 1024 * 1024, policy: UPLOAD_POLICIES.generic },
  'line-video': { maxBytes: LINE_VIDEO_MAX_BYTES, policy: UPLOAD_POLICIES.lineVideo },
} as const satisfies Record<string, { maxBytes: number; policy: UploadDetectionPolicy }>;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

/** 內容偵測只需要開頭（file-type、Office zip 判斷）與結尾（Magika）；小於此大小整份讀 */
const SAMPLE_HEAD_BYTES = 1024 * 1024;
const SAMPLE_TAIL_BYTES = 64 * 1024;

function tooLarge(maxBytes: number): AppError {
  return new AppError(`檔案超過上限 ${Math.round(maxBytes / 1024 / 1024)} MB`, 'FILE_TOO_LARGE', 413, { maxBytes });
}

/**
 * Build an organized storage key: {tenantId}/{directory}/{subPath?}/{uuid}.{ext}
 */
export function buildStorageKey(
  tenantId: string,
  directory: StorageDirectory,
  filename: string,
  subPath?: string,
): string {
  const ext = extname(filename) || '';
  const parts = [tenantId, directory];
  if (subPath) parts.push(subPath);
  parts.push(`${randomUUID()}${ext}`);
  return parts.join('/');
}

export function buildQuarantineKey(
  tenantId: string,
  filename: string,
  directory: QuarantineDirectory = 'media',
): string {
  if (!/^[a-z0-9-]+$/i.test(directory)) {
    throw new AppError('隔離區路徑不正確', 'BAD_REQUEST', 400);
  }
  return `${tenantId}/quarantine/${directory}/${randomUUID()}${extname(filename) || ''}`;
}

export function isTenantQuarantineKey(key: string, tenantId: string): boolean {
  const parts = key.split('/');
  return (
    parts.length === 4 &&
    parts[0] === tenantId &&
    parts[1] === 'quarantine' &&
    /^[a-z0-9-]+$/i.test(parts[2]) &&
    /^[0-9a-f-]{36}(?:\.[a-z0-9]+)?$/i.test(parts[3])
  );
}

/**
 * Ensure the bucket exists, creating it if necessary.
 */
export async function ensureBucket(): Promise<void> {
  await getProvider().ensureBucket();
}

/**
 * Upload a file to S3/MinIO.
 * Returns the storage key and public URL.
 */
export async function uploadFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  tenantId: string,
  directory?: StorageDirectory,
  subPath?: string,
): Promise<{ key: string; url: string }> {
  const key = directory
    ? buildStorageKey(tenantId, directory, originalFilename, subPath)
    : `${tenantId}/${randomUUID()}${extname(originalFilename) || ''}`;

  return getProvider().upload(buffer, key, mimeType);
}

/**
 * Get a presigned URL for downloading a file.
 */
export async function getFileUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getProvider().getSignedUrl(key, expiresInSeconds);
}

/**
 * Get a public (non-presigned) URL for a file.
 */
export function getPublicUrl(key: string): string {
  return getProvider().getPublicUrl(key);
}

/**
 * Delete a file from S3/MinIO.
 */
export async function deleteFile(key: string): Promise<void> {
  await getProvider().delete(key);
}

/**
 * 簽發直傳網址（15 分鐘內有效）。宣告的大小簽進網址，超過用途上限時不簽發。
 */
export async function presignUpload(
  tenantId: string,
  input: { filename: string; mimeType: string; size: number; purpose?: UploadPurpose; directory?: StorageDirectory },
): Promise<{ key: string; uploadUrl: string }> {
  const { maxBytes } = UPLOAD_PURPOSES[input.purpose ?? 'generic'];
  if (input.size > maxBytes) throw tooLarge(maxBytes);
  const key = buildQuarantineKey(tenantId, input.filename, input.directory ?? 'media');
  return getProvider().presignUpload(key, input.mimeType, input.size);
}

/** 讀取偵測用的片段：大檔只讀開頭與結尾，接在一起後偵測結果與整份相同 */
async function readDetectionSample(provider: StorageProvider, key: string, size: number): Promise<Buffer | null> {
  if (size <= SAMPLE_HEAD_BYTES + SAMPLE_TAIL_BYTES) {
    return size === 0 ? Buffer.alloc(0) : provider.getObjectRange(key, 0, size - 1);
  }
  const head = await provider.getObjectRange(key, 0, SAMPLE_HEAD_BYTES - 1);
  const tail = await provider.getObjectRange(key, size - SAMPLE_TAIL_BYTES, size - 1);
  return head && tail ? Buffer.concat([head, tail]) : null;
}

/**
 * 直傳完成：檢查大小與內容，通過後用 storage 端複製轉成正式檔（內容不經過 API），刪除隔離檔。
 */
export async function completePresignedUpload(
  tenantId: string,
  input: { key: string; filename: string; mimeType: string; purpose?: UploadPurpose; directory?: StorageDirectory },
): Promise<{ key: string; url: string; detectedMime?: string }> {
  const { key, filename, mimeType } = input;
  if (!isTenantQuarantineKey(key, tenantId)) {
    throw new AppError('隔離區檔案不正確', 'FORBIDDEN', 403);
  }
  const { maxBytes, policy } = UPLOAD_PURPOSES[input.purpose ?? 'generic'];
  const provider = getProvider();

  const head = await provider.headObject(key);
  if (!head) {
    throw new AppError('找不到此檔案', 'NOT_FOUND', 404);
  }

  let promotedKey: string | undefined;
  try {
    if (head.size > maxBytes) throw tooLarge(maxBytes);
    const sample = await readDetectionSample(provider, key, head.size);
    if (!sample) throw new AppError('找不到此檔案', 'NOT_FOUND', 404);

    const detected = await assertUploadContent({ buffer: sample, filename, clientMime: mimeType }, policy);
    const detectedMime = detected.detectedMime ?? mimeType;
    const promoted = await provider.copy(key, buildStorageKey(tenantId, input.directory ?? 'media', filename), detectedMime);
    promotedKey = promoted.key;
    await deleteFile(key);
    return { ...promoted, detectedMime };
  } catch (error) {
    if (promotedKey) await deleteFile(promotedKey).catch((cleanupError) => logger.warn('[Storage] failed to clean promoted object', cleanupError));
    await deleteFile(key).catch((cleanupError) => logger.warn('[Storage] failed to clean quarantine object', cleanupError));
    throw error;
  }
}

export async function getObject(key: string, maxBytes?: number): Promise<{ buffer: Buffer; contentType?: string } | null> {
  return getProvider().getObject(key, maxBytes);
}

// ─── LINE imagemap 多尺寸底圖 ─────────────────────────────────────

/** LINE imagemap 要求底圖提供的 5 種寬度（LINE 依裝置抓對應解析度）。 */
export const IMAGEMAP_WIDTHS = [240, 300, 460, 700, 1040] as const;

/** imagemap 一組多尺寸圖的 MinIO key 前綴（不含尺寸）：{tenantId}/imagemap/{imageId}/ */
export function imagemapKeyPrefix(tenantId: string, imageId: string): string {
  return `${tenantId}/imagemap/${imageId}`;
}

/** 單一尺寸的 key：{tenantId}/imagemap/{imageId}/{width}（刻意不含副檔名，對齊 LINE baseUrl/{width} 規範）。 */
export function imagemapSizeKey(tenantId: string, imageId: string, width: number): string {
  return `${imagemapKeyPrefix(tenantId, imageId)}/${width}`;
}

/**
 * 上傳 imagemap 底圖：用 sharp 把原圖產生 5 種寬度（等比縮放，只縮不放大），
 * 每個尺寸存成一個不含副檔名的 MinIO key。回傳 imageId 供組 baseUrl。
 * LINE 抓圖走公開 route `/line-imagemap/{tenantId}/{imageId}/{width}`。
 */
export async function uploadImagemapBase(
  buffer: Buffer,
  tenantId: string,
): Promise<{ imageId: string }> {
  const { default: sharp } = await import('sharp');
  const imageId = randomUUID();

  await Promise.all(
    IMAGEMAP_WIDTHS.map(async (width) => {
      const resized = await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      await getProvider().upload(resized, imagemapSizeKey(tenantId, imageId, width), 'image/jpeg');
    }),
  );

  return { imageId };
}
