/**
 * 建立／編輯優惠券表單的純邏輯：欄位定義、驗證、必填、風險、最壞成本、表單值與 API 欄位互轉。
 * 規則與文案依《優惠券後台 UX 規則》第 3、6 節與後台原型（admin-spec.md 第 2 章）。
 * 不碰 React，方便單獨測試。
 */
import { LOCKED_FIELDS, staffCodeError } from '@open333crm/shared';
import type {
  CodeMode,
  Coupon,
  CouponInput,
  CouponPurpose,
  CouponType,
  RedeemMode,
  ValidityMode,
} from '@/hooks/useCoupons';

export type FormMode = 'create' | 'draft' | 'published';

/** 表單值一律用字串保存輸入框的原樣，送出時才轉型；radio 未選時為空字串。 */
export interface FormValues {
  name: string;
  terms: string;
  imageUrl: string;
  couponType: CouponType | '';
  discountAmount: string;
  minSpend: string;
  discountPercent: string;
  percentCap: string;
  giftName: string;
  giftQty: string;
  exchangeItem: string;
  exchangeValueCap: string;
  purpose: CouponPurpose | '';
  validityMode: ValidityMode | '';
  startAt: string;
  endAt: string;
  afterClaimDays: string;
  afterOpenMinutes: string;
  codeMode: CodeMode | '';
  codePrefix: string;
  sharedCode: string;
  redeemMode: RedeemMode | '';
  staffCode: string;
  totalLimit: string;
  perContactLimit: string;
  maskCodeBeforeStart: boolean;
  autoTag: boolean;
  claimTagId: string;
  claimTagTtlDays: string;
}

export type FieldKey = keyof FormValues | 'codes';
export type GroupKey = 'couponType' | 'purpose' | 'validityMode' | 'codeMode' | 'redeemMode';
export type SectionId = 'basic' | 'type' | 'validity' | 'code' | 'issue' | 'redeem' | 'guard';

export const MAX_NAME = 30;
export const MAX_IMPORT_CODES = 50_000;
export const IMPORT_CODE_PATTERN = /^[A-Za-z0-9-]{4,32}$/;
/** 單張最高額達此值又由顧客自助核銷時，列為風險 */
export const HIGH_VALUE = 500;
export const TERMS_SELF_REDEEM_LINE = '誤按即失效，無法恢復';

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const money = (n: number) => `NT$${Math.round(n).toLocaleString('en-US')}`;
/** 2026-10-31 → 10/31 */
export const md = (s: string) => (s ? s.slice(5).replace('-', '/') : '');

export const SECTIONS: { id: SectionId; title: string; desc: string }[] = [
  { id: 'basic', title: '基本資料', desc: '顧客在券夾與券詳情看到的內容' },
  { id: 'type', title: '券型與用途', desc: '先選券型，下方會出現對應的金額或品項欄位' },
  { id: 'validity', title: '效期', desc: '三種到期邏輯，對應不同的發放情境' },
  { id: 'code', title: '券號', desc: '決定追蹤精度與防轉發能力' },
  { id: 'issue', title: '發行控制', desc: '限制總量與單人領取次數' },
  { id: 'redeem', title: '核銷方式', desc: '在門市或線上如何確認使用' },
  { id: 'guard', title: '防濫用與自動化', desc: '預設開啟，建議保留' },
];

export interface GroupOption<V extends string = string> {
  value: V;
  label: string;
  hint: string;
}

export const GROUPS: Record<GroupKey, { label: string; caption: string; options: GroupOption[] }> = {
  couponType: {
    label: '券型',
    caption: '決定折扣怎麼算',
    options: [
      { value: 'DISCOUNT_AMOUNT', label: '元折抵', hint: '折抵固定金額' },
      { value: 'DISCOUNT_PERCENT', label: '% 折扣', hint: '依比例折抵' },
      { value: 'GIFT', label: '贈品', hint: '送實體贈品，填贈品名稱與數量' },
      { value: 'EXCHANGE', label: '兌換', hint: '換品項或服務，填品項與價值上限' },
    ],
  },
  purpose: {
    label: '用途分類',
    caption: '決定由誰發放，以及計入哪一份報表',
    options: [
      { value: 'SERVICE', label: '客服補償', hint: '座席在對話中直接發給顧客' },
      { value: 'MARKETING', label: '行銷推廣', hint: '行銷人員透過活動、廣播或短連結發放，座席無法在對話中發送' },
    ],
  },
  validityMode: {
    label: '效期模式',
    caption: '券什麼時候失效',
    options: [
      { value: 'FIXED', label: '固定起訖', hint: '適合檔期活動' },
      { value: 'AFTER_CLAIM', label: '領取後 N 天', hint: '適合入會禮' },
      { value: 'AFTER_OPEN', label: '開啟後 N 分鐘', hint: '防囤券、店內即用' },
    ],
  },
  codeMode: {
    label: '序號模式',
    caption: '每張券的券號怎麼產生',
    options: [
      { value: 'UNIQUE_CODE', label: '一人一碼', hint: '可精準追蹤到個人' },
      { value: 'SHARED_CODE', label: '共用碼', hint: '可印在文宣上' },
      { value: 'IMPORTED_CODES', label: '序號包匯入', hint: '沿用電商折扣碼庫' },
    ],
  },
  redeemMode: {
    label: '誰來核銷',
    caption: '決定防護強度與歸因方式',
    options: [
      { value: 'STAFF_CODE', label: '顧客出示手機，店員輸入驗證碼確認', hint: '店員驗證碼 · 店員在顧客手機輸入驗證碼' },
      { value: 'STAFF_SCAN', label: '店員用核銷台掃顧客手機上的 QR Code', hint: '店員掃碼 · 防護最強' },
      { value: 'SELF', label: '顧客自己滑動確認，不需要店員', hint: '顧客自助 · 適合低價值券' },
    ],
  },
};

export const FIELD_LABEL: Record<FieldKey, string> = {
  name: '券名稱',
  terms: '使用條款',
  imageUrl: '券面圖',
  couponType: '券型',
  discountAmount: '折抵金額',
  minSpend: '最低消費門檻',
  discountPercent: '折掉幾 %',
  percentCap: '折抵上限',
  giftName: '贈品名稱',
  giftQty: '每張券可兌換數量',
  exchangeItem: '兌換品項',
  exchangeValueCap: '品項價值上限',
  purpose: '用途分類',
  validityMode: '效期模式',
  startAt: '生效日',
  endAt: '失效日',
  afterClaimDays: '有效天數',
  afterOpenMinutes: '有效時間',
  codeMode: '序號模式',
  codePrefix: '券號前綴',
  sharedCode: '券號',
  codes: '序號包',
  redeemMode: '誰來核銷',
  staffCode: '店員驗證碼',
  totalLimit: '發行總量上限',
  perContactLimit: '每人領取上限',
  maskCodeBeforeStart: '未到生效日不顯示序號',
  autoTag: '領券自動貼標',
  claimTagId: '標籤',
  claimTagTtlDays: '標籤時效',
};

export const SECTION_OF: Record<FieldKey, SectionId> = {
  name: 'basic', terms: 'basic', imageUrl: 'basic',
  couponType: 'type', discountAmount: 'type', minSpend: 'type', discountPercent: 'type', percentCap: 'type',
  giftName: 'type', giftQty: 'type', exchangeItem: 'type', exchangeValueCap: 'type', purpose: 'type',
  validityMode: 'validity', startAt: 'validity', endAt: 'validity', afterClaimDays: 'validity', afterOpenMinutes: 'validity',
  codeMode: 'code', codePrefix: 'code', sharedCode: 'code', codes: 'code',
  totalLimit: 'issue', perContactLimit: 'issue',
  redeemMode: 'redeem', staffCode: 'redeem',
  maskCodeBeforeStart: 'guard', autoTag: 'guard', claimTagId: 'guard', claimTagTtlDays: 'guard',
};

const LOCKED = new Set<string>(LOCKED_FIELDS);

/** 已發布的券這個欄位是否唯讀（鎖定清單由 @open333crm/shared 與後端共用）。 */
export function isLocked(mode: FormMode, field: FieldKey): boolean {
  if (mode !== 'published') return false;
  return LOCKED.has(field === 'codes' ? 'codeMode' : field);
}

/** 已發布的券可修改、儲存時會比對差異的欄位（API 欄位名）。 */
export const EDITABLE_AFTER_PUBLISH = [
  'name', 'terms', 'imageUrl', 'totalLimit', 'perContactLimit',
  'maskCodeBeforeStart', 'claimTagId', 'claimTagTtlDays',
] as const;

/** DOM id：欄位、radio 選項、區塊 */
export const fieldDomId = (f: FieldKey) => `coupon-f-${f}`;
export const optionDomId = (g: GroupKey, v: string) => `coupon-opt-${g}-${v}`;
export const sectionDomId = (s: SectionId) => `coupon-sec-${s}`;

export function emptyValues(today = ymd(new Date())): FormValues {
  return {
    name: '', terms: '', imageUrl: '',
    couponType: '', discountAmount: '', minSpend: '0', discountPercent: '', percentCap: '',
    giftName: '', giftQty: '1', exchangeItem: '', exchangeValueCap: '',
    purpose: '',
    validityMode: '', startAt: today, endAt: '', afterClaimDays: '30', afterOpenMinutes: '15',
    codeMode: '', codePrefix: '', sharedCode: '',
    redeemMode: '', staffCode: '',
    totalLimit: '', perContactLimit: '1',
    // 「防濫用與自動化」兩個選項預設都開啟（規格 2.2 第 7 區）
    maskCodeBeforeStart: true, autoTag: true, claimTagId: '', claimTagTtlDays: '30',
  };
}

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function valuesFromCoupon(c: Coupon): FormValues {
  const base = emptyValues();
  return {
    name: c.name ?? '',
    terms: c.terms ?? '',
    imageUrl: c.imageUrl ?? '',
    couponType: c.couponType ?? '',
    discountAmount: str(c.discountAmount),
    minSpend: c.minSpend == null ? base.minSpend : String(c.minSpend),
    discountPercent: str(c.discountPercent),
    percentCap: str(c.percentCap),
    giftName: c.giftName ?? '',
    giftQty: c.giftQty == null ? base.giftQty : String(c.giftQty),
    exchangeItem: c.exchangeItem ?? '',
    exchangeValueCap: str(c.exchangeValueCap),
    purpose: c.purpose ?? '',
    validityMode: c.validityMode ?? '',
    // 後端以 UTC 午夜保存日期，取 ISO 的日期部分即為當初送出的 YYYY-MM-DD
    startAt: c.startAt ? c.startAt.slice(0, 10) : c.status === 'DRAFT' ? base.startAt : '',
    endAt: c.endAt ? c.endAt.slice(0, 10) : '',
    afterClaimDays: c.afterClaimDays == null ? base.afterClaimDays : String(c.afterClaimDays),
    afterOpenMinutes: c.afterOpenMinutes == null ? base.afterOpenMinutes : String(c.afterOpenMinutes),
    codeMode: c.codeMode ?? '',
    codePrefix: c.codePrefix ?? '',
    sharedCode: c.sharedCode ?? '',
    redeemMode: c.redeemMode ?? '',
    staffCode: c.staffCode ?? '',
    totalLimit: str(c.totalLimit),
    perContactLimit: str(c.perContactLimit ?? 1),
    maskCodeBeforeStart: c.maskCodeBeforeStart ?? true,
    autoTag: !!c.claimTagId,
    claimTagId: c.claimTagId ?? '',
    claimTagTtlDays: c.claimTagTtlDays == null ? base.claimTagTtlDays : String(c.claimTagTtlDays),
  };
}

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** 轉成 API 欄位。只送目前選擇用得到的欄位，其餘送 null 清掉（例如券型從元折抵改成贈品）。 */
export function toCouponInput(v: FormValues): CouponInput & { name: string } {
  const t = v.couponType;
  const text = (s: string) => s.trim() || null;
  return {
    name: v.name.trim(),
    terms: v.terms.trim() || null,
    imageUrl: v.imageUrl || null,
    couponType: t || null,
    discountAmount: t === 'DISCOUNT_AMOUNT' ? toNum(v.discountAmount) : null,
    minSpend: t === 'DISCOUNT_AMOUNT' ? toNum(v.minSpend) ?? 0 : null,
    discountPercent: t === 'DISCOUNT_PERCENT' ? toNum(v.discountPercent) : null,
    percentCap: t === 'DISCOUNT_PERCENT' ? toNum(v.percentCap) : null,
    giftName: t === 'GIFT' ? text(v.giftName) : null,
    giftQty: t === 'GIFT' ? toNum(v.giftQty) ?? 1 : null,
    exchangeItem: t === 'EXCHANGE' ? text(v.exchangeItem) : null,
    exchangeValueCap: t === 'EXCHANGE' ? toNum(v.exchangeValueCap) : null,
    purpose: v.purpose || null,
    validityMode: v.validityMode || null,
    startAt: v.validityMode === 'FIXED' ? v.startAt || null : null,
    endAt: v.validityMode === 'FIXED' ? v.endAt || null : null,
    afterClaimDays: v.validityMode === 'AFTER_CLAIM' ? toNum(v.afterClaimDays) : null,
    afterOpenMinutes: v.validityMode === 'AFTER_OPEN' ? toNum(v.afterOpenMinutes) : null,
    codeMode: v.codeMode || null,
    codePrefix: v.codeMode === 'UNIQUE_CODE' ? text(v.codePrefix.toUpperCase()) : null,
    sharedCode: v.codeMode === 'SHARED_CODE' ? text(v.sharedCode.toUpperCase()) : null,
    redeemMode: v.redeemMode || null,
    // 驗證碼一律字串，開頭的 0 不可去掉
    staffCode: v.redeemMode === 'STAFF_CODE' ? v.staffCode || null : null,
    totalLimit: toNum(v.totalLimit),
    perContactLimit: toNum(v.perContactLimit) ?? 1,
    maskCodeBeforeStart: v.maskCodeBeforeStart,
    claimTagId: v.autoTag ? v.claimTagId || null : null,
    claimTagTtlDays: v.autoTag ? toNum(v.claimTagTtlDays) : null,
  };
}

/** 已發布的券：只取可修改欄位中值真的改變者。 */
export function editableChanges(base: FormValues, next: FormValues): CouponInput {
  const a = toCouponInput(base) as Record<string, unknown>;
  const b = toCouponInput(next) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_AFTER_PUBLISH) {
    if (a[key] !== b[key]) out[key] = b[key];
  }
  return out as CouponInput;
}

/** 依目前選擇，各區塊有哪些輸入欄位（不含 radio 群組）。 */
export function visibleFields(v: FormValues): Record<SectionId, FieldKey[]> {
  const type: FieldKey[] = [];
  if (v.couponType === 'DISCOUNT_AMOUNT') type.push('discountAmount', 'minSpend');
  if (v.couponType === 'DISCOUNT_PERCENT') type.push('discountPercent', 'percentCap');
  if (v.couponType === 'GIFT') type.push('giftName', 'giftQty');
  if (v.couponType === 'EXCHANGE') type.push('exchangeItem', 'exchangeValueCap');
  const validity: FieldKey[] =
    v.validityMode === 'FIXED' ? ['startAt', 'endAt']
      : v.validityMode === 'AFTER_CLAIM' ? ['afterClaimDays']
        : v.validityMode === 'AFTER_OPEN' ? ['afterOpenMinutes'] : [];
  const code: FieldKey[] =
    v.codeMode === 'UNIQUE_CODE' ? ['codePrefix']
      : v.codeMode === 'SHARED_CODE' ? ['sharedCode']
        : v.codeMode === 'IMPORTED_CODES' ? ['codes'] : [];
  return {
    basic: ['name', 'terms', 'imageUrl'],
    type,
    validity,
    code,
    issue: ['totalLimit', 'perContactLimit'],
    redeem: v.redeemMode === 'STAFF_CODE' ? ['staffCode'] : [],
    guard: v.autoTag ? ['claimTagId', 'claimTagTtlDays'] : [],
  };
}

const SECTION_GROUPS: Record<SectionId, GroupKey[]> = {
  basic: [], type: ['couponType', 'purpose'], validity: ['validityMode'], code: ['codeMode'],
  issue: [], redeem: ['redeemMode'], guard: [],
};

const REQUIRED = new Set<FieldKey>([
  'name', 'discountAmount', 'discountPercent', 'giftName', 'exchangeItem', 'startAt', 'endAt',
  'afterClaimDays', 'afterOpenMinutes', 'codePrefix', 'sharedCode', 'codes', 'perContactLimit',
  'staffCode', 'claimTagId',
]);

export const isRequired = (f: FieldKey) => REQUIRED.has(f);

export interface FormContext {
  mode: FormMode;
  /** 序號包已檢查、可匯入的筆數；null 代表還沒有上傳 */
  importOk: number | null;
  /** 已發放張數：已發布的券，發行總量不可低於此數（UX 規則 D7 以「已發放」為準） */
  issuedCount?: number;
  today?: string;
}

export interface MissingItem {
  key: FieldKey | GroupKey;
  label: string;
  section: SectionId;
  /** 點擊「尚有 N 個必填欄位」時要聚焦的元素 */
  target: string;
}

function isFilled(v: FormValues, f: FieldKey, ctx: FormContext): boolean {
  if (f === 'staffCode') return /^\d{4,6}$/.test(v.staffCode);
  if (f === 'codes') return (ctx.importOk ?? 0) > 0;
  const val = v[f as keyof FormValues];
  return typeof val === 'boolean' ? true : String(val ?? '').trim() !== '';
}

/** 尚未填寫的必填欄位，依畫面順序。已發布的券只檢查可修改的欄位。 */
export function missingItems(v: FormValues, ctx: FormContext): MissingItem[] {
  const fields = visibleFields(v);
  const out: MissingItem[] = [];
  for (const sec of SECTIONS) {
    for (const g of SECTION_GROUPS[sec.id]) {
      if (isLocked(ctx.mode, g)) continue;
      if (!v[g]) {
        out.push({ key: g, label: GROUPS[g].label, section: sec.id, target: optionDomId(g, GROUPS[g].options[0].value) });
      }
      // 群組選了之後才出現的欄位，排在該群組後面
      for (const f of fields[sec.id]) {
        if (groupOfField(f) !== g) continue;
        if (REQUIRED.has(f) && !isLocked(ctx.mode, f) && !isFilled(v, f, ctx)) {
          out.push({ key: f, label: FIELD_LABEL[f], section: sec.id, target: fieldDomId(f) });
        }
      }
    }
    for (const f of fields[sec.id]) {
      if (groupOfField(f)) continue;
      if (REQUIRED.has(f) && !isLocked(ctx.mode, f) && !isFilled(v, f, ctx)) {
        out.push({ key: f, label: FIELD_LABEL[f], section: sec.id, target: fieldDomId(f) });
      }
    }
  }
  return out;
}

function groupOfField(f: FieldKey): GroupKey | null {
  if (['discountAmount', 'minSpend', 'discountPercent', 'percentCap', 'giftName', 'giftQty', 'exchangeItem', 'exchangeValueCap'].includes(f)) return 'couponType';
  if (['startAt', 'endAt', 'afterClaimDays', 'afterOpenMinutes'].includes(f)) return 'validityMode';
  if (['codePrefix', 'sharedCode', 'codes'].includes(f)) return 'codeMode';
  if (f === 'staffCode') return 'redeemMode';
  return null;
}

const NUMERIC: FieldKey[] = [
  'discountAmount', 'minSpend', 'discountPercent', 'percentCap', 'giftQty', 'exchangeValueCap',
  'afterClaimDays', 'afterOpenMinutes', 'totalLimit', 'perContactLimit', 'claimTagTtlDays',
];

/**
 * 欄位格式錯誤（不含「此欄位必填」）。只檢查目前看得到、而且沒有鎖定的欄位。
 * 文案逐字依規格 2.3。
 */
export function validate(v: FormValues, ctx: FormContext): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const fields = visibleFields(v);
  const visible = new Set(Object.values(fields).flat());
  const check = (f: FieldKey) => visible.has(f) && !isLocked(ctx.mode, f);
  const n = (f: keyof FormValues) => toNum(String(v[f]));

  // 數字欄位：負數與非數字先擋，後面的規則才有意義
  for (const f of NUMERIC) {
    if (!check(f)) continue;
    const s = String(v[f as keyof FormValues]).trim();
    if (s === '' || /^\d+$/.test(s) || /^-\d+$/.test(s)) continue;
    e[f] = '只能輸入數字，請移除文字或符號';
  }
  const amount = (f: FieldKey, zeroMsg: string) => {
    if (!check(f) || e[f]) return;
    const x = n(f as keyof FormValues);
    if (x === null) return;
    if (x < 0) e[f] = `不能是負數，${zeroMsg}`;
    else if (x === 0) e[f] = zeroMsg;
  };

  if (v.couponType === 'DISCOUNT_AMOUNT') {
    amount('discountAmount', '金額需大於 0，例如輸入 100');
    const m = n('minSpend');
    if (check('minSpend') && !e.minSpend && m !== null && m < 0) e.minSpend = '門檻不能是負數，輸入 0 表示不限';
    const d = n('discountAmount');
    if (check('discountAmount') && !e.discountAmount && !e.minSpend && d && m && d > 0 && m > 0 && d >= m) {
      e.discountAmount = `折抵金額需小於最低消費門檻 ${money(m)}，請調低折抵或提高門檻`;
    }
  }
  if (v.couponType === 'DISCOUNT_PERCENT') {
    const r = n('discountPercent');
    if (check('discountPercent') && !e.discountPercent && r !== null && (r < 1 || r > 99)) {
      e.discountPercent = '折扣比例只能是 1–99，例如輸入 15 代表打 85 折';
    }
    amount('percentCap', '折抵上限需大於 0；不設上限請留空');
  }
  if (v.couponType === 'GIFT' && check('giftQty') && !e.giftQty) {
    const q = n('giftQty');
    if (q !== null && q < 1) e.giftQty = '數量至少 1 份';
  }
  if (v.couponType === 'EXCHANGE') amount('exchangeValueCap', '價值上限需大於 0；不設上限請留空');

  if (v.validityMode === 'FIXED') {
    const today = ctx.today ?? ymd(new Date());
    if (check('startAt') && ctx.mode !== 'published' && v.startAt && v.startAt < today) {
      e.startAt = `生效日不能早於今天（${md(today)}），請改為今天或之後`;
    }
    if (check('endAt') && v.startAt && v.endAt && v.endAt <= v.startAt) {
      e.endAt = `失效日必須晚於生效日（${md(v.startAt)}），請重新選擇`;
    }
  }
  if (v.validityMode === 'AFTER_CLAIM' && check('afterClaimDays') && !e.afterClaimDays) {
    const x = n('afterClaimDays');
    if (x !== null && x < 1) e.afterClaimDays = '至少 1 天，請輸入 1 以上的數字';
  }
  if (v.validityMode === 'AFTER_OPEN' && check('afterOpenMinutes') && !e.afterOpenMinutes) {
    const x = n('afterOpenMinutes');
    if (x !== null && x < 1) e.afterOpenMinutes = '至少 1 分鐘，請輸入 1 以上的數字';
  }

  if (check('sharedCode') && v.sharedCode) {
    const c = v.sharedCode;
    if (!/^[A-Za-z0-9]+$/.test(c)) e.sharedCode = '只能使用英文與數字，請移除空白或符號';
    else if (c.length < 4 || c.length > 20) e.sharedCode = `需 4–20 字，目前 ${c.length} 字`;
  }
  if (check('codePrefix') && v.codePrefix && !/^[A-Za-z0-9]+$/.test(v.codePrefix)) {
    e.codePrefix = '只能使用英文與數字，請移除空白或符號';
  }

  const total = n('totalLimit');
  if (check('totalLimit') && !e.totalLimit && total !== null) {
    if (total < 1) e.totalLimit = '至少 1 張的整數；不限總量請留空';
    else if (ctx.mode === 'published' && ctx.issuedCount != null && total < ctx.issuedCount) {
      e.totalLimit = `不能低於已發放的 ${ctx.issuedCount.toLocaleString('en-US')} 張`;
    }
  }
  const per = n('perContactLimit');
  if (check('perContactLimit') && !e.perContactLimit && per !== null) {
    if (per < 1) e.perContactLimit = '至少 1 張';
    else if (total && !e.totalLimit && per > total) e.perContactLimit = `不能大於發行總量（${total.toLocaleString('en-US')} 張）`;
  }

  if (check('staffCode') && v.staffCode) {
    const err = staffCodeError(v.staffCode);
    if (err) e.staffCode = /^\d{0,3}$/.test(v.staffCode) ? `${err}，目前 ${v.staffCode.length} 位` : err;
  }
  if (check('claimTagTtlDays') && !e.claimTagTtlDays) {
    const x = n('claimTagTtlDays');
    if (x !== null && x < 1) e.claimTagTtlDays = '至少 1 天';
  }
  return e;
}

/** 打幾折：折掉 15% → 85 折；折掉 20% → 8 折 */
export function zhe(rate: number): string {
  const p = 100 - rate;
  return p % 10 === 0 ? String(p / 10) : String(p);
}

/** 單張最高可折抵的金額；null 代表沒有上限，0 代表不適用（贈品）。 */
function perMax(v: FormValues): number | null {
  if (v.couponType === 'DISCOUNT_AMOUNT') return toNum(v.discountAmount) ?? 0;
  if (v.couponType === 'DISCOUNT_PERCENT') return toNum(v.percentCap);
  if (v.couponType === 'EXCHANGE') return toNum(v.exchangeValueCap);
  return 0;
}

export interface Risk {
  key: 'percentCap' | 'minSpend' | 'discountPercent' | 'totalLimit' | 'redeemMode';
  section: SectionId;
  title: string;
  text: string;
  /** 「去設定」要聚焦的元素 */
  target: string;
}

/** 不擋發布、但發布前必須勾選確認的設定（規格 2.5）。 */
export function risks(v: FormValues): Risk[] {
  const r: Risk[] = [];
  const n = (f: keyof FormValues) => toNum(String(v[f]));
  if (v.couponType === 'DISCOUNT_PERCENT' && !((n('percentCap') ?? 0) > 0)) {
    r.push({ key: 'percentCap', section: 'type', title: '無折抵上限', text: `比例折扣沒有封頂，大額訂單可折抵 ${v.discountPercent || '?'}% 不設限。`, target: fieldDomId('percentCap') });
  }
  if (v.couponType === 'DISCOUNT_AMOUNT' && !((n('minSpend') ?? 0) > 0)) {
    r.push({ key: 'minSpend', section: 'type', title: '無消費門檻', text: `任何金額的訂單都能折抵 ${money(n('discountAmount') ?? 0)}，包含低價品項。`, target: fieldDomId('minSpend') });
  }
  const rate = n('discountPercent');
  if (v.couponType === 'DISCOUNT_PERCENT' && rate !== null && rate >= 50) {
    r.push({ key: 'discountPercent', section: 'type', title: '折扣 ≥ 50%', text: `目前折掉 ${rate}%（打 ${zhe(rate)} 折），請確認不是誤填。`, target: fieldDomId('discountPercent') });
  }
  if (!((n('totalLimit') ?? 0) > 0)) {
    r.push({ key: 'totalLimit', section: 'issue', title: '不限總量', text: '發行張數沒有上限，只要符合資格就能持續領取。', target: fieldDomId('totalLimit') });
  }
  const pm = perMax(v);
  if (v.redeemMode === 'SELF' && v.couponType && v.couponType !== 'GIFT' && (pm === null || pm >= HIGH_VALUE)) {
    r.push({ key: 'redeemMode', section: 'redeem', title: '高金額搭配顧客自助', text: `單張最高可折 ${pm === null ? '無上限' : money(pm)}，卻由顧客自行核銷，無店員把關。`, target: optionDomId('redeemMode', 'SELF') });
  }
  return r;
}

export interface WorstCost {
  cost: string;
  formula: string;
  note: string;
  bounded: boolean;
}

/** 最壞成本：假設所有券都被領取，並以最高額度核銷。 */
export function worstCost(v: FormValues): WorstCost {
  const total = toNum(v.totalLimit);
  const pm = perMax(v);
  const t = v.couponType;
  let perLabel = '';
  if (t === 'DISCOUNT_AMOUNT') perLabel = `單張折抵 ${money(pm ?? 0)}`;
  if (t === 'DISCOUNT_PERCENT') perLabel = pm ? `單張上限 ${money(pm)}` : '單張無上限';
  if (t === 'EXCHANGE') perLabel = pm ? `單張價值上限 ${money(pm)}` : '單張價值無上限';
  if (t === 'GIFT') perLabel = `${v.giftQty || 1} 份贈品`;
  const formula = `${total ? `${total.toLocaleString('en-US')} 張` : '不限量'} × ${perLabel}`;
  if (t === 'GIFT') {
    if (!total) return { cost: '無上限', formula, note: '未設發行總量，贈品需求無法封頂。', bounded: false };
    return { cost: `${(total * (toNum(v.giftQty) ?? 1)).toLocaleString('en-US')} 份贈品`, formula, note: '以贈品數量計，請確認庫存足夠。', bounded: true };
  }
  if (!pm || !total) {
    return {
      cost: '無上限',
      formula,
      note: `有未設上限的項目，成本無法封頂。建議至少設定發行總量${t === 'DISCOUNT_PERCENT' ? '或折抵上限' : ''}。`,
      bounded: false,
    };
  }
  return { cost: money(pm * total), formula, note: '假設所有券都被領取，並以最高額度核銷。', bounded: true };
}

/** 欄位旁的即時警告（不擋發布）。 */
export function warnings(v: FormValues, ctx: FormContext, errors: Partial<Record<FieldKey, string>>): Partial<Record<FieldKey, string>> {
  const w: Partial<Record<FieldKey, string>> = {};
  const n = (f: keyof FormValues) => toNum(String(v[f]));
  const rate = n('discountPercent');
  if (v.couponType === 'DISCOUNT_PERCENT' && rate !== null && rate > 50 && rate <= 99) w.discountPercent = '折掉超過一半，請確認沒有輸入錯誤';
  if (!((n('totalLimit') ?? 0) > 0) && !errors.totalLimit) w.totalLimit = '不限總量，發布前需要再次確認';
  if (v.couponType === 'DISCOUNT_PERCENT' && !((n('percentCap') ?? 0) > 0) && !errors.percentCap) {
    w.percentCap = '未設折抵上限，大額訂單的折抵金額沒有上限，發布前需要再次確認';
  }
  if (v.couponType === 'DISCOUNT_AMOUNT' && !((n('minSpend') ?? 0) > 0) && !errors.minSpend) {
    w.minSpend = '無消費門檻，任何金額的訂單都能折抵，發布前需要再次確認';
  }
  if (v.redeemMode === 'STAFF_CODE' && ctx.mode !== 'published') w.staffCode = '優惠券發布後，店員驗證碼將無法修改。';
  const total = n('totalLimit');
  if (v.codeMode === 'IMPORTED_CODES' && ctx.importOk != null && total && ctx.importOk < total) {
    w.codes = `可用序號 ${ctx.importOk.toLocaleString('en-US')} 筆，少於發行總量 ${total.toLocaleString('en-US')} 張，序號用完後顧客將領不到券`;
  }
  return w;
}

/** 「折掉幾 %」的即時換算提示 */
export function percentHint(v: FormValues): string {
  const r = toNum(v.discountPercent);
  if (v.couponType !== 'DISCOUNT_PERCENT' || r === null || r < 1 || r > 99) return '';
  const cap = toNum(v.percentCap);
  const off = Math.min((1000 * r) / 100, cap && cap > 0 ? cap : Infinity);
  return `＝打 ${zhe(r)} 折，原價 NT$1,000 付 ${money(Math.max(0, 1000 - off))}`;
}

/** 區塊摘要（設定進度 aside）。 */
export function sectionSummary(v: FormValues, sec: SectionId, ctx: FormContext): string {
  const label = (g: GroupKey) => GROUPS[g].options.find((o) => o.value === v[g])?.label ?? '';
  const n = (f: keyof FormValues) => toNum(String(v[f]));
  switch (sec) {
    case 'basic':
      return v.name.trim() || '未命名';
    case 'type':
      return [label('couponType') || '券型未選', v.purpose ? label('purpose') : '用途未選'].join(' · ');
    case 'validity':
      if (v.validityMode === 'FIXED') return v.startAt && v.endAt ? `${md(v.startAt)}–${md(v.endAt)}` : '固定起訖';
      if (v.validityMode === 'AFTER_CLAIM') return `領取後 ${v.afterClaimDays || '?'} 天`;
      if (v.validityMode === 'AFTER_OPEN') return `開啟後 ${v.afterOpenMinutes || '?'} 分鐘`;
      return '未選';
    case 'code':
      return codeSummary(v, ctx);
    case 'issue':
      return `${(n('totalLimit') ?? 0) > 0 ? `${n('totalLimit')!.toLocaleString('en-US')} 張` : '不限總量'} · 每人 ${v.perContactLimit || '?'} 張`;
    case 'redeem':
      return v.redeemMode ? { STAFF_CODE: '店員驗證碼', STAFF_SCAN: '店員掃碼', SELF: '顧客自助' }[v.redeemMode] : '未選';
    case 'guard':
      return [v.maskCodeBeforeStart ? '遮蔽序號' : '', v.autoTag ? '貼標' : ''].filter(Boolean).join(' · ') || '未開啟';
  }
}

export function codeSummary(v: FormValues, ctx: Pick<FormContext, 'importOk'>): string {
  if (v.codeMode === 'UNIQUE_CODE') return `一人一碼 · ${v.codePrefix ? `${v.codePrefix.toUpperCase()}-XXXX` : '前綴未填'}`;
  if (v.codeMode === 'SHARED_CODE') return `共用碼 · ${v.sharedCode ? v.sharedCode.toUpperCase() : '未填'}`;
  if (v.codeMode === 'IMPORTED_CODES') return `序號包 · ${ctx.importOk != null ? `${ctx.importOk.toLocaleString('en-US')} 筆` : '未上傳'}`;
  return '未選';
}

/** 後端 400 訊息歸到哪個欄位顯示；歸不到的顯示在底部操作列。 */
export function fieldForServerMessage(message: string): FieldKey | null {
  if (/發行總量|已發放|已領取的/.test(message) && !/每人/.test(message)) return 'totalLimit';
  if (/每人/.test(message)) return 'perContactLimit';
  if (/驗證碼|4–6 位/.test(message)) return 'staffCode';
  if (/共用碼|券號/.test(message)) return 'sharedCode';
  if (/券名|優惠券名稱/.test(message)) return 'name';
  if (/失效日|到期日/.test(message)) return 'endAt';
  return null;
}

export type { Coupon };
