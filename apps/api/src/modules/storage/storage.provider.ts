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
  /** 取出物件內容為 Buffer（供 API route 內部代理讀取，如 imagemap 公開圖端）。找不到回 null。 */
  getObject(key: string): Promise<{ buffer: Buffer; contentType?: string } | null>;
  delete(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
  presignUpload(key: string, mimeType: string, expiresInSeconds?: number): Promise<PresignResult>;
}
