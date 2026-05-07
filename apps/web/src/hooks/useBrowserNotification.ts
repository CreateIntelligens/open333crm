'use client';

import { useCallback, useEffect } from 'react';

/**
 * Browser desktop notification helper.
 *
 * On mount, asks the user once for permission (if not already decided). The
 * returned `notify` function only fires when:
 *   - permission is granted
 *   - the tab is hidden (so we don't double-notify when the user is already
 *     looking at the page; the in-app toast covers that case)
 *
 * If the user denied permission or the API isn't available, `notify` is a
 * no-op — callers don't need to guard.
 */
export function useBrowserNotification() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const notify = useCallback((title: string, body?: string, clickUrl?: string) => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return; // user is already on the page

    try {
      const n = new Notification(title, {
        body: body ?? '',
        icon: '/favicon.ico',
        tag: clickUrl ?? title, // dedupe identical alerts
      });
      if (clickUrl) {
        n.onclick = () => {
          window.focus();
          window.location.href = clickUrl;
          n.close();
        };
      }
    } catch (err) {
      console.warn('[useBrowserNotification] failed to show notification:', err);
    }
  }, []);

  return notify;
}
