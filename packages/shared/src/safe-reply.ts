/** LINE replyToken is only safe during the original webhook's short window. */
export const LINE_REPLY_SAFE_WINDOW_MS = 30_000;

export type LineDeliveryStrategy = 'reply' | 'push';

export function selectSafeLineStrategy(input: {
  replyToken?: unknown;
  receivedAt?: unknown;
  now?: Date;
}): LineDeliveryStrategy {
  if (typeof input.replyToken !== 'string' || input.replyToken.length === 0) return 'push';
  if (typeof input.receivedAt !== 'string' && !(input.receivedAt instanceof Date)) return 'push';
  const receivedAt = input.receivedAt instanceof Date ? input.receivedAt : new Date(input.receivedAt);
  if (Number.isNaN(receivedAt.getTime())) return 'push';
  const elapsed = (input.now ?? new Date()).getTime() - receivedAt.getTime();
  return elapsed >= 0 && elapsed < LINE_REPLY_SAFE_WINDOW_MS ? 'reply' : 'push';
}
