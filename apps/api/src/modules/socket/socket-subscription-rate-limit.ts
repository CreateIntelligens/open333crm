export const SOCKET_SUBSCRIPTION_RATE_WINDOW_MS = 60_000;
export const SOCKET_SUBSCRIPTION_RATE_MAX = 60;

export interface SocketSubscriptionRateLimitState {
  count: number;
  resetAt: number;
}

export function consumeSocketSubscriptionAttempt(
  state: SocketSubscriptionRateLimitState,
  now = Date.now(),
): { allowed: boolean; state: SocketSubscriptionRateLimitState } {
  if (state.resetAt <= now) {
    return {
      allowed: true,
      state: { count: 1, resetAt: now + SOCKET_SUBSCRIPTION_RATE_WINDOW_MS },
    };
  }

  if (state.count >= SOCKET_SUBSCRIPTION_RATE_MAX) {
    return { allowed: false, state };
  }

  return {
    allowed: true,
    state: { count: state.count + 1, resetAt: state.resetAt },
  };
}
