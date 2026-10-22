/**
 * 交易內處理唯一約束與條件認領的共用函式（主規格 tenant-transaction-context，design 決策 7）。
 *
 * 在 inTenant() 的交易內，「撞到 P2002 再接住錯誤」行不通：PostgreSQL 的交易在第一個錯誤之後
 * 進入 aborted 狀態，之後的查詢全部失敗。這裡的寫法不讓資料庫丟錯，交易可以繼續使用。
 *
 * 寫入與查詢以 callback 傳入，不收 model 名稱：泛型包裝 Prisma 的 model 會失去 select 決定的型別。
 */

/**
 * 寫入一筆資料；撞到唯一鍵時改用既有的那一筆。
 *
 * create 要用 createManyAndReturn({ data: [row], skipDuplicates: true })：底層是
 * INSERT … ON CONFLICT DO NOTHING，衝突時回傳空陣列。另一個交易同時寫入同一個唯一鍵時，
 * PostgreSQL 等對方 commit 後才略過，所以 findExisting 查得到對方的資料。
 *
 * skipDuplicates 會略過任何唯一約束的衝突，不只 findExisting 查的那一個，
 * 所以略過之後查不到既有資料時丟錯，不回傳空值。
 */
export async function createOrFindExisting<T>(
  create: () => Promise<T[]>,
  findExisting: () => Promise<T | null>,
): Promise<{ row: T; created: boolean }> {
  const rows = await create();
  if (rows.length > 1) {
    throw new Error(`createOrFindExisting: create 只能寫入一筆，實際寫入 ${rows.length} 筆`);
  }
  if (rows.length === 1) return { row: rows[0], created: true };

  const existing = await findExisting();
  if (!existing) {
    throw new Error('createOrFindExisting: 寫入被略過，但查不到既有資料（衝突的可能是另一個唯一約束）');
  }
  return { row: existing, created: false };
}

/**
 * 以條件更新認領一筆資料，例如 updateMany({ where: { id, status: 'pending' }, data: { status: 'processing' } })。
 * 更新 1 筆是認領成功，0 筆是別人已經認領。認領條件只能對應一筆資料，
 * 大於 1 筆代表條件寫錯（例如 where 漏了 id），丟錯讓交易 rollback。
 */
export async function claimOne(update: () => Promise<{ count: number }>): Promise<boolean> {
  const { count } = await update();
  if (count > 1) {
    throw new Error(`claimOne: 認領條件對應 ${count} 筆資料，只能對應一筆`);
  }
  return count === 1;
}
