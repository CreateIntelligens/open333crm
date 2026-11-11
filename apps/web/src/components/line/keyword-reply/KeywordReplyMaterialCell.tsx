'use client';

/**
 * 關鍵字回覆列表的「回覆素材」欄。素材不能在這頁使用時（與規則渠道不符、已刪除、已停用、讀不到），
 * 直接標示原因；渠道不符的素材引導到自動化規則編輯（PR #364 第二輪審查；change add-fb-ig-keyword-coupon）。
 */
import type { KeywordReply } from '@/hooks/useKeywordReplies';

interface Props {
  reply: Pick<KeywordReply, 'id' | 'materialId' | 'materialIssue'>;
  /** 在素材清單找到的素材；找不到時為 undefined */
  material?: { name: string; contentType: string };
}

export function KeywordReplyMaterialCell({ reply, material }: Props) {
  if (!reply.materialId) return <span className="text-xs text-muted-foreground">—</span>;
  const issue = reply.materialIssue;
  if (issue?.kind === 'other_channel') {
    return (
      <div className="text-xs">
        <div className="font-medium text-warning">{`${issue.channelLabel} 素材，與規則渠道不符`}</div>
        <a href={`/dashboard/automation/${reply.id}`} className="text-[11px] text-primary underline">
          到自動化規則編輯
        </a>
      </div>
    );
  }
  if (issue?.kind === 'missing') {
    return <span className="text-xs text-destructive">素材已刪除（id: {reply.materialId.slice(0, 8)}…），請重新選擇</span>;
  }
  if (issue?.kind === 'inactive') return <span className="text-xs text-destructive">素材已停用，請重新選擇</span>;
  if (issue?.kind === 'unknown') return <span className="text-xs text-warning">無法確認素材，請重新整理</span>;
  if (!material) {
    // 素材清單只取 200 筆：沒列到不代表有問題，只顯示 id
    return <span className="text-xs text-muted-foreground">素材（id: {reply.materialId.slice(0, 8)}…）</span>;
  }
  return (
    <div>
      <div className="text-xs font-medium">{material.name}</div>
      <div className="text-[11px] text-muted-foreground">{material.contentType}</div>
    </div>
  );
}
