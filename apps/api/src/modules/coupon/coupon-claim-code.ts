/**
 * 公開領券連結的代碼與顧客看到的文字（add-coupon-system design D30）。純函式，不碰資料庫。
 *
 * 代碼 8 碼，字集同券碼（去除 0/O/1/I/L）。顧客改動預填文字時，系統只認代碼：
 * 大小寫、全形、空白都不影響（spec「顧客改動預填文字」）。
 */
import { randomInt } from 'node:crypto';
import { buildBindingLink, channelPublicLabel, publicAccountName, resolveBindingHandle } from '../identity-binding/binding-links.js';

/** 與券碼相同的字集（packages/core 的 CODE_ALPHABET） */
export const CLAIM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CLAIM_CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${CLAIM_CODE_ALPHABET}]{${CLAIM_CODE_LENGTH}}$`);
/** FB／IG 導流連結的 ref：coupon_{代碼} */
const REF_RE = /^coupon_([A-Za-z0-9]{8})$/;

export function generateClaimCode(): string {
  let code = '';
  for (let i = 0; i < CLAIM_CODE_LENGTH; i += 1) code += CLAIM_CODE_ALPHABET[randomInt(CLAIM_CODE_ALPHABET.length)];
  return code;
}

/** 網址或輸入的代碼正規化：全形轉半形、去空白、轉大寫；不是代碼格式回 null */
export function normalizeClaimCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** 字串中由英數組成、長度剛好 8 的片段（前後不是英數），且只含代碼字集 */
function exactRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Z0-9]+/g)) {
    if (m[0].length === CLAIM_CODE_LENGTH && CODE_RE.test(m[0])) out.push(m[0]);
  }
  return out;
}

/**
 * 從顧客的訊息找出可能的領券代碼（最多 5 個，依出現順序）。
 * 兩種切法都試：原文以空白分隔的 8 碼（「code K7M2Q9XA please」），
 * 以及去掉空白後的 8 碼（「領券 k7m2 q9xa」）。8 碼的一般英文字也會被當成候選，查不到就照一般訊息處理。
 */
export function extractClaimCodeCandidates(text: string | null | undefined): string[] {
  if (!text) return [];
  const upper = text.normalize('NFKC').toUpperCase();
  const found = [...exactRuns(upper), ...exactRuns(upper.replace(/\s+/g, ''))];
  return [...new Set(found)].slice(0, 5);
}

/** FB／IG 導流事件的 ref（`coupon_{代碼}`）；不是領券的 ref 回 null */
export function claimCodeFromRef(ref: string | null | undefined): string | null {
  const m = ref ? REF_RE.exec(ref.trim()) : null;
  return m ? normalizeClaimCode(m[1]) : null;
}

export function claimRef(code: string): string {
  return `coupon_${code}`;
}

/** LINE 預填文字：顧客改掉前後文字，只要代碼還在就能領 */
export function claimPrefillText(code: string): string {
  return `我要領取優惠券，代碼 ${code}（請直接送出）`;
}

export function claimPageUrl(webBaseUrl: string, code: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/coupon/claim/${code}`;
}

export type ClaimChannelType = 'LINE' | 'FB' | 'THREADS';
export const CLAIM_CHANNEL_TYPES: readonly ClaimChannelType[] = ['LINE', 'FB', 'THREADS'];

export interface ClaimChannelLink {
  channelType: ClaimChannelType;
  /** 給顧客看的公開帳號名稱（@xxxx、粉專 username）；沒有時為 null */
  publicName: string | null;
  /** LINE：非好友送不出訊息，要先加好友 */
  addFriendUrl?: string;
  /** LINE 為預填領券訊息的 oaMessage 連結；FB／IG 為帶 ref 的開啟對話連結 */
  sendCodeUrl: string;
}

/**
 * 領券頁的渠道按鈕。沿用跨渠道綁定代碼的導流做法（binding-links.ts）：
 * LINE 用 oaMessage 預填文字，FB／IG 用 m.me／ig.me 的 ref。渠道沒有公開帳號 ID 時回 null（顧客無從開啟對話）。
 */
export function buildClaimChannelLink(channelType: string, settings: unknown, code: string): ClaimChannelLink | null {
  if (!CLAIM_CHANNEL_TYPES.includes(channelType as ClaimChannelType)) return null;
  const handle = resolveBindingHandle(settings);
  if (!handle) return null;
  const type = channelType as ClaimChannelType;
  if (type === 'LINE') {
    const id = encodeURIComponent(handle);
    return {
      channelType: 'LINE',
      publicName: publicAccountName('LINE', handle),
      addFriendUrl: `https://line.me/R/ti/p/${id}`,
      sendCodeUrl: `https://line.me/R/oaMessage/${id}/?${encodeURIComponent(claimPrefillText(code))}`,
    };
  }
  const link = buildBindingLink({ channelType: type, displayName: '', handle }, claimRef(code));
  return { channelType: type, publicName: link.publicName, sendCodeUrl: link.sendCodeUrl };
}

/** 「請到 LINE（@shop123）領取」的渠道稱呼：用平台上的公開名稱，不用後台自取的渠道名稱 */
export function claimChannelLabel(channelType: string, settings: unknown): string {
  return channelPublicLabel(channelType, resolveBindingHandle(settings));
}

/** 傳訊領券回覆顧客的文字（spec「公開領券失敗時回覆顧客」；純文字、不放 emoji） */
export const CLAIM_REPLY_TEXT = {
  unavailable: '這個領券活動目前無法領取',
  alreadyClaimed: '您已經領過這張優惠券',
  soldOut: '優惠券已全數領完',
  /** 全形括號後不留空格：「請到 LINE（@shop）領取」「請到 Facebook 領取」 */
  wrongChannel: (label: string) => `請到 ${label}${label.endsWith('）') ? '' : ' '}領取`,
  /** 系統錯誤（spec 未列的原因）：仍要回覆顧客，不讓顧客以為沒反應 */
  failed: '目前無法發送優惠券，請稍後再試一次',
} as const;

export type ClaimFailureReason =
  | 'LINK_UNAVAILABLE'
  | 'ALREADY_CLAIMED'
  | 'SOLD_OUT'
  | 'WRONG_CHANNEL'
  | 'ISSUE_FAILED'
  | 'DELIVERY_FAILED';

/** 後台對話紀錄裡的原因文字（客服看的） */
export const CLAIM_FAILURE_NOTE: Record<ClaimFailureReason, string> = {
  LINK_UNAVAILABLE: '領券連結已停用、不在期間內，或券不是進行中',
  ALREADY_CLAIMED: '顧客已達每人領取上限',
  SOLD_OUT: '發行總量或序號已用完',
  WRONG_CHANNEL: '代碼屬於其他渠道的領券連結',
  ISSUE_FAILED: '發券時發生錯誤',
  DELIVERY_FAILED: '發券訊息送不出，券已作廢',
};
