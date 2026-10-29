import { getBrowserFingerprint, initSession } from './session.js';
import { connectVisitorSocket } from './socket.js';
import { injectStyles, createLauncher, createPanel, applyPanelTheme, appendMessage } from './ui.js';
import type { Message } from './session.js';
import { getRealtimeOrigin } from '@open333crm/shared';

interface Open333CRMConfig {
  channelId: string;
  channelPublicKey?: string;
  apiBaseUrl: string;
}

declare global {
  interface Window {
    Open333CRM?: Open333CRMConfig;
  }
}

async function boot(): Promise<void> {
  const config = window.Open333CRM;
  if (!config?.channelId || !config.apiBaseUrl) {
    console.warn('[Open333CRM] Missing channelId or apiBaseUrl in window.Open333CRM');
    return;
  }

  const { channelId, apiBaseUrl } = config;
  const realtimeOrigin = getRealtimeOrigin(apiBaseUrl);
  const fingerprint = getBrowserFingerprint();

  // Init visitor session
  let session: Awaited<ReturnType<typeof initSession>>;
  try {
    session = await initSession(apiBaseUrl, config.channelPublicKey ?? channelId, fingerprint);
  } catch (err) {
    console.error('[Open333CRM] Failed to init session:', err);
    return;
  }

  // Build UI
  injectStyles();
  const launcher = createLauncher();
  const { panel, messagesEl, input, sendBtn } = createPanel('Chat with us');
  applyPanelTheme(panel, session.theme);

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
    appendMessage(messagesEl, greetMsg, false);
  }

  // Connect Socket.IO for real-time replies
  const sock = connectVisitorSocket(realtimeOrigin, session.sessionId, session.claimToken, fingerprint);
  sock.onAgentMessage((msg) => {
    appendMessage(messagesEl, msg, false);
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
    appendMessage(messagesEl, outMsg, true);
    // appendMessage is synchronous, so the last child is the message just sent
    const outEl = messagesEl.lastElementChild;
    input.value = '';
    const markFailed = () => {
      if (outEl) outEl.textContent = `${text} [傳送失敗]`;
    };

    try {
      const res = await fetch(`${apiBaseUrl}/webchat/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          claimToken: session.claimToken,
          clientMessageId: crypto.randomUUID(),
          type: 'text',
          payload: { text },
          fingerprint,
        }),
      });
      if (!res.ok) {
        markFailed();
        console.error('[Open333CRM] Message send failed:', res.status);
      }
    } catch (err) {
      markFailed();
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
