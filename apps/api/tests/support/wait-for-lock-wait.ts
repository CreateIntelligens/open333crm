/**
 * 並行測試的同步點：等到有連線被指定的交易擋住（等它持有的列鎖或 advisory lock）。
 *
 * 用法：交易 1 以 backendPid() 取得自己的連線 pid，停在提交前；啟動交易 2 後呼叫 waitUntilBlockedBy()，
 * 確認交易 2 已經卡在交易 1 的鎖上，再放開交易 1。
 * 以固定時間等待無法保證交易 2 已走到鎖（機器慢時它可能還沒開始，測試會走另一條路而照樣通過）；
 * 只看「有沒有連線在等鎖」也可能被其他不相關的等待誤判，所以限定被交易 1 擋住。
 * 等不到就丟錯，讓測試失敗而不是誤判通過。呼叫端要在 finally 放開交易 1，避免逾時後交易 1 一直開著。
 */
import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '#src/lib/tenant-db.js';

/** 目前交易所在連線的 pid（在 withTenant 的 tx 內呼叫） */
export async function backendPid(tx: TenantDb): Promise<number> {
  const [row] = await (tx as PrismaClient).$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

export async function waitUntilBlockedBy(prisma: PrismaClient, blockerPid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ blocked: number }>>`
      SELECT count(*)::int AS blocked FROM pg_stat_activity
      WHERE ${blockerPid}::int = ANY (pg_blocking_pids(pid))`;
    if (row.blocked > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待 ${timeoutMs}ms 仍沒有連線被 pid ${blockerPid} 擋住：第二個交易沒有卡在預期的鎖上`);
}
