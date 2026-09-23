/**
 * 素材標籤與「設定 → 標籤管理」統一。
 *   npx tsx src/__tests__/material-tag-unify.test.ts
 *
 * 背景（2026-09-23 使用者提問「這兩個是一樣的東西？」）：
 * 素材標籤原本是 `Material.tags`（String[] 自由字串），與 Tag 表互不相通——
 * 同一個概念在兩邊各存一份，無法改名或合併，也做不到跨模組查詢。
 *
 * 統一方式：保留 Material.tags 作為實際儲存（查詢用 hasSome，不需 join），
 * 但寫入時把標籤名稱登記到 Tag 表（scope=MATERIAL）。
 * 採「隨手打、背後自動建」——行銷人員的操作速度不變，但標籤自此可統一管理。
 *
 * ⚠️ 為什麼不用關聯表（MaterialTag）：
 * `TenantDb` 是 `PrismaClient | TransactionClient | TenantScopedClient` 的聯集，
 * TS 對聯集上的多載推導成本是各成員乘積。實測新增一張關聯表就超過上限，
 * 整個 codebase 噴 470 個 TS2349，且錯誤出現在完全沒改過的檔案。
 * 改 TenantDb 定義牽連 200+ 處、風險過高，故採登記制。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const repoFile = (rel: string) => readFileSync(join(here, '../../../../', rel), 'utf8');
const webSrc = (rel: string) =>
  readFileSync(join(here, '../../../../apps/web/src', rel), 'utf8');

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${(err as Error).message}`);
    fail += 1;
  }
}

const service = src('modules/marketing/material.service.ts');
const schema = repoFile('packages/database/prisma/schema.prisma');

// ─── 正規化邏輯（與 registerMaterialTags 內的實作同語意）──────────────────

function normalize(tags: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

t('trim 前後空白', () => {
  assert.deepEqual(normalize(['  春季促銷  ']), ['春季促銷']);
});

t('大小寫不敏感去重，保留首次出現的寫法', () => {
  assert.deepEqual(normalize(['VIP', 'vip', 'Vip']), ['VIP']);
});

t('trim 後相同視為重複（這是實測踩到的情境）', () => {
  // UAT 實測：使用者輸入 ["春季促銷", "  春季促銷  "] 原本會存成兩筆
  assert.deepEqual(normalize(['春季促銷', '  春季促銷  ']), ['春季促銷']);
});

t('空字串與純空白被丟棄', () => {
  assert.deepEqual(normalize(['', '   ', '　', '有效']), ['有效']);
});

t('保留順序', () => {
  assert.deepEqual(normalize(['c', 'a', 'b']), ['c', 'a', 'b']);
});

// ─── schema ───────────────────────────────────────────────────────────────

t('TagScope 有 MATERIAL', () => {
  const block = schema.slice(
    schema.indexOf('enum TagScope'),
    schema.indexOf('}', schema.indexOf('enum TagScope')),
  );
  assert.ok(block.includes('MATERIAL'), 'TagScope 缺 MATERIAL，素材標籤無法登記到 Tag 表');
});

t('沒有建立 MaterialTag 關聯表（刻意的取捨，見檔頭）', () => {
  assert.ok(
    !schema.includes('model MaterialTag'),
    '新增關聯表會讓 TenantDb 的聯集型別推導超過上限（實測 470 個 TS2349）',
  );
});

t('Material.tags 仍是實際儲存處', () => {
  const block = schema.slice(
    schema.indexOf('model Material '),
    schema.indexOf('model MaterialCategory'),
  );
  assert.ok(/tags\s+String\[\]/.test(block), 'Material.tags 不該被移除');
});

// ─── service ──────────────────────────────────────────────────────────────

t('registerMaterialTags 會把標籤登記到 Tag 表', () => {
  assert.ok(service.includes('export async function registerMaterialTags'), '缺登記函式');
  const block = service.slice(service.indexOf('export async function registerMaterialTags'));
  assert.ok(block.includes("scope: 'MATERIAL'"), '未指定 MATERIAL scope');
  assert.ok(/prisma\.tag\.create/.test(block), '未在標籤不存在時建立');
});

t('自動建標籤有處理併發衝突', () => {
  const block = service.slice(service.indexOf('export async function registerMaterialTags'));
  assert.ok(
    /try\s*\{[\s\S]*?prisma\.tag\.create[\s\S]*?\}\s*catch/.test(block),
    '未包 try/catch——@@unique[tenantId,name,scope] 在併發下會衝突',
  );
});

t('建立與更新素材都會登記標籤', () => {
  const calls = service.match(/await registerMaterialTags\(/g) ?? [];
  assert.ok(calls.length >= 2, `建立與更新都要登記，目前只有 ${calls.length} 處`);
});

t('正規化後的值會寫回 Material.tags', () => {
  // 否則素材存著「  春季促銷  」而 Tag 表是「春季促銷」，兩邊對不起來、過濾失準
  assert.ok(
    service.includes('normalizedTags') || service.includes('normalized'),
    '未把正規化結果寫回素材',
  );
});

t('更新素材時只在有帶 tags 才登記（避免誤清）', () => {
  assert.ok(
    /if \(input\.tags !== undefined\) \{[\s\S]{0,200}?registerMaterialTags/.test(service),
    '未判斷 input.tags 是否有帶——改其他欄位時會誤動標籤',
  );
});

// ─── 建議清單 ─────────────────────────────────────────────────────────────

t('listMaterialTags 從 Tag 表讀（含尚未使用的標籤）', () => {
  const block = service.slice(
    service.indexOf('export async function listMaterialTags'),
  );
  assert.ok(
    /prisma\.tag\.findMany[\s\S]{0,200}?scope: 'MATERIAL'/.test(block),
    '未從 Tag 表讀——設定頁新增的標籤在素材編輯器選不到',
  );
});

t('listMaterialTags 併入舊的 Material.tags（過渡期不讓標籤消失）', () => {
  const block = service.slice(service.indexOf('export async function listMaterialTags'));
  assert.ok(
    /prisma\.material\.findMany/.test(block),
    '未併入舊資料——尚未回填的素材標籤會從建議清單消失',
  );
});

// ─── 前後端的 scope 選項要一致 ───────────────────────────────────────────

t('後端 tag schema 接受 MATERIAL', () => {
  const code = src('modules/tag/tag.routes.ts');
  assert.ok(
    /scope: z\.enum\(\[[^\]]*'MATERIAL'/.test(code),
    'tag.routes 的 scope enum 缺 MATERIAL——設定頁建不出素材標籤',
  );
});

t('前端標籤管理有「素材」選項', () => {
  const code = webSrc('components/settings/TagManagement.tsx');
  assert.ok(code.includes("value: 'MATERIAL'"), '建立表單缺素材選項');
  assert.ok(code.includes("MATERIAL: '素材'"), '標籤列表缺素材的中文名');
  assert.ok(
    /'ALL', 'CONTACT', 'CONVERSATION', 'CASE', 'MATERIAL'/.test(code),
    '篩選列缺素材分頁',
  );
});

// ─── code review 發現（2026-09-23）──────────────────────────────────────

t('刪除 MATERIAL 標籤會一併從 Material.tags 移除', () => {
  // 不處理的話：管理員在設定頁刪了標籤，素材仍帶著那個字串，
  // 而 listMaterialTags 會併入舊字串 → 刪掉的標籤立刻又出現在建議清單。
  const code = src('modules/tag/tagging.service.ts');
  assert.ok(
    code.includes('removeMaterialTagString'),
    'deleteTenantTag 未清理 Material.tags——刪掉的標籤會馬上復活',
  );
  const block = code.slice(code.indexOf('export async function deleteTenantTag'));
  assert.ok(
    /scope === 'MATERIAL'[\s\S]{0,120}?removeMaterialTagString/.test(block),
    '未在 MATERIAL scope 時呼叫清理',
  );
});

t('改名 MATERIAL 標籤會同步 Material.tags 內的字串', () => {
  // 不同步的話 Tag 列是新名、素材是舊名，建議清單會同時出現兩個。
  const code = src('modules/tag/tagging.service.ts');
  assert.ok(code.includes('renameMaterialTagString'), 'updateTenantTag 未同步素材標籤');
});

t('registerMaterialTags 的既有查詢是大小寫不敏感', () => {
  // names 已用 toLowerCase 去重，但 Postgres 的 in 與 @@unique 都區分大小寫。
  // 只用 `in: names` 查的話，素材 A 存 Sale、B 存 sale 會建出兩筆 Tag 列。
  const block = service.slice(
    service.indexOf('export async function registerMaterialTags'),
  );
  assert.ok(
    /mode: 'insensitive'/.test(block),
    '查詢未用 insensitive——大小寫不同的同義標籤會重複建立',
  );
});

// ─── 回填腳本 ─────────────────────────────────────────────────────────────

t('有回填腳本處理既有資料', () => {
  const script = repoFile('scripts/backfill-material-tags.mjs');
  assert.ok(script.includes("scope: 'MATERIAL'"), '未登記為 MATERIAL scope');
  assert.ok(script.includes("includes('--apply')"), '未提供 dry-run');
  assert.ok(
    script.includes('material.update'),
    '未正規化既有素材的 tags——會殘留未 trim 的值',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
