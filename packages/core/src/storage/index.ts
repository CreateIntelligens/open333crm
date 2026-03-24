export interface StorageProvider {
  upload(
    bucket: string,
    key: string,
    file: Buffer | ReadableStream,
    contentType?: string
  ): Promise<string>;
  getPublicUrl(bucket: string, key: string): Promise<string>;
  delete(bucket: string, key: string): Promise<void>;
}
