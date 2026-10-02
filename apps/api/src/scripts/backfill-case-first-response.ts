/**
 * 為既有工單補上首次回應時間（AUDIT SLA-01，issue #197）。
 *
 * 原本沒有任何程式寫入 Case.firstResponseAt，套了 SLA 的工單一律被判定首次回應逾時、每 24 小時重發假警報。
 * 修正後新的客服訊息會寫入；這支腳本為既有工單補值：取工單建立後、關聯對話中最早一則客服（AGENT）送出的訊息時間。
 *
 * 安全設計：
 *   - 預設 dry-run，只列出會補幾張；帶 --apply 才寫入
 *   - 只補 firstResponseAt 為空的工單，可重複執行
 *   - 單一 UPDATE ... FROM 子查詢，只動 firstResponseAt
 *
 * 用法（在 apps/api 目錄）：
 *   DATABASE_URL=<owner 或 app_admin> npx tsx src/scripts/backfill-case-first-response.ts
 *   DATABASE_URL=<owner 或 app_admin> npx tsx src/scripts/backfill-case-first-response.ts --apply
 */
import { prisma } from '@open333crm/database';

const apply = process.argv.includes('--apply');
// 跨租戶掃描：使用共用 client（不自建 PrismaClient），DATABASE_URL 需指向 owner / app_admin（BYPASSRLS）

const FIRST_AGENT_REPLY = `
  SELECT c.id AS case_id, MIN(m."createdAt") AS first_reply
  FROM cases c
  JOIN conversations cv ON cv."caseId" = c.id AND cv."tenantId" = c."tenantId"
  JOIN messages m ON m."conversationId" = cv.id
  WHERE c."firstResponseAt" IS NULL
    AND m.direction = 'OUTBOUND'
    AND m."senderType" = 'AGENT'
    AND m."createdAt" >= c."createdAt"
  GROUP BY c.id
`;

async function main() {
  const [{ total, pending }] = await prisma.$queryRawUnsafe<Array<{ total: bigint; pending: bigint }>>(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "firstResponseAt" IS NULL) AS pending FROM cases`,
  );
  const candidates = await prisma.$queryRawUnsafe<Array<{ case_id: string; first_reply: Date }>>(FIRST_AGENT_REPLY);
  console.log(`工單共 ${total} 張，沒有首次回應時間 ${pending} 張，其中找得到客服回覆、可補值 ${candidates.length} 張`);
  if (Number(total) === 0) {
    // 以 app_tenant 等受 RLS 限制的帳號連線時，查詢會回 0 筆而不報錯
    console.log('\n查到 0 張工單：若資料庫確實有工單，代表 DATABASE_URL 不是 owner／app_admin（受 RLS 限制），請改用 owner 連線');
    return;
  }

  if (!apply) {
    console.log('\n(dry-run) 加上 --apply 才會寫入');
    return;
  }
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE cases SET "firstResponseAt" = r.first_reply
    FROM (${FIRST_AGENT_REPLY}) r
    WHERE cases.id = r.case_id AND cases."firstResponseAt" IS NULL
  `);
  console.log(`已補 ${updated} 張`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
