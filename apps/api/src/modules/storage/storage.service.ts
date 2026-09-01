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

export type StorageDirectory = 'media' | 'templates' | 'exports' | 'avatars' | 'imagemap';

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
 * Generate a presigned PUT URL for direct client upload.
 * Returns the storage key and upload URL (valid for 15 minutes by default).
 */
export async function presignUpload(
  tenantId: string,
  filename: string,
  mimeType: string,
  directory: StorageDirectory = 'media',
  subPath?: string,
): Promise<{ key: string; uploadUrl: string }> {
  const key = buildStorageKey(tenantId, directory, filename, subPath);
  return getProvider().presignUpload(key, mimeType);
}

/** 取出物件內容為 Buffer（供公開圖端 route 代理讀取）。找不到回 null。 */
export async function getObject(key: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  return getProvider().getObject(key);
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
