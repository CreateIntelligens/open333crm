/**
 * 跨渠道綁定：租戶設定讀取、導流識別解析、導流連結與顧客看到的訊息文字（design D6 / D10）。
 */
import { BINDING_CODE_TTL_MS, DEFAULT_BIND_KEYWORDS, DEFAULT_EMAIL_KEYWORDS, DEFAULT_UNBIND_KEYWORDS } from './binding-code.js';

export interface IdentityBindingSettings {
  enabled: boolean;
  bindKeywords: string[];
  unbindKeywords: string[];
  /** email 登記（change add-email-identity-merge）：與綁定代碼分開啟用 */
  emailEnabled: boolean;
  emailKeywords: string[];
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
    emailEnabled: obj.emailEnabled === true,
    emailKeywords: keywordList(obj.emailKeywords, DEFAULT_EMAIL_KEYWORDS),
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
  /** 給顧客看的公開帳號名稱（見 publicAccountName）；沒有可公開的名稱時為 null */
  publicName: string | null;
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
        publicName: publicAccountName('LINE', target.handle),
        addFriendUrl: `https://line.me/R/ti/p/${handle}`,
        sendCodeUrl: `https://line.me/R/oaMessage/${handle}/?${encodeURIComponent(linePrefillText(code))}`,
      };
    case 'FB':
      return { channelType: 'FB', publicName: publicAccountName('FB', target.handle), sendCodeUrl: `https://m.me/${handle}?ref=${code}` };
    case 'THREADS':
      return {
        channelType: 'THREADS',
        publicName: publicAccountName('THREADS', target.handle),
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

/**
 * 給顧客看的公開帳號名稱：FB 粉專 username、IG @username、LINE Basic ID（@xxxx）。
 * 一律用平台上的公開識別，不用後台自取的渠道名稱（例如「測試粉專」「第二個line串接」不該讓顧客看到）。
 * FB 沒有 username 時導流識別會退回純數字的粉專 ID，數字對顧客沒有意義，回 null 只顯示類型。
 */
export function publicAccountName(channelType: string, handle?: string | null): string | null {
  const h = handle?.trim();
  if (!h) return null;
  if (channelType === 'FB') return /^\d+$/.test(h) ? null : h;
  if (channelType === 'THREADS' || channelType === 'LINE') return h.startsWith('@') ? h : `@${h}`;
  return h;
}

/**
 * 給顧客看的渠道稱呼：類型加上公開帳號名稱，例如「Facebook（my.shop）」「LINE（@abc1234）」。
 * 同一租戶可能接多個 LINE OA／粉專，只寫「LINE」顧客分不出是哪一個；沒有公開名稱時只寫類型。
 */
export function channelPublicLabel(channelType: string, handle?: string | null): string {
  const label = channelLabel(channelType);
  const name = publicAccountName(channelType, handle);
  return name ? `${label}（${name}）` : label;
}

/** 發碼後回覆顧客的訊息（純文字，四個渠道都能顯示；不放 emoji） */
export function buildInviteText(links: BindingLink[], code: string): string {
  const minutes = Math.round(BINDING_CODE_TTL_MS / 60000);
  const sections = links.map((link) => {
    const title = link.publicName ? `【${channelLabel(link.channelType)}：${link.publicName}】` : `【${channelLabel(link.channelType)}】`;
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

/** 「LINE 帳號」／「LINE（總店）帳號」：全形括號後不留空格 */
const accountOf = (label: string) => `${label}${label.endsWith('）') ? '' : ' '}帳號`;

export const BINDING_TEXT = {
  noTargets: '目前沒有其他可以綁定的帳號。',
  rateLimited: '綁定連結申請次數過多，請一小時後再試。',
  invalid: '這組綁定代碼無效、已被使用或已過期，請回到原本的對話重新取得。',
  sameIdentity: '請到「另一個」要綁定的帳號送出這組代碼。',
  alreadyBound: '這兩個帳號已經完成綁定了。',
  channelConflict: '無法綁定：同一個渠道只能綁定一個帳號。若這不是您本人的帳號，請不要使用別人轉傳的代碼。',
  unbindExpired: '綁定已超過 7 天，無法自行解除，請聯繫客服協助。',
  confirmPrompt: (otherLabel: string, otherName: string, confirmKeyword: string, minutes: number) =>
    `您正在把這個帳號與 ${accountOf(otherLabel)}「${otherName}」綁定，綁定後兩邊的對話紀錄、點數會合併在一起。\n\n確定是您本人的帳號，請於 ${minutes} 分鐘內回覆「${confirmKeyword}」。\n如果不是您本人申請的，請不要回覆，也不要把代碼或連結轉給別人。`,
  noPending: '目前沒有待確認的綁定，可能已超過時間。請回到原本的對話重新取得代碼。',
  bound: (otherLabel: string, unbindKeyword: string) =>
    `已完成帳號綁定：此帳號已與您的 ${accountOf(otherLabel)}合併為同一位顧客。若非本人操作，請於 7 天內回覆「${unbindKeyword}」。`,
  unbound: '已解除帳號綁定，兩個帳號恢復為各自獨立。',
  deliveryFailed: '綁定通知沒有送到顧客（綁定結果不受影響）',
} as const;

/** email 登記的顧客訊息（純文字、不放 emoji；change add-email-identity-merge） */
export const EMAIL_TEXT = {
  invite: (url: string, minutes: number) =>
    [
      '請點選下方連結登記您的 email。登記後，使用相同 email 的其他帳號（例如 LINE、Facebook）會整合為同一位顧客，對話紀錄會合併在一起。',
      url,
      `連結 ${minutes} 分鐘內有效，只能使用一次，請勿轉傳給他人。`,
    ].join('\n\n'),
  rateLimited: 'email 登記連結申請次數過多，請一小時後再試。',
  registered: '已登記您的 email。',
  channelConflict: '無法自動整合帳號：這個 email 已由同一類帳號中的另一個帳號使用。如需協助請直接留言，客服會為您處理。',
  /** 通知登記的一方；對方沒有任何渠道時 otherLabel 為 null */
  mergedToRegistrant: (otherLabel: string | null, otherName: string, unbindKeyword: string) =>
    `已完成帳號整合：此帳號已與${otherLabel ? `您的 ${accountOf(otherLabel)}` : '相同 email 的顧客資料'}「${otherName}」整合為同一位顧客，對話紀錄會合併在一起。若非本人操作，請於 7 天內回覆「${unbindKeyword}」。`,
  /** 通知原本就使用這個 email 的一方 */
  mergedToExisting: (registrantLabel: string, registrantName: string, unbindKeyword: string) =>
    `您的帳號已與 ${accountOf(registrantLabel)}「${registrantName}」整合為同一位顧客（以相同 email 登記）。若非本人操作，請於 7 天內回覆「${unbindKeyword}」。`,
} as const;
