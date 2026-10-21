/**
 * 核銷結果畫面的內容（成功、失敗、網路不穩、帳號錯誤共用一張狀態卡）。
 * 文案依 mobile-prototype-spec 2.8 表格；「活動已提前結束」與「尚未領取」原型沒有，依同樣的句型補上。
 */
import type { LookupResponse, LookupResult, RedeemFailureReason, StoreCoupon } from '@/lib/store-console-api';
import { ACCOUNT_SAY, accountCard, type AccountErrorCode } from './errors';
import { md, offerOf, redeemModeLabel, spokenTime, ymdhm } from './format';

export type ResultAction = 'scan' | 'manual' | 'login' | 'retry' | 'cancel';

export interface ResultRow {
  k: string;
  v: string;
  mono?: boolean;
}

export interface ResultView {
  tone: 'success' | 'danger' | 'neutral';
  /** 圖示種類 */
  icon: 'ticket' | 'ban' | 'calendar' | 'search' | 'phone' | 'wifi' | 'account';
  category: string;
  title: string;
  description?: string;
  kv?: { k: string; v: string };
  tag?: string;
  rows: ResultRow[];
  /** 找不到這張券時，大字顯示剛才查詢的序號 */
  bigCode?: string;
  say?: string;
  actions: { label: string; action: ResultAction; variant: 'primary' | 'outline' }[];
}

export type FailureKey = 'used' | 'expired' | 'notyet' | 'notfound' | 'wrongMode' | 'ended' | 'notClaimed' | 'sharedCode' | 'keyReused';

export const LOOKUP_FAILURE: Record<Exclude<LookupResult, 'OK'>, FailureKey> = {
  USED: 'used',
  EXPIRED: 'expired',
  NOT_YET: 'notyet',
  NOT_FOUND: 'notfound',
  WRONG_MODE: 'wrongMode',
  ENDED: 'ended',
  NOT_CLAIMED: 'notClaimed',
  SHARED_CODE: 'sharedCode',
};

export const REDEEM_FAILURE: Record<RedeemFailureReason, FailureKey> = {
  ALREADY_REDEEMED: 'used',
  EXPIRED: 'expired',
  NOT_YET_VALID: 'notyet',
  NOT_FOUND: 'notfound',
  WRONG_MODE: 'wrongMode',
  REVOKED: 'ended',
  NOT_CLAIMED: 'notClaimed',
  SHARED_CODE: 'sharedCode',
  KEY_REUSED: 'keyReused',
};

export interface FailureInput {
  key: FailureKey;
  /** 查詢時輸入或掃到的序號 */
  code: string;
  coupon?: StoreCoupon;
  redeemedAt?: string | null;
  redeemedStoreName?: string | null;
  expiresAt?: string | null;
  availableAt?: string | null;
}

export function failureFromLookup(code: string, r: LookupResponse): FailureInput {
  return {
    key: LOOKUP_FAILURE[r.result as Exclude<LookupResult, 'OK'>],
    code,
    coupon: r.coupon,
    redeemedAt: r.redeemedAt,
    redeemedStoreName: r.redeemedStoreName,
    expiresAt: r.expiresAt,
    availableAt: r.availableAt,
  };
}

const BACK_TO_SCAN = [{ label: '返回掃描', action: 'scan' as const, variant: 'primary' as const }];

function couponRows(c?: StoreCoupon): ResultRow[] {
  return c ? [{ k: '券名', v: c.name }, { k: '顧客', v: c.customerName }] : [];
}

export function failureView(f: FailureInput): ResultView {
  const c = f.coupon;
  switch (f.key) {
    case 'used': {
      const day = md(f.redeemedAt);
      return {
        tone: 'danger',
        icon: 'ban',
        category: '無法使用',
        title: day ? `已於 ${day} 使用過` : '這張券已使用過',
        description: '請顧客確認是否已用過',
        rows: [
          ...couponRows(c),
          ...(f.redeemedAt ? [{ k: '使用時間', v: ymdhm(f.redeemedAt), mono: true }] : []),
          ...(f.redeemedStoreName ? [{ k: '使用門市', v: f.redeemedStoreName }] : []),
        ],
        say: day
          ? `這張券在 ${day} ${spokenTime(f.redeemedAt)} 已經使用過了，麻煩您確認一下。`
          : '這張券已經使用過了，麻煩您確認一下。',
        actions: BACK_TO_SCAN,
      };
    }
    case 'expired': {
      const day = md(f.expiresAt ?? c?.expiresAt ?? c?.endAt);
      return {
        tone: 'danger',
        icon: 'calendar',
        category: '無法使用',
        title: day ? `已於 ${day} 到期` : '這張券已到期',
        description: '過期的券無法核銷',
        rows: couponRows(c),
        say: day ? `這張券 ${day} 已經到期了，有問題可以聯絡我們的客服。` : '這張券已經到期了，有問題可以聯絡我們的客服。',
        actions: BACK_TO_SCAN,
      };
    }
    case 'notyet': {
      const day = md(f.availableAt ?? c?.startAt);
      return {
        tone: 'danger',
        icon: 'calendar',
        category: '無法使用',
        title: day ? `${day} 起才能使用` : '還沒到可以使用的日期',
        description: '請顧客於生效日後再使用',
        rows: couponRows(c),
        say: day ? `這張券 ${day} 起才能使用喔。` : '這張券還沒到可以使用的日期喔。',
        actions: BACK_TO_SCAN,
      };
    }
    case 'notfound':
      return {
        tone: 'danger',
        icon: 'search',
        category: '無法使用',
        title: '找不到這張券',
        description: '請確認序號是否正確',
        rows: [],
        bigCode: f.code,
        say: '我再確認一次券號，請稍等。',
        actions: [
          { label: '確認序號後重新輸入', action: 'manual', variant: 'primary' },
          { label: '重新掃描', action: 'scan', variant: 'outline' },
        ],
      };
    case 'keyReused':
      return {
        tone: 'danger',
        icon: 'search',
        category: '無法使用',
        title: '請重新查詢這張券',
        description: '這次核銷的請求已用於另一張券，這張券沒有被核銷',
        rows: couponRows(c),
        say: '我重新查一次券，請稍等。',
        actions: BACK_TO_SCAN,
      };
    case 'sharedCode':
      return {
        tone: 'danger',
        icon: 'search',
        category: '無法使用',
        title: '這是共用券號',
        description: '每位顧客的共用券號都相同，分不出是誰的券',
        rows: [{ k: '處理方式', v: '請掃描顧客手機上的 QR Code' }],
        say: '麻煩出示手機上的優惠券 QR Code，我幫您掃描。',
        actions: BACK_TO_SCAN,
      };
    case 'wrongMode':
      return {
        tone: 'danger',
        icon: 'phone',
        category: '無法使用',
        title: '需在顧客手機上核銷',
        description: '此券為店員驗證碼券或顧客自助券',
        rows: c ? [{ k: '券名', v: c.name }, { k: '核銷方式', v: redeemModeLabel(c.redeemMode) }] : [],
        say: '這張券要在您的手機上使用，請按「立即使用」。',
        actions: BACK_TO_SCAN,
      };
    case 'ended':
      return {
        tone: 'danger',
        icon: 'ban',
        category: '無法使用',
        title: '活動已提前結束',
        description: '這張券的活動已結束，無法核銷',
        rows: couponRows(c),
        say: '這個活動已經提前結束了，有問題可以聯絡我們的客服。',
        actions: BACK_TO_SCAN,
      };
    case 'notClaimed':
      return {
        tone: 'danger',
        icon: 'ban',
        category: '無法使用',
        title: '尚未領取',
        description: '顧客還沒有領取這張券，請顧客先完成領取',
        rows: couponRows(c),
        say: '這張券還沒有領取，請先在手機上完成領取喔。',
        actions: BACK_TO_SCAN,
      };
  }
}

export function successView(input: { coupon: StoreCoupon; redeemedAt: string; storeName: string }): ResultView {
  const offer = offerOf(input.coupon);
  return {
    tone: 'success',
    icon: 'ticket',
    category: '核銷完成',
    title: offer.headline,
    kv: offer.sub,
    rows: [
      { k: '券名', v: input.coupon.name },
      { k: '顧客', v: input.coupon.customerName },
      { k: '序號', v: input.coupon.code, mono: true },
      { k: '核銷時間', v: ymdhm(input.redeemedAt), mono: true },
      { k: '核銷門市', v: input.storeName },
    ],
    actions: [{ label: '下一位', action: 'scan', variant: 'primary' }],
  };
}

export function networkView(coupon: StoreCoupon): ResultView {
  return {
    tone: 'neutral',
    icon: 'wifi',
    category: '請再試一次',
    title: '網路不穩',
    // 請求可能已到後端並完成核銷，也可能沒有：不能說券尚未使用。重試沿用重試鍵，會取得實際結果
    description: '請按「重試」確認結果，不會重複核銷',
    tag: '結果未確認',
    rows: couponRows(coupon),
    say: '網路有點慢，我確認一下結果。',
    actions: [
      { label: '取消', action: 'cancel', variant: 'outline' },
      { label: '重試', action: 'retry', variant: 'primary' },
    ],
  };
}

/** 觸發帳號錯誤的時機：開啟、查券、確認核銷、查看紀錄 */
export type AccountErrorTiming = 'open' | 'lookup' | 'confirm' | 'records';

export function accountView(code: AccountErrorCode, timing: AccountErrorTiming, username: string | null, coupon?: StoreCoupon): ResultView {
  const card = accountCard(code);
  const atConfirm = timing === 'confirm';
  return {
    tone: 'danger',
    icon: 'account',
    category: '無法使用',
    title: card.title,
    description: card.description,
    tag: atConfirm ? '本次未核銷' : undefined,
    rows: [...(atConfirm ? couponRows(coupon) : []), ...(username ? [{ k: '門市帳號', v: username }] : [])],
    // 顧客在場（查券或確認核銷時）才需要跟顧客說明
    say: timing === 'lookup' || atConfirm ? ACCOUNT_SAY : undefined,
    actions: [{ label: card.button, action: 'login', variant: 'primary' }],
  };
}
