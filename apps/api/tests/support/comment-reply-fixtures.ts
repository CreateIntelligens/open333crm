/**
 * 留言自動私訊 feature 測試的資料準備（change add-comment-keyword-private-reply，planning/05-qa.md §4.3）。
 *
 * 每個測試檔自建一個租戶（「自建租戶＋標記」法：並行測試不能用交易回滾），所有資料掛在這個租戶下，
 * cleanup() 依租戶刪除。用法：
 *
 *   const fx = createCommentReplyFixtures(prisma);
 *   const tenant = await fx.tenant({ plan: { features: ['comment_reply'], limits: { monthlyCommentReplies: 100 } } });
 *   const fb = await fx.fbChannel(tenant.id, { mode: 'platform' });
 *   const role = await fx.role(tenant.id, ['comment_reply.view']);
 *   const agent = await fx.agent(tenant.id, role.id, { channels: [{ channelId: fb.id, accessLevel: 'full' }] });
 *   afterAll(() => fx.cleanup());
 *
 * 留言資料：rule()、author()、log() 直接寫入 comment_reply_rules、comment_authors、comment_reply_logs，
 * 不經過收件流程。tenantId 與 channelId 由呼叫端給，所以也能用在測試自己建立的租戶上（那些租戶要自己清理，
 * 順序同 cleanup()：logs → authors／usages → rules）。
 *
 * 寫入用呼叫端給的 client（feature 測試的 PrismaClient 連的是測試資料庫）。需要驗 RLS 的測試，
 * 讀寫請另外用 app_tenant 連線，這裡只負責準備資料。
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';

export interface PlanInput {
  /** 方案含的 feature；含留言自動私訊時給 ['comment_reply', ...] */
  features?: string[];
  /** 例如 { monthlyCommentReplies: 100, maxCommentReplyRules: 2 }；值 null 表示無上限 */
  limits?: Record<string, number | null>;
  allowedChannelTypes?: string[];
}

export interface TenantInput {
  /** 不給或給 null：租戶沒有方案（planId 為 null） */
  plan?: PlanInput | null;
  isActive?: boolean;
  limitOverrides?: Record<string, number | null>;
}

export type ChannelMode = 'platform' | 'own_app';

export interface ChannelInput {
  mode?: ChannelMode;
  /** 粉專 ID／IG 專業帳號 ID；不給時自動產生不重複的值 */
  externalAccountId?: string;
  isActive?: boolean;
  settings?: Record<string, unknown>;
  pageAccessToken?: string;
  /** 自備 App 的 App Secret（mode = own_app 時使用） */
  appSecret?: string;
  appId?: string;
}

export interface CreatedChannel {
  id: string;
  tenantId: string;
  channelType: string;
  externalAccountId: string;
  credentials: Record<string, unknown>;
}

export function createCommentReplyFixtures(prisma: PrismaClient, mark = `cr-${Date.now()}-${randomUUID().slice(0, 8)}`) {
  const tenantIds: string[] = [];
  const planIds: string[] = [];
  let seq = 0;
  const next = () => `${Date.now()}${String(++seq).padStart(4, '0')}`;

  async function plan(input: PlanInput = {}) {
    const p = await prisma.plan.create({
      data: {
        slug: `${mark}-plan-${next()}`,
        name: `${mark} 方案`,
        features: input.features ?? ['inbox', 'core'],
        limits: input.limits ?? {},
        allowedChannelTypes: input.allowedChannelTypes ?? ['LINE', 'FB', 'THREADS', 'WEBCHAT'],
      },
    });
    planIds.push(p.id);
    return p;
  }

  async function tenant(input: TenantInput = {}) {
    const p = input.plan === undefined || input.plan === null ? null : await plan(input.plan);
    const t = await prisma.tenant.create({
      data: {
        name: `${mark} 租戶 ${next()}`,
        isActive: input.isActive ?? true,
        planId: p?.id ?? null,
        limitOverrides: input.limitOverrides ?? {},
      },
    });
    tenantIds.push(t.id);
    return { ...t, plan: p };
  }

  async function channel(tenantId: string, channelType: 'FB' | 'THREADS', input: ChannelInput = {}): Promise<CreatedChannel> {
    const mode = input.mode ?? 'platform';
    const externalAccountId = input.externalAccountId ?? `${channelType === 'FB' ? 'PAGE' : 'IGID'}_${next()}`;
    const pageAccessToken = input.pageAccessToken ?? `token-${externalAccountId}`;
    const credentials: Record<string, unknown> =
      mode === 'platform'
        ? { connectMode: 'platform', pageId: externalAccountId, pageAccessToken }
        : {
            appId: input.appId ?? `app-${externalAccountId}`,
            appSecret: input.appSecret ?? `secret-${externalAccountId}`,
            pageAccessToken,
            pageId: externalAccountId,
            verifyToken: `verify-${externalAccountId}`,
          };
    const c = await prisma.channel.create({
      data: {
        tenantId,
        channelType,
        displayName: `${mark} ${channelType} ${externalAccountId}`,
        isActive: input.isActive ?? true,
        credentialsEncrypted: encryptCredentials(credentials),
        settings: (input.settings ?? {}) as object,
        externalAccountId,
      },
    });
    return { id: c.id, tenantId, channelType, externalAccountId, credentials };
  }

  const fbChannel = (tenantId: string, input: ChannelInput = {}) => channel(tenantId, 'FB', input);
  const igChannel = (tenantId: string, input: ChannelInput = {}) => channel(tenantId, 'THREADS', input);

  /** 自訂角色，只含給定的權限碼 */
  async function role(tenantId: string, permissionCodes: string[]) {
    return prisma.role.create({
      data: {
        tenantId,
        slug: `${mark}-role-${next()}`,
        name: `${mark} 角色`,
        permissions: { create: permissionCodes.map((permissionCode) => ({ permissionCode })) },
      },
    });
  }

  /**
   * 成員。給 channels 時建立 AgentChannelAccess（分店帳號只看得到這些渠道）；
   * 不給時沒有任何渠道綁定（依 channel-scoped-visibility 規則決定看得到什麼）。
   */
  async function agent(
    tenantId: string,
    roleId: string,
    options: { role?: 'ADMIN' | 'SUPERVISOR' | 'AGENT'; channels?: Array<{ channelId: string; accessLevel?: 'full' | 'reply_only' | 'read_only' }> } = {},
  ) {
    const a = await prisma.agent.create({
      data: {
        tenantId,
        email: `${mark}-${next()}@example.test`,
        name: `${mark} 成員`,
        passwordHash: 'x',
        roleId,
        ...(options.role ? { role: options.role } : {}),
      },
    });
    for (const ch of options.channels ?? []) {
      await prisma.agentChannelAccess.create({ data: { agentId: a.id, channelId: ch.channelId, accessLevel: ch.accessLevel ?? 'full' } });
    }
    return a;
  }

  /** 留言規則（預設：文字內容、關鍵字「優惠」、全部貼文） */
  async function rule(tenantId: string, channelId: string, input: Partial<Prisma.CommentReplyRuleUncheckedCreateInput> = {}) {
    return prisma.commentReplyRule.create({
      data: {
        name: `${mark} 規則 ${next()}`,
        keywords: ['優惠'],
        contentType: 'text',
        messageText: '感謝留言，優惠資訊如下',
        ...input,
        tenantId,
        channelId,
      },
    });
  }

  /** 留言者對應（一位留言者在一個渠道一筆；contactId 必填） */
  async function author(
    tenantId: string,
    channelId: string,
    contactId: string,
    input: Partial<Prisma.CommentAuthorUncheckedCreateInput> = {},
  ) {
    const now = new Date();
    return prisma.commentAuthor.create({
      data: {
        externalUserId: `ASID_${next()}`,
        displayName: '留言的王小明',
        username: 'ming.wang',
        firstCommentAt: now,
        lastCommentAt: now,
        ...input,
        tenantId,
        channelId,
        contactId,
      },
    });
  }

  /**
   * 觸發紀錄（預設 SENT，帶齊會被匿名化的個資欄位）。dedupeKey 預設 null：同一個去重鍵只能有一筆
   * SENDING／SENT（部分唯一索引），同一位留言者要多筆 SENT 時只給其中一筆 `<ruleId>:<commenterId>`。
   */
  async function log(
    ruleRow: { id: string; tenantId: string; channelId: string },
    authorRow: { id: string; externalUserId: string },
    input: Partial<Prisma.CommentReplyLogUncheckedCreateInput> = {},
  ) {
    const commentId = input.commentId ?? `POST_1_${next()}`;
    return prisma.commentReplyLog.create({
      data: {
        postId: 'POST_1',
        commenterId: authorRow.externalUserId,
        commenterName: '留言的王小明',
        commenterUsername: 'ming.wang',
        commentText: '我要優惠，電話 0912345678',
        commentCreatedAt: new Date(),
        matchedKeywords: ['優惠'],
        status: 'SENT',
        recipientUid: `PSID_${next()}`,
        sentAt: new Date(),
        sentContentSnapshot: { type: 'text', text: '感謝留言，優惠資訊如下' },
        ...input,
        commentId,
        tenantId: ruleRow.tenantId,
        channelId: ruleRow.channelId,
        ruleId: ruleRow.id,
        commentAuthorId: authorRow.id,
      },
    });
  }

  /** 依 FK 順序刪除這些租戶的留言資料：紀錄 → 留言者／用量 → 規則 */
  async function deleteCommentData(ids: string[]) {
    if (!ids.length) return;
    const where = { tenantId: { in: ids } };
    await prisma.commentReplyLog.deleteMany({ where });
    await prisma.commentAuthor.deleteMany({ where });
    await prisma.commentReplyUsage.deleteMany({ where });
    await prisma.commentReplyRule.deleteMany({ where });
  }

  /**
   * 刪除本檔建立的所有資料。測試自己在租戶下建立的其他資料（對話、聯絡人、稽核…）要先由測試刪除，
   * 或在 extra 裡刪，否則外鍵會擋下渠道與租戶的刪除。
   */
  async function cleanup(extra?: (tenantIds: string[]) => Promise<void>) {
    try {
      // 留言紀錄對留言者是 Restrict：先刪，測試在 extra 裡刪聯絡人時才不會被擋
      await deleteCommentData(tenantIds);
      if (extra) await extra([...tenantIds]);
      if (tenantIds.length) {
        const where = { tenantId: { in: tenantIds } };
        await prisma.agentChannelAccess.deleteMany({ where: { agent: where } });
        await prisma.agent.deleteMany({ where });
        await prisma.rolePermission.deleteMany({ where: { role: where } });
        await prisma.role.deleteMany({ where });
        await prisma.channel.deleteMany({ where });
        // 收件流程會替新租戶補建 tenant_settings
        await prisma.tenantSettings.deleteMany({ where });
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
      if (planIds.length) await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    } finally {
      tenantIds.length = 0;
      planIds.length = 0;
    }
  }

  return { mark, plan, tenant, channel, fbChannel, igChannel, role, agent, rule, author, log, deleteCommentData, cleanup };
}
