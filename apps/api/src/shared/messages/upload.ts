/**
 * 上傳檔案被拒絕時回給使用者的中文訊息（issue #470）。
 *
 * 為何集中：內容偵測、收件匣傳媒體、網站聊天室背景圖都會擋檔案，
 * 各自寫英文或各自翻譯會讓同一個原因有好幾種說法。偵測器的英文 reason 只放在
 * AppError 的 details 與 log，給工程師除錯，不顯示給使用者。
 */

/** 內容偵測拒絕的原因分類。偵測信心不足與無法辨識對使用者是同一件事，歸成 unrecognized。 */
export type UploadRejection = 'empty' | 'unrecognized' | 'type_not_allowed' | 'extension_mismatch' | 'mime_mismatch';

/** MIME 對應到使用者熟悉的格式名稱（多半就是副檔名）。 */
const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'video/mp4': 'MP4',
  'video/quicktime': 'MOV',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word（DOCX）',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel（XLSX）',
  'text/csv': 'CSV',
  'text/html': 'HTML',
  'text/markdown': 'Markdown',
  'text/plain': '純文字（TXT）',
};

/** 單一 MIME 的格式名稱；沒收錄的回傳 MIME 原文。 */
export function fileTypeLabel(mime: string): string {
  return MIME_LABELS[mime] ?? mime;
}

/** 允許的格式清單，例如「JPG、PNG」。 */
export function allowedFileTypesText(allowedMimes: readonly string[]): string {
  return [...new Set(allowedMimes.map(fileTypeLabel))].join('、');
}

/** 內容偵測拒絕上傳時的訊息。 */
export function uploadRejectedMessage(
  rejection: UploadRejection,
  allowedMimes: readonly string[],
  detectedMime?: string,
): string {
  const allowed = allowedFileTypesText(allowedMimes);
  switch (rejection) {
    case 'empty':
      return '檔案是空的，請重新選擇檔案';
    case 'type_not_allowed':
      return detectedMime
        ? `這裡不接受 ${fileTypeLabel(detectedMime)} 檔案，請改用 ${allowed}`
        : `這裡不接受這種檔案，請改用 ${allowed}`;
    case 'extension_mismatch':
      return detectedMime
        ? `檔案內容（${fileTypeLabel(detectedMime)}）與副檔名不符，請確認檔案格式或改正副檔名`
        : '檔案內容與副檔名不符，請確認檔案格式或改正副檔名';
    case 'mime_mismatch':
      // 副檔名正確、只有上傳時標示的 MIME 與內容不符（PR #492 review）：不提副檔名，避免使用者去改正確的副檔名
      return detectedMime
        ? `檔案內容（${fileTypeLabel(detectedMime)}）與上傳時標示的檔案類型不符，請重新選擇檔案`
        : '檔案內容與上傳時標示的檔案類型不符，請重新選擇檔案';
    case 'unrecognized':
    default:
      return `無法辨識檔案內容，請確認檔案沒有損壞，且是允許的格式（${allowed}）`;
  }
}

/** 內容偵測服務暫時無法使用（503）。 */
export const UPLOAD_DETECTION_UNAVAILABLE_MESSAGE = '暫時無法檢查檔案內容，請稍後再試';

/** 入口只收特定類型，宣告的類型不在清單內。 */
export function unsupportedFileTypeMessage(allowedMimes: readonly string[]): string {
  return `不支援這種檔案，請改用 ${allowedFileTypesText(allowedMimes)}`;
}

/** 檔案超過入口的大小上限。 */
export function fileTooLargeMessage(maxBytes: number): string {
  return `檔案超過上限 ${Math.round(maxBytes / 1024 / 1024)} MB，請壓縮後再上傳`;
}
