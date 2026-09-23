/**
 * 工單分類的單一事實來源。
 *
 * 為什麼要抽出來：原本建立視窗（CaseCreateModal）與詳情頁（CaseDetail）
 * 各自寫死一份清單，而且內容完全不同——
 *   建立頁：維修 / 查詢 / 投訴 / 其他
 *   詳情頁：產品諮詢 / 訂單問題 / 退換貨 / 帳號問題 / 技術支援 /
 *           投訴建議 / 付款問題 / 物流配送 / 其他
 * 兩套只有「其他」重疊。
 *
 * 後果：用建立視窗選「維修」的工單，進詳情頁時分類下拉找不到對應 option，
 * 會顯示成空值；使用者只要在詳情頁存一次檔，分類就被洗掉了。
 *
 * 2026-09-23 決議統一採用詳情頁那套 9 項（粒度較細、涵蓋面完整），
 * 並由後端 enum 擋下非法值——原本後端是 `z.string()` 全開，
 * 實測 500 字亂碼與 <script> 都能寫入，會污染分類篩選與報表。
 */

/** 工單分類（不含「未分類」空值） */
export const CASE_CATEGORIES = [
  '產品諮詢',
  '訂單問題',
  '退換貨',
  '帳號問題',
  '技術支援',
  '投訴建議',
  '付款問題',
  '物流配送',
  '其他',
] as const;

export type CaseCategory = (typeof CASE_CATEGORIES)[number];

/**
 * 下拉選單用的選項（含「未分類」空值）。
 * 詳情頁允許把分類清空，建立頁則視情況決定要不要帶這一項。
 */
export const CASE_CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '未分類' },
  ...CASE_CATEGORIES.map((c) => ({ value: c, label: c })),
];

/** 判斷是否為合法分類（空字串視為「未分類」，也算合法） */
export function isValidCaseCategory(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true;
  return typeof value === 'string' && (CASE_CATEGORIES as readonly string[]).includes(value);
}
