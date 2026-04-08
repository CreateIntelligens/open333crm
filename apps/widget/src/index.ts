import { initSession } from './session.js';
import { connectVisitorSocket } from './socket.js';
import { injectStyles, createLauncher, createPanel, appendMessage } from './ui.js';
import type { Message } from './session.js';

interface Open333CRMConfig {
  channelId: string;
  apiUrl: string;
}

declare global {
  interface Window {
    Open333CRM?: Open333CRMConfig;
  }
}

async function boot(): Promise<void> {
  const config = window.Open333CRM;
  if (!config?.channelId || !config?.apiUrl) {
    console.warn('[Open333CRM] Missing channelId or apiUrl in window.Open333CRM');
    return;
  }

  const { channelId, apiUrl } = config;

  // Init visitor session
  let session: Awaited<ReturnType<typeof initSession>>;
  try {
    session = await initSession(apiUrl, channelId);
  } catch (err) {
    console.error('[Open333CRM] Failed to init session:', err);
    return;
  }

  // Build UI
  injectStyles();
  const launcher = createLauncher();
  const { panel, messagesEl, input, sendBtn } = createPanel('Chat with us');

  let panelOpen = false;
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
  const sock = connectVisitorSocket(apiUrl, channelId, session.visitorToken);
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
      const res = await fetch(`${apiUrl}/api/v1/webchat/${channelId}/messages`, {
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
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
  document.addEventListener('DOMContentLoaded', () => { boot(); });
} else {
  boot();
}

