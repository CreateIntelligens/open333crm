/**
 * 為既有 FB／IG 渠道補上外部帳號 ID（change fix-meta-webhook-page-routing，tasks 4.4）。
 *
 * webhook 改依 entry.id 分派後，沒有帳號 ID 的渠道會走相容模式（照舊收件但無法擋錯置）。
 * 這支腳本用各渠道已存的 token 向 Meta 查帳號 ID：FB 取 /me 的 id（粉專 ID），
 * IG 取 /me 的 user_id（IG 專業帳號 ID = webhook entry.id）。
 *
 * 安全設計：
 *   - 預設 dry-run，只查詢並列出結果；帶 --apply 才寫入
 *   - 先查齊所有渠道再比對重複：同一帳號對到兩個以上渠道（含已有帳號 ID 的渠道）時，
 *     衝突的一律不寫入並列出，交由人工停用其中一個後重跑（不猜哪一個是對的）
 *   - 單一渠道查詢失敗（權杖過期、金鑰解不開）只記錄、不中斷
 *   - 只寫 externalAccountId，不動其他欄位
 *
 * 用法（在 apps/api 目錄）：
 *   DATABASE_URL=<owner 或 app_admin> CREDENTIAL_ENCRYPTION_KEY=... npx tsx src/scripts/backfill-channel-external-account-id.ts
 *   ... npx tsx src/scripts/backfill-channel-external-account-id.ts --apply
 */
import { prisma } from '@open333crm/database';
import { decryptCredentials } from '../modules/channel/channel.service.js';

const apply = process.argv.includes('--apply');
// 跨租戶掃描：使用共用 client（不自建 PrismaClient），DATABASE_URL 需指向 owner / app_admin（BYPASSRLS）

type Row = { id: string; tenantId: string; channelType: string; displayName: string; externalAccountId: string | null; isActive: boolean };

async function lookupAccountId(channelType: string, token: string): Promise<string> {
  const url =
    channelType === 'FB'
      ? 'https://graph.facebook.com/v21.0/me?fields=id,name'
      : 'https://graph.instagram.com/v21.0/me?fields=user_id,username';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  const id = channelType === 'FB' ? body.id : body.user_id;
  if (!id) throw new Error('回應沒有帳號 ID');
  return String(id);
}

const label = (c: Row) => `[${c.channelType}] ${c.displayName} (${c.id}) tenant=${c.tenantId}${c.isActive ? '' : ' 已停用'}`;

async function main() {
  const rows = await prisma.channel.findMany({
    where: { channelType: { in: ['FB', 'THREADS'] } },
    select: { id: true, tenantId: true, channelType: true, displayName: true, externalAccountId: true, isActive: true, credentialsEncrypted: true },
    orderBy: [{ tenantId: 'asc' }, { channelType: 'asc' }],
  });
  const credsById = new Map(rows.map((r) => [r.id, r.credentialsEncrypted]));
  const channels: Row[] = rows.map(({ credentialsEncrypted: _c, ...r }) => r);

  const missing = channels.filter((c) => !c.externalAccountId && c.isActive);
  console.log(`FB／IG 渠道 ${channels.length} 個，啟用中且缺帳號 ID ${missing.length} 個\n`);

  // 1. 查詢
  const found = new Map<string, string>(); // channelId -> accountId
  const failures: string[] = [];
  for (const c of missing) {
    try {
      const creds = decryptCredentials(credsById.get(c.id)!);
      const token = creds.pageAccessToken as string | undefined;
      if (!token) throw new Error('憑證沒有 pageAccessToken');
      const accountId = await lookupAccountId(c.channelType, token);
      found.set(c.id, accountId);
      console.log(`  查到 ${label(c)} → ${accountId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${label(c)}：${msg}`);
      console.log(`  失敗 ${label(c)}：${msg}`);
    }
  }

  // 2. 比對重複（含已寫入帳號 ID 的渠道；不分租戶）
  const claims = new Map<string, Row[]>(); // `${type}:${accountId}` -> channels
  for (const c of channels) {
    const accountId = c.externalAccountId ?? found.get(c.id);
    if (!accountId) continue;
    const key = `${c.channelType}:${accountId}`;
    claims.set(key, [...(claims.get(key) ?? []), c]);
  }
  const conflicted = new Set<string>();
  const conflictLines: string[] = [];
  for (const [key, list] of claims) {
    if (list.length < 2) continue;
    for (const c of list) conflicted.add(c.id);
    conflictLines.push(`  ${key}\n${list.map((c) => `    - ${label(c)}${c.externalAccountId ? '（已寫入）' : ''}`).join('\n')}`);
  }
  if (conflictLines.length) {
    console.log(`\n衝突：同一帳號對到多個渠道，以下全部不寫入，請停用多餘的渠道後重跑\n${conflictLines.join('\n')}`);
  }

  const toWrite = [...found].filter(([id]) => !conflicted.has(id));
  console.log(`\n可寫入 ${toWrite.length} 個，衝突 ${[...found.keys()].filter((id) => conflicted.has(id)).length} 個，查詢失敗 ${failures.length} 個`);

  if (!apply) {
    console.log('\n(dry-run) 加上 --apply 才會寫入');
    return;
  }

  let written = 0;
  for (const [id, accountId] of toWrite) {
    const c = channels.find((x) => x.id === id)!;
    try {
      await prisma.channel.updateMany({ where: { id, tenantId: c.tenantId, externalAccountId: null }, data: { externalAccountId: accountId } });
      written++;
    } catch (err) {
      // 腳本執行期間有人按了驗證而先寫入同一帳號：唯一索引擋下，列出即可
      console.log(`  寫入失敗 ${label(c)}：${(err as { code?: string }).code === 'P2002' ? '帳號已被其他渠道連結' : String(err)}`);
    }
  }
  console.log(`\n完成：寫入 ${written} 個`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // 載入的模組會開著 Redis 等連線，明確結束，避免腳本卡住不退出
    process.exit(process.exitCode ?? 0);
  });
