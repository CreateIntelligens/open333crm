#!/usr/bin/env node
/**
 * 清除 #281 修正前每天重複寫入的 SLA 時間軸事件與通知（issue #320，一次性腳本）。
 *
 * 背景：#281（ee79c5ae）之前，SLA 掃描以「24 小時內有沒有同類事件」去重，逾期的工單每天重寫一筆
 * 時間軸事件（case_events），並重發一次通知給負責人與全部主管。#281 改成「同一個期限只記一次」，
 * 但已經產生的重複資料沒有清除。
 *
 * 規則（SQL 在 scripts/sql/dedupe-sla-events.sql）：
 *   - 時間軸：actorType = 'system' 的五種 SLA 事件，同一張工單、同一種事件、同一個期限 key 只留最早一筆
 *     （createdAt、id 排序）。期限 key：逾期類用 facts['sla.dueAt']；警告類再加
 *     facts['sla.warningBeforeMinutes']；客戶等待用 facts['case.lastAgentReplyAt']（null 也算一組）。
 *     沒有 key 的舊列不動。
 *   - 通知：只刪「對應到要刪除的重複時間軸事件」的英文標題 SLA 通知。舊程式寫完事件才把通知丟進佇列，
 *     所以依工單（clickUrl）、類型（= eventType）與時間配對到最近的事件；每筆被刪事件、每位成員
 *     最多刪一筆。對應到保留事件的通知（不同期限週期、客服回覆後重算）與配對不到的通知都不動。
 *   - 兩者都只刪 --cutoff 之前寫入的列。cutoff 之後還有重複事件或英文通知，表示 cutoff 給錯了，
 *     --apply 會拒絕執行。
 *
 * 安全設計：
 *   - 預設 dry-run：只印出筆數，交易最後回滾；建立暫存表後把交易設為唯讀。
 *   - --apply：單一交易。要刪的 id 放進 TEMP TABLE，刪除前把整列匯出成 CSV，DELETE 的筆數要和
 *     預覽一致，不一致就回滾並以非零結束。不在正式 schema 建備份表。
 *   - --expect-events / --expect-notifications：帶入 dry-run 確認過的筆數，這次預覽不同就不刪。
 *   - 需要能略過 RLS 的連線（owner 或 BYPASSRLS）：優先用 MIGRATE_DATABASE_URL，否則 DATABASE_URL。
 *     連線身分不能略過 RLS 時直接失敗，不會因為看不到資料而回報 0 筆。
 *
 * 用法（在 repo 根目錄，或把 scripts/ 整個資料夾複製到 API 容器的 /app/scripts/ 後在 /app 執行）：
 *   node scripts/dedupe-sla-events.mjs --find-cutoff
 *   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z
 *   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z --tenant <id> [--tenant <id>]
 *   node scripts/dedupe-sla-events.mjs --cutoff 2026-10-15T08:00:00Z --tenant <id> --apply \
 *     --expect-events 1234 --expect-notifications 567 [--out-dir /tmp] [--notifications=skip]
 *
 * 操作手冊：docs/ref/features/SLA.md「清除 #281 前的重複 SLA 事件」。
 */
import { createRequire } from 'node:module';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_PATH = fileURLToPath(new URL('./sql/dedupe-sla-events.sql', import.meta.url));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPLICIT_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const EXPORT_BATCH = 5000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const USAGE = `用法：
  node scripts/dedupe-sla-events.mjs --find-cutoff
  node scripts/dedupe-sla-events.mjs --cutoff <ISO 時間，含時區> [--tenant <id> ...]
      [--notifications=delete|skip] [--apply [--expect-events N] [--expect-notifications N] [--out-dir 目錄]]`;

/**
 * @description 解析命令列參數；不合法時丟出 Error（訊息為繁體中文）。
 * @param {string[]} argv process.argv.slice(2)
 */
export function parseArgs(argv) {
  const opts = {
    mode: 'report',
    cutoff: null,
    tenants: [],
    apply: false,
    notifications: 'delete',
    outDir: process.cwd(),
    expectEvents: null,
    expectNotifications: null,
  };
  let cutoffRaw = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const takeValue = () => {
      if (eq > 0) return arg.slice(eq + 1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${name} 需要一個值`);
      i += 1;
      return next;
    };
    const takeCount = () => {
      const raw = takeValue();
      if (!/^\d+$/.test(raw)) throw new Error(`${name} 要是 0 以上的整數，收到「${raw}」`);
      return Number(raw);
    };

    switch (name) {
      case '--find-cutoff':
        opts.mode = 'find-cutoff';
        break;
      case '--apply':
        opts.apply = true;
        break;
      case '--cutoff':
        cutoffRaw = takeValue();
        break;
      case '--tenant': {
        const id = takeValue();
        if (!UUID_RE.test(id)) throw new Error(`--tenant 要是租戶 ID（UUID），收到「${id}」`);
        opts.tenants.push(id.toLowerCase());
        break;
      }
      case '--notifications': {
        const value = takeValue();
        if (value !== 'delete' && value !== 'skip') {
          throw new Error(`--notifications 只接受 delete 或 skip，收到「${value}」`);
        }
        opts.notifications = value;
        break;
      }
      case '--out-dir':
        opts.outDir = resolve(takeValue());
        break;
      case '--expect-events':
        opts.expectEvents = takeCount();
        break;
      case '--expect-notifications':
        opts.expectNotifications = takeCount();
        break;
      default:
        throw new Error(`不認得的參數 ${arg}\n${USAGE}`);
    }
  }

  if (opts.mode === 'find-cutoff') return opts;

  if (!cutoffRaw) throw new Error(`請用 --cutoff 指定 #281 上線時間（可先執行 --find-cutoff）\n${USAGE}`);
  if (!EXPLICIT_TZ_RE.test(cutoffRaw)) {
    throw new Error(`--cutoff 要寫時區（例如 2026-10-15T08:00:00Z 或 +08:00），收到「${cutoffRaw}」`);
  }
  const cutoff = new Date(cutoffRaw);
  if (Number.isNaN(cutoff.getTime())) throw new Error(`--cutoff 不是合法的時間：「${cutoffRaw}」`);
  opts.cutoff = cutoff;
  return opts;
}

/** @description 讀出 SQL 檔，以 `-- @名稱` 切成段落 */
export function readSections(path = SQL_PATH) {
  const parts = readFileSync(path, 'utf8').split(/^-- @([a-z-]+)\s*$/m);
  const sections = new Map();
  for (let i = 1; i < parts.length; i += 2) sections.set(parts[i], parts[i + 1].trim());
  return sections;
}

function sectionOf(sections, name) {
  const sql = sections.get(name);
  if (!sql) throw new Error(`dedupe-sla-events.sql 缺少 -- @${name} 段落`);
  return sql;
}

/**
 * @description 在呼叫端給的交易內預覽（並在 apply 時刪除）重複的 SLA 事件與通知。
 *   呼叫端負責交易：dry-run 結束後要回滾；apply 時這個函式丟出錯誤，呼叫端就要回滾。
 * @param {import('@prisma/client').Prisma.TransactionClient} tx owner 交易
 * @param {object} opts parseArgs() 的結果，另可帶 log
 * @returns {Promise<{ report: object, applied: object | null }>}
 */
export async function runDedupe(tx, opts) {
  const sections = readSections();
  const run = (name, ...params) => tx.$executeRawUnsafe(sectionOf(sections, name), ...params);
  const query = (name, ...params) => tx.$queryRawUnsafe(sectionOf(sections, name), ...params);
  const withNotifications = opts.notifications !== 'skip';

  await run('guard');
  await query('params', opts.cutoff.toISOString(), opts.tenants.join(','));
  await run('ranked-events');
  await run('event-targets');
  if (withNotifications) {
    await run('notification-pairs');
    await run('notification-targets');
  } else {
    // 讓 @target-totals 與 @delete-notifications 仍可執行：空的目標表
    await tx.$executeRawUnsafe('CREATE TEMP TABLE sla_dedupe_notification_targets (id uuid) ON COMMIT DROP');
  }
  if (!opts.apply) {
    // dry-run：暫存表建好後，這個交易不再寫入任何資料
    await tx.$executeRawUnsafe('SET LOCAL transaction_read_only = on');
  }

  const eventsByTenant = await query('count-events');
  const notificationsByTenant = withNotifications ? await query('count-notifications') : null;
  const notificationSummary = withNotifications ? (await query('notification-summary'))[0] : null;
  const sum = (rows) => rows.reduce((n, r) => n + r.toDelete, 0);
  const report = {
    cutoff: opts.cutoff.toISOString(),
    tenants: opts.tenants,
    events: { byTenant: eventsByTenant, total: sum(eventsByTenant) },
    notifications: notificationsByTenant
      ? {
          byTenant: notificationsByTenant,
          total: sum(notificationsByTenant),
          english: notificationSummary.english,
          matchedKept: notificationSummary.matchedKept,
          extraOnDeleted: notificationSummary.extraOnDeleted,
          unmatched: notificationSummary.unmatched,
        }
      : null,
    afterCutoff: {
      events: (await query('after-cutoff-events'))[0].count,
      notifications: notificationSummary?.afterCutoff ?? 0,
    },
    missingKey: await query('missing-key'),
    topCases: await query('top-cases'),
    affectedRules: await query('affected-rules'),
  };

  // 先印預覽：--apply 被拒絕時也看得到筆數
  if (opts.log) printReport(report, opts.log);
  if (!opts.apply) return { report, applied: null };

  const applied = await applyDeletion(tx, sections, report, opts);
  return { report, applied };
}

async function applyDeletion(tx, sections, report, opts) {
  const { afterCutoff } = report;
  if (afterCutoff.events > 0 || afterCutoff.notifications > 0) {
    throw new Error(
      `cutoff 之後仍有重複事件 ${afterCutoff.events} 筆、英文 SLA 通知 ${afterCutoff.notifications} 筆，` +
        'cutoff 可能早於 #281 上線時間。請用 --find-cutoff 確認後再執行，這次不刪除。',
    );
  }
  const expected = { events: report.events.total, notifications: report.notifications?.total ?? 0 };
  if (opts.expectEvents != null && opts.expectEvents !== expected.events) {
    throw new Error(`時間軸要刪 ${expected.events} 筆，與預期的 ${opts.expectEvents} 筆不一致，這次不刪除。請重新執行 dry-run 確認。`);
  }
  if (opts.expectNotifications != null && opts.expectNotifications !== expected.notifications) {
    throw new Error(`通知要刪 ${expected.notifications} 筆，與預期的 ${opts.expectNotifications} 筆不一致，這次不刪除。請重新執行 dry-run 確認。`);
  }
  const [totals] = await tx.$queryRawUnsafe(sectionOf(sections, 'target-totals'));
  if (totals.events !== expected.events || totals.notifications !== expected.notifications) {
    throw new Error(`目標表筆數（${totals.events}/${totals.notifications}）與預覽（${expected.events}/${expected.notifications}）不一致，這次不刪除。`);
  }
  if (expected.events === 0 && expected.notifications === 0) {
    return { deletedEvents: 0, deletedNotifications: 0, files: {} };
  }

  const stamp = opts.fileStamp ?? new Date().toISOString().replace(/[-:.]/g, '');
  const files = {
    events: resolve(opts.outDir, `sla-dedupe-${stamp}-case-events.csv`),
    notifications: resolve(opts.outDir, `sla-dedupe-${stamp}-notifications.csv`),
  };
  // 只記這次成功建立的檔案：開檔失敗（例如同名檔案已存在）時不能把別人的檔案刪掉
  const created = [];
  try {
    await exportCsv(tx, sectionOf(sections, 'export-events'), files.events, created, [
      'id', 'tenantId', 'caseId', 'actorType', 'actorId', 'eventType', 'payload', 'createdAt',
    ]);
    await exportCsv(tx, sectionOf(sections, 'export-notifications'), files.notifications, created, [
      'id', 'tenantId', 'agentId', 'type', 'title', 'body', 'clickUrl', 'isRead', 'readAt', 'createdAt',
    ]);

    const deletedEvents = await tx.$executeRawUnsafe(sectionOf(sections, 'delete-events'));
    const deletedNotifications = await tx.$executeRawUnsafe(sectionOf(sections, 'delete-notifications'));
    if (deletedEvents !== expected.events || deletedNotifications !== expected.notifications) {
      throw new Error(
        `實際刪除（時間軸 ${deletedEvents}、通知 ${deletedNotifications}）與預覽（${expected.events}、${expected.notifications}）不一致，整筆交易回滾。`,
      );
    }
    return { deletedEvents, deletedNotifications, files };
  } catch (err) {
    // 交易會回滾：CSV 裡的列沒有被刪，留著會被誤認為備份
    for (const file of created) if (existsSync(file)) unlinkSync(file);
    throw err;
  }
}

/**
 * @description 一個 CSV 欄位。NULL 寫成沒有引號的空欄位（psql \copy 的 FORMAT csv 讀回 NULL），
 *   其他值一律加引號：日期寫 ISO 8601（UTC），物件與陣列（例如 jsonb）寫 JSON，其餘用 String()。
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportCsv(tx, sql, file, created, columns) {
  const fd = openSync(file, 'wx');
  created.push(file);
  try {
    writeSync(fd, `${columns.map(csvCell).join(',')}\n`);
    let lastId = ZERO_UUID;
    for (;;) {
      const rows = await tx.$queryRawUnsafe(sql, lastId, EXPORT_BATCH);
      for (const row of rows) writeSync(fd, `${columns.map((c) => csvCell(row[c])).join(',')}\n`);
      if (rows.length < EXPORT_BATCH) break;
      lastId = rows[rows.length - 1].id;
    }
  } finally {
    closeSync(fd);
  }
}

/** @description 找 cutoff：最早的中文 SLA 通知時間與最晚的英文 SLA 通知時間 */
export async function findCutoff(tx) {
  const sections = readSections();
  await tx.$executeRawUnsafe(sectionOf(sections, 'guard'));
  const [row] = await tx.$queryRawUnsafe(sectionOf(sections, 'find-cutoff'));
  return row;
}

function printReport(report, log) {
  const scope = report.tenants.length ? report.tenants.join(', ') : '所有租戶';
  log(`cutoff：${report.cutoff}（只刪這個時間之前寫入的列）`);
  log(`範圍：${scope}\n`);

  log(`時間軸事件：要刪 ${report.events.total} 筆`);
  for (const r of report.events.byTenant) log(`  [${r.tenantName}] ${r.tenantId}  ${r.eventType}  ${r.toDelete}`);
  if (report.notifications) {
    const n = report.notifications;
    log(`\n英文標題 SLA 通知：共 ${n.english} 則，配對到要刪除的重複事件、要刪 ${n.total} 則`);
    for (const r of n.byTenant) log(`  [${r.tenantName}] ${r.tenantId}  ${r.type}  ${r.toDelete}`);
    log(`  配對到保留的事件（不動）：${n.matchedKept} 則`);
    log(`  同一筆被刪事件、同一位成員的第二則以後（不動）：${n.extraOnDeleted} 則`);
    log(`  配對不到事件（不動）：${n.unmatched} 則`);
  } else {
    log('\n英文標題 SLA 通知：--notifications=skip，不處理');
  }

  log(`\ncutoff 之後（應為 0）：重複事件 ${report.afterCutoff.events}、英文 SLA 通知 ${report.afterCutoff.notifications}`);

  const missing = report.missingKey.map((r) => `${r.eventType} ${r.count}`).join('、') || '無';
  log(`沒有期限 key、不處理的時間軸事件：${missing}`);

  log('\n重複最多的工單（前 10 張）：');
  if (report.topCases.length === 0) log('  無');
  for (const r of report.topCases) {
    log(`  [${r.tenantName}] ${r.caseId}  ${r.caseStatus}  要刪 ${r.toDelete}  「${r.caseTitle}」`);
  }

  log('\n依 sla.breachCount / sla.escalationLevel 判斷的啟用中規則（清除後會比較晚觸發）：');
  if (report.affectedRules.length === 0) log('  無');
  for (const r of report.affectedRules) log(`  [${r.tenantName}] ${r.name}（${r.id}，${r.eventType}）`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  // 套件裝在 apps/api 底下（repo 與 API 容器都有）；根目錄沒有這個相依
  const apiPackageJson = new URL('../apps/api/package.json', import.meta.url);
  if (!existsSync(apiPackageJson)) {
    console.error('找不到 apps/api/package.json：請把腳本放在 repo（或 API 容器 /app）的 scripts/ 底下執行');
    process.exit(1);
  }
  const { PrismaClient } = createRequire(apiPackageJson)('@prisma/client');
  const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('請設定 MIGRATE_DATABASE_URL 或 DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  const log = (line) => console.log(line);

  class DryRunRollback extends Error {}

  try {
    if (opts.mode === 'find-cutoff') {
      const row = await findCutoff(prisma);
      log(`最早的中文 SLA 通知（#281 之後）：${row.firstChineseAt?.toISOString() ?? '無'}`);
      log(`最晚的英文 SLA 通知（#281 之前）：${row.lastEnglishAt?.toISOString() ?? '無'}`);
      if (row.firstChineseAt) log(`\n可用的 cutoff：--cutoff ${row.firstChineseAt.toISOString()}`);
      if (row.firstChineseAt && row.lastEnglishAt && row.lastEnglishAt >= row.firstChineseAt) {
        log('注意：有英文通知晚於最早的中文通知，可能有 worker 還跑舊版本。請改用部署紀錄的時間。');
      }
      return;
    }

    let result;
    try {
      await prisma.$transaction(
        async (tx) => {
          result = await runDedupe(tx, { ...opts, log });
          if (!opts.apply) throw new DryRunRollback();
        },
        { timeout: 30 * 60_000, maxWait: 60_000 },
      );
    } catch (err) {
      if (!(err instanceof DryRunRollback)) throw err;
    }

    if (!opts.apply) {
      log('\n[dry-run] 沒有寫入。確認筆數後加上 --apply 執行，建議同時帶');
      log(`  --expect-events ${result.report.events.total}` +
        (result.report.notifications ? ` --expect-notifications ${result.report.notifications.total}` : ''));
      return;
    }
    const { applied } = result;
    log(`\n已刪除：時間軸 ${applied.deletedEvents} 筆、通知 ${applied.deletedNotifications} 筆。`);
    if (applied.files.events) {
      log(`刪除前匯出的 CSV：\n  ${applied.files.events}\n  ${applied.files.notifications}`);
    }
  } catch (err) {
    console.error(`\n失敗，沒有刪除任何資料：${err.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
