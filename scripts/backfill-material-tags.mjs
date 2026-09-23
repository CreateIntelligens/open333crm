#!/usr/bin/env node
/**
 * 把既有素材的 Material.tags 回填到 Tag 表（scope=MATERIAL），並正規化素材上的值。
 *
 * 背景：素材標籤原本是 Material.tags（String[] 自由字串），與「設定 → 標籤管理」
 * 的 Tag 表互不相通。2026-09-23 統一後，新寫入會自動登記到 Tag 表，
 * 但既有資料還沒有對應的 Tag 紀錄，也可能殘留未 trim 的值（如「  春季促銷  」）。
 *
 * 這支腳本做兩件事：
 *   1. 把每個素材用過的標籤登記到 Tag 表（已存在的跳過）
 *   2. 把素材上的 tags 正規化（trim + 去重），讓它與 Tag 表對得起來
 *
 * 安全設計：
 *   - 預設 dry-run，要帶 --apply 才寫入
 *   - 會先列出「將建立的標籤」與「將被正規化的素材」供人工確認
 *   - 不刪除任何標籤，只新增與清理格式
 *
 * 用法：
 *   DATABASE_URL=... node scripts/backfill-material-tags.mjs           # 只看會動到什麼
 *   DATABASE_URL=... node scripts/backfill-material-tags.mjs --apply   # 實際執行
 */
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** trim + 去重（大小寫不敏感，保留首次出現的寫法） */
function normalize(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags ?? []) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

try {
  const materials = await prisma.material.findMany({
    where: { isActive: true },
    select: { id: true, name: true, tenantId: true, tags: true },
  });

  // 依租戶彙整需要的標籤名稱，並找出需要正規化的素材
  const byTenant = new Map();
  const needsNormalize = [];

  for (const m of materials) {
    const norm = normalize(m.tags);
    if (norm.length === 0) continue;

    if (JSON.stringify(norm) !== JSON.stringify(m.tags)) {
      needsNormalize.push({ ...m, normalized: norm });
    }
    if (!byTenant.has(m.tenantId)) byTenant.set(m.tenantId, new Set());
    for (const t of norm) byTenant.get(m.tenantId).add(t);
  }

  // 找出尚未登記到 Tag 表的
  const toCreate = [];
  for (const [tenantId, names] of byTenant) {
    const existing = await prisma.tag.findMany({
      where: { tenantId, scope: 'MATERIAL', name: { in: [...names] } },
      select: { name: true },
    });
    const have = new Set(existing.map((t) => t.name.toLowerCase()));
    for (const name of names) {
      if (!have.has(name.toLowerCase())) toCreate.push({ tenantId, name });
    }
  }

  console.log(`掃描素材：${materials.length} 筆`);
  console.log(`將建立的 Tag 紀錄：${toCreate.length} 筆`);
  for (const t of toCreate.slice(0, 10)) console.log(`  + ${t.name}`);
  if (toCreate.length > 10) console.log(`  …其餘 ${toCreate.length - 10} 筆`);

  console.log(`需正規化的素材：${needsNormalize.length} 筆`);
  for (const m of needsNormalize.slice(0, 10)) {
    console.log(`  ~ ${m.name}: ${JSON.stringify(m.tags)} → ${JSON.stringify(m.normalized)}`);
  }
  if (needsNormalize.length > 10) console.log(`  …其餘 ${needsNormalize.length - 10} 筆`);

  if (toCreate.length === 0 && needsNormalize.length === 0) {
    console.log('\n沒有需要處理的資料。');
  } else if (!apply) {
    console.log('\n[dry-run] 未寫入。確認無誤後加 --apply 實際執行。');
  } else {
    for (const t of toCreate) {
      try {
        await prisma.tag.create({
          data: { tenantId: t.tenantId, name: t.name, scope: 'MATERIAL', type: 'MANUAL' },
        });
      } catch {
        // @@unique([tenantId, name, scope]) 衝突 → 已存在，略過
      }
    }
    for (const m of needsNormalize) {
      await prisma.material.update({ where: { id: m.id }, data: { tags: m.normalized } });
    }
    console.log(`\n✔ 已建立 ${toCreate.length} 筆標籤、正規化 ${needsNormalize.length} 筆素材。`);
  }
} finally {
  await prisma.$disconnect();
}
