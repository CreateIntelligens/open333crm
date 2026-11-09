/**
 * 圖文選單的發布狀態（change migrate-line-tenant-ctx design D3）。
 * 發布中停留超過 5 分鐘視為中斷，API 允許重新發布；門檻與 API 的 STALE_PUBLISHING_MS 相同。
 */
const STALE_PUBLISHING_MS = 5 * 60_000;

export function isRichMenuPublishInterrupted(menu: { status: string; updatedAt: string }, now = Date.now()): boolean {
  return menu.status === 'publishing' && now - new Date(menu.updatedAt).getTime() > STALE_PUBLISHING_MS;
}

/** 發布中、而且還沒中斷：鎖住編輯，不顯示發布按鈕 */
export function isRichMenuPublishing(menu: { status: string; updatedAt: string }, now = Date.now()): boolean {
  return menu.status === 'publishing' && !isRichMenuPublishInterrupted(menu, now);
}
