'use client';

import { useEffect } from 'react';
import {
  loadWebTalkSdk,
  unmountWebTalk,
  WEBTALK_MOUNT_OPTIONS,
} from '@/lib/webtalk';

export function WebTalkGlobal() {
  useEffect(() => {
    let cancelled = false;

    loadWebTalkSdk()
      .then(() => {
        if (cancelled) return;
        if (!window.WebTalk?.mount) {
          throw new Error('WebTalk SDK is loaded but window.WebTalk.mount is unavailable');
        }

        void window.WebTalk.mount(WEBTALK_MOUNT_OPTIONS);
      })
      .catch((error) => {
        console.error('Failed to initialize WebTalk', error);
      });

    return () => {
      cancelled = true;
      unmountWebTalk();
    };
  }, []);

  return null;
}
