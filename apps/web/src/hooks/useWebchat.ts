import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/lib/constants';

declare global {
  interface Window {
    Open333CRM?: { channelId: string; apiBaseUrl: string };
    __open333crmWidgetLoaded?: boolean;
  }
}

const WIDGET_SCRIPT_ID = 'open333crm-widget-script';

/**
 * Hook to programmatically load and tear down the Open333CRM webchat widget.
 *
 * Usage:
 *   const { load, unload } = useWebchat();
 *   load(channelId);   // inject widget for given channel
 *   unload();          // remove widget from DOM
 */
export function useWebchat() {
  const activeChannelId = useRef<string | null>(null);

  const unload = useCallback(() => {
    // Remove launcher + panel injected by widget
    document.getElementById('o333-launcher')?.remove();
    document.getElementById('o333-panel')?.remove();

    // Remove the script tag so next load re-executes
    document.getElementById(WIDGET_SCRIPT_ID)?.remove();
    delete window.Open333CRM;
    window.__open333crmWidgetLoaded = false;
    activeChannelId.current = null;
  }, []);

  const load = useCallback(
    (channelId: string) => {
      // If same channel already loaded, no-op
      if (activeChannelId.current === channelId) return;

      // Clean up any previous widget
      unload();

      activeChannelId.current = channelId;

      const widgetUrl = '/webchat/widget.js';

      window.Open333CRM = { channelId, apiBaseUrl: API_BASE_URL };

      const script = document.createElement('script');
      script.id = WIDGET_SCRIPT_ID;
      script.src = widgetUrl;
      script.async = true;
      script.onload = () => {
        window.__open333crmWidgetLoaded = true;
      };
      document.head.appendChild(script);
    },
    [unload],
  );

  // Auto-unload on component unmount
  useEffect(() => {
    return () => {
      unload();
    };
  }, [unload]);

  return { load, unload };
}
