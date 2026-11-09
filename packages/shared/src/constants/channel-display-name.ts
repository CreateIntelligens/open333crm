/**
 * 渠道類型的顯示名稱。程式、資料庫與 webhook 網址用渠道系統代號（LINE、FB、THREADS、WEBCHAT），
 * 但畫面、匯出檔與給使用者看的錯誤訊息一律顯示這裡的名稱，不顯示代號。
 *
 * Instagram 私訊的系統代號是 THREADS（歷史命名，維持不改），畫面一律顯示 Instagram。
 * 前後端共用這一份對照；新增渠道類型時改這裡。
 */
const CHANNEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  LINE: 'LINE',
  FB: 'Facebook',
  THREADS: 'Instagram',
  WEBCHAT: '網站聊天室',
  WHATSAPP: 'WhatsApp',
  TELEGRAM: 'Telegram',
  EMAIL: 'Email',
  API: 'API',
};

/**
 * @description 把渠道系統代號轉成使用者看得懂的名稱（不分大小寫：素材用小寫代號 `fb`、`line`）。
 * @param channelType 渠道系統代號，例如 `THREADS`
 * @returns 顯示名稱，例如 `Instagram`；不認得的代號原樣回傳，沒有代號回空字串
 */
export function channelDisplayName(channelType: string | null | undefined): string {
  if (!channelType) return '';
  return CHANNEL_DISPLAY_NAMES[channelType.toUpperCase()] ?? channelType;
}
