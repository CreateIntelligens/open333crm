/**
 * 粉絲門戶活動的封存機制。
 *   npx tsx src/__tests__/portal-archive.test.ts
 *
 * 背景（Wave 6）：
 * deleteActivity 只允許刪 DRAFT，ENDED 活動沒有任何移除途徑——
 * UAT 累積 12 筆 [E2E] ENDED 活動永遠留在列表上，誤建的活動也一樣。
 *
 * 但也不能直接放寬成「ENDED 也能刪」：
 * PortalSubmission 對 PortalActivity 是 onDelete: Cascade，
 * 硬刪會連帶清掉所有參與者的提交紀錄與積分依據。
 * 活動辦完了要「從列表消失」，不該以銷毀客戶資料為代價。
 *
 * 改用 ARCHIVED 狀態（schema 早就有這個 enum 值，但從未被使用）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const schema = readFileSync(
  join(here, '../../../../packages/database/prisma/schema.prisma'),
  'utf8',
);

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

const service = src('modules/portal/portal.service.ts');
const routes = src('modules/portal/portal.routes.ts');

// ─── 前提：確認「為什麼不能直接刪」 ──────────────────────────────────────

t('前提：PortalSubmission 對活動是 Cascade（硬刪會清掉參與紀錄）', () => {
  // 用「下一個 model/enum 宣告」當結尾——不能用第一個 '}'，
  // 因為 @default("{}") 這類預設值裡就有大括號，會提早截斷。
  const start = schema.indexOf('model PortalSubmission');
  const rest = schema.slice(start + 1);
  const nextDecl = rest.search(/\n(model|enum) /);
  const submissionModel = rest.slice(0, nextDecl === -1 ? undefined : nextDecl);
  assert.ok(
    submissionModel.includes('onDelete: Cascade'),
    '若不是 Cascade，這個設計前提就要重新評估',
  );
});

t('前提：schema 早就有 ARCHIVED 狀態（不需 migration）', () => {
  const enumBlock = schema.slice(
    schema.indexOf('enum PortalActivityStatus'),
    schema.indexOf('}', schema.indexOf('enum PortalActivityStatus')),
  );
  assert.ok(enumBlock.includes('ARCHIVED'));
});

// ─── 封存語意 ─────────────────────────────────────────────────────────────

t('有 archiveActivity 與 unarchiveActivity', () => {
  assert.ok(service.includes('export async function archiveActivity'));
  assert.ok(service.includes('export async function unarchiveActivity'));
});

t('封存是改狀態，不是刪除（不可誤用 delete）', () => {
  const block = service.slice(
    service.indexOf('export async function archiveActivity'),
    service.indexOf('export async function unarchiveActivity'),
  );
  assert.ok(/status:\s*'ARCHIVED'/.test(block), '未設為 ARCHIVED');
  assert.ok(
    !/portalActivity\.delete/.test(block),
    'archiveActivity 不該呼叫 delete——會連帶清掉參與者的提交紀錄',
  );
});

t('進行中（PUBLISHED）的活動不可直接封存', () => {
  const block = service.slice(
    service.indexOf('export async function archiveActivity'),
    service.indexOf('export async function unarchiveActivity'),
  );
  assert.ok(
    /status === 'PUBLISHED'/.test(block),
    '未擋下 PUBLISHED——進行中的活動被收起來，客戶會突然看不到',
  );
});

t('重複封存要擋下（避免誤判成功）', () => {
  const block = service.slice(
    service.indexOf('export async function archiveActivity'),
    service.indexOf('export async function unarchiveActivity'),
  );
  assert.ok(/status === 'ARCHIVED'/.test(block));
});

t('取消封存回到 ENDED，且只對已封存的活動有效', () => {
  const block = service.slice(service.indexOf('export async function unarchiveActivity'));
  assert.ok(/status !== 'ARCHIVED'/.test(block), '未檢查是否真的已封存');
  assert.ok(/status:\s*'ENDED'/.test(block), '未回到 ENDED');
});

// ─── 列表過濾 ─────────────────────────────────────────────────────────────

t('列表預設不顯示已封存的活動', () => {
  const block = service.slice(
    service.indexOf('export async function listActivities'),
    service.indexOf('export async function getActivity'),
  );
  assert.ok(
    /not:\s*'ARCHIVED'/.test(block),
    'listActivities 未排除 ARCHIVED——封存了還是看得到，等於沒做',
  );
});

t('明確帶 status 查詢時仍可查到已封存的活動', () => {
  const block = service.slice(
    service.indexOf('export async function listActivities'),
    service.indexOf('export async function getActivity'),
  );
  assert.ok(
    /if\s*\(filters\.status\)/.test(block),
    '呼叫端應能用 status=ARCHIVED 查回已封存的活動',
  );
});

// ─── 路由 ─────────────────────────────────────────────────────────────────

t('封存端點受 portal.manage 權限保護', () => {
  assert.ok(routes.includes("'/activities/:id/archive'"), '缺少封存端點');
  assert.ok(routes.includes("'/activities/:id/unarchive'"), '缺少取消封存端點');
  const archiveBlock = routes.slice(routes.indexOf("'/activities/:id/archive'"));
  assert.ok(
    archiveBlock.slice(0, 200).includes("requirePermission('portal.manage')"),
    '封存端點未做權限守門',
  );
});

t('封存端點不把 AppError 壓成 400（保留 409 等語意狀態碼）', () => {
  const start = routes.indexOf("'/activities/:id/archive'");
  const end = routes.indexOf("'/activities/:id/unarchive'");
  const block = routes.slice(start, end);
  assert.ok(
    !block.includes('status(400)'),
    '同檔其他端點把 AppError 一律轉 400，遺失了 409 的語意；新端點應交給全域 handler',
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
