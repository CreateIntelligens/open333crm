type PageGetter = (url: string, config: { params: { page: number; limit: number } }) => Promise<{ data: unknown }>;

/** API 單頁上限（各列表路由的 Zod schema 為 max(100)） */
const PAGE_SIZE = 100;

/**
 * 移除網址查詢字串中既有的 `page`、`limit`。分頁參數一律由 fetchAllPages 透過 params 帶入，
 * 否則同名參數會送兩次，後端可能收到陣列或沿用舊的 limit。只處理字串，不依賴 window（SSR 也可用）。
 */
function stripPagination(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const kept = url
    .slice(q + 1)
    .split('&')
    .filter((pair) => {
      if (pair === '') return false;
      const name = pair.split('=')[0];
      return name !== 'page' && name !== 'limit';
    });
  return kept.length ? `${url.slice(0, q)}?${kept.join('&')}` : url.slice(0, q);
}

/**
 * 依 `meta.totalPages` 逐頁取回分頁 API 的全部資料。
 * 給沒有分頁 UI、需要一次顯示全部資料的列表用（例如自動化規則列表）。
 * 回應沒有 `meta` 時視為只有一頁。`meta` 沒有 `totalPages`、但有 `total` 與 `limit` 時
 * （例如粉絲活動、短連結的列表 API），依 total / limit 算頁數。
 */
export async function fetchAllPages<T>(get: PageGetter, url: string): Promise<T[]> {
  const rows: T[] = [];
  const baseUrl = stripPagination(url);
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const res = await get(baseUrl, { params: { page, limit: PAGE_SIZE } });
    const body = res.data as { data?: T[]; meta?: { totalPages?: number; total?: number; limit?: number } };
    rows.push(...(body.data ?? []));
    const meta = body.meta;
    totalPages =
      meta?.totalPages ??
      (typeof meta?.total === 'number' && typeof meta?.limit === 'number' && meta.limit > 0
        ? Math.ceil(meta.total / meta.limit)
        : 1);
  }
  return rows;
}
