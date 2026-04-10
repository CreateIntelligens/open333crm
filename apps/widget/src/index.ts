import { initSession } from './session.js';
import { connectVisitorSocket } from './socket.js';
import { injectStyles, createLauncher, createPanel, appendMessage } from './ui.js';
import type { Message } from './session.js';
import { getRealtimeOrigin } from '@open333crm/shared';

interface Open333CRMConfig {
  channelId: string;
  apiBaseUrl: string;
}

declare global {
  interface Window {
    Open333CRM?: Open333CRMConfig;
  }
}

async function boot(): Promise<void> {
  const config = window.Open333CRM;
  if (!config?.channelId || !config?.apiBaseUrl) {
    console.warn('[Open333CRM] Missing channelId or apiBaseUrl in window.Open333CRM');
    return;
  }

  const { channelId, apiBaseUrl } = config;
  const realtimeOrigin = getRealtimeOrigin(apiBaseUrl);

  // Init visitor session
  let session: Awaited<ReturnType<typeof initSession>>;
  try {
    session = await initSession(apiBaseUrl, channelId);
  } catch (err) {
    console.error('[Open333CRM] Failed to init session:', err);
    return;
  }

  // Build UI
  injectStyles();
  const launcher = createLauncher();
  const { panel, messagesEl, input, sendBtn } = createPanel('Chat with us');

  let panelOpen = false;
  let isComposing = false;
  launcher.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('o333-hidden', !panelOpen);
    if (panelOpen) input.focus();
  });

  // Show greeting for new visitor
  if (session.greeting) {
    const greetMsg: Message = {
      direction: 'OUTBOUND',
      senderType: 'BOT',
      contentType: 'text',
      content: { text: session.greeting },
    };
    appendMessage(messagesEl, greetMsg, true);
  }

  // Connect Socket.IO for real-time replies
  const sock = connectVisitorSocket(realtimeOrigin, channelId, session.visitorToken);
  sock.onAgentMessage((msg) => {
    appendMessage(messagesEl, msg, true);
    if (!panelOpen) {
      launcher.innerHTML = '🔴';
    }
  });

  // Send message
  async function sendMessage(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;

    // Optimistic UI
    const outMsg: Message = {
      direction: 'INBOUND',
      contentType: 'text',
      content: { text },
    };
    appendMessage(messagesEl, outMsg, false);
    input.value = '';

    try {
      const res = await fetch(`${apiBaseUrl}/webchat/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorToken: session.visitorToken,
          contentType: 'text',
          content: { text },
        }),
      });
      if (!res.ok) {
        console.error('[Open333CRM] Message send failed:', res.status);
      }
    } catch (err) {
      console.error('[Open333CRM] Message send error:', err);
    }
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  input.addEventListener('compositionend', () => {
    isComposing = false;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Reset notification dot when panel opened
  launcher.addEventListener('click', () => {
    launcher.innerHTML = '💬';
  });
}

// Auto-boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    boot();
  });
} else {
  boot();
}
