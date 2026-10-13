/**
 * S3 Storage Provider — implements StorageProvider for S3/MinIO.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider, UploadResult, PresignResult } from './storage.provider.js';
import { logger } from '@open333crm/core';

export interface S3ProviderConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
  setAcl?: boolean;
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  /**
   * 簽瀏覽器上傳網址用的 client。簽名包含主機名稱，用內部的 S3_ENDPOINT（例如 minio:9000）簽，
   * 瀏覽器連不到；改打公開網域又因主機不同被拒（SignatureDoesNotMatch）。
   */
  private publicClient: S3Client;
  private bucket: string;
  private publicUrl: string;
  private setAcl: boolean;

  constructor(config: S3ProviderConfig) {
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials,
      forcePathStyle: true,
    });
    this.publicClient = new S3Client({
      endpoint: config.publicUrl,
      region: config.region,
      credentials,
      forcePathStyle: true,
      // 預設會把「空內容」的 CRC32 簽進網址，S3 會拒收真正的檔案
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl;
    this.setAcl = config.setAcl ?? true;
  }

  async upload(buffer: Buffer, key: string, mimeType: string): Promise<UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ...(this.setAcl ? { ACL: 'public-read' } : {}),
      }),
    );
    const url = `${this.publicUrl}/${this.bucket}/${key}`;
    return { key, url };
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${this.bucket}/${key}`;
  }

  async getObject(key: string, maxBytes?: number): Promise<{ buffer: Buffer; contentType?: string } | null> {
    try {
      if (maxBytes !== undefined) {
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        if (head.ContentLength !== undefined && head.ContentLength > maxBytes) return null;
      }
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { buffer: Buffer.from(bytes), contentType: res.ContentType };
    } catch (err) {
      // 找不到物件（NoSuchKey）或其他讀取錯誤 → 回 null，由呼叫端回 404。
      if ((err as { name?: string })?.name === 'NoSuchKey') return null;
      logger.warn(`[Storage] getObject failed for key ${key}:`, err);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        logger.info(`[Storage] Created bucket: ${this.bucket}`);
      } catch (createErr) {
        logger.warn(`[Storage] Bucket creation warning:`, createErr);
      }
    }
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0 };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name !== 'NotFound' && name !== 'NoSuchKey') logger.warn(`[Storage] headObject failed for key ${key}:`, err);
      return null;
    }
  }

  async getObjectRange(key: string, start: number, end: number): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string })?.name === 'NoSuchKey') return null;
      logger.warn(`[Storage] getObjectRange failed for key ${key}:`, err);
      return null;
    }
  }

  async copy(fromKey: string, toKey: string, mimeType: string): Promise<UploadResult> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: toKey,
        CopySource: `${this.bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}`,
        ContentType: mimeType,
        MetadataDirective: 'REPLACE',
        ...(this.setAcl ? { ACL: 'public-read' } : {}),
      }),
    );
    return { key: toKey, url: this.getPublicUrl(toKey) };
  }

  async presignUpload(key: string, mimeType: string, contentLength: number, expiresInSeconds = 900): Promise<PresignResult> {
    const uploadUrl = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: contentLength,
      }),
      { expiresIn: expiresInSeconds },
    );
    return { key, uploadUrl };
  }
}
