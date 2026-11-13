/**
 * 三個留言自動私訊 route 檔共用：從 request 組出檢視者（有效權限＝角色權限 ∩ 方案天花板）。
 * flow 不讀 request（change migrate-role-agent-tenant-ctx 決策 7）。
 */
import type { FastifyRequest } from 'fastify';
import { effectivePermissionsFromRequest } from '../../services/channel-visibility.js';
import type { CommentReplyViewer } from './comment-reply-access.js';

export const COMMENT_REPLY_VIEW = 'comment_reply.view';
export const COMMENT_REPLY_MANAGE = 'comment_reply.manage';

export async function viewerOf(request: FastifyRequest): Promise<CommentReplyViewer> {
  const eff = await effectivePermissionsFromRequest(request);
  return {
    agentId: request.agent.id,
    hasViewAll: eff.has('channel.view_all'),
    canManage: eff.has(COMMENT_REPLY_MANAGE),
    canViewInbox: eff.has('inbox.view'),
  };
}
