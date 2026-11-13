/**
 * 留言自動私訊元件測試共用的假資料（欄位依 design.md「API」）。
 */
import type {
  CommentReplyReadiness,
  CommentReplyReadinessChannel,
  CommentReplyRuleView,
} from '#src/lib/comment-reply/types.js';

export const FB_ID = '11111111-1111-4111-8111-111111111111';
export const IG_ID = '22222222-2222-4222-8222-222222222222';

export function readinessChannel(overrides: Partial<CommentReplyReadinessChannel> = {}): CommentReplyReadinessChannel {
  return {
    channelId: FB_ID,
    channelType: 'FB',
    displayName: '品牌粉專',
    appMode: 'platform',
    receiving: true,
    subscribed: true,
    missingPermissions: [],
    canPrivateReply: true,
    canPublicReply: true,
    tokenStatus: 'valid',
    lastCommentEventAt: null,
    ...overrides,
  };
}

export function makeReadiness(overrides: Partial<CommentReplyReadiness> = {}): CommentReplyReadiness {
  return {
    testPhase: { fb: false, ig: false },
    capabilities: {
      fbPrivateReply: true,
      fbPostPicker: true,
      fbPublicReply: true,
      igPrivateReply: true,
      igPostPicker: true,
      igPublicReply: true,
    },
    emergencyStopped: false,
    quota: { monthlyUsed: 0, monthlyLimit: null, activeRules: 0, maxRules: null },
    channels: [
      readinessChannel(),
      readinessChannel({ channelId: IG_ID, channelType: 'THREADS', displayName: '@brand_official', appMode: 'own_app', missingPermissions: null }),
    ],
    ...overrides,
  };
}

export function makeRule(overrides: Partial<CommentReplyRuleView> = {}): CommentReplyRuleView {
  return {
    id: 'rule-1',
    name: '雙 11 留 +1',
    channelId: FB_ID,
    channel: { id: FB_ID, channelType: 'FB', displayName: '品牌粉專' },
    keywords: ['+1', '加一'],
    matchMode: 'any',
    postScope: 'all',
    posts: [],
    content: { type: 'text', text: '感謝參加活動' },
    dedupePerCommenter: true,
    publicReply: { enabled: false, texts: [] },
    isActive: true,
    priority: 0,
    canEdit: true,
    stats7d: { sent: 128, failed: 2, expired: 0, duplicate: 5 },
    warnings: [],
    ...overrides,
  };
}

export const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });

export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), {
    response: { status, data: { success: false, error: { code, message, ...(details ? { details } : {}) } } },
  });
}
