/**
 * 成員 socket 連線的房間名稱（issue #427，主規格 socket-room-authorization）。
 *
 * API（events/socket-push.ts、socket 連線）與 workers（經 Redis `socket:emit` 推播）共用這份命名，
 * 兩個行程才會推到同一個房間。
 *
 * 渠道相關的推播（訊息內容、對話更新）只送到渠道房間：
 *   - `tenant:<租戶 ID>:channel:<渠道 ID>`：看得到該渠道、沒有 `channel.view_all` 的成員
 *   - `tenant:<租戶 ID>:channels:all`：有 `channel.view_all` 的成員（總店），新渠道不必重新加入
 * 一位成員只會在其中一種房間，所以同一則推播同時送到兩種房間時不會重複收到。
 */

/** 全租戶房間：不帶渠道資料的推播（工單、短連結統計等） */
export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/** 單一渠道的房間：只有看得到這個渠道的成員加入 */
export function tenantChannelRoom(tenantId: string, channelId: string): string {
  return `tenant:${tenantId}:channel:${channelId}`;
}

/** 總店（channel.view_all）房間：收到本租戶所有渠道的推播 */
export function tenantAllChannelsRoom(tenantId: string): string {
  return `tenant:${tenantId}:channels:all`;
}

/** 某渠道的推播要送到的房間：該渠道的房間與總店房間 */
export function channelPushRooms(tenantId: string, channelId: string): string[] {
  return [tenantChannelRoom(tenantId, channelId), tenantAllChannelsRoom(tenantId)];
}

/** 是否為本租戶的渠道房間（含總店房間）；重新計算房間時用來找出要離開的房間 */
export function isTenantChannelScopedRoom(tenantId: string, room: string): boolean {
  return room === tenantAllChannelsRoom(tenantId) || room.startsWith(`tenant:${tenantId}:channel:`);
}
