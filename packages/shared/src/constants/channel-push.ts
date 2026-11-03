/**
 * 能主動推送訊息的渠道：群發、附券廣播與批次發券只能用這些渠道（change reject-webchat-push-415，issue #415）。
 * 前後端共用這一份清單；新增能主動推送的渠道時改這裡。
 *
 * 沒有 WEBCHAT：網站聊天室的訊息由 API 推到訪客的 socket 房間，只有收件匣回覆路徑會推，
 * 群發與發券對它送出會假成功（AUDIT CHAN-02）。
 */
export const PROACTIVE_PUSH_CHANNEL_TYPES: readonly string[] = ['LINE', 'FB', 'THREADS'];

/** 渠道能不能主動推送訊息（群發、附券廣播、批次發券） */
export function supportsProactivePush(channelType: string | null | undefined): boolean {
  return !!channelType && PROACTIVE_PUSH_CHANNEL_TYPES.includes(channelType);
}
