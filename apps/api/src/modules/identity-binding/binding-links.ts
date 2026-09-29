/**
 * 跨渠道綁定：租戶設定讀取、導流識別解析、導流連結與顧客看到的訊息文字（design D6 / D10）。
 */
import { BINDING_CODE_TTL_MS, DEFAULT_BIND_KEYWORDS, DEFAULT_UNBIND_KEYWORDS } from './binding-code.js';

export interface IdentityBindingSettings {
  enabled: boolean;
  bindKeywords: string[];
  unbindKeywords: string[];
}

function keywordList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const list = raw.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

/** 將 TenantSettings.identityBinding（JSON）轉成含預設值的設定；未設定＝關閉 */
export function parseIdentityBindingSettings(raw: unknown): IdentityBindingSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: obj.enabled === true,
    bindKeywords: keywordList(obj.bindKeywords, DEFAULT_BIND_KEYWORDS),
    unbindKeywords: keywordList(obj.unbindKeywords, DEFAULT_UNBIND_KEYWORDS),
  };
}

/** 關鍵字比對：整句相符（去頭尾空白、不分大小寫），避免一般對話裡提到「綁定帳號」就被攔截 */
export function matchesKeyword(text: string, keywords: string[]): boolean {
  const t = text.trim().toLowerCase();
  return t !== '' && keywords.some((k) => k.toLowerCase() === t);
}

/** 渠道導流識別：管理員手動填的 bindingHandle 優先，其次是驗證時自動取得的 bindingHandleAuto */
export function resolveBindingHandle(settings: unknown): string | null {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  for (const v of [s.bindingHandle, s.bindingHandleAuto]) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

export type BindableChannelType = 'LINE' | 'FB' | 'THREADS';

export interface BindingTarget {
  channelType: BindableChannelType;
  displayName: string;
  handle: string;
}

export interface BindingLink {
  channelType: BindableChannelType;
  displayName: string;
  /** LINE 專用：非好友必須先加好友才能送出訊息 */
  addFriendUrl?: string;
  /** 點下去會把代碼帶回系統的連結 */
  sendCodeUrl: string;
}

/** LINE 預填文字（顧客改動前後文字仍可兌換，見 binding-code.ts 的比對規則） */
export function linePrefillText(code: string): string {
  return `我要綁定帳號，代碼 ${code}（請直接送出）`;
}

export function buildBindingLink(target: BindingTarget, code: string): BindingLink {
  const handle = encodeURIComponent(target.handle);
  switch (target.channelType) {
    case 'LINE':
      return {
        channelType: 'LINE',
        displayName: target.displayName,
        addFriendUrl: `https://line.me/R/ti/p/${handle}`,
        sendCodeUrl: `https://line.me/R/oaMessage/${handle}/?${encodeURIComponent(linePrefillText(code))}`,
      };
    case 'FB':
      return { channelType: 'FB', displayName: target.displayName, sendCodeUrl: `https://m.me/${handle}?ref=${code}` };
    case 'THREADS':
      return {
        channelType: 'THREADS',
        displayName: target.displayName,
        sendCodeUrl: `https://ig.me/m/${handle}?ref=${code}`,
      };
  }
}

const CHANNEL_LABEL: Record<string, string> = {
  LINE: 'LINE',
  FB: 'Facebook',
  THREADS: 'Instagram',
  WEBCHAT: '網站客服',
};

export function channelLabel(channelType: string): string {
  return CHANNEL_LABEL[channelType] ?? channelType;
}

/** 發碼後回覆顧客的訊息（純文字，四個渠道都能顯示；不放 emoji） */
export function buildInviteText(links: BindingLink[], code: string): string {
  const minutes = Math.round(BINDING_CODE_TTL_MS / 60000);
  const sections = links.map((link) => {
    const title = `【${channelLabel(link.channelType)}：${link.displayName}】`;
    if (link.channelType === 'LINE') {
      return `${title}\n1. 先加入好友：${link.addFriendUrl}\n2. 加入後點此送出綁定代碼：${link.sendCodeUrl}`;
    }
    if (link.channelType === 'THREADS') {
      return `${title}\n點此開啟：${link.sendCodeUrl}\n（僅支援手機 App；開啟後請傳送任一訊息）`;
    }
    return `${title}\n點此開啟：${link.sendCodeUrl}\n（開啟後若沒有反應，請傳送任一訊息）`;
  });
  return [
    '請選擇要綁定的帳號，完成後各帳號的對話紀錄會合併在一起。',
    ...sections,
    `若連結無法使用，請到要綁定的帳號直接傳送這組代碼：${code}`,
    `代碼 ${minutes} 分鐘內有效，只能使用一次，請勿轉傳給他人。`,
  ].join('\n\n');
}

export const BINDING_TEXT = {
  noTargets: '目前沒有其他可以綁定的帳號。',
  rateLimited: '綁定連結申請次數過多，請一小時後再試。',
  invalid: '這組綁定代碼無效或已過期，請回到原本的對話重新取得。',
  sameIdentity: '請到「另一個」要綁定的帳號送出這組代碼。',
  alreadyBound: '這兩個帳號已經完成綁定了。',
  unbindExpired: '綁定已超過 7 天，無法自行解除，請聯繫客服協助。',
  bound: (otherLabel: string, unbindKeyword: string) =>
    `已完成帳號綁定：此帳號已與您的 ${otherLabel} 帳號合併為同一位顧客。若非本人操作，請於 7 天內回覆「${unbindKeyword}」。`,
  unbound: '已解除帳號綁定，兩個帳號恢復為各自獨立。',
  deliveryFailed: '綁定通知沒有送到顧客（綁定結果不受影響）',
} as const;
