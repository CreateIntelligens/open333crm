/**
 * Storage Provider Interface — abstract layer for storage backends.
 */

export interface UploadResult {
  key: string;
  url: string;
}

export interface PresignResult {
  key: string;
  uploadUrl: string;
}

export interface StorageProvider {
  upload(buffer: Buffer, key: string, mimeType: string): Promise<UploadResult>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getPublicUrl(key: string): string;
  delete(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
  presignUpload(key: string, mimeType: string, expiresInSeconds?: number): Promise<PresignResult>;
}
