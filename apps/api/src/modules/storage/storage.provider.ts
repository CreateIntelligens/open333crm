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
  getObject(key: string, maxBytes?: number): Promise<{ buffer: Buffer; contentType?: string } | null>;
  delete(key: string): Promise<void>;
  ensureBucket(): Promise<void>;
  /** 只查大小，不讀內容；找不到回 null */
  headObject(key: string): Promise<{ size: number } | null>;
  /** 讀取 [start, end]（含 end）的片段；找不到回 null */
  getObjectRange(key: string, start: number, end: number): Promise<Buffer | null>;
  /** storage 端複製成新物件，內容不經過 API */
  copy(fromKey: string, toKey: string, mimeType: string): Promise<UploadResult>;
  /**
   * 簽發瀏覽器用的上傳網址。contentLength 簽進網址，實際上傳的大小不同時 storage 拒收。
   */
  presignUpload(key: string, mimeType: string, contentLength: number, expiresInSeconds?: number): Promise<PresignResult>;
}
