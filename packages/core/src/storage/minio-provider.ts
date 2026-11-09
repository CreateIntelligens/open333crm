import * as Minio from 'minio';
import { StorageProvider } from './index.js';
import { logger } from '../logger/index.js';
import { resolveMinioConfig } from './minio-config.js';

/** 兩邊都沒設定時，每個行程只警告一次 */
let warnedDefault = false;

export class MinioStorageProvider implements StorageProvider {
  private client: Minio.Client;

  constructor() {
    const { source, ...connection } = resolveMinioConfig();
    if (source === 'default' && !warnedDefault) {
      warnedDefault = true;
      logger.warn(
        '[storage] 沒有設定 S3_ENDPOINT（或 MINIO_ENDPOINT），MinIO 連線使用本機預設值 localhost:9000 與 minioadmin。' +
          '容器內會連回自己，請設定與 api 相同的 S3_ENDPOINT、S3_ACCESS_KEY、S3_SECRET_KEY（原 AUDIT STO-01，已修正）',
      );
    }
    this.client = new Minio.Client(connection);
  }

  async upload(
    bucket: string,
    key: string,
    file: Buffer | ReadableStream | string,
    contentType?: string
  ): Promise<string> {
    try {
      // Ensure bucket exists
      const exists = await this.client.bucketExists(bucket);
      if (!exists) {
        await this.client.makeBucket(bucket);
      }

      await this.client.putObject(bucket, key, file as any, {
        'Content-Type': contentType || 'application/octet-stream',
      } as any);

      return this.getPublicUrl(bucket, key);
    } catch (err) {
      logger.error('MinIO upload error:', err);
      throw err;
    }
  }

  async getPublicUrl(bucket: string, key: string): Promise<string> {
    // In a real production environment, this would be a CDN URL or a permanent presigned URL.
    // For local dev, we construct the URL pointing to the MinIO API or a proxy.
    const endpoint = process.env.MINIO_PUBLIC_ENDPOINT || `http://localhost:9000`;
    return `${endpoint}/${bucket}/${key}`;
  }

  /**
   * 列出 bucket 裡以 prefix 開頭的所有物件 key（遞迴，含子目錄）。回收孤兒檔的一次性腳本用（issue #474）。
   * 列出途中出錯時整個丟出，不回傳部分結果：只拿到一部分會讓呼叫端以為其他檔案不存在。
   */
  list(bucket: string, prefix: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      const stream = this.client.listObjectsV2(bucket, prefix, true);
      stream.on('data', (item: { name?: string }) => {
        if (item.name) keys.push(item.name);
      });
      stream.on('error', (err: Error) => {
        logger.error('MinIO list error:', err);
        reject(err);
      });
      stream.on('end', () => resolve(keys));
    });
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, key);
    } catch (err) {
      logger.error('MinIO delete error:', err);
      throw err;
    }
  }
}
