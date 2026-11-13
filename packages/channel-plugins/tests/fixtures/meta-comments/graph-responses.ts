/**
 * Graph API 回應樣本（change add-comment-keyword-private-reply，planning/05-qa.md §4.2）。
 *
 * 來源：Messenger Send API、Graph API 錯誤處理與 Rate Limiting 文件（本地文件 ~/Documents/facebook-developers-docs/docs/）。
 * 取得日期：2026-11-13。
 *
 * **待實測**（design「需要 UAT 實測的項目」M2；實測後把真實 code／subcode 回填本檔與外掛對照表）：
 *   - alreadyReplied：文件未載明，社群經驗為 code 10900（"Activity already replied to"）
 *   - expiredByMeta：文件未載明，社群經驗為 code 10903（超過 7 天回覆期限）
 *   - 對另一個粉專私訊（RECIPIENT_IS_PAGE）：文件只寫不允許，錯誤碼未知，本檔沒有樣本
 *   - Standard Access 對象不在 App 角色內：錯誤碼未知，暫以 permissionMissing（code 10）代表
 *   - userUnavailable 的 subcode 1545041：碼 551 有文件，subcode 待實測
 *   - publicReplyPermission：公開回覆缺權限回 code 200 或 10，待實測哪一個
 */

export const graphError = (code: number, extra: Record<string, unknown> = {}) => ({
  error: { message: `(#${code}) test error`, type: 'OAuthException', code, fbtrace_id: 'TRACE-1', ...extra },
});

export const privateReplyOk = { recipient_id: 'PSID-1', message_id: 'm_1' };
export const igPrivateReplyOk = { recipient_id: 'IGSID-1', message_id: 'm1' };
export const publicReplyOk = { id: 'REPLY-1' };
export const subscribeOk = { success: true };

export const tokenExpired = graphError(190, { error_subcode: 463 });
export const permissionMissing = graphError(10);
export const permission200 = graphError(200);
export const userUnavailable = graphError(551, { error_subcode: 1545041 });
export const commentNotFound = graphError(100, { error_subcode: 33 });
/** 待實測 */
export const alreadyReplied = graphError(10900);
/** 待實測 */
export const expiredByMeta = graphError(10903);
export const rateLimited613 = graphError(613);
export const rateLimited4 = graphError(4);
export const rateLimitedBuc = graphError(80001);
export const unknownError = graphError(1);

/** `X-Business-Use-Case-Usage` 標頭（estimated_time_to_regain_access 是分鐘數） */
export const bucUsageHeader = (minutes: number) =>
  JSON.stringify({
    '100000000000001': [{ type: 'messenger', call_count: 100, total_cputime: 30, total_time: 40, estimated_time_to_regain_access: minutes }],
  });
