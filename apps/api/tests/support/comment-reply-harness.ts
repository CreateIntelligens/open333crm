/**
 * 留言自動私訊 feature 測試的共用接線（change add-comment-keyword-private-reply，planning/05-qa.md §1.2、§3.3）。
 *
 * 原則：走真的入口，只攔對外 fetch。
 * - webhook：processWebhookEvent／processPlatformMetaWebhook（與 webhook.routes 同樣傳入 app_tenant 連線與 Redis），
 *   或經 Fastify inject 打 /api/v1/webhooks/*（真的 webhook.routes）
 * - 外掛：真的 fbPlugin／threadsPlugin，Graph API 由 fake-meta-graph 攔下
 * - 工作：outbox 照常寫入資料庫；快路徑改成記錄 job（不進 BullMQ），再交給 index.ts 同一個工廠
 *   createCommentReplyProcessor(createCommentReplyJobRunner(...)) 處理。BullMQ 的接線另由 comment-reply-queue-wiring.test.ts 測
 *
 * 平台設定（platform_settings）是全域表：feature 測試一次只跑一個檔案，每個檔案在 afterAll 呼叫 resetPlatformSettings()。
 */
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { DelayedError } from 'bullmq';
import { registerChannelPlugin, fbPlugin, threadsPlugin } from '@open333crm/channel-plugins';
import { writeOutbox, type OutboxRow } from '@open333crm/core';
import type { Server } from 'socket.io';
import { urls } from '#tests/setup/feature-config.js';
import type { EventPublisher } from '#src/events/outbox-publisher.js';

// 平台 Meta App（/webhooks/meta 驗簽用）；要在 loadEnvConfig() 之前設定
export const PLATFORM_APP_SECRET = 'cr-platform-app-secret';
process.env.META_APP_ID ??= 'cr-platform-app';
process.env.META_APP_SECRET = PLATFORM_APP_SECRET;
process.env.META_WEBHOOK_VERIFY_TOKEN ??= 'cr-verify';
process.env.META_CONNECT_REDIRECT_URI ??= 'https://crm.example.com/api/v1/meta-connect/callback';

const { loadEnvConfig } = await import('#src/config/env.js');
loadEnvConfig();
registerChannelPlugin(fbPlugin);
registerChannelPlugin(threadsPlugin);

const { processPlatformMetaWebhook, processWebhookEvent } = await import('#src/modules/webhook/webhook.service.js');
const { createCommentReplyJobRunner, createCommentReplyProcessor } = await import('#src/modules/comment-reply/comment-reply.worker.js');
const { clearCommentReplyPlatformSettingsCache: invalidateCommentReplyPlatformSettings, COMMENT_REPLY_SETTING_KEYS } = await import(
  '#src/modules/comment-reply/comment-reply-platform-settings.js'
);
const { clearCommentReplyRuleCache } = await import('#src/modules/comment-reply/comment-reply-rule-cache.js');
const { signed } = await import('./meta-webhook.js');

export const owner = new PrismaClient({ datasources: { db: { url: urls.owner } } });
export const tenantDb = new PrismaClient({ datasources: { db: { url: urls.tenant } } });
export const adminDb = new PrismaClient({ datasources: { db: { url: urls.admin } } });
export const redis = new Redis(urls.redis, { maxRetriesPerRequest: 2 });

export const silentIo = { to: () => ({ emit: () => true }), emit: () => true } as unknown as Server;

// ── 記錄 job 的 outbox publisher ────────────────────────────────────

export interface RecordedJob {
  row: OutboxRow;
  attemptsMade: number;
  delayedUntil: number | null;
  /** completed／failed（重試用盡）／pending（還沒處理或延後中） */
  state: 'pending' | 'completed' | 'failed';
  lastError?: string;
}

export const jobs: RecordedJob[] = [];

export const recordingPublisher: EventPublisher = {
  write: (tx, input) => writeOutbox(tx as Pick<Prisma.TransactionClient, 'outbox'>, input),
  async dispatch(rows) {
    for (const row of rows) {
      if (row.kind === 'job' && row.queueName === 'comment-reply') {
        jobs.push({ row, attemptsMade: 0, delayedUntil: null, state: 'pending' });
      }
    }
  },
};

export function jobsForLog(logId: string): RecordedJob[] {
  return jobs.filter((j) => (j.row.payload as { logId?: string }).logId === logId);
}

// ── webhook 入口 ────────────────────────────────────────────────────

export const webhookDeps = { tenantPrisma: tenantDb, redis, events: recordingPublisher };

/** /webhooks/meta（平台 App Secret 簽章） */
export async function postToPlatform(payload: unknown, options: { badSignature?: boolean; secret?: string } = {}) {
  const { raw, headers } = signed(payload, options.secret ?? PLATFORM_APP_SECRET, options);
  return processPlatformMetaWebhook(adminDb, silentIo, raw, headers, webhookDeps);
}

/** /webhooks/fb/:channelId、/webhooks/threads/:channelId（渠道自己的 App Secret 簽章） */
export async function postToChannel(
  channel: { id: string; channelType: string },
  payload: unknown,
  secret: string,
  options: { badSignature?: boolean } = {},
) {
  const { raw, headers } = signed(payload, secret, options);
  return processWebhookEvent(adminDb, silentIo, channel.id, channel.channelType, raw, headers, undefined, webhookDeps);
}

// ── job 處理（index.ts 同一個工廠） ─────────────────────────────────

let clock: (() => Date) | undefined;
/** 讓消費者用指定的時間（期限測試）；不給時用真實時間 */
export function setDeliveryClock(fn: (() => Date) | undefined): void {
  clock = fn;
}

export function runner() {
  return createCommentReplyJobRunner({ prisma: tenantDb, redis, now: () => clock?.() ?? new Date() });
}

/**
 * 處理一個 job 一次：與 BullMQ 相同的結果——延後（DelayedError，不增加 attemptsMade）、
 * 丟錯（attemptsMade +1，用盡進 failed）、正常完成。
 */
export async function runJobOnce(job: RecordedJob): Promise<void> {
  const processor = createCommentReplyProcessor(runner());
  const attempts = (job.row.jobOptions as { attempts?: number } | null)?.attempts ?? 1;
  const fakeJob = {
    data: job.row.payload,
    attemptsMade: job.attemptsMade,
    opts: { attempts },
    moveToDelayed: async (ts: number) => {
      job.delayedUntil = ts;
    },
  };
  try {
    await processor(fakeJob);
    job.state = 'completed';
    job.delayedUntil = null;
  } catch (err) {
    if (err instanceof DelayedError) return;
    job.attemptsMade += 1;
    job.lastError = err instanceof Error ? err.message : String(err);
    if (job.attemptsMade >= attempts) job.state = 'failed';
  }
}

/**
 * 處理所有待處理的 job，直到沒有可處理的（延後中的 job 預設不處理；includeDelayed 時也處理）。
 * maxRounds 防止無限迴圈。
 */
export async function drainJobs(options: { includeDelayed?: boolean; maxRounds?: number } = {}): Promise<void> {
  for (let round = 0; round < (options.maxRounds ?? 20); round++) {
    const ready = jobs.filter((j) => j.state === 'pending' && (options.includeDelayed || j.delayedUntil === null));
    if (ready.length === 0) return;
    for (const job of ready) await runJobOnce(job);
  }
}

// ── 平台設定 ────────────────────────────────────────────────────────

const NO_CAPABILITIES = {
  fbPrivateReply: false,
  fbPostPicker: false,
  fbPublicReply: false,
  igPrivateReply: false,
  igPostPicker: false,
  igPublicReply: false,
};

export const ALL_CAPABILITIES = {
  fbPrivateReply: true,
  fbPostPicker: true,
  fbPublicReply: true,
  igPrivateReply: true,
  igPostPicker: true,
  igPublicReply: true,
};

export async function setPlatformSetting(key: keyof typeof COMMENT_REPLY_SETTING_KEYS, value: unknown): Promise<void> {
  const k = COMMENT_REPLY_SETTING_KEYS[key];
  // 能力開關的型別要求 6 個鍵都在：測試只寫要開的，其餘補 false
  if (key === 'capabilities') value = { ...NO_CAPABILITIES, ...(value as object) };
  await owner.platformSetting.upsert({ where: { key: k }, update: { value: value as never }, create: { key: k, value: value as never } });
  invalidateCommentReplyPlatformSettings();
}

/** 能力全開、測試階段關、沒有緊急停止；限速放寬（測試不被 bucket 擋，除非測試自己調低） */
export async function enableAllCapabilities(): Promise<void> {
  await setPlatformSetting('capabilities', ALL_CAPABILITIES);
  await setPlatformSetting('testPhase', { fb: false, ig: false });
  await setPlatformSetting('emergencyStop', { stopped: false });
  await setPlatformSetting('rateLimits', { fbPerHour: 30000, igPerHour: 30000, publicReplyPerHour: 30000 });
}

export async function resetPlatformSettings(): Promise<void> {
  await owner.platformSetting.deleteMany({ where: { key: { in: Object.values(COMMENT_REPLY_SETTING_KEYS) } } });
  invalidateCommentReplyPlatformSettings();
}

/** 清掉某些渠道的限流 bucket（避免測試互相影響） */
export async function clearRateBuckets(channelIds: string[]): Promise<void> {
  const keys = channelIds.flatMap((id) => [`cr:rate:pm:${id}`, `cr:rate:pm:${id}:paused`, `cr:rate:pr:${id}`, `cr:rate:pr:${id}:paused`]);
  if (keys.length) await redis.del(...keys);
}

export function resetHarness(): void {
  jobs.length = 0;
  clock = undefined;
  clearCommentReplyRuleCache();
  invalidateCommentReplyPlatformSettings();
}

// ── 資料 ────────────────────────────────────────────────────────────

export interface RuleInput {
  name?: string;
  keywords?: string[];
  matchMode?: 'any' | 'all';
  postScope?: 'all' | 'selected';
  postIds?: string[];
  contentType?: 'text' | 'material';
  messageText?: string;
  materialId?: string | null;
  dedupePerCommenter?: boolean;
  publicReplyEnabled?: boolean;
  publicReplyTexts?: string[];
  isActive?: boolean;
  priority?: number;
}

export async function createRule(tenantId: string, channelId: string, input: RuleInput = {}) {
  return owner.commentReplyRule.create({
    data: {
      tenantId,
      channelId,
      name: input.name ?? '留言規則',
      keywords: input.keywords ?? ['+1'],
      matchMode: input.matchMode ?? 'any',
      postScope: input.postScope ?? 'all',
      postIds: input.postIds ?? [],
      contentType: input.contentType ?? 'text',
      messageText: input.contentType === 'material' ? null : (input.messageText ?? '感謝留言，這是活動連結'),
      materialId: input.materialId ?? null,
      dedupePerCommenter: input.dedupePerCommenter ?? true,
      publicReplyEnabled: input.publicReplyEnabled ?? false,
      publicReplyTexts: input.publicReplyTexts ?? [],
      isActive: input.isActive ?? true,
      priority: input.priority ?? 0,
    },
  });
}

/** 刪除租戶的留言自動私訊資料與收件產生的聯絡人、對話、outbox（cleanup 的 extra） */
export async function cleanupCommentReplyData(tenantIds: string[]): Promise<void> {
  if (!tenantIds.length) return;
  const where = { tenantId: { in: tenantIds } };
  await owner.conversation.updateMany({ where, data: { originCommentReplyLogId: null } });
  await owner.commentReplyLog.deleteMany({ where });
  await owner.commentAuthor.deleteMany({ where });
  await owner.commentReplyUsage.deleteMany({ where });
  await owner.commentReplyRule.deleteMany({ where });
  const convs = await owner.conversation.findMany({ where, select: { id: true } });
  await owner.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await owner.conversation.deleteMany({ where });
  await owner.contactMergeLog.deleteMany({ where });
  await owner.channelIdentity.deleteMany({ where: { contact: where } });
  await owner.contact.updateMany({ where, data: { mergedIntoId: null } });
  await owner.contact.deleteMany({ where });
  await owner.material.deleteMany({ where });
  await owner.outbox.deleteMany({ where });
}

export async function disconnectAll(): Promise<void> {
  await Promise.allSettled([owner.$disconnect(), tenantDb.$disconnect(), adminDb.$disconnect()]);
  redis.disconnect();
}
