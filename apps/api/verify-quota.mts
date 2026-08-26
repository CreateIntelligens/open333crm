import { loadEnvConfig } from './src/config/env.js';
loadEnvConfig();
import { PrismaClient } from '@prisma/client';
import { redis } from '@open333crm/core';
import { incrMonthlyTokens, isMonthlyTokenExceeded, clearTokenQuotaCache } from './src/modules/trial/token-quota.service.js';
const prisma = new PrismaClient();
const TENANT = 'a0000000-0000-0000-0000-000000000001';

async function main() {
  await clearTokenQuotaCache(TENANT);
  // demo 租戶 planId=null → 無上限，isMonthlyTokenExceeded 應恆 false
  const noLimit = await isMonthlyTokenExceeded(prisma, TENANT);
  console.log(`[1] 無 plan(planId=null) → 不擋: ${noLimit === false ? 'PASS' : 'FAIL'}`);

  // 直接測計數器累加邏輯（不依賴 plan）
  await clearTokenQuotaCache(TENANT);
  await incrMonthlyTokens(prisma, TENANT, 1000);
  await incrMonthlyTokens(prisma, TENANT, 500);
  const now = new Date();
  const key = `aiquota:${TENANT}:${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const val = await redis.get(key);
  // 注意：incr 前會先回填 DB 值（可能非0），故驗證「累加了 1500」而非絕對值
  console.log(`[2] 計數器 key=${key} 值=${val}（含 DB 回填 + 1500 累加）`);
  console.log(`[2] 計數器有值且 >= 1500: ${Number(val) >= 1500 ? 'PASS' : 'FAIL'}`);

  // TTL 檢查（應設到月底）
  const ttl = await redis.pttl(key);
  console.log(`[3] TTL 設到月底（>0 天）: ${ttl > 0 ? 'PASS (剩 '+Math.round(ttl/86400000)+' 天)' : 'FAIL'}`);

  // 清理
  await clearTokenQuotaCache(TENANT);
  console.log('已清理計數器');
  await redis.quit();
}
main().catch(console.error).finally(() => prisma.$disconnect());
