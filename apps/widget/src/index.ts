import { initSession } from './session.js';
import { connectVisitorSocket } from './socket.js';
import { injectStyles, createLauncher, createPanel, appendMessage } from './ui.js';
import type { Message } from './session.js';
import { getRealtimeOrigin } from '@open333crm/shared';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime'];

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
  const { panel, messagesEl, input, sendBtn, attachBtn, fileInput } = createPanel('Chat with us');

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

  // --- Media upload ---
  async function sendMedia(file: File): Promise<void> {
    const isImage = ALLOWED_IMAGE_MIMES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_MIMES.includes(file.type);

    if (!isImage && !isVideo) {
      alert('只支援圖片（PNG/JPG）或影片（MP4/MOV）');
      return;
    }

    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > maxBytes) {
      alert(`檔案大小超過 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`);
      return;
    }

    // Optimistic placeholder
    const placeholderEl = document.createElement('div');
    placeholderEl.className = 'o333-msg o333-msg-in';
    placeholderEl.textContent = '[傳送中...]';
    messagesEl.appendChild(placeholderEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const formData = new FormData();
      formData.append('visitorToken', session.visitorToken);
      formData.append('file', file);

      const uploadRes = await fetch(`${apiBaseUrl}/webchat/${channelId}/media`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        placeholderEl.textContent = '[傳送失敗]';
        console.error('[Open333CRM] Media upload failed:', uploadRes.status);
        return;
      }

      const { data } = await uploadRes.json() as { data: { url: string; contentType: 'image' | 'video' } };

      await fetch(`${apiBaseUrl}/webchat/${channelId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorToken: session.visitorToken,
          contentType: data.contentType,
          content: { url: data.url },
        }),
      });

      // Replace placeholder with actual media
      placeholderEl.textContent = '';
      if (data.contentType === 'image') {
        placeholderEl.classList.add('o333-msg-img');
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = 'image';
        placeholderEl.appendChild(img);
      } else {
        placeholderEl.classList.add('o333-msg-video');
        const video = document.createElement('video');
        video.src = data.url;
        video.controls = true;
        placeholderEl.appendChild(video);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      placeholderEl.textContent = '[傳送失敗]';
      console.error('[Open333CRM] Media send error:', err);
    }
  }

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      sendMedia(file);
      fileInput.value = '';
    }
  });
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
