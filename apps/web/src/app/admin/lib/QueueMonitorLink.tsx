'use client';

import { useState } from 'react';
import { API_BASE_URL } from '@/lib/constants';
import { platformApi } from './platform-api';

/**
 * 側邊欄的「佇列監控」（change queue-monitoring）。bull-board 的畫面不帶 Authorization 標頭，
 * 所以先以平台 JWT 換發監控 cookie，再在新分頁開啟。
 *
 * 分頁在點擊當下開啟：在 await 之後才呼叫 window.open 會被瀏覽器當成彈出視窗擋下。
 * 換發請求帶 credentials：本機的 API 與網頁不同來源，瀏覽器要帶 credentials 才會存下 cookie。
 */
export function QueueMonitorLink() {
  const [error, setError] = useState<string | null>(null);

  const openDashboard = async () => {
    setError(null);
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      await platformApi.post('/queues/session', {}, { withCredentials: true });
      if (tab) tab.location.href = `${API_BASE_URL}/platform/queues`;
    } catch (err) {
      tab?.close();
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setError(message ?? '無法開啟佇列監控，請稍後再試');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openDashboard}
        style={{
          padding: '10px 12px',
          borderRadius: 9,
          color: 'rgba(255,255,255,.82)',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          fontWeight: 500,
          fontSize: 14,
          cursor: 'pointer',
          transition: 'background .12s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.10)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        佇列監控
      </button>
      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: '#fde68a', padding: '2px 12px 6px' }}>
          {error}
        </div>
      )}
    </>
  );
}
