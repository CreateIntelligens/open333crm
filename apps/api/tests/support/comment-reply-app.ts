/**
 * 留言自動私訊後台 API 的 feature 測試 app（change add-comment-keyword-private-reply 第 7 節）。
 *
 * 走真實的三個 route 檔、requirePermission（角色權限 ∩ 方案天花板）、渠道可見範圍與 app_tenant 連線（RLS）。
 * 認證換成固定的成員；FB／IG 外掛以正式的 fbPlugin、threadsPlugin 註冊（與 index.ts 相同）。
 * 平台設定是全域的：setPlatformCapabilities() 寫入後清掉 60 秒快取，restorePlatformSettings() 刪掉本檔寫過的鍵。
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { fbPlugin, registerChannelPlugin, threadsPlugin } from '@open333crm/channel-plugins';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import commentReplyRuleRoutes from '#src/modules/comment-reply/comment-reply-rule.routes.js';
import commentReplyLogRoutes from '#src/modules/comment-reply/comment-reply-log.routes.js';
import commentReplyChannelRoutes from '#src/modules/comment-reply/comment-reply-channel.routes.js';
import {
  clearCommentReplyPlatformSettingsCache,
  COMMENT_REPLY_SETTING_KEYS,
  type CommentReplyCapabilityFlags,
} from '#src/modules/comment-reply/comment-reply-platform-settings.js';
import type { EventPublisher } from '#src/events/outbox-publisher.js';

registerChannelPlugin(fbPlugin);
registerChannelPlugin(threadsPlugin);

export const BASE = '/api/v1/comment-replies';

export const ALL_CAPABILITIES_ON: CommentReplyCapabilityFlags = {
  fbPrivateReply: true,
  fbPostPicker: true,
  fbPublicReply: true,
  igPrivateReply: true,
  igPostPicker: true,
  igPublicReply: true,
};

export interface CommentReplyAppDeps {
  owner: PrismaClient;
  tenantDb: PrismaClient;
  redis: Redis;
  events?: EventPublisher;
}

/** 以指定成員身分建一個 app；呼叫端負責 close() */
export async function buildCommentReplyApp(
  deps: CommentReplyAppDeps,
  agent: { id: string; tenantId: string; roleId: string | null; role?: string },
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', deps.tenantDb);
  app.decorate('prismaAdmin', deps.owner);
  app.decorate('redis', deps.redis);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: agent.tenantId, role: agent.role ?? 'AGENT', roleId: agent.roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(deps.tenantDb, agent.tenantId);
  });
  await app.register(commentReplyRuleRoutes, { prefix: BASE, events: deps.events });
  await app.register(commentReplyLogRoutes, { prefix: BASE, events: deps.events });
  await app.register(commentReplyChannelRoutes, { prefix: BASE, events: deps.events });
  await app.ready();
  return app;
}

export async function setPlatformSetting(owner: PrismaClient, key: string, value: unknown): Promise<void> {
  await owner.platformSetting.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
  clearCommentReplyPlatformSettingsCache();
}

export async function setPlatformCapabilities(owner: PrismaClient, caps: Partial<CommentReplyCapabilityFlags>): Promise<void> {
  await setPlatformSetting(owner, COMMENT_REPLY_SETTING_KEYS.capabilities, { ...ALL_CAPABILITIES_ON, ...caps });
}

export async function restorePlatformSettings(owner: PrismaClient): Promise<void> {
  await owner.platformSetting.deleteMany({ where: { key: { in: Object.values(COMMENT_REPLY_SETTING_KEYS) } } });
  clearCommentReplyPlatformSettingsCache();
}

/** 清掉快取的 perms:tenant／perms:role 不需要：每個測試檔的角色與方案都是新建的 */
export const VIEW = 'comment_reply.view';
export const MANAGE = 'comment_reply.manage';
