export const LINE_DELIVERY_METADATA_KEYS = {
  retryKey: "lineRetryKey",
  requestId: "lineRequestId",
  status: "lineDeliveryStatus",
} as const;

export const LINE_RETRY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export function isLineRetryKeyExpired(updatedAt: Date, now = Date.now()): boolean {
  return now - updatedAt.getTime() >= LINE_RETRY_KEY_TTL_MS;
}

export type LineDeliveryStatus = "accepted" | "failed" | "pending";
