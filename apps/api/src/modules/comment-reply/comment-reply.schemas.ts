/**
 * 留言自動私訊 API 的輸入驗證（change add-comment-keyword-private-reply design「API」的 Zod 輸入）。
 *
 * spec 要求驗證失敗回 400 且 `details.field` 指出欄位，所以路由不直接丟 ZodError（全站錯誤處理只回 issues），
 * 而是呼叫這裡的 parse 函式：失敗時丟 `AppError(訊息, 'VALIDATION_ERROR', 400, { field, issues })`。
 * 錯誤訊息沿用 planning/01-ux.md §3.3 的欄位文案。
 *
 * ⚠️ 日期一律用 z.coerce.date()（專案慣例），不可用 z.string().datetime()。
 * 前端還沒寫；列舉以 design API 定義為準，前端完成後要回頭比對送出的值。
 */
import { z } from 'zod/v3';
import { COMMENT_REPLY_STATUSES } from '@open333crm/shared';
import { AppError } from '../../shared/utils/response.js';
import { normalizeForCommentMatch } from './comment-reply-match.js';

// ─── 共用欄位 ────────────────────────────────────────────────────────────

/** null 或空字串視為沒填（z.coerce.date() 會把 null 轉成 1970 年） */
const optionalDate = z.preprocess(
  (v) => (v === null || v === '' ? undefined : v),
  z.coerce.date({ errorMap: () => ({ message: '日期格式不正確' }) }).optional(),
);

const keywordsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, '關鍵字不可空白')
      .max(50, '單一關鍵字最多 50 字'),
  )
  .min(1, '至少要 1 個關鍵字')
  .max(20, '最多 20 個關鍵字')
  .superRefine((keywords, ctx) => {
    // 比對時不分大小寫與全形半形，正規化後相同的關鍵字算重複（例如 +1 與 ＋１）
    const seen = new Map<string, string>();
    for (const kw of keywords) {
      const key = normalizeForCommentMatch(kw);
      const prev = seen.get(key);
      if (prev !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `關鍵字「${kw}」與「${prev}」重複（不分大小寫與全形半形）` });
        return;
      }
      seen.set(key, kw);
    }
  });

const postSchema = z.object({
  postId: z.string().trim().min(1, '貼文 ID 不可空白').max(300, '貼文 ID 太長'),
  permalink: z.string().max(2000).optional(),
  thumbnailUrl: z.string().max(2000).optional(),
  excerpt: z.string().max(200).optional(),
  publishedAt: optionalDate,
});

const postsSchema = z.array(postSchema).max(50, '最多指定 50 篇貼文');

const contentSchema = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('text'),
      text: z.string().trim().min(1, '請選擇素材或輸入私訊文字').max(1000, '私訊文字最多 1,000 字'),
    }),
    z.object({
      type: z.literal('material'),
      materialId: z.string({ required_error: '請選擇素材或輸入私訊文字' }).uuid('素材不正確'),
    }),
  ],
  { errorMap: () => ({ message: '請選擇素材或輸入私訊文字' }) },
);

const publicReplySchema = z
  .object({
    enabled: z.boolean().default(false),
    texts: z.array(z.string().trim().min(1, '公開回覆文字不可空白').max(300, '公開回覆每則最多 300 字')).max(5, '公開回覆最多 5 則').default([]),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.texts.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['texts'], message: '請輸入公開回覆的文字，或關閉公開回覆' });
    }
  });

const ruleFields = {
  channelId: z.string({ required_error: '請選擇粉專或 IG 帳號' }).uuid('請選擇粉專或 IG 帳號'),
  name: z.string({ required_error: '請輸入規則名稱' }).trim().min(1, '請輸入規則名稱').max(200, '規則名稱最多 200 字'),
  keywords: keywordsSchema,
  matchMode: z.enum(['any', 'all']),
  postScope: z.enum(['all', 'selected']),
  posts: postsSchema,
  content: contentSchema,
  dedupePerCommenter: z.boolean(),
  publicReply: publicReplySchema,
  isActive: z.boolean(),
};

/** 指定貼文時至少 1 篇（只有兩個欄位都在時才檢查；PATCH 的合併檢查由 service 用合併後的值再呼叫一次） */
function refinePosts(value: { postScope?: string; posts?: unknown[] }, ctx: z.RefinementCtx) {
  if (value.postScope === 'selected' && value.posts !== undefined && value.posts.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['posts'], message: '請至少選擇 1 篇貼文' });
  }
}

// ─── 規則 ────────────────────────────────────────────────────────────────

/** POST /rules 的輸入（design RuleInput） */
export const ruleInputSchema = z
  .object({
    ...ruleFields,
    matchMode: ruleFields.matchMode.default('any'),
    postScope: ruleFields.postScope.default('all'),
    posts: ruleFields.posts.default([]),
    dedupePerCommenter: ruleFields.dedupePerCommenter.default(true),
    publicReply: ruleFields.publicReply.default({ enabled: false, texts: [] }),
    isActive: ruleFields.isActive.default(true),
  })
  .superRefine(refinePosts);
export type RuleInput = z.infer<typeof ruleInputSchema>;

/** PATCH /rules/:id 的輸入（design RulePatch）：只回送出的欄位，不套預設值；不可帶 channelId */
export const rulePatchSchema = z
  .object({
    name: ruleFields.name,
    keywords: ruleFields.keywords,
    matchMode: ruleFields.matchMode,
    postScope: ruleFields.postScope,
    posts: ruleFields.posts,
    content: ruleFields.content,
    dedupePerCommenter: ruleFields.dedupePerCommenter,
    publicReply: ruleFields.publicReply,
    isActive: ruleFields.isActive,
  })
  .partial()
  .superRefine(refinePosts);
export type RulePatch = z.infer<typeof rulePatchSchema>;

/** PATCH /rules/:id/active */
export const ruleActiveSchema = z.object({ isActive: z.boolean() });

/** PUT /rules/order */
export const reorderSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1, '排序清單不可為空')
    .max(500)
    .superRefine((ids, ctx) => {
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '排序清單有重複的規則' });
    }),
});

/** POST /rules/test */
export const ruleTestSchema = z.object({
  channelId: z.string().uuid('請選擇粉專或 IG 帳號'),
  postId: z.string().trim().min(1).max(300).optional(),
  text: z.string().min(1, '請輸入留言文字').max(2000, '留言文字最多 2,000 字'),
});

// ─── 觸發紀錄 ────────────────────────────────────────────────────────────

/** query string 的布林：'true' / 'false' */
const queryBoolean = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

/** query string 的狀態可多選：`status=FAILED,SKIPPED` 或 `status=FAILED&status=SKIPPED` */
const statusList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
  z.array(z.enum(COMMENT_REPLY_STATUSES)).min(1),
);

/** GET /logs、GET /logs/summary 的篩選 */
export const logsQuerySchema = z.object({
  status: statusList.optional(),
  channelId: z.string().uuid().optional(),
  ruleId: z.string().uuid().optional(),
  from: optionalDate,
  to: optionalDate,
  q: z.string().trim().max(100, '搜尋文字最多 100 字').optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  since: optionalDate,
  countOnly: queryBoolean.optional(),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;

// ─── 其他端點 ────────────────────────────────────────────────────────────

export const idParamSchema = z.object({ id: z.string().uuid() });
export const channelIdParamSchema = z.object({ channelId: z.string().uuid() });
export const materialOptionsQuerySchema = z.object({ channelId: z.string().uuid() });
export const postsQuerySchema = z.object({ cursor: z.string().max(500).optional() });
export const resolvePostSchema = z.object({ url: z.string().trim().min(1, '請貼上貼文網址').max(2000, '網址太長') });

// ─── parse 函式（路由呼叫） ──────────────────────────────────────────────

/**
 * 以 schema 驗證；失敗時丟 VALIDATION_ERROR 400，`details.field` 是第一個錯誤的最上層欄位
 * （例如 `publicReply.texts` 的錯誤回 `publicReply`），`details.issues` 列出全部錯誤。
 */
export function parseWithField<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  const first = result.error.issues[0];
  const field = first?.path.length ? String(first.path[0]) : undefined;
  throw new AppError(first?.message ?? '輸入內容有誤，請檢查後重新送出', 'VALIDATION_ERROR', 400, { field, issues });
}

export function parseRuleInput(input: unknown): RuleInput {
  return parseWithField(ruleInputSchema, input);
}

/** 帶 channelId → CHANNEL_IMMUTABLE 400（渠道建立後不能更改） */
export function parseRulePatch(input: unknown): RulePatch {
  if (input && typeof input === 'object' && 'channelId' in input) {
    throw new AppError('渠道建立後不能更改；要換渠道請刪除後重新建立', 'CHANNEL_IMMUTABLE', 400, { field: 'channelId' });
  }
  return parseWithField(rulePatchSchema, input);
}

export function parseReorderInput(input: unknown): z.infer<typeof reorderSchema> {
  return parseWithField(reorderSchema, input);
}

export function parseRuleTestInput(input: unknown): z.infer<typeof ruleTestSchema> {
  return parseWithField(ruleTestSchema, input);
}

export function parseLogsQuery(input: unknown): LogsQuery {
  return parseWithField(logsQuerySchema, input);
}
