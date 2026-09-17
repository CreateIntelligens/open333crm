/**
 * 會員綁定的設定驅動介面（OpenSpec design D5）。
 *
 * 為何設定驅動：這決定日後每接一個客戶是「改設定」還是「改程式」。
 * 若為每個客戶寫轉接程式，核心程式會隨客戶數量腐化。
 *
 * ⚠️ 涵蓋度限制：格式特殊者（需簽章、多步驟 OAuth、非 JSON 回應）
 * 仍需寫轉接程式，屬客製層工作。設定介面不嘗試涵蓋所有情況。
 */

export type MemberAuthType = 'none' | 'bearer' | 'api_key' | 'basic';

export interface MemberApiAuth {
  type: MemberAuthType;
  /** bearer：token；api_key：金鑰值；basic：base64(user:pass) */
  credential?: string;
  /** api_key 放在哪個 header，預設 X-API-Key */
  headerName?: string;
}

export interface MemberBindingConfig {
  /** 是否啟用會員綁定 */
  enabled: boolean;
  /** 查詢會員的端點。支援 {{memberId}} / {{phone}} 等佔位符 */
  endpoint: string;
  method: 'GET' | 'POST';
  auth: MemberApiAuth;
  /** 額外 header */
  headers?: Record<string, string>;
  /** POST 的 body 範本（JSON 字串，含佔位符） */
  bodyTemplate?: string;
  /**
   * 回應欄位對應。key 為我們的欄位名，value 為回應中的路徑。
   * 例：{ memberId: 'data.member_no', memberName: 'data.name' }
   */
  fieldMapping: Record<string, string>;
  /**
   * 判斷「查無此會員」的依據。外部 API 常以 200 + 空資料表示查無，
   * 而非 404——沒有這個設定就無法區分「查無」與「成功但欄位為空」。
   */
  notFoundWhen?: {
    /** 此路徑的值為 falsy 即視為查無 */
    fieldIsEmpty?: string;
    /** 此路徑的值等於指定值即視為查無 */
    fieldEquals?: { path: string; value: string | number | boolean };
  };
  /** 綁定成功後寫入 ContactAttribute 的 key，預設 member_id */
  attributeKey?: string;
  /** 綁定成功後自動貼上的標籤 */
  bindTagId?: string | null;
  timeoutMs?: number;
}

/** 顧客在綁定頁輸入的識別資料。欄位名對應 endpoint／bodyTemplate 的佔位符。 */
export type MemberLookupInput = Record<string, string>;

export type BindingFailureReason =
  /** 外部服務無回應：逾時、連線失敗、DNS 錯誤 */
  | 'UPSTREAM_UNREACHABLE'
  /** 外部服務回傳錯誤：非 2xx，或回應非預期格式 */
  | 'UPSTREAM_ERROR'
  /** 查無此會員：外部服務正常回應，但找不到對應會員 */
  | 'MEMBER_NOT_FOUND'
  /** 設定不完整或未啟用 */
  | 'NOT_CONFIGURED'
  /** 此會員編號已被其他聯絡人綁定 */
  | 'ALREADY_BOUND_TO_OTHER';

export interface BindingSuccess {
  ok: true;
  memberId: string;
  /** 依 fieldMapping 取得的其他欄位，一併寫入 ContactAttribute */
  attributes: Record<string, string>;
}

export interface BindingFailure {
  ok: false;
  reason: BindingFailureReason;
  /** 供後台排查用的技術細節，不直接顯示給顧客 */
  detail?: string;
}

export type BindingResult = BindingSuccess | BindingFailure;
