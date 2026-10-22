/**
 * 核銷台的日期與優惠文字。
 * 門市在台灣，時間一律以台灣時間顯示（不受手機時區設定影響，也讓測試結果固定）。
 */
import type { StoreCoupon } from '@/lib/store-console-api';

const TZ = 'Asia/Taipei';

interface Parts {
  y: string;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

function parts(value: string | Date | null | undefined): Parts | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const get = (type: string) => fmt.formatToParts(date).find((p) => p.type === type)?.value ?? '0';
  return { y: get('year'), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')) % 24, mm: Number(get('minute')) };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** 10/5 */
export function md(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${p.m}/${p.d}` : '';
}

/** 2026/10/05 */
export function ymd(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${p.y}/${p2(p.m)}/${p2(p.d)}` : '';
}

/** 14:31 */
export function hm(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${p2(p.hh)}:${p2(p.mm)}` : '';
}

/** 2026/10/05 14:31 */
export function ymdhm(value: string | Date | null | undefined): string {
  const p = parts(value);
  return p ? `${ymd(value)} ${hm(value)}` : '';
}

/** 跟顧客說的口語時間：下午 2:31 */
export function spokenTime(value: string | Date | null | undefined): string {
  const p = parts(value);
  if (!p) return '';
  const half = p.hh < 12 ? '上午' : '下午';
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return `${half} ${h12}:${p2(p.mm)}`;
}

/** 有效期限：2026/10/01 – 10/31（同一年省略年份） */
export function validityRange(c: Pick<StoreCoupon, 'startAt' | 'endAt' | 'expiresAt'>): string {
  const end = c.expiresAt ?? c.endAt;
  const start = c.startAt;
  if (!start && !end) return '不限';
  if (!start) return `至 ${ymd(end)}`;
  if (!end) return `${ymd(start)} 起`;
  const sameYear = parts(start)?.y === parts(end)?.y;
  const endText = sameYear ? `${p2(parts(end)!.m)}/${p2(parts(end)!.d)}` : ymd(end);
  return `${ymd(start)} – ${endText}`;
}

/** NT$1,000 */
export function nt(n: number | null | undefined): string {
  return `NT$${(n ?? 0).toLocaleString('en-US')}`;
}

/** 後端存「折掉幾 %」，台灣慣用「打幾折」：15 → 85 折，10 → 9 折 */
export function percentOff(discountPercent: number | null | undefined): string {
  const v = 100 - (discountPercent ?? 0);
  return `${v % 10 === 0 ? v / 10 : v} 折`;
}

export type CouponKind = 'cash' | 'pct' | 'gift' | 'swap';

export function kindOf(c: Pick<StoreCoupon, 'couponType'>): CouponKind {
  switch (c.couponType) {
    case 'DISCOUNT_PERCENT':
      return 'pct';
    case 'GIFT':
      return 'gift';
    case 'EXCHANGE':
      return 'swap';
    default:
      return 'cash';
  }
}

/** 確認畫面主卡：「結帳時要做什麼」 */
export interface OfferView {
  /** 券型標籤：元折抵／% 折扣／贈品／兌換 */
  label: string;
  /** 動詞：結帳折抵／結帳打折／贈送／兌換 */
  verb: string;
  /** 大字 */
  main: string;
  /** 次要列（沒有就不顯示） */
  sub?: { k: string; v: string };
  /** 警示，例「本次消費未滿 NT$1,000 不能使用」 */
  note?: string;
  /** 結果卡的標題，例「結帳折抵 NT$100」「85 折」 */
  headline: string;
  /** 紀錄列表右側的短文字，例「折抵 NT$100」 */
  short: string;
  /** 紀錄展開後的「結帳內容」 */
  detail: string;
}

export function offerOf(c: StoreCoupon): OfferView {
  switch (kindOf(c)) {
    case 'pct': {
      const main = percentOff(c.discountPercent);
      return {
        label: '% 折扣',
        verb: '結帳打折',
        main,
        sub: c.percentCap ? { k: '最多折', v: nt(c.percentCap) } : undefined,
        headline: main,
        short: main,
        detail: c.percentCap ? `結帳打 ${main}（最多折 ${nt(c.percentCap)}）` : `結帳打 ${main}`,
      };
    }
    case 'gift': {
      const main = `${c.giftName ?? '贈品'} ×${c.giftQty ?? 1}`;
      return { label: '贈品', verb: '贈送', main, headline: `贈送 ${main}`, short: `贈送 ${main}`, detail: `贈送 ${main}` };
    }
    case 'swap': {
      const main = `${c.exchangeItem ?? '兌換品項'} ×1`;
      const cap = c.exchangeValueCap ? nt(c.exchangeValueCap) : null;
      return {
        label: '兌換',
        verb: '兌換',
        main,
        sub: cap ? { k: '價值上限', v: cap } : undefined,
        headline: `兌換 ${main}`,
        short: `兌換 ${main}`,
        detail: cap ? `兌換 ${main}（價值上限 ${cap}）` : `兌換 ${main}`,
      };
    }
    default: {
      const main = nt(c.discountAmount);
      return {
        label: '元折抵',
        verb: '結帳折抵',
        main,
        sub: c.minSpend ? { k: '最低消費', v: nt(c.minSpend) } : undefined,
        note: c.minSpend ? `本次消費未滿 ${nt(c.minSpend)} 不能使用` : undefined,
        headline: `結帳折抵 ${main}`,
        short: `折抵 ${main}`,
        detail: c.minSpend ? `結帳折抵 ${main}（滿 ${nt(c.minSpend)}）` : `結帳折抵 ${main}`,
      };
    }
  }
}

/** 核銷方式的說法 */
export function redeemModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case 'STAFF_CODE':
      return '店員驗證碼';
    case 'SELF':
      return '顧客自助';
    case 'STAFF_SCAN':
      return '店員掃碼';
    default:
      return '—';
  }
}

/** m:ss（倒數用） */
export function mss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${p2(total % 60)}`;
}
