type PageGetter = (url: string, config: { params: { page: number; limit: number } }) => Promise<{ data: unknown }>;

/** API 單頁上限（各列表路由的 Zod schema 為 max(100)） */
const PAGE_SIZE = 100;

/**
 * 依 `meta.totalPages` 逐頁取回分頁 API 的全部資料。
 * 給沒有分頁 UI、需要一次顯示全部資料的列表用（例如自動化規則列表）。
 * 回應沒有 `meta` 時視為只有一頁。
 */
export async function fetchAllPages<T>(get: PageGetter, url: string): Promise<T[]> {
  const rows: T[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const res = await get(url, { params: { page, limit: PAGE_SIZE } });
    const body = res.data as { data?: T[]; meta?: { totalPages?: number } };
    rows.push(...(body.data ?? []));
    totalPages = body.meta?.totalPages ?? 1;
  }
  return rows;
}
