/**
 * 素材 body 的「存檔前擋控」驗證。
 *
 * 為什麼集中在這裡：各版型編輯器的 props 介面都不一樣，
 * 若要每個編輯器各自回報錯誤給 MaterialEditor，得逐一改介面、侵入性高。
 * 改成由 MaterialEditor 依 contentType 呼叫這支函式集中判斷，
 * 新增版型時只要在這裡加一個分支。
 *
 * 判斷準則：只擋「存下去也一定不會動」的錯誤（送出後客戶端無法播放/顯示），
 * 不擋「可以先存草稿、之後再補」的欄位（例如尚未填完的選填內容）。
 * 必填欄位的擋控仍由各頁面的 handleSave 負責。
 */
import { validateLineVideoUrl } from '@open333crm/shared';

/**
 * 回傳 null 表示可以存檔；否則回傳阻擋原因（直接顯示給使用者）。
 */
export function validateMaterialBody(
  contentType: string,
  body: Record<string, unknown>,
): string | null {
  if (contentType === 'line_video') {
    const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl : '';
    // 空值不在此擋——留給必填檢查處理，避免剛進編輯器就把按鈕變灰。
    if (!videoUrl.trim()) return null;
    return validateLineVideoUrl(videoUrl);
  }

  return null;
}
