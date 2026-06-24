'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * On-screen logger for debugging flows where the real console is unreachable
 * (e.g. the LINE in-app browser on a phone). Returns `logs` to render and a
 * `log()` that also forwards to console. Captures global errors / rejections.
 */
export function useScreenLog() {
  const start = useRef(0);
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((...args: unknown[]) => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!start.current) start.current = now;
    const body = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    // eslint-disable-next-line no-console
    console.log('[LIFF]', ...args);
    setLogs((prev) => [...prev, `+${(now - start.current).toFixed(0)}ms  ${body}`]);
  }, []);

  useEffect(() => {
    const onErr = (e: ErrorEvent) => setLogs((p) => [...p, `❌ onerror: ${e.message}`]);
    const onRej = (e: PromiseRejectionEvent) =>
      setLogs((p) => [...p, `❌ unhandledrejection: ${String(e.reason)}`]);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  return { logs, log };
}
