/**
 * 訊息媒體檔 key 的格式檢查。資料刪除（apps/workers data-erasure.handler）與回收孤兒檔的一次性腳本
 * （scripts/recover-erased-media-orphans.mjs）共用，兩邊只刪同一種 key。
 */

const MEDIA_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.\w+)?$/;

/**
 * 是否為指定對話的媒體檔：`{tenantId}/media/{conversationId}/{uuid}{.ext}`
 * （apps/api storage.service buildStorageKey 的格式）。多層路徑、其他租戶、其他目錄或檔名不是 uuid 都回 false。
 *
 * @param key 物件儲存的 key
 * @param tenantId 必須相同的租戶
 * @param conversationIds 允許的對話 id
 */
export function isConversationMediaKey(key: string, tenantId: string, conversationIds: ReadonlySet<string>): boolean {
  const parts = key.split('/');
  return (
    parts.length === 4 &&
    parts[0] === tenantId &&
    parts[1] === 'media' &&
    conversationIds.has(parts[2]) &&
    MEDIA_FILE_NAME.test(parts[3])
  );
}
