/**
 * 留言私訊送出工作的唯一排入點（change add-comment-keyword-private-reply design D1、D2）。
 *
 * 收件（comment-reply-intake.flow）、後台重試（comment-reply.flow 的 retryLogFlow）、補回排程
 * （comment-reply-maintenance.flow 的 recover）都經這裡：佇列名、job 名、job data 形狀與 job options 只有一份。
 * 寫 outbox（與呼叫端同一個交易），commit 後送進 comment-reply 佇列。
 * job 資料只有識別欄位（spec「留言處理不把個資寫進工作與日誌」）；消費者以 status='PENDING' 條件認領，重複排入無害。
 */
import { enqueueJob, type EventPublisher } from '../../events/outbox-publisher.js';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import {
  COMMENT_REPLY_JOB_DELIVER,
  COMMENT_REPLY_JOB_OPTIONS,
  COMMENT_REPLY_QUEUE,
  type CommentReplyJobData,
} from './comment-reply.types.js';

export async function enqueueCommentReplyDelivery(scope: TenantScope, events: EventPublisher, logId: string): Promise<void> {
  const job: CommentReplyJobData = { tenantId: scope.tenantId, logId };
  await enqueueJob(scope, events, COMMENT_REPLY_QUEUE, COMMENT_REPLY_JOB_DELIVER, job, COMMENT_REPLY_JOB_OPTIONS);
}
