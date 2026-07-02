/**
 * 結構性防護（不只靠 prompt）：對 LLM 抽出的 QA 做程式端二次校驗。
 */
import { detectModelKeys } from './transcript.js';

/** 台灣手機（09xx）與市話（0x-xxxx / (0x)xxxx）粗略偵測。 */
const PHONE_PATTERN = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4}|\(0\d{1,2}\)\s?\d{3,4}[-\s]?\d{3,4}/;
/** 金額（數字 + 元/塊）。 */
const PRICE_PATTERN = /\d{2,6}\s?(元|塊|NT|nt\$|\$)/;
/** 完整地址（含縣市 + 路街 + 號）。 */
const ADDRESS_PATTERN = /[縣市].{0,10}[路街段巷弄].{0,6}號/;

/**
 * 判斷一段答案是否含「會變動」資訊（電話/金額/地址/營業時間）。
 * 命中即應強制 volatile:true。
 */
export function looksVolatile(text: string): boolean {
  return (
    PHONE_PATTERN.test(text) ||
    PRICE_PATTERN.test(text) ||
    ADDRESS_PATTERN.test(text) ||
    /營業時間|幾點.{0,4}(開|關|營業)|到幾點/.test(text)
  );
}

/** 是否含疑似殘留 PII（手機/完整地址）——命中應強制 needsReview。 */
export function looksPii(text: string): boolean {
  return PHONE_PATTERN.test(text) || ADDRESS_PATTERN.test(text);
}

/**
 * 是否為「具體據點/電話」資料（門市地址、電話、客服專線號碼）。
 *
 * 決策（依使用者）：這類資料不入 KB——ASR 逐字稿的電話號碼常聽錯，入庫等於
 * 重蹈「AI 給錯電話」覆轍（見 KB缺料清單第3條）。權威門市清單應來自官方。
 * 逐字稿只保留「客戶常問門市在哪」這個信號進分析報告。
 *
 * 判定：answer 含電話號碼串 或 完整地址（縣市+路+號）。
 */
const LOCATION_PHONE =
  // 市話多段（02-2592-5252 / 04-2270-1567）、黏一起的長號、區碼括號、0800、7碼以上純數字
  /0\d[-\s]?\d{3,4}[-\s]?\d{3,4}|0\d[-\s]?\d{6,}|\b\d{7,}\b|\(0\d\)|0800/;
const LOCATION_ADDR = /[縣市區].{0,12}[路街段巷弄].{0,8}號/;
/** 提到「分機/轉接 + 號碼」也算具體聯絡資訊。 */
const LOCATION_EXT = /(分機|轉接?)\s*\d{3,}/;
export function isSpecificLocation(text: string): boolean {
  return (
    LOCATION_PHONE.test(text) ||
    LOCATION_ADDR.test(text) ||
    LOCATION_EXT.test(text)
  );
}

/**
 * 是否為「低資訊量」答案——只把客戶推去問別人/自己查，沒有實質可入庫知識。
 * 決策（依使用者）：這類 QA 自動捨棄，不入 KB。
 * 例：「請聯繫服務單位確認後再說明」「可自行查詢或請客服協助提供」。
 */
const LOW_INFO_PATTERNS = [
  /(請|需)(先)?(聯繫|洽詢|撥打|致電|詢問).{0,10}(確認|洽詢|協助|提供|說明)?[。\s]*$/,
  /可(自行查詢|請客服協助|向客服(提出|洽詢|詢問))/,
  /需由.{0,8}確認/,
  /請.{0,6}(自行|再)?查詢/,
];
export function isLowInfo(text: string): boolean {
  const t = text.trim();
  // 很短 + 命中「叫人去問」句型 → 低資訊量
  if (t.length <= 60 && LOW_INFO_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

/**
 * 檢查 answer 中出現的型號是否都在「本通允許清單」內。
 * 回傳不在清單內的型號（幻覺型號）；非空代表需 needsReview。
 */
export function hallucinatedModels(answer: string, allowedKeys: string[]): string[] {
  const allowed = new Set(allowedKeys);
  return detectModelKeys(answer).filter((k) => !allowed.has(k));
}

/** 標準分類集合（對齊 keywords.ts 的缺口分類）。 */
const CANONICAL_CATEGORIES = new Set([
  '保固', '門市據點', '客服專線', '維修費用', '退換貨',
  '促銷活動', '送修流程', '故障排除', '使用教學', '產品諮詢',
]);

/** LLM 偶爾產出分類外的值，正規化回標準分類。 */
export function normalizeCategory(raw: string): string {
  if (CANONICAL_CATEGORIES.has(raw)) return raw;
  const alias: Record<string, string> = {
    維修流程: '送修流程', 報修流程: '送修流程', 維修: '送修流程',
    價格: '維修費用', 費用: '維修費用', 收費: '維修費用',
    門市: '門市據點', 據點: '門市據點', 地址: '門市據點',
    電話: '客服專線', 專線: '客服專線',
    操作: '使用教學', 清潔保養: '使用教學', 保養: '使用教學',
    規格: '產品諮詢', 選購: '產品諮詢',
    故障: '故障排除', 維修判斷: '故障排除',
  };
  for (const [k, v] of Object.entries(alias)) {
    if (raw.includes(k)) return v;
  }
  return '產品諮詢';
}
