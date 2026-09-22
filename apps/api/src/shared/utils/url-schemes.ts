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
 *
 * ⚠️ **這只是 scheme 白名單，不是 SSRF 防護。**
 * `http://169.254.169.254/`、`http://127.0.0.1:8080` 都是合法 http 網址，
 * 會通過本 schema。要防 SSRF 必須另外檢查「解析後的目的地 IP」。
 *
 * 專案已有完整的目的地檢查：`modules/webhook/downstream-forwarder.ts`
 * 的 `isBlockedUrl()`——CIDR 比對，涵蓋 loopback／private／CGNAT／link-local／
 * benchmarking／multicast／reserved 與 IPv6（含 IPv4-mapped），DNS 失敗一律擋，
 * 並有 `__tests__/webhook-ssrf.test.ts`。**不要再寫第四份。**
 *
 * 各欄位該用哪一層：
 * | 欄位性質 | 需要 |
 * |---|---|
 * | 前端渲染成連結／圖片（previewImageUrl） | 本 schema 即可 |
 * | 後端 fetch **第三方**（webhook 目的地、會員綁定端點） | 本 schema + `isBlockedUrl()` |
 * | 後端 fetch **自家內部服務**（Ollama baseUrl） | 只用本 schema |
 *
 * 最後一列是刻意的：Ollama 本來就部署在內網
 * （預設 `localhost:11434`，UAT 為 `open333crm-ollama:11434`），
 * 套目的地檢查會讓 AI 功能無法設定。這種欄位靠 `settings.manage` 權限控管，
 * 而非限制能填什麼。
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .url('網址格式不正確')
  .refine((v) => HTTP_SCHEME_RE.test(v), {
    message: '網址只允許 http 或 https',
  });

/**
 * LINE action 專用：允許 line: 與 tel:
 *
 * ⚠️ 只比對前綴不夠——`https:`、`http:invalid`、`line:`、`tel:` 這些
 * 光有 scheme、沒有實際內容的值會通過，錯誤要到 LINE publish 才爆。
 * 故依 scheme 分別驗證實際格式。
 *
 * `.max(1000)` 依 LINE 官方文件：URI action 的 uri 上限 1000 字元
 * （reference/messaging-api，URI action 章節）。
 */
export const lineUriSchema = z
  .string()
  .trim()
  .max(1000)
  .superRefine((v, ctx) => {
    const m = v.match(/^(https?|line|tel):/i);
    if (!m) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '連結只允許 http、https、line 或 tel' });
      return;
    }
    const scheme = m[1].toLowerCase();

    if (scheme === 'http' || scheme === 'https') {
      // 必須有 `//` —— new URL('http:invalid') 會把 invalid 當成 hostname 而通過，
      // 依 WHATWG 規範雖合法，但那不是能點的連結。
      if (!/^https?:\/\//i.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '網址格式不正確，應為 https://...' });
        return;
      }
      try {
        const u = new URL(v);
        if (!u.hostname) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: '網址缺少主機名稱' });
        }
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '網址格式不正確' });
      }
      return;
    }

    if (scheme === 'tel') {
      // tel:+886912345678 / tel:0912345678——需有實際號碼
      if (!/^tel:\+?[\d\-() ]{3,}$/i.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '電話連結格式不正確，例如 tel:+886912345678' });
      }
      return;
    }

    // line:// 開頭且後面要有內容，擋掉裸 `line:`
    if (!/^line:\/\/.+/i.test(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'LINE 連結格式不正確，例如 line://ti/p/@example' });
    }
  });

/**
 * 判斷一個字串是否為 http(s) 網址且語法正確。
 * 給無法直接套 zod 的地方（service 層、既有的手寫驗證）使用。
 *
 * ⚠️ 同 `httpUrlSchema`：**只驗 scheme 與語法，不做目的地檢查**。
 * 名稱中的 "Safe" 指的是「不是 javascript:／data:／file:」，
 * 不代表可以安全地由後端連線。後端要連的位址請併用 `isBlockedUrl()`。
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
