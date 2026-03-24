import * as Minio from 'minio';
import { StorageProvider } from './index';
import { logger } from '../logger';

export class MinioStorageProvider implements StorageProvider {
  private client: Minio.Client;

  constructor() {
    this.client = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });
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

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.removeObject(bucket, key);
    } catch (err) {
      logger.error('MinIO delete error:', err);
      throw err;
    }
  }
}
