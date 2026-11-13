/**
 * 留言關鍵字自動私訊的 4 張租戶表：RLS、權限、複合外鍵與唯一索引（change add-comment-keyword-private-reply，tasks 3.1）。
 *
 * - `comment_reply_rules`、`comment_reply_logs`、`comment_authors`、`comment_reply_usages` 都 ENABLE＋FORCE RLS，
 *   app_tenant 未綁租戶時看不到任何列，綁 A 時不能寫入 tenantId 為 B 的列。
 * - 外鍵 (channelId, tenantId)、(ruleId, tenantId)、(commentAuthorId, tenantId) 是複合外鍵：
 *   外鍵檢查不受 RLS 影響，所以單欄外鍵會讓 A 的列指向 B 的渠道／規則／留言者，複合外鍵才擋得住。
 * - 收件冪等靠 UNIQUE (channelId, commentId)（design D9）；
 *   「同一位留言者只私訊一次」靠部分唯一索引，只在 SENDING／SENT 生效（design D10）。
 *
 * 資料隔離：每列都帶 MARK（渠道、聯絡人名稱、規則名稱、留言 ID 前綴），afterAll 以 admin 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import { TENANT_A, TENANT_B, urls } from '#tests/setup/feature-config.js';

const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
const adminDb = new PrismaClient({ datasources: { db: { url: urls.admin } } });

const MARK = `CR-RLS-${Date.now().toString(36)}`;
const TABLES = ['comment_reply_rules', 'comment_reply_logs', 'comment_authors', 'comment_reply_usages'];
const MONTH = '2099-01';

interface Seed {
  channelId: string;
  contactId: string;
  ruleId: string;
  authorId: string;
}
const seeds: Record<string, Seed> = {};
let seq = 0;
const nextCommentId = () => `${MARK}-c${++seq}`;

/** 以 admin（BYPASSRLS）建一組渠道、聯絡人、規則、留言者、當月用量 */
async function seedTenant(tenantId: string): Promise<Seed> {
  const channel = await adminDb.channel.create({
    data: { tenantId, channelType: 'FB', displayName: MARK, credentialsEncrypted: 'x' },
  });
  const contact = await adminDb.contact.create({ data: { tenantId, displayName: MARK } });
  const rule = await adminDb.commentReplyRule.create({
    data: { tenantId, channelId: channel.id, name: MARK, keywords: ['+1'], contentType: 'text', messageText: 'hi' },
  });
  const author = await adminDb.commentAuthor.create({
    data: {
      tenantId,
      channelId: channel.id,
      externalUserId: `${MARK}-u-${tenantId.slice(0, 2)}`,
      contactId: contact.id,
      firstCommentAt: new Date(),
      lastCommentAt: new Date(),
    },
  });
  await adminDb.commentReplyUsage.create({ data: { tenantId, month: MONTH } });
  return { channelId: channel.id, contactId: contact.id, ruleId: rule.id, authorId: author.id };
}

/** 以 app_tenant 綁 A 寫一筆紀錄；回傳 Prisma 錯誤碼（成功回 null） */
async function insertLogAsA(data: Record<string, unknown>): Promise<string | null> {
  try {
    await withTenant(tenantDb, TENANT_A, (tx) =>
      tx.commentReplyLog.create({
        data: {
          tenantId: TENANT_A,
          postId: `${MARK}-post`,
          commentCreatedAt: new Date(),
          ...(data as { channelId: string; ruleId: string; commentAuthorId: string; commentId: string }),
        },
      }),
    );
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? String((err as Error).message);
  }
}

/** admin 直接建一筆 A 的紀錄（繞過 RLS，用來測索引本身） */
function adminLog(extra: Record<string, unknown>) {
  const a = seeds.A;
  return adminDb.commentReplyLog.create({
    data: {
      tenantId: TENANT_A,
      channelId: a.channelId,
      ruleId: a.ruleId,
      commentAuthorId: a.authorId,
      commentId: nextCommentId(),
      postId: `${MARK}-post`,
      commentCreatedAt: new Date(),
      ...extra,
    },
  });
}

beforeAll(async () => {
  seeds.A = await seedTenant(TENANT_A);
  seeds.B = await seedTenant(TENANT_B);
  await adminLog({});
});

afterAll(async () => {
  const channels = await adminDb.channel.findMany({ where: { displayName: MARK }, select: { id: true } });
  const channelIds = channels.map((c) => c.id);
  await adminDb.commentReplyLog.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {});
  await adminDb.commentAuthor.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {});
  await adminDb.commentReplyRule.deleteMany({ where: { channelId: { in: channelIds } } }).catch(() => {});
  await adminDb.commentReplyUsage.deleteMany({ where: { month: MONTH } }).catch(() => {});
  await adminDb.contact.deleteMany({ where: { displayName: MARK } }).catch(() => {});
  await adminDb.channel.deleteMany({ where: { id: { in: channelIds } } }).catch(() => {});
  await tenantDb.$disconnect();
  await adminDb.$disconnect();
});

describe('資料表設定', () => {
  test('4 張表都 ENABLE＋FORCE RLS、有 tenant_isolation policy、明確授權 app_tenant 四種權限', async () => {
    const rows = await adminDb.$queryRawUnsafe<Array<{ relname: string; rls: boolean; force: boolean; policy: boolean; grants: number }>>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS policy,
              (SELECT count(*)::int FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
                WHERE has_table_privilege('app_tenant', c.oid, p.priv)) AS grants
         FROM pg_class c
        WHERE c.relname = ANY($1::text[]) AND c.relkind = 'r'
        ORDER BY c.relname`,
      TABLES,
    );
    assert.deepEqual(
      rows.map((r) => r.relname),
      [...TABLES].sort(),
      '4 張表都要存在',
    );
    for (const r of rows) {
      assert.equal(r.rls, true, `${r.relname} 要 ENABLE ROW LEVEL SECURITY`);
      assert.equal(r.force, true, `${r.relname} 要 FORCE ROW LEVEL SECURITY`);
      assert.equal(r.policy, true, `${r.relname} 要有 tenant_isolation policy`);
      assert.equal(r.grants, 4, `${r.relname} 要明確 GRANT app_tenant SELECT/INSERT/UPDATE/DELETE`);
    }
  });

  test('conversations.originCommentReplyLogId 參照 comment_reply_logs，刪除紀錄時設為 null', async () => {
    const rows = await adminDb.$queryRawUnsafe<Array<{ ref: string; del: string }>>(
      // information_schema 只列目前角色擁有的表，改查 pg_constraint（confdeltype 'n' = SET NULL）
      `SELECT con.confrelid::regclass::text AS ref,
              CASE con.confdeltype WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' ELSE con.confdeltype::text END AS del
         FROM pg_constraint con
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
        WHERE con.contype = 'f' AND con.conrelid = 'conversations'::regclass AND a.attname = 'originCommentReplyLogId'`,
    );
    assert.equal(rows.length, 1, 'conversations 要有 originCommentReplyLogId 外鍵');
    assert.equal(rows[0].ref, 'comment_reply_logs');
    assert.equal(rows[0].del, 'SET NULL');
  });
});

describe('RLS 隔離', () => {
  test('app_tenant 未綁租戶時 4 張表都回 0 列', async () => {
    assert.equal(await tenantDb.commentReplyRule.count(), 0);
    assert.equal(await tenantDb.commentReplyLog.count(), 0);
    assert.equal(await tenantDb.commentAuthor.count(), 0);
    assert.equal(await tenantDb.commentReplyUsage.count(), 0);
  });

  test('綁 A 只看得到 A 的規則與留言者，看不到 B 的', async () => {
    const [rules, authors] = await withTenant(tenantDb, TENANT_A, async (tx) => [
      await tx.commentReplyRule.findMany({ where: { name: MARK }, select: { tenantId: true } }),
      await tx.commentAuthor.findMany({ where: { channelId: { in: [seeds.A.channelId, seeds.B.channelId] } }, select: { tenantId: true } }),
    ]);
    assert.deepEqual(rules.map((r) => r.tenantId), [TENANT_A]);
    assert.deepEqual(authors.map((r) => r.tenantId), [TENANT_A]);
  });

  test('綁 A 時寫入 tenantId 為 B 的列被 WITH CHECK 擋下', async () => {
    const b = seeds.B;
    await assert.rejects(
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.commentReplyRule.create({
          data: { tenantId: TENANT_B, channelId: b.channelId, name: MARK, keywords: ['x'], contentType: 'text', messageText: 'x' },
        }),
      ),
      /row-level security/i,
    );
    await assert.rejects(
      withTenant(tenantDb, TENANT_A, (tx) => tx.commentReplyUsage.create({ data: { tenantId: TENANT_B, month: '2099-02' } })),
      /row-level security/i,
    );
    await assert.rejects(
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.commentAuthor.create({
          data: {
            tenantId: TENANT_B,
            channelId: b.channelId,
            externalUserId: `${MARK}-wc`,
            contactId: b.contactId,
            firstCommentAt: new Date(),
            lastCommentAt: new Date(),
          },
        }),
      ),
      /row-level security/i,
    );
    await assert.rejects(
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.commentReplyLog.create({
          data: {
            tenantId: TENANT_B,
            channelId: b.channelId,
            ruleId: b.ruleId,
            commentAuthorId: b.authorId,
            commentId: nextCommentId(),
            postId: 'p',
            commentCreatedAt: new Date(),
          },
        }),
      ),
      /row-level security/i,
    );
  });
});

describe('複合外鍵擋跨租戶參照', () => {
  test('以 A 的 tenantId 參照 B 的 channelId → 外鍵錯誤', async () => {
    const a = seeds.A;
    const code = await insertLogAsA({ channelId: seeds.B.channelId, ruleId: a.ruleId, commentAuthorId: a.authorId, commentId: nextCommentId() });
    assert.equal(code, 'P2003');
  });

  test('以 A 的 tenantId 參照 B 的 ruleId → 外鍵錯誤', async () => {
    const a = seeds.A;
    const code = await insertLogAsA({ channelId: a.channelId, ruleId: seeds.B.ruleId, commentAuthorId: a.authorId, commentId: nextCommentId() });
    assert.equal(code, 'P2003');
  });

  test('以 A 的 tenantId 參照 B 的 commentAuthorId → 外鍵錯誤', async () => {
    const a = seeds.A;
    const code = await insertLogAsA({ channelId: a.channelId, ruleId: a.ruleId, commentAuthorId: seeds.B.authorId, commentId: nextCommentId() });
    assert.equal(code, 'P2003');
  });

  test('以 A 的 tenantId 建規則參照 B 的渠道 → 外鍵錯誤', async () => {
    await assert.rejects(
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.commentReplyRule.create({
          data: { tenantId: TENANT_A, channelId: seeds.B.channelId, name: MARK, keywords: ['x'], contentType: 'text', messageText: 'x' },
        }),
      ),
      (err: { code?: string }) => err.code === 'P2003',
    );
  });

  test('同租戶的參照可以寫入（對照組）', async () => {
    const a = seeds.A;
    const code = await insertLogAsA({ channelId: a.channelId, ruleId: a.ruleId, commentAuthorId: a.authorId, commentId: nextCommentId() });
    assert.equal(code, null);
  });
});

describe('唯一索引', () => {
  test('(channelId, commentId) 並行寫入兩次只有一筆', async () => {
    const a = seeds.A;
    const commentId = nextCommentId();
    const insert = () =>
      withTenant(tenantDb, TENANT_A, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO comment_reply_logs ("tenantId","channelId","ruleId","commentAuthorId","commentId","postId","commentCreatedAt","updatedAt")
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'p',now(),now())
           ON CONFLICT ("channelId","commentId") DO NOTHING`,
          TENANT_A,
          a.channelId,
          a.ruleId,
          a.authorId,
          commentId,
        ),
      );
    const inserted = await Promise.all([insert(), insert()]);
    assert.equal(inserted[0] + inserted[1], 1, '兩次並行只有一次插入成功');
    assert.equal(await adminDb.commentReplyLog.count({ where: { channelId: a.channelId, commentId } }), 1);
  });

  test('dedupeKey 在 PENDING、FAILED、EXPIRED 可以重複', async () => {
    const dedupeKey = `${MARK}-d1`;
    await adminLog({ dedupeKey, status: 'PENDING' });
    await adminLog({ dedupeKey, status: 'PENDING' });
    await adminLog({ dedupeKey, status: 'FAILED' });
    await adminLog({ dedupeKey, status: 'EXPIRED' });
    await adminLog({ dedupeKey, status: 'SENT' });
    assert.equal(await adminDb.commentReplyLog.count({ where: { dedupeKey } }), 5);
  });

  test('dedupeKey 在 SENDING／SENT 只能有一筆', async () => {
    const dedupeKey = `${MARK}-d2`;
    await adminLog({ dedupeKey, status: 'SENT' });
    await assert.rejects(adminLog({ dedupeKey, status: 'SENT' }), (err: { code?: string }) => err.code === 'P2002');
    await assert.rejects(adminLog({ dedupeKey, status: 'SENDING' }), (err: { code?: string }) => err.code === 'P2002');
    // PENDING → SENDING 撞唯一鍵（消費者認領時的情境）
    const pending = await adminLog({ dedupeKey, status: 'PENDING' });
    await assert.rejects(
      adminDb.commentReplyLog.update({ where: { id: pending.id }, data: { status: 'SENDING' } }),
      (err: { code?: string }) => err.code === 'P2002',
    );
  });

  test('dedupeKey 為 null 時不受限制', async () => {
    await adminLog({ status: 'SENT' });
    await adminLog({ status: 'SENT' });
  });
});
