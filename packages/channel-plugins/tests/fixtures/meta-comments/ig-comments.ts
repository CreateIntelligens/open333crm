/**
 * Instagram webhook `comments` 留言事件樣本（Instagram Login，change add-comment-keyword-private-reply，planning/05-qa.md §4.1）。
 *
 * 來源：Instagram Platform › Webhooks `comments`、Private Replies、Self Messaging 文件
 * （本地文件 ~/Documents/facebook-developers-docs/docs/instagram/）。
 * 取得日期：2026-11-13，依文件組成，**尚未以 UAT 真實 payload 核對**。
 * 注意：IG 留言事件沒有建立時間，外掛以 `entry.time` 當留言時間（design D14）。
 * 待實測：
 *   - M6：對另一則留言的回覆（帶 parent_id）能否私訊（igCommentsReply）
 *   - 廣告貼文的 `ad_id`、`ad_title` 形式（igCommentsAd），重複通知（igCommentsAdDuplicate）
 * 實測後把真實 payload 去識別化再更新本檔，並改寫上面的取得日期與來源。
 */

export const IG_ACCOUNT_ID = '17840000000000001';
export const IG_MEDIA_ID = '18000000000000001';
export const IG_COMMENT_ID = '18100000000000001';
export const IG_COMMENTER = { id: 'IGSID-1', username: 'amy' };
/** 2024-11-13T03:53:20Z（毫秒） */
export const IG_ENTRY_TIME = 1731470000000;

type Change = { field: string; value: Record<string, unknown> };

export function igPayload(changes: Change[], accountId = IG_ACCOUNT_ID, time = IG_ENTRY_TIME) {
  return { object: 'instagram', entry: [{ id: accountId, time, changes }] };
}

export function igCommentValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IG_COMMENT_ID,
    text: '+1',
    from: { ...IG_COMMENTER },
    media: { id: IG_MEDIA_ID, media_product_type: 'FEED' },
    ...overrides,
  };
}

/** ig-comments：一般貼文留言 */
export const igComments = igPayload([{ field: 'comments', value: igCommentValue() }]);

/** ig-comments-reply：對另一則留言的回覆（待實測 M6） */
export const igCommentsReply = igPayload([
  { field: 'comments', value: igCommentValue({ id: '18100000000000002', parent_id: IG_COMMENT_ID }) },
]);

/** ig-comments-self：自己帳號的留言（from.id 等於 entry.id） */
export const igCommentsSelf = igPayload([
  { field: 'comments', value: igCommentValue({ id: '18100000000000003', from: { id: IG_ACCOUNT_ID, username: 'shop' } }) },
]);

/** ig-comments-self-scoped：自己帳號的留言（from 帶 self_ig_scoped_id，Self Messaging 文件） */
export const igCommentsSelfScoped = igPayload([
  {
    field: 'comments',
    value: igCommentValue({ id: '18100000000000004', from: { id: 'IGSID-SELF', username: 'shop', self_ig_scoped_id: 'IGSID-SELF' } }),
  },
]);

/** ig-comments-ad：廣告貼文留言 */
export const igCommentsAd = igPayload([
  {
    field: 'comments',
    value: igCommentValue({ id: '18100000000000005', media: { id: IG_MEDIA_ID, media_product_type: 'FEED', ad_id: 'AD1', ad_title: '雙 11 廣告' } }),
  },
]);

/** ig-comments-ad-duplicate：同一則留言、不同 entry.time（文件寫可能重複通知） */
export const igCommentsAdDuplicate = igPayload(
  [{ field: 'comments', value: igCommentValue({ id: '18100000000000005', media: { id: IG_MEDIA_ID, ad_id: 'AD1' } }) }],
  IG_ACCOUNT_ID,
  IG_ENTRY_TIME + 60_000,
);

/** ig-live-comments：直播留言，不處理 */
export const igLiveComments = igPayload([{ field: 'live_comments', value: igCommentValue({ id: '18100000000000006' }) }]);
