/**
 * Rich Menu 會影響所有好友的操作，確認文字要白話說清楚（change fix-rich-menu-default-safety）。
 * isDefault=true 的選單發布時會設成該官方帳號所有好友的預設選單（change migrate-line-tenant-ctx 之前是 selected）。
 */

export const RICH_MENU_DEFAULT_CHECK_CONFIRM =
  '勾選後，這張選單一發布就會成為這個官方帳號「所有好友」的預設選單，換掉好友目前看到的選單。確定要勾選嗎？';

export function richMenuPublishConfirm(isDefault: boolean): string {
  if (isDefault) {
    return '這張選單設為「所有好友的預設選單」，發布後會立刻換掉這個官方帳號所有好友目前看到的選單。\n\n發布後不能直接編輯，要先取消發布。確定發布？';
  }
  return '確定發布到 LINE？這張選單不是預設選單，不會換掉好友目前看到的選單。發布後不能直接編輯，要先取消發布。';
}

export function richMenuUnpublishConfirm(isDefault: boolean): string {
  if (isDefault) {
    return '這張是「所有好友的預設選單」。取消發布後，這個官方帳號所有好友的預設選單會消失，直到你再發布另一張預設選單。確定取消發布？';
  }
  return '確定取消發布？將從 LINE 移除此 Rich Menu。';
}

/** 發布成功但 LINE 設預設失敗（回應帶 DEFAULT_NOT_SET）時的提示 */
export const RICH_MENU_DEFAULT_NOT_SET_NOTICE =
  '選單已發布，但沒有設成所有好友的預設選單：LINE 設定預設時失敗。好友目前看到的選單沒有改變。\n\n要設成預設，請取消發布，在編輯頁重新勾選「設為所有好友的預設選單」並儲存，再發布一次。';
