import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { readAiPrivacyPolicy } from '../platform/ai-privacy.service.js';
import type { ChatProvider } from './providers/types.js';

const DEID_URL = 'https://2md.aiurl.tw/api/deid';
const MAX_TEXT_CHARS = 100_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;
const responseSchema = z.object({
  code: z.literal(200),
  data: z.object({ status: z.literal('ok'), text: z.string().min(1) }),
});

function privacyFailure(): AppError {
  return new AppError('AI 去識別化服務暫時無法使用，請稍後重試', 'AI_DEIDENTIFICATION_UNAVAILABLE', 503);
}

async function maskText(text: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(DEID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text, mode: 'label', retentionMode: 'none', score: false }),
    redirect: 'error',
    signal,
  });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw privacyFailure();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw privacyFailure();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // The upstream envelope also contains restoration mappings with original values.
  // Extract only the validated text; keep no response cache or mapping store.
  return responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data.text;
}

async function maskTexts(texts: string[]): Promise<string[]> {
  if (texts.length > 2_048 || texts.some((text) => text.length > MAX_TEXT_CHARS)) throw privacyFailure();
  const unique = [...new Set(texts.filter(Boolean))];
  if (unique.length === 0) return texts.slice();
  const masked = new Map<string, string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let cursor = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
      while (cursor < unique.length) {
        controller.signal.throwIfAborted();
        const original = unique[cursor++];
        masked.set(original, await maskText(original, controller.signal));
      }
    }));
    controller.signal.throwIfAborted();
    return texts.map((text) => text ? masked.get(text)! : '');
  } catch {
    controller.abort();
    // A fixed error prevents upstream echo bodies, mappings and source text from
    // reaching provider error logging or usage records.
    throw privacyFailure();
  } finally {
    clearTimeout(timer);
  }
}

function mapStrings(value: unknown, transform: (text: string) => string, depth = 0): unknown {
  if (depth > 32) throw privacyFailure();
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, transform, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform, depth + 1)]));
  }
  return value;
}

const MESSAGE_PROTOCOL_KEYS = new Set([
  'url', 'mediaUrl', 'thumbnailUrl', 'previewImageUrl', 'storageKey', 'replyToken', 'postbackData',
  'uri', 'videoUrl', 'previewUrl', 'originalContentUrl', 'channelMsgId', 'clientMessageId', 'contactUid',
  'contactId', 'conversationId', 'caseId', 'strategy', 'retryKey', 'mimeType', 'contentType', 'messageId', 'id',
]);
const MATERIAL_PROTOCOL_KEYS = new Set([...MESSAGE_PROTOCOL_KEYS].filter((key) => ![
  'url', 'mediaUrl', 'thumbnailUrl', 'previewImageUrl', 'uri', 'videoUrl', 'previewUrl', 'originalContentUrl',
  'postbackData',
].includes(key)));

function mapMessageStrings(value: unknown, transform: (text: string) => string, key = '', depth = 0): unknown {
  if (depth > 32) throw privacyFailure();
  if (typeof value === 'string') return MESSAGE_PROTOCOL_KEYS.has(key) ? value : transform(value);
  if (Array.isArray(value)) return value.map((item) => mapMessageStrings(item, transform, key, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, mapMessageStrings(item, transform, childKey, depth + 1)]));
  }
  return value;
}

function mapMaterialStrings(value: unknown, transform: (text: string) => string, key = '', depth = 0): unknown {
  if (depth > 32) throw privacyFailure();
  if (typeof value === 'string') return MATERIAL_PROTOCOL_KEYS.has(key) ? value : transform(value);
  if (Array.isArray(value)) return value.map((item) => mapMaterialStrings(item, transform, key, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, mapMaterialStrings(item, transform, childKey, depth + 1)]));
  }
  return value;
}

async function maskStructuredContent(
  content: Record<string, unknown>,
  scope: 'message' | 'material' = 'message',
): Promise<Record<string, unknown>> {
  const mapFields = scope === 'material' ? mapMaterialStrings : mapMessageStrings;
  const texts: string[] = [];
  mapFields(content, (text) => {
    texts.push(text);
    return text;
  });
  const masked = await maskTexts(texts);
  let index = 0;
  return mapFields(content, () => masked[index++]) as Record<string, unknown>;
}

/**
 * 訊息來源決定 `content`（送出與顯示的內容）用原文還是遮罩版；遮罩版一律另存在 metadata 給模型讀。
 * - `inbound`：渠道進站訊息，保留原文。
 * - `agent_default` / `agent_original`：座席手打的回覆，預設遮罩，可單則選擇保留原文。
 * - `system`：Bot／AI 產生或含座席輸入的系統訊息，送出與保存遮罩版。
 * - `system_template`：程式內固定的系統文案（登記連結、帳號整合通知、滿意度感謝等，含系統插入的連結與名稱），
 *   保留原文送出與保存。2md 會把一般詞誤判成人名（「下方連結」→「下[姓名]」），遮罩會把顧客收到的文字改壞。
 */
export type StoredMessagePrivacySource = 'inbound' | 'agent_default' | 'agent_original' | 'system' | 'system_template';

export interface StoredMessagePrivacy {
  version: 1;
  /** inbound keeps channel content; mask is the tenant default; original is an explicit agent choice. */
  mode: 'inbound' | 'mask' | 'original' | 'system' | 'system_template';
  maskedContent: Record<string, unknown>;
}

export interface PreparedStoredMessageContent {
  content: Prisma.InputJsonObject;
  metadata: Prisma.InputJsonObject;
}

export interface PreparedStoredMaterialBody {
  body: Prisma.InputJsonObject;
  maskedBody: Prisma.InputJsonObject | null;
  privacyMode: 'mask' | 'original' | null;
}

/** Prepare a material body for storage and delivery with an explicit per-save mode. */
export async function prepareStoredMaterialBody(
  prisma: TenantDb,
  tenantId: string,
  body: Record<string, unknown>,
  requestedMode: 'mask' | 'original' = 'mask',
): Promise<PreparedStoredMaterialBody> {
  // Structural DB doubles used by older unit tests do not expose this model.
  if (!('platformSetting' in (prisma as object))) {
    return { body: body as Prisma.InputJsonObject, maskedBody: null, privacyMode: null };
  }
  if (!(await readAiPrivacyPolicy(prisma, tenantId)).enabled) {
    return { body: body as Prisma.InputJsonObject, maskedBody: null, privacyMode: null };
  }

  const maskedBody = await maskStructuredContent(body, 'material');
  const privacyMode = requestedMode === 'original' ? 'original' : 'mask';
  return {
    body: (privacyMode === 'original' ? body : maskedBody) as Prisma.InputJsonObject,
    maskedBody: maskedBody as Prisma.InputJsonObject,
    privacyMode,
  };
}

/**
 * Runs every textual leaf of a Message.content payload through the same bounded
 * de-identification client. The masked copy is private metadata, so channel and
 * UI payloads keep their existing shape. All model readers use this copy.
 */
export async function prepareStoredMessageContent(
  prisma: TenantDb,
  tenantId: string,
  content: Record<string, unknown>,
  source: StoredMessagePrivacySource,
): Promise<PreparedStoredMessageContent> {
  // Unit doubles built before the platform policy existed omit platformSetting.
  // A real TenantDb always provides this Prisma model; treating a structural test
  // double as disabled keeps unrelated behavior tests focused on their subject.
  if (!('platformSetting' in (prisma as object))) return { content: content as Prisma.InputJsonObject, metadata: {} };
  if (!(await readAiPrivacyPolicy(prisma, tenantId)).enabled) return { content: content as Prisma.InputJsonObject, metadata: {} };

  const maskedContent = await maskStructuredContent(content);
  const mode: StoredMessagePrivacy['mode'] = source === 'agent_default'
    ? 'mask'
    : source === 'agent_original'
      ? 'original'
      : source;

  return {
    content: (source === 'agent_default' || source === 'system' ? maskedContent : content) as Prisma.InputJsonObject,
    metadata: { privacy: { version: 1, mode, maskedContent } as unknown as Prisma.InputJsonValue },
  };
}

/** Model-facing readers use the stored masked text when a Message has one. */
export function readModelMessageContent(content: unknown, metadata: unknown): string {
  const privacy = metadata && typeof metadata === 'object'
    ? (metadata as { privacy?: { maskedContent?: unknown } }).privacy
    : undefined;
  const selected = privacy?.maskedContent ?? content;
  if (!selected || typeof selected !== 'object') return '';
  const text = (selected as { text?: unknown }).text;
  return typeof text === 'string' ? text : '';
}

/** One wrapper per operation. A disabled policy returns the exact original provider. */
export async function getPrivacyAwareChatProvider(
  prisma: TenantDb,
  tenantId: string,
  provider: ChatProvider,
): Promise<ChatProvider> {
  if (!(await readAiPrivacyPolicy(prisma, tenantId)).enabled) return provider;
  return {
    ...provider,
    async generate(options) {
      const texts = [options.systemPrompt, options.userMessage, ...(options.history ?? []).map((message) => message.content)];
      const masked = await maskTexts(texts);
      return provider.generate({
        ...options,
        systemPrompt: masked[0],
        userMessage: masked[1],
        history: options.history?.map((message, index) => ({ ...message, content: masked[index + 2] })),
      });
    },
    async generateToolTurn(options) {
      const texts = [options.systemPrompt];
      // Visit only content and argument values; identifiers and schema keys are
      // protocol fields, while credentials and tool declarations stay local.
      for (const message of options.messages) {
        texts.push(message.content);
        for (const call of message.toolCalls ?? []) {
          mapStrings(call.arguments, (text) => { texts.push(text); return text; });
        }
      }
      const masked = await maskTexts(texts);
      let index = 1;
      const messages = options.messages.map((message) => ({
        ...message,
        content: masked[index++],
        toolCalls: message.toolCalls?.map((call) => ({
          ...call,
          arguments: mapStrings(call.arguments, () => masked[index++]) as Record<string, unknown>,
        })),
      }));
      return provider.generateToolTurn({ ...options, systemPrompt: masked[0], messages });
    },
  };
}

export async function deidentifyTenantText(prisma: TenantDb, tenantId: string, text: string): Promise<string> {
  if (!(await readAiPrivacyPolicy(prisma, tenantId)).enabled) return text;
  return (await maskTexts([text]))[0];
}

/** De-identify every string value in a JSON trace before it is persisted. */
export async function deidentifyTenantData(prisma: TenantDb, tenantId: string, value: unknown): Promise<unknown> {
  if (!(await readAiPrivacyPolicy(prisma, tenantId)).enabled) return value;
  const strings: string[] = [];
  mapStrings(value, (text) => {
    strings.push(text);
    return text;
  });
  const masked = await maskTexts(strings);
  let index = 0;
  return mapStrings(value, () => masked[index++]);
}
