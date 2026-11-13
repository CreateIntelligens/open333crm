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
 * 本檔目前只含不依賴新資料表的部分（租戶、方案、渠道、角色、成員與渠道可見範圍）。
 * TODO(add-comment-keyword-private-reply 第 3 節之後)：comment_reply_rules、comment_reply_logs、comment_authors、
 *   comment_reply_usages 建好後，在這裡補 rule()、log()、author() helper，並在 cleanup() 依 FK 順序先刪
 *   logs → authors／usages → rules，再刪渠道與租戶。
 *
 * 寫入用呼叫端給的 client（feature 測試的 PrismaClient 連的是測試資料庫）。需要驗 RLS 的測試，
 * 讀寫請另外用 app_tenant 連線，這裡只負責準備資料。
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
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

  /**
   * 刪除本檔建立的所有資料。測試自己在租戶下建立的其他資料（對話、聯絡人、稽核…）要先由測試刪除，
   * 或在 extra 裡刪，否則外鍵會擋下渠道與租戶的刪除。
   */
  async function cleanup(extra?: (tenantIds: string[]) => Promise<void>) {
    try {
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

  return { mark, plan, tenant, channel, fbChannel, igChannel, role, agent, cleanup };
}
