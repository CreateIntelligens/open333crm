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
  });
  return _provider;
}

export type StorageDirectory = 'media' | 'templates' | 'exports' | 'avatars';

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
