/**
 * 留言私訊內容的渲染與公開回覆文字的選擇（change add-comment-keyword-private-reply：
 * comment-private-reply「私訊內容的渲染」「送出前重新檢查」「公開回覆留言」）。
 *
 * 純函式：素材由呼叫端讀出後傳入（消費者送出前讀、試算預覽也可用），這裡不碰資料庫。
 * - 送出時通常還沒有聯絡人資料，只代入素材變數的預設值、呼叫端給的額外變數，與留言專屬變數 `commenter.name`。
 * - `{commenter.name}` 與 `{{commenter.name}}` 都代入留言者名稱；其餘沒有值的 `{{變數}}` 一律留空，
 *   送出內容不含未解析的佔位字串。
 * - FB 素材的站內路徑換公開網址在 FB 外掛的 postMessage() 內處理（design D6），這裡不重做。
 */
import { buildVariableMap, type TemplateVariable } from '../marketing/template-renderer.js';
import type { OutboundPayload } from '@open333crm/channel-plugins';

/** 留言專屬變數：留言者名稱（FB `from.name`、IG `@username`） */
export const COMMENTER_NAME_VARIABLE = 'commenter.name';

/**
 * Messenger 的收據、優惠券、意見調查範本不能用於留言私訊（comment-reply-rules「規則私訊內容的限制」），
 * 即使外掛宣告了也擋下。
 */
export const COMMENT_REPLY_FORBIDDEN_MATERIAL_TYPES: readonly string[] = ['fb_receipt', 'fb_coupon', 'fb_feedback'];

/** 外掛 `extensions.comments.capabilities` 中與內容有關的欄位（design「外掛契約」CommentReplyCapabilities） */
export interface CommentReplyContentCapabilities {
  /** 可用於私訊的內容類型；IG 只有 `['text']` */
  privateReplyContentTypes: readonly string[];
  /** 素材的渠道類型；IG 沒有素材為 null */
  materialChannelType: string | null;
}

/** 渲染需要的素材欄位（Material 的子集）；null 表示素材已刪除 */
export interface CommentReplyMaterialInput {
  id: string;
  channelType: string;
  contentType: string;
  isActive: boolean;
  body: unknown;
  variables: unknown;
}

export type CommentReplyRuleContent =
  | { type: 'text'; text: string }
  | { type: 'material'; material: CommentReplyMaterialInput | null };

export interface RenderCommentReplyInput {
  content: CommentReplyRuleContent;
  commenter: { name?: string | null };
  capabilities: CommentReplyContentCapabilities;
  /** 呼叫端提供的其他變數（例如 `storage.base_url`）；素材預設值會被它覆蓋 */
  extraVariables?: Record<string, string>;
}

export type RenderCommentReplyResult =
  | { ok: true; payload: OutboundPayload }
  | { ok: false; reason: 'MATERIAL_UNAVAILABLE' | 'MATERIAL_UNSUPPORTED' };

/** 留言者顯示名稱：FB 用名稱，IG 用 `@帳號`；都沒有時是空字串 */
export function commenterDisplayName(c: { commenterName?: string | null; commenterUsername?: string | null }): string {
  if (c.commenterName) return c.commenterName;
  if (c.commenterUsername) return `@${c.commenterUsername}`;
  return '';
}

/**
 * 把規則內容渲染成外掛 `sendPrivateReply()` 的 payload。
 * 素材停用或刪除 → MATERIAL_UNAVAILABLE；類型不在外掛宣告內、渠道類型不符、或是禁用範本 → MATERIAL_UNSUPPORTED。
 */
export function renderCommentReplyContent(input: RenderCommentReplyInput): RenderCommentReplyResult {
  const { content, capabilities } = input;
  const commenterName = input.commenter.name ?? '';

  if (content.type === 'text') {
    if (!capabilities.privateReplyContentTypes.includes('text')) return { ok: false, reason: 'MATERIAL_UNSUPPORTED' };
    const vars = { ...(input.extraVariables ?? {}), [COMMENTER_NAME_VARIABLE]: commenterName };
    return { ok: true, payload: { contentType: 'text', content: { text: substitute(content.text, vars) } } };
  }

  const material = content.material;
  if (!material || !material.isActive) return { ok: false, reason: 'MATERIAL_UNAVAILABLE' };
  if (
    capabilities.materialChannelType === null ||
    material.channelType !== capabilities.materialChannelType ||
    !capabilities.privateReplyContentTypes.includes(material.contentType) ||
    COMMENT_REPLY_FORBIDDEN_MATERIAL_TYPES.includes(material.contentType)
  ) {
    return { ok: false, reason: 'MATERIAL_UNSUPPORTED' };
  }

  const defs = Array.isArray(material.variables) ? (material.variables as TemplateVariable[]) : [];
  const vars = {
    ...buildVariableMap(defs, input.extraVariables ?? {}),
    [COMMENTER_NAME_VARIABLE]: commenterName,
  };
  const body = material.body && typeof material.body === 'object' ? material.body : {};
  return {
    ok: true,
    payload: { contentType: material.contentType, content: substitute(body, vars) as Record<string, unknown> },
  };
}

// `{{key}}` 或 `{commenter.name}`；一次掃描完成，代入的值（例如留言者名稱內的大括號）不會再被掃描或清掉
const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_.]+)\}\}|\{commenter\.name\}/g;

function substitute<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER_RE, (_m, key: string | undefined) => vars[key ?? COMMENTER_NAME_VARIABLE] ?? '') as T;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars)) as T;
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) result[k] = substitute(v, vars);
    return result as T;
  }
  return value;
}

/**
 * 公開回覆文字：依留言 ID 從設定中固定選一則（同一則留言重算結果相同；不同留言分散到各則，
 * 避免同一段文字在同一篇貼文下重複數百次被 Meta 判為垃圾留言）。沒有文字時回傳 null。
 */
export function pickPublicReplyText(texts: readonly string[], commentId: string): string | null {
  if (texts.length === 0) return null;
  return texts[fnv1a(commentId) % texts.length];
}

/** FNV-1a 32 位元雜湊（不需加密強度，只求穩定且分散） */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
