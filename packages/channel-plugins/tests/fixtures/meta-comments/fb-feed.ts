/**
 * FB Page webhook `feed` 留言事件樣本（change add-comment-keyword-private-reply，planning/05-qa.md §4.1）。
 *
 * 來源：Meta Webhooks Reference › Page `feed`（本地文件 ~/Documents/facebook-developers-docs/docs/webhooks/）。
 * 取得日期：2026-11-13，依文件組成，**尚未以 UAT 真實 payload 核對**。
 * 待實測（design「需要 UAT 實測的項目」）：
 *   - M1：`from.id` 是否等於 PSID、同一人是否穩定
 *   - M5：廣告貼文留言會不會送、`post_id` 形式（fbFeedAdComment 為推測形式）
 *   - M8：`from` 是否可能缺少（fbFeedCommentNoFrom）
 *   - RX-15：Meta 是否真的會把 `messaging[]` 與 `changes[]` 放在同一個 entry（fbMixedMessagingAndFeed）
 * 實測後把真實 payload 去識別化（名稱、ID 換成假值）再更新本檔，並改寫上面的取得日期與來源。
 *
 * apps/api/tests/support/meta-webhook.ts 的 builder 以本檔的常數為預設值。
 */

export const FB_PAGE_ID = '100000000000001';
export const FB_POST_ID = `${FB_PAGE_ID}_200000000000001`;
export const FB_COMMENT_ID = '200000000000001_300000000000001';
export const FB_COMMENTER = { id: '400000000000001', name: '王小明' };
/** 2024-11-13T03:53:20Z（Unix 秒） */
export const FB_CREATED_TIME = 1731470000;

type FeedValue = Record<string, unknown>;

/** 組一包 `object=page` 的 feed 變更 */
export function fbFeedPayload(values: FeedValue[], pageId = FB_PAGE_ID, time = FB_CREATED_TIME * 1000) {
  return {
    object: 'page',
    entry: [{ id: pageId, time, changes: values.map((value) => ({ field: 'feed', value })) }],
  };
}

export function fbCommentValue(overrides: FeedValue = {}): FeedValue {
  return {
    item: 'comment',
    verb: 'add',
    comment_id: FB_COMMENT_ID,
    post_id: FB_POST_ID,
    parent_id: FB_POST_ID,
    from: { ...FB_COMMENTER },
    message: '我要+1',
    created_time: FB_CREATED_TIME,
    post: { id: FB_POST_ID, status_type: 'added_photos', is_published: true },
    ...overrides,
  };
}

/** fb-feed-comment-add：貼文的第一層留言 */
export const fbFeedCommentAdd = fbFeedPayload([fbCommentValue()]);

/** fb-feed-comment-reply：對另一則留言的回覆（parent_id 是留言 ID） */
export const fbFeedCommentReply = fbFeedPayload([
  fbCommentValue({ comment_id: '200000000000001_300000000000002', parent_id: FB_COMMENT_ID }),
]);

/** fb-feed-comment-from-page：粉專自己的留言（含本功能的公開回覆），不可觸發 */
export const fbFeedCommentFromPage = fbFeedPayload([
  fbCommentValue({ comment_id: '200000000000001_300000000000003', from: { id: FB_PAGE_ID, name: '測試粉專' } }),
]);

/** fb-feed-comment-no-from：缺 from（待實測 M8 是否會發生） */
export const fbFeedCommentNoFrom = (() => {
  const value = fbCommentValue({ comment_id: '200000000000001_300000000000004' });
  delete value.from;
  return fbFeedPayload([value]);
})();

/** fb-feed-comment-edited */
export const fbFeedCommentEdited = fbFeedPayload([fbCommentValue({ verb: 'edited', message: '我要+2' })]);

/** fb-feed-comment-remove：顧客刪除留言（沒有 message） */
export const fbFeedCommentRemove = (() => {
  const value = fbCommentValue({ verb: 'remove' });
  delete value.message;
  return fbFeedPayload([value]);
})();

/** fb-feed-reaction */
export const fbFeedReaction = fbFeedPayload([
  { item: 'reaction', verb: 'add', reaction_type: 'like', post_id: FB_POST_ID, from: { ...FB_COMMENTER }, created_time: FB_CREATED_TIME },
]);

/** fb-feed-like（舊版按讚事件） */
export const fbFeedLike = fbFeedPayload([
  { item: 'like', verb: 'add', post_id: FB_POST_ID, from: { ...FB_COMMENTER }, created_time: FB_CREATED_TIME },
]);

/** fb-feed-post：粉專發文 */
export const fbFeedPost = fbFeedPayload([
  { item: 'post', verb: 'add', post_id: FB_POST_ID, from: { id: FB_PAGE_ID, name: '測試粉專' }, message: '新品上市', created_time: FB_CREATED_TIME },
]);

/** fb-feed-status */
export const fbFeedStatus = fbFeedPayload([
  { item: 'status', verb: 'add', post_id: FB_POST_ID, from: { id: FB_PAGE_ID, name: '測試粉專' }, message: '公告', created_time: FB_CREATED_TIME },
]);

/** fb-feed-share */
export const fbFeedShare = fbFeedPayload([
  { item: 'share', verb: 'add', post_id: FB_POST_ID, from: { ...FB_COMMENTER }, link: 'https://example.com', created_time: FB_CREATED_TIME },
]);

/** fb-feed-ad-comment：廣告貼文留言（待實測 M5：FB 是否送、post_id 形式） */
export const fbFeedAdComment = fbFeedPayload([
  fbCommentValue({ comment_id: '200000000000009_300000000000009', post_id: `${FB_PAGE_ID}_200000000000009`, parent_id: `${FB_PAGE_ID}_200000000000009` }),
]);

/** fb-mixed-messaging-and-feed：同一個 entry 有私訊與留言（待實測 RX-15） */
export const fbMixedMessagingAndFeed = {
  object: 'page',
  entry: [{
    id: FB_PAGE_ID,
    time: FB_CREATED_TIME * 1000,
    messaging: [{
      sender: { id: 'PSID-MIXED' },
      recipient: { id: FB_PAGE_ID },
      timestamp: FB_CREATED_TIME * 1000,
      message: { mid: 'm_mixed_1', text: '你好' },
    }],
    changes: [{ field: 'feed', value: fbCommentValue() }],
  }],
};
