import type { Message } from './session.js';

const STYLES = `
  #o333-launcher {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    width: 56px; height: 56px; border-radius: 50%;
    background: #2563eb; color: #fff; border: none; cursor: pointer;
    font-size: 24px; box-shadow: 0 4px 12px rgba(0,0,0,.25);
    display: flex; align-items: center; justify-content: center;
    transition: background .2s;
  }
  #o333-launcher:hover { background: #1d4ed8; }
  #o333-panel {
    position: fixed; bottom: 92px; right: 24px; z-index: 9998;
    width: 340px; height: 480px; border-radius: 16px;
    background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.18);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #o333-panel.o333-hidden { display: none; }
  #o333-header {
    background: #2563eb; color: #fff;
    padding: 14px 16px; font-size: 15px; font-weight: 600;
  }
  #o333-messages {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .o333-msg {
    max-width: 80%; padding: 8px 12px; border-radius: 12px;
    font-size: 14px; line-height: 1.4; word-break: break-word;
  }
  .o333-msg-in {
    background: #f1f5f9; color: #1e293b;
    align-self: flex-start; border-bottom-left-radius: 4px;
  }
  .o333-msg-out {
    background: #2563eb; color: #fff;
    align-self: flex-end; border-bottom-right-radius: 4px;
  }
  #o333-input-row {
    display: flex; gap: 8px; padding: 10px 12px;
    border-top: 1px solid #e2e8f0;
  }
  #o333-input {
    flex: 1; border: 1px solid #cbd5e1; border-radius: 8px;
    padding: 8px 12px; font-size: 14px; outline: none;
  }
  #o333-input:focus { border-color: #2563eb; }
  #o333-send {
    background: #2563eb; color: #fff; border: none;
    border-radius: 8px; padding: 8px 14px; cursor: pointer;
    font-size: 14px; font-weight: 600;
  }
  #o333-send:hover { background: #1d4ed8; }
`;

export function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function createLauncher(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = 'o333-launcher';
  btn.innerHTML = '💬';
  btn.title = 'Chat with us';
  document.body.appendChild(btn);
  return btn;
}

export function createPanel(title: string): {
  panel: HTMLElement;
  messagesEl: HTMLElement;
  input: HTMLInputElement;
  sendBtn: HTMLButtonElement;
} {
  const panel = document.createElement('div');
  panel.id = 'o333-panel';
  panel.classList.add('o333-hidden');
  panel.innerHTML = `
    <div id="o333-header">${escapeHtml(title)}</div>
    <div id="o333-messages"></div>
    <div id="o333-input-row">
      <input id="o333-input" type="text" placeholder="Type a message..." autocomplete="off" />
      <button id="o333-send">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  return {
    panel,
    messagesEl: panel.querySelector('#o333-messages') as HTMLElement,
    input: panel.querySelector('#o333-input') as HTMLInputElement,
    sendBtn: panel.querySelector('#o333-send') as HTMLButtonElement,
  };
}

export function appendMessage(container: HTMLElement, msg: Message, isOutbound: boolean): void {
  const text = msg.content?.text ?? '';
  if (!text) return;

  const el = document.createElement('div');
  el.className = `o333-msg ${isOutbound ? 'o333-msg-out' : 'o333-msg-in'}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
