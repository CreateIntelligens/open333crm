/**
 * 對話訊息的 contentType 與 content 結構（單一事實來源）。
 *
 * 背景（Wave 6 欄位級測試）：
 * `sendMessageSchema` 原本是
 *   { contentType: z.string().default('text'), content: z.record(z.unknown()) }
 * 幾乎等於沒驗。UAT 實測以下五種全部回 201 並以 OUTBOUND 落庫：
 *   {content:{}}、{content:{text:""}}、{content:{text:"   "}}、
 *   {content:{foo:"bar"}}、{contentType:"wut", content:{text:"x"}}
 *
 * 後果分兩層：
 * 1. 對話裡出現空泡泡訊息（客服端與客戶端都看得到）
 * 2. 走真實 LINE/FB 渠道時，channel-plugins 的 toLineMessage() 對未知
 *    contentType 會落到 `default:` 分支當成 text 送出，內容取
 *    `content.text ?? ''` —— 等於推一則空訊息給客戶
 *
 * 前端 MessageInput 有 trim() 擋控，所以一般操作碰不到；API 直呼則毫無防護。
 */

/**
 * 客服端可主動送出的訊息類型。
 *
 * 刻意只放「客服真的會送」的類型：
 * - `system` 不在此列——那是系統事件訊息，由後端自行建立（見
 *   conversation.service.ts 的 contentType: 'system'），不該由 API 呼叫端指定
 * - `sticker` / `location` 目前只出現在「接收」方向（客戶傳進來），
 *   客服端 UI 沒有送出入口，故不開放
 */
export const OUTBOUND_MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'file'] as const;

export type OutboundMessageType = (typeof OUTBOUND_MESSAGE_TYPES)[number];

/** 文字訊息長度上限。LINE 單則 text message 上限 5000 字，取同值。 */
export const MESSAGE_TEXT_MAX_LENGTH = 5000;

/** 媒體網址長度上限（與 LINE 的 originalContentUrl 一致） */
export const MESSAGE_MEDIA_URL_MAX_LENGTH = 2000;

/**
 * 驗證一則要送出的訊息。
 *
 * 回傳 null 表示通過；否則回傳「為什麼不行」的中文訊息。
 *
 * 為什麼不直接寫成 zod discriminatedUnion：這支函式同時要給
 * 後端 route（zod superRefine 內）與前端擋控使用，寫成純函式比較好共用，
 * 錯誤訊息也能一致。
 */
export function validateOutboundMessage(
  contentType: string,
  content: Record<string, unknown>,
): string | null {
  if (!(OUTBOUND_MESSAGE_TYPES as readonly string[]).includes(contentType)) {
    return `不支援的訊息類型「${contentType}」，可用：${OUTBOUND_MESSAGE_TYPES.join('、')}`;
  }

  if (contentType === 'text') {
    const text = content.text;
    if (typeof text !== 'string') {
      return '文字訊息缺少 text 欄位';
    }
    if (!text.trim()) {
      // 純空白與全形空白都算空——送出去就是一則空泡泡
      return '訊息內容不可為空白';
    }
    if (text.length > MESSAGE_TEXT_MAX_LENGTH) {
      return `訊息長度不可超過 ${MESSAGE_TEXT_MAX_LENGTH} 字`;
    }
    return null;
  }

  // image / video / audio / file 都靠網址指向實際檔案。
  //
  // ⚠️ 欄位名在專案內並不一致：前端 useMessages 送 `url`
  // （content: contentType === 'text' ? { text } : { url }），
  // 而 channel-plugins 的 toLineMessage 讀 `mediaUrl`。
  // 兩邊都接受，避免驗證把正常流程擋掉。
  const mediaUrl = getMediaUrl(content);
  if (!mediaUrl) {
    return '媒體訊息缺少檔案網址（url）';
  }
  if (mediaUrl.length > MESSAGE_MEDIA_URL_MAX_LENGTH) {
    return `媒體網址不可超過 ${MESSAGE_MEDIA_URL_MAX_LENGTH} 字`;
  }
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return '媒體網址必須是 http 或 https';
  }

  return null;
}

/**
 * 從 content 取出媒體網址，相容專案內兩種欄位名。
 * 匯出供 channel-plugins 等呼叫端共用，避免各自再寫一份 fallback。
 */
export function getMediaUrl(content: Record<string, unknown>): string | null {
  for (const key of ['url', 'mediaUrl'] as const) {
    const v = content[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
