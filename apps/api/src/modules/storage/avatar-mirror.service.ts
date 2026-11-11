/**
 * 把渠道平台的頭像存進物件儲存（spec inbound-contact-resolution「渠道頭像存進物件儲存」，AUDIT IDENT-06）。
 *
 * FB 的 profile_pic 網址會失效，存自己的網址才不會在收件匣變成縮寫。
 * 網址來自平台 API，仍當成外部輸入：只走 https、每次轉址都重新檢查不指向內部網路。
 */
import { fileTypeFromBuffer } from 'file-type';
import { logger } from '@open333crm/core';
import { isBlockedUrl } from '../webhook/downstream-forwarder.js';
import { deleteFile, getPublicUrl, uploadFile } from './storage.service.js';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** 網址是否已經是本租戶 avatars 目錄的檔案；其他租戶或其他目錄的檔案要重新存 */
export function isStoredAvatarUrl(tenantId: string, url: string): boolean {
  return url.startsWith(getPublicUrl(`${tenantId}/avatars/`));
}

/** 補存產生的 key：{tenantId}/avatars/{uuid}.{ext}（buildStorageKey），ext 由檔案內容決定 */
function isAvatarKey(tenantId: string, key: string): boolean {
  return new RegExp(`^${tenantId}/avatars/[0-9a-f-]{36}\\.(?:jpg|png|webp|gif)$`).test(key);
}

/**
 * 刪除本租戶 avatars 目錄下、補存產生格式的頭像檔；其他網址與檔案不動。失敗只記 log。
 * 規則與 apps/workers data-erasure.handler 的 collectAvatarKeys() 相同。
 */
export async function deleteStoredAvatar(tenantId: string, url: string): Promise<void> {
  if (!isStoredAvatarUrl(tenantId, url)) return;
  const key = url.slice(getPublicUrl('').length);
  if (!isAvatarKey(tenantId, key)) return;
  await deleteFile(key).catch((err) => {
    logger.warn('[AvatarMirror] 刪除頭像檔失敗', err);
  });
}

/** 讀取回應內容，超過上限就停止讀並回 null */
async function readLimited(response: Response, maxBytes: number): Promise<Buffer | null> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * 下載頭像並上傳到 `{tenantId}/avatars/`。
 * @returns 物件儲存的網址；網址不安全、不是允許的圖片、超過 5 MB 或下載失敗時回 null
 */
export async function mirrorAvatar(tenantId: string, sourceUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = sourceUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (await isBlockedUrl(url)) {
        logger.warn('[AvatarMirror] 頭像網址不安全，不下載');
        return null;
      }
      const response = await fetch(url, { redirect: 'manual', signal: controller.signal });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        url = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) {
        logger.warn(`[AvatarMirror] 下載頭像失敗 status=${response.status}`);
        return null;
      }

      const declaredType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const declared = Number(response.headers.get('content-length'));
      if (declared > AVATAR_MAX_BYTES) return null;
      const buffer = await readLimited(response, AVATAR_MAX_BYTES);
      if (!buffer || buffer.length === 0) return null;
      // 回應標頭只當參考（可能是 octet-stream 或亂寫）：以檔頭的 magic bytes 判斷實際類型，上傳時也用判斷出來的類型
      const mimeType = (await fileTypeFromBuffer(buffer))?.mime ?? '';
      const ext = EXT_BY_TYPE[mimeType];
      if (!ext) {
        logger.warn(`[AvatarMirror] 頭像內容不是允許的圖片 declared=${declaredType} detected=${mimeType || 'unknown'}`);
        return null;
      }

      const { url: storedUrl } = await uploadFile(buffer, `avatar${ext}`, mimeType, tenantId, 'avatars');
      return storedUrl;
    }
    logger.warn('[AvatarMirror] 頭像轉址次數過多');
    return null;
  } catch (err) {
    logger.warn('[AvatarMirror] 下載或上傳頭像失敗', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
