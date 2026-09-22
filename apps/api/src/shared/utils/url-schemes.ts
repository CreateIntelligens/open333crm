/**
 * 網址 scheme 白名單的共用 zod schema。
 *
 * 為什麼需要：`z.string().url()` 底層是 `new URL()`，只檢查「可不可以解析」，
 * **完全不限制 protocol**。`javascript:alert(1)`、`data:text/html,...`、
 * `file:///etc/passwd`、`ftp:/x` 全部都能通過。
 *
 * Wave 6 實測發現四處受影響，風險分兩類：
 *
 * 1. 會被「後端主動連線」的網址 —— SSRF 面，風險最高
 *    - Embedding baseUrl（settings）：後端會 fetch 這個位址做健康檢查與向量化
 *    - 渠道 webhookBaseUrl：會被串成對外的 webhook 位址
 *
 * 2. 會被「前端渲染成可點連結或圖片來源」的網址 —— XSS 面
 *    - 短連結 targetUrl：轉址頁丟進 window.location.replace()（已於 shortlink.routes 處理）
 *    - 素材 previewImageUrl：前端當 <img src> 渲染
 *    - Rich Menu uri action：LINE 官方只收 http/https/line/tel
 */
import { z } from 'zod';

/** 後端會主動連線的位址：只允許 http(s)，不接受任何其他 protocol。 */
export const HTTP_SCHEME_RE = /^https?:\/\//i;

/**
 * LINE action 可用的 scheme。
 * 依 LINE 官方文件（reference/messaging-api）：URI action 只允許
 * http / https / line / tel，其他 scheme LINE 會回 400。
 */
export const LINE_URI_SCHEME_RE = /^(https?|line|tel):/i;

/**
 * 一般對外網址：必須是 http(s)。
 * 用於會被後端 fetch、或被前端當連結/圖片來源的欄位。
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .url('網址格式不正確')
  .refine((v) => HTTP_SCHEME_RE.test(v), {
    message: '網址只允許 http 或 https',
  });

/** LINE action 專用：允許 line: 與 tel: */
export const lineUriSchema = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => LINE_URI_SCHEME_RE.test(v), {
    message: '連結只允許 http、https、line 或 tel',
  });

/**
 * 判斷一個字串是否為安全的 http(s) 網址。
 * 給無法直接套 zod 的地方（service 層、既有的手寫驗證）使用。
 */
export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!HTTP_SCHEME_RE.test(value.trim())) return false;
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}
