/**
 * 交易級 advisory lock 的共用鎖鍵與取鎖（issue #403）。
 *
 * `pg_advisory_xact_lock(hashtextextended(<字串>, 0))` 的鎖鍵是字串。PostgreSQL 比對 uuid 不分大小寫，
 * 字串卻分大小寫：同一筆資料以大寫 id 與小寫 id 取鎖，會拿到兩把不同的鎖，互斥就失效。
 * 所以鎖鍵中凡是 uuid 的段落一律轉成小寫；其他段落原樣保留（例如外部會員編號、LINE uid，
 * 它們在資料庫比對時分大小寫，鎖也要分）。
 */
import type { Prisma } from '@prisma/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @description 以 `:` 串接各段產生鎖鍵；uuid 形式的段落轉成小寫。
 * 只有一段時不加任何前綴，與既有鎖鍵（例如券的鎖鍵就是券 id）相同，部署期間新舊程式仍互斥。
 * @param parts 鎖鍵的各段，例如 `('sla', caseId, eventType)`
 * @returns 正規化後的鎖鍵字串
 */
export function advisoryLockKey(...parts: string[]): string {
  return parts.map((p) => (UUID_RE.test(p) ? p.toLowerCase() : p)).join(':');
}

/**
 * @description 在交易內取得交易級 advisory lock，交易結束時自動釋放；同一個交易重複取同一把鎖不會卡住。
 * @param tx 呼叫端開的交易（必須是交易，否則鎖在該語句結束就釋放）
 * @param parts 鎖鍵的各段，規則見 advisoryLockKey
 */
export async function advisoryXactLock(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  ...parts: string[]
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${advisoryLockKey(...parts)}, 0))`;
}
