/**
 * @description 跳脫 SQL LIKE 的萬用字元，讓使用者輸入的 `%`、`_` 與反斜線當成一般文字比對。
 *
 * Prisma 的 `contains`／`string_contains` 會把值包成 `%值%` 交給 PostgreSQL 的 LIKE／ILIKE，
 * 但不跳脫值裡的 `%`、`_`：搜尋 `a_1` 會比對到 `ab1`（PR #449 審查）。PostgreSQL 的 LIKE
 * 預設以反斜線跳脫，所以先跳脫反斜線，再跳脫 `%` 與 `_`。
 *
 * @param keyword 使用者輸入的關鍵字
 * @returns 可直接交給 Prisma `contains` 的關鍵字
 */
export function escapeLikeKeyword(keyword: string): string {
  return keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
