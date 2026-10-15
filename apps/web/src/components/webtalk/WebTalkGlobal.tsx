'use client';

import { useEffect } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import {
  fetchWebTalkSession,
  getWebTalkAiDisabledEndpoint,
  loadWebTalkSdk,
  seedWebTalkIdentity,
  teardownWebTalk,
} from '@/lib/webtalk';

/**
 * 後台全域的 WebTalk 協作工具列（change webtalk-multi-tenant）。
 * 先向 API 取得租戶專屬的房間代號；伺服器未設定或租戶停用時完全不載入 SDK。
 * 換帳號、離開後台時卸載並清除 SDK 的本機資料。
 */
export function WebTalkGlobal() {
  const { agent } = useAuth();
  const agentId = agent?.id;
  const agentName = agent?.name;
  const agentAvatar = agent?.avatar;

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    (async () => {
      const session = await fetchWebTalkSession();
      if (cancelled || !session.enabled) return;
      const mount = await loadWebTalkSdk(session.sdkUrl, session.sdkIntegrity);
      if (cancelled) return;
      seedWebTalkIdentity({ id: agentId, name: agentName ?? '', avatar: agentAvatar });
      await mount({
        roomId: session.roomId,
        aiEndpoint: session.aiEndpoint ?? getWebTalkAiDisabledEndpoint(),
        enableVirtualRoom: false,
      });
    })().catch((error) => {
      console.error('Failed to initialize WebTalk', error);
    });

    return () => {
      cancelled = true;
      teardownWebTalk();
    };
    // 名稱、頭像變更不重新掛載；只有換成員時才重新取得房間
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  return null;
}
