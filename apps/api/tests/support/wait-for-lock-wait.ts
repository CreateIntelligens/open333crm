/**
 * 並行測試的同步點：等到資料庫裡有連線正在等鎖（列鎖或 advisory lock）。
 *
 * 用法：交易 1 停在提交前，啟動交易 2，呼叫本函式確認交易 2 已經卡在交易 1 持有的鎖上，再放開交易 1。
 * 以固定時間等待無法保證交易 2 已走到鎖（機器慢時它可能還沒開始，測試會走另一條路而照樣通過）。
 * 等不到就丟錯，讓測試失敗而不是誤判通過。
 */
import type { PrismaClient } from '@prisma/client';

export async function waitForLockWait(prisma: PrismaClient, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row.waiting > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待 ${timeoutMs}ms 仍沒有連線在等鎖：第二個交易沒有卡在預期的鎖上`);
}
