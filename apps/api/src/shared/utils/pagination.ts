/**
 * 分頁查詢參數的共用 zod schema。
 *
 * 為什麼需要集中：service 層普遍用 `skip: (page - 1) * limit` 計算偏移量，
 * 一旦 page 小於 1 就會算出負數，Prisma 直接拒收並拋出未攔截的例外 → 500。
 *
 * 專案內原本只有 contact / conversation / canvas 三個模組做對了
 * （`z.coerce.number().int().positive().default(1)`），marketing / material /
 * shortlink / portal / knowledge 則是裸 `Number()` 或 `parseInt()`，
 * UAT 實測 `?page=0` 與 `?page=-1` 皆回 500。
 *
 * 用法：
 *   const { page, limit } = paginationSchema.parse(request.query);
 * 若該端點還有其他查詢參數：
 *   const q = paginationSchema.extend({ status: z.string().optional() }).parse(request.query);
 */
import { z } from 'zod';

/** 單頁筆數上限：避免一次撈爆記憶體／回應體積。 */
export const MAX_PAGE_SIZE = 100;

/**
 * `coerce` 是必要的：query string 進來一律是字串，
 * 沒有 coerce 會讓 `?page=2` 直接驗證失敗。
 * 非數字（如 `?page=abc`）由 zod 轉型失敗擋下，回 400 而非 500。
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number({ invalid_type_error: '頁碼必須是數字' })
    .int('頁碼必須是整數')
    .positive('頁碼必須大於 0')
    .default(1),
  limit: z.coerce
    .number({ invalid_type_error: '每頁筆數必須是數字' })
    .int('每頁筆數必須是整數')
    .positive('每頁筆數必須大於 0')
    .max(MAX_PAGE_SIZE, `每頁筆數不可超過 ${MAX_PAGE_SIZE}`)
    .default(20),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * 給「呼叫端傳的是 number | undefined、無法走 zod」的 service 層用的兜底夾制。
 * 屬第二道防線——正確做法仍是在 route 層用 paginationSchema 擋住。
 */
export function clampPage(page: number | undefined): number {
  if (!Number.isFinite(page) || page === undefined) return 1;
  return Math.max(1, Math.floor(page));
}

export function clampLimit(limit: number | undefined, fallback = 20): number {
  if (!Number.isFinite(limit) || limit === undefined) return fallback;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}
