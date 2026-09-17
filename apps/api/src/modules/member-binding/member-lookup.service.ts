/**
 * 呼叫客戶的會員 API 查詢會員（design D5）。
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

const DEFAULT_TIMEOUT_MS = 10_000;

/** 置換 {{key}} 佔位符。缺值以空字串取代，與 canvas 的 api-fetch-node 行為一致。 */
function substitute(template: string, vars: MemberLookupInput): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
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

export async function lookupMember(
  config: MemberBindingConfig,
  input: MemberLookupInput,
): Promise<BindingResult> {
  if (!config?.enabled || !config.endpoint) {
    return { ok: false, reason: 'NOT_CONFIGURED' };
  }

  const url = substitute(config.endpoint, input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: config.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers ?? {}),
        ...buildAuthHeaders(config),
      },
      body: config.method === 'POST' && config.bodyTemplate
        ? substitute(config.bodyTemplate, input)
        : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // 逾時、DNS、連線拒絕都落這裡——對方系統的問題，不是顧客的問題
    const detail = (err as Error).name === 'AbortError' ? '連線逾時' : (err as Error).message;
    logger.warn('[MemberBinding] 外部會員 API 無回應', { detail });
    return { ok: false, reason: 'UPSTREAM_UNREACHABLE', detail };
  }
  clearTimeout(timer);

  if (!response.ok) {
    // 404 常被用來表示查無會員，與其他錯誤分開
    if (response.status === 404) {
      return { ok: false, reason: 'MEMBER_NOT_FOUND' };
    }
    const detail = `HTTP ${response.status}`;
    logger.warn('[MemberBinding] 外部會員 API 回傳錯誤', { detail });
    return { ok: false, reason: 'UPSTREAM_ERROR', detail };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    logger.warn('[MemberBinding] 外部會員 API 回應非 JSON');
    return { ok: false, reason: 'UPSTREAM_ERROR', detail: '回應非 JSON 格式' };
  }

  if (isNotFound(config, body)) {
    return { ok: false, reason: 'MEMBER_NOT_FOUND' };
  }

  // 依 fieldMapping 取值
  const attributes: Record<string, string> = {};
  for (const [ourKey, theirPath] of Object.entries(config.fieldMapping ?? {})) {
    const v = getByPath(body, theirPath);
    if (v !== undefined && v !== null && v !== '') {
      attributes[ourKey] = String(v);
    }
  }

  const memberId = attributes.memberId;
  if (!memberId) {
    // 對方回 200 但取不到會員編號——設定的 fieldMapping 與實際回應不符，
    // 或該筆資料不完整。不可建立不完整綁定（tasks 5.6）
    logger.warn('[MemberBinding] 回應中取不到 memberId', {
      mappedKeys: Object.keys(attributes),
    });
    return { ok: false, reason: 'MEMBER_NOT_FOUND', detail: '回應中無會員編號' };
  }

  return { ok: true, memberId, attributes };
}
