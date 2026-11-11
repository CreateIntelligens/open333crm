/**
 * 呼叫客戶的會員 API 查詢會員（design D5）。
 *
 * 本檔是「基礎通道」：不為任何特定客戶的格式客製，只提供通用的
 * 端點／認證／欄位對應能力，並處理所有客戶都會遇到的問題——
 * 佔位符編碼、SSRF、逾時重試、回應大小、錯誤分類。
 *
 * ⚠️ 錯誤需分三類回報（tasks 5.6）：外部無回應／外部回錯／查無會員。
 * 只回「綁定失敗」會讓客服無從判斷是對方系統掛了還是顧客輸錯編號。
 */
import { logger } from '@open333crm/core';
import type {
  MemberBindingConfig,
  MemberLookupInput,
  BindingResult,
} from './member-binding.types.js';
import { assertEndpointAllowed, readBodyLimited } from './upstream-guard.js';

const DEFAULT_TIMEOUT_MS = 10_000;

/** 暫時性失敗才重試。對方回 4xx 是設定或輸入問題，重試沒有意義。 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 300;

/**
 * 置換 {{key}} 佔位符。
 *
 * ⚠️ URL 中的值必須編碼：會員編號含 & 或 # 會被解讀為 query 分隔符，
 * 導致額外參數被注入到送往客戶 API 的請求（實測 `A&admin=true` 會多出 admin 參數）。
 * JSON body 則走 JSON.stringify 轉義，避免值中的引號破壞結構。
 */
function substitute(
  template: string,
  vars: MemberLookupInput,
  mode: 'url' | 'json',
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const raw = vars[key] ?? '';
    if (mode === 'url') return encodeURIComponent(raw);
    // JSON.stringify 回傳含外層引號的字串，去掉後才能嵌在 "{{x}}" 之中
    return JSON.stringify(raw).slice(1, -1);
  });
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
    obj,
  );
}

function buildAuthHeaders(config: MemberBindingConfig): Record<string, string> {
  const { auth } = config;
  if (!auth || auth.type === 'none' || !auth.credential) return {};
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.credential}` };
    case 'basic':
      return { Authorization: `Basic ${auth.credential}` };
    case 'api_key':
      return { [auth.headerName || 'X-API-Key']: auth.credential };
    default:
      return {};
  }
}

/** 依設定判斷回應是否代表「查無此會員」。 */
function isNotFound(config: MemberBindingConfig, body: unknown): boolean {
  const rule = config.notFoundWhen;
  if (!rule) return false;
  if (rule.fieldIsEmpty) {
    const v = getByPath(body, rule.fieldIsEmpty);
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      return true;
    }
  }
  if (rule.fieldEquals) {
    if (getByPath(body, rule.fieldEquals.path) === rule.fieldEquals.value) return true;
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchOutcome {
  kind: 'response' | 'unreachable';
  response?: Response;
  detail?: string;
}

/** 單次呼叫，逾時以 AbortController 控制。 */
async function attemptFetch(
  url: string,
  config: MemberBindingConfig,
  body: string | undefined,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: config.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
        ...buildAuthHeaders(config),
      },
      body,
      signal: controller.signal,
      redirect: 'manual', // 轉址可能指向內網，不自動跟隨
    });
    return { kind: 'response', response };
  } catch (err) {
    const detail = (err as Error).name === 'AbortError' ? '連線逾時' : (err as Error).message;
    return { kind: 'unreachable', detail };
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupMember(
  config: MemberBindingConfig,
  input: MemberLookupInput,
): Promise<BindingResult> {
  if (!config?.enabled || !config.endpoint) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const url = substitute(config.endpoint, input, 'url');

  // SSRF 防護：端點由後台填入，等同讓管理員指定伺服器要連的位址
  const allowed = await assertEndpointAllowed(url);
  if (!allowed.ok) {
    logger.warn('[MemberBinding] 端點不被允許', { reason: allowed.reason, detail: allowed.detail });
    return {
      ok: false,
      reason: allowed.reason === 'DNS_FAILED' ? 'UPSTREAM_UNREACHABLE' : 'UPSTREAM_ERROR',
      detail: `端點不被允許（${allowed.reason}）`,
    };
  }

  const body =
    config.method === 'POST' && config.bodyTemplate
      ? substitute(config.bodyTemplate, input, 'json')
      : undefined;

  let outcome: FetchOutcome | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    outcome = await attemptFetch(url, config, body);

    const retryable =
      outcome.kind === 'unreachable' ||
      (outcome.response != null && RETRYABLE_STATUS.has(outcome.response.status));

    if (!retryable || attempt === MAX_ATTEMPTS) break;

    // 指數退避：對方若是暫時過載，立刻重打只會加重負擔
    await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    logger.info('[MemberBinding] 重試對外呼叫', { attempt: attempt + 1 });
  }

  if (!outcome || outcome.kind === 'unreachable') {
    logger.warn('[MemberBinding] 外部會員 API 無回應', { detail: outcome?.detail });
    return { ok: false, reason: 'UPSTREAM_UNREACHABLE', detail: outcome?.detail };
  }

  const response = outcome.response!;

  if (response.status >= 300 && response.status < 400) {
    // redirect: 'manual' 下轉址不會被跟隨，明確回報而非當成成功
    return { ok: false, reason: 'UPSTREAM_ERROR', detail: `未跟隨的轉址（HTTP ${response.status}）` };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return { ok: false, reason: 'MEMBER_NOT_FOUND' };
    }
    const detail = `HTTP ${response.status}`;
    logger.warn('[MemberBinding] 外部會員 API 回傳錯誤', { detail });
    return { ok: false, reason: 'UPSTREAM_ERROR', detail };
  }

  const read = await readBodyLimited(response);
  if (!read.ok) {
    logger.warn('[MemberBinding] 外部會員 API 回應過大');
    return { ok: false, reason: 'UPSTREAM_ERROR', detail: '回應內容過大' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    logger.warn('[MemberBinding] 外部會員 API 回應非 JSON');
    return { ok: false, reason: 'UPSTREAM_ERROR', detail: '回應非 JSON 格式' };
  }

  if (isNotFound(config, parsed)) {
    return { ok: false, reason: 'MEMBER_NOT_FOUND' };
  }

  const attributes: Record<string, string> = {};
  for (const [ourKey, theirPath] of Object.entries(config.fieldMapping ?? {})) {
    const v = getByPath(parsed, theirPath);
    if (v !== undefined && v !== null && v !== '') {
      attributes[ourKey] = String(v);
    }
  }

  const memberId = attributes.memberId;
  if (!memberId) {
    // 對方回 200 但取不到會員編號——fieldMapping 與實際回應不符，
    // 或該筆資料不完整。不可建立不完整綁定（tasks 5.6）
    logger.warn('[MemberBinding] 回應中取不到 memberId', { mappedKeys: Object.keys(attributes) });
    return { ok: false, reason: 'MEMBER_NOT_FOUND', detail: '回應中無會員編號' };
  }

  return { ok: true, memberId, attributes };
}

/**
 * 連線測試：用設定與測試值實際打一次，讓後台在存檔後能立刻驗證設定是否正確，
 * 而不是等顧客去踩雷。回傳與正式查詢相同的結果型別。
 */
export async function testConnection(
  config: MemberBindingConfig,
  sampleInput: MemberLookupInput,
): Promise<BindingResult> {
  return lookupMember(config, sampleInput);
}
