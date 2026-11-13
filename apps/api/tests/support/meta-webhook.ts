/**
 * 組 FB／IG 留言與私訊 webhook payload、算簽章、呼叫入口
 * （change add-comment-keyword-private-reply，planning/05-qa.md §4.1、§4.3）。
 *
 * builder 的預設值取自外掛的 fixture（packages/channel-plugins/tests/fixtures/meta-comments/），兩邊一致。
 * 每個 builder 都可覆寫 ID，feature 測試請帶上自己的 stamp，避免和其他測試撞到同一個粉專或留言。
 *
 * 入口：
 *   - deliverToChannel：呼叫 processWebhookEvent（渠道自己的回呼網址，舊模式），不經 HTTP
 *   - deliverToPlatform：呼叫 processPlatformMetaWebhook（/webhooks/meta），不經 HTTP
 *   - injectMetaWebhook：經 Fastify inject 打 /api/v1/webhooks/meta（測回 200 與回應時間）
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { processPlatformMetaWebhook, processWebhookEvent } from '#src/modules/webhook/webhook.service.js';
import { getMetaAppConfig } from '#src/modules/meta-connect/meta-connect.service.js';
import {
  FB_COMMENTER,
  FB_COMMENT_ID,
  FB_CREATED_TIME,
  FB_PAGE_ID,
  FB_POST_ID,
} from '../../../../packages/channel-plugins/tests/fixtures/meta-comments/fb-feed.js';
import {
  IG_ACCOUNT_ID,
  IG_COMMENTER,
  IG_COMMENT_ID,
  IG_ENTRY_TIME,
  IG_MEDIA_ID,
} from '../../../../packages/channel-plugins/tests/fixtures/meta-comments/ig-comments.js';

export { FB_PAGE_ID, FB_POST_ID, FB_COMMENT_ID, FB_COMMENTER, IG_ACCOUNT_ID, IG_MEDIA_ID, IG_COMMENT_ID, IG_COMMENTER };

// ── payload builder ───────────────────────────────────────────────

export interface FbCommentInput {
  pageId?: string;
  commentId?: string;
  postId?: string;
  parentId?: string;
  from?: { id: string; name?: string } | null;
  message?: string;
  /** Unix 秒 */
  createdTime?: number;
  verb?: 'add' | 'remove' | 'edited';
  item?: string;
}

/** 一則 FB feed 變更的 value */
export function fbCommentChange(input: FbCommentInput = {}): Record<string, unknown> {
  const postId = input.postId ?? FB_POST_ID;
  const value: Record<string, unknown> = {
    item: input.item ?? 'comment',
    verb: input.verb ?? 'add',
    comment_id: input.commentId ?? FB_COMMENT_ID,
    post_id: postId,
    parent_id: input.parentId ?? postId,
    message: input.message ?? '我要+1',
    created_time: input.createdTime ?? FB_CREATED_TIME,
  };
  if (input.from !== null) value.from = input.from ?? { ...FB_COMMENTER };
  return value;
}

/** `object=page` 的 feed 留言 payload；一個粉專一個 entry */
export function fbCommentPayload(comments: FbCommentInput[] = [{}]) {
  const byPage = new Map<string, Record<string, unknown>[]>();
  for (const c of comments) {
    const pageId = c.pageId ?? FB_PAGE_ID;
    byPage.set(pageId, [...(byPage.get(pageId) ?? []), fbCommentChange(c)]);
  }
  return {
    object: 'page',
    entry: [...byPage].map(([id, values]) => ({
      id,
      time: Date.now(),
      changes: values.map((value) => ({ field: 'feed', value })),
    })),
  };
}

export interface FbMessageInput {
  pageId?: string;
  psid: string;
  text?: string;
  mid?: string;
  isEcho?: boolean;
  timestamp?: number;
}

/** `object=page` 的私訊事件（顧客回覆私訊、echo） */
export function fbMessagePayload(messages: FbMessageInput[]) {
  return {
    object: 'page',
    entry: messages.map((m) => {
      const pageId = m.pageId ?? FB_PAGE_ID;
      const ts = m.timestamp ?? Date.now();
      return {
        id: pageId,
        time: ts,
        messaging: [{
          sender: { id: m.isEcho ? pageId : m.psid },
          recipient: { id: m.isEcho ? m.psid : pageId },
          timestamp: ts,
          message: { mid: m.mid ?? `m_${m.psid}_${ts}_${Math.random().toString(36).slice(2)}`, text: m.text ?? '你好', ...(m.isEcho ? { is_echo: true } : {}) },
        }],
      };
    }),
  };
}

export interface IgCommentInput {
  accountId?: string;
  commentId?: string;
  mediaId?: string;
  parentId?: string;
  from?: { id: string; username?: string; self_ig_scoped_id?: string };
  text?: string;
  adId?: string;
  /** entry.time（毫秒） */
  time?: number;
  field?: 'comments' | 'live_comments';
}

export function igCommentPayload(comments: IgCommentInput[] = [{}]) {
  return {
    object: 'instagram',
    entry: comments.map((c) => ({
      id: c.accountId ?? IG_ACCOUNT_ID,
      time: c.time ?? IG_ENTRY_TIME,
      changes: [{
        field: c.field ?? 'comments',
        value: {
          id: c.commentId ?? IG_COMMENT_ID,
          text: c.text ?? '+1',
          from: c.from ?? { ...IG_COMMENTER },
          media: { id: c.mediaId ?? IG_MEDIA_ID, media_product_type: 'FEED', ...(c.adId ? { ad_id: c.adId } : {}) },
          ...(c.parentId ? { parent_id: c.parentId } : {}),
        },
      }],
    })),
  };
}

export interface IgMessageInput {
  accountId?: string;
  igsid: string;
  text?: string;
  mid?: string;
  timestamp?: number;
}

export function igMessagePayload(messages: IgMessageInput[]) {
  return {
    object: 'instagram',
    entry: messages.map((m) => {
      const accountId = m.accountId ?? IG_ACCOUNT_ID;
      const ts = m.timestamp ?? Date.now();
      return {
        id: accountId,
        time: ts,
        messaging: [{
          sender: { id: m.igsid },
          recipient: { id: accountId },
          timestamp: ts,
          message: { mid: m.mid ?? `ig_${m.igsid}_${ts}_${Math.random().toString(36).slice(2)}`, text: m.text ?? '你好' },
        }],
      };
    }),
  };
}

// ── 簽章 ─────────────────────────────────────────────────────────

export function signBody(raw: Buffer, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
}

/** 把 payload 轉成 raw body 與簽章標頭；`badSignature` 為 true 時簽章故意錯 */
export function signed(payload: unknown, secret: string, options: { badSignature?: boolean } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = signBody(raw, options.badSignature ? `${secret}-wrong` : secret);
  return { raw, headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' } as Record<string, string> };
}

// ── 入口 ─────────────────────────────────────────────────────────

const silentIo = { to: () => ({ emit: () => true }), emit: () => true } as unknown as Server;

/** 渠道自己的回呼網址（舊模式）：/webhooks/fb/:channelId、/webhooks/threads/:channelId */
export async function deliverToChannel(
  prisma: PrismaClient,
  channel: { id: string; channelType: string },
  payload: unknown,
  secret: string,
  options: { io?: Server; badSignature?: boolean } = {},
) {
  const { raw, headers } = signed(payload, secret, options);
  return processWebhookEvent(prisma, options.io ?? silentIo, channel.id, channel.channelType, raw, headers);
}

/** 平台 Meta App（/webhooks/meta）：以平台 App Secret 簽章；平台 App 未設定時丟錯 */
export async function deliverToPlatform(
  prisma: PrismaClient,
  payload: unknown,
  options: { io?: Server; badSignature?: boolean; secret?: string } = {},
) {
  const secret = options.secret ?? getMetaAppConfig()?.appSecret;
  if (!secret) throw new Error('meta-webhook: 平台 Meta App 未設定（META_APP_ID 等四個環境變數）');
  const { raw, headers } = signed(payload, secret, options);
  return processPlatformMetaWebhook(prisma, options.io ?? silentIo, raw, headers);
}

/** 經 Fastify inject 打 /api/v1/webhooks/meta，回傳狀態碼與花費毫秒數 */
export async function injectMetaWebhook(
  app: FastifyInstance,
  payload: unknown,
  options: { secret?: string; badSignature?: boolean; url?: string } = {},
) {
  const secret = options.secret ?? getMetaAppConfig()?.appSecret;
  if (!secret) throw new Error('meta-webhook: 平台 Meta App 未設定（META_APP_ID 等四個環境變數）');
  const { raw, headers } = signed(payload, secret, options);
  const started = performance.now();
  const res = await app.inject({ method: 'POST', url: options.url ?? '/api/v1/webhooks/meta', headers, payload: raw });
  return { statusCode: res.statusCode, body: res.body, elapsedMs: performance.now() - started };
}
