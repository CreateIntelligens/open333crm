/**
 * MinioStorageProvider 的連線設定（原 AUDIT STO-01，已修正）。
 *
 * api 以 S3_* 設定物件儲存（apps/api storage.service），.env.workers 與 UAT 的 workers 也只提供 S3_*。
 * 原本這裡只讀 MINIO_*，沒設定時連到 localhost:9000，在 workers 容器內連回自己，
 * 匯出上傳、資料刪除的媒體檔與頭像檔刪除都失敗。現在：
 *   1. 有 MINIO_ENDPOINT 時沿用 MINIO_*（相容舊設定）。
 *   2. 否則從 S3_ENDPOINT 的網址解析主機、port（沒寫時 http 80、https 443）與 useSSL，金鑰用 S3_ACCESS_KEY、S3_SECRET_KEY。
 *   3. 兩邊都沒有時用本機開發的預設值（localhost:9000、minioadmin），source 是 'default'，由呼叫端寫 warn log。
 * bucket 不在這裡：呼叫端傳入 S3_BUCKET（與 api 上傳的 bucket 相同）。
 */
export interface MinioConnection {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  /** 設定來源：MINIO_*、S3_*，或兩邊都沒設定時的本機預設值 */
  source: 'MINIO' | 'S3' | 'default';
}

type Env = Record<string, string | undefined>;

const DEV_KEY = 'minioadmin';

export function resolveMinioConfig(env: Env = process.env): MinioConnection {
  if (env.MINIO_ENDPOINT) {
    return {
      endPoint: env.MINIO_ENDPOINT,
      port: parseInt(env.MINIO_PORT || '9000', 10),
      useSSL: env.MINIO_USE_SSL === 'true',
      accessKey: env.MINIO_ACCESS_KEY || DEV_KEY,
      secretKey: env.MINIO_SECRET_KEY || DEV_KEY,
      source: 'MINIO',
    };
  }
  if (env.S3_ENDPOINT) {
    let url: URL;
    try {
      url = new URL(env.S3_ENDPOINT);
    } catch {
      throw new Error(`S3_ENDPOINT 不是合法的網址（例如 http://minio:9000），收到「${env.S3_ENDPOINT}」`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`S3_ENDPOINT 要以 http:// 或 https:// 開頭，收到「${env.S3_ENDPOINT}」`);
    }
    const useSSL = url.protocol === 'https:';
    return {
      endPoint: url.hostname,
      port: url.port ? parseInt(url.port, 10) : useSSL ? 443 : 80,
      useSSL,
      accessKey: env.S3_ACCESS_KEY || DEV_KEY,
      secretKey: env.S3_SECRET_KEY || DEV_KEY,
      source: 'S3',
    };
  }
  return { endPoint: 'localhost', port: 9000, useSSL: false, accessKey: DEV_KEY, secretKey: DEV_KEY, source: 'default' };
}
