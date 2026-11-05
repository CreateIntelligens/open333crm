/**
 * 圖文選單用到的 LINE Messaging API。都是外部呼叫，由 flow 在交易外呼叫（AGENTS.md 結構規則 2）。
 *
 * 每個呼叫有 30 秒逾時（change migrate-line-tenant-ctx design D3）：整段發布最多 5 次外部呼叫，
 * 要遠低於「發布中超過 5 分鐘視為中斷」的門檻。
 */
import { AppError } from '../../shared/utils/response.js';

const LINE_API_BASE = 'https://api.line.me';
const LINE_DATA_API_BASE = 'https://api-data.line.me';
const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB
const TIMEOUT_MS = 30_000;

/** 逾時或連不上時轉成 LINE_API_ERROR，讓呼叫端照一般的 LINE 錯誤處理 */
async function lineFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new AppError('LINE 沒有回應，請稍後重試', 'LINE_API_ERROR', 400, { upstream: (err as Error).message });
  }
}

const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export interface RichMenuImage {
  buffer: Buffer;
  contentType: 'image/jpeg' | 'image/png';
}

/** 下載背景圖，只擋大小與 MIME；寬高由 LINE 上傳時檢查（版型已在建立與修改時驗過） */
export async function fetchRichMenuImage(imageUrl: string): Promise<RichMenuImage> {
  let response: Response;
  try {
    response = await fetch(imageUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError(`無法取得背景圖：${imageUrl}`, 'IMAGE_FETCH_FAILED', 400);
  }
  if (!response.ok) {
    throw new AppError(`背景圖回應 ${response.status}：${imageUrl}`, 'IMAGE_FETCH_FAILED', 400);
  }

  const contentTypeHeader = (response.headers.get('content-type') ?? '').toLowerCase();
  let contentType: RichMenuImage['contentType'];
  if (contentTypeHeader.includes('image/jpeg') || contentTypeHeader.includes('image/jpg')) {
    contentType = 'image/jpeg';
  } else if (contentTypeHeader.includes('image/png')) {
    contentType = 'image/png';
  } else {
    throw new AppError(
      `背景圖格式必須是 JPEG 或 PNG（實際：${contentTypeHeader || 'unknown'}）`,
      'IMAGE_INVALID_TYPE',
      400,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(
      `背景圖大小 ${(buffer.byteLength / 1024).toFixed(0)}KB 超過 LINE 限制 1MB`,
      'IMAGE_TOO_LARGE',
      400,
    );
  }
  return { buffer, contentType };
}

export interface LineRichMenuBody {
  size: unknown;
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: unknown;
}

/** 建立 LINE 選單，回傳 LINE 端的選單 id */
export async function createLineRichMenu(accessToken: string, body: LineRichMenuBody): Promise<string> {
  const res = await lineFetch(`${LINE_API_BASE}/v2/bot/richmenu`, {
    method: 'POST',
    headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new AppError(
      'LINE 無法建立圖文選單，請確認版型與渠道設定後重試',
      'LINE_API_ERROR',
      400,
      // 管理員主動發布：LINE 原文放 details 供排查，不併進 message
      { upstream: await res.text(), status: res.status },
    );
  }
  const { richMenuId } = (await res.json()) as { richMenuId: string };
  return richMenuId;
}

export async function uploadLineRichMenuImage(accessToken: string, lineRichMenuId: string, image: RichMenuImage) {
  const res = await lineFetch(`${LINE_DATA_API_BASE}/v2/bot/richmenu/${lineRichMenuId}/content`, {
    method: 'POST',
    headers: { ...auth(accessToken), 'Content-Type': image.contentType },
    body: image.buffer,
  });
  if (!res.ok) {
    throw new AppError('LINE 無法接受此背景圖，請確認圖片尺寸與格式後重試', 'LINE_API_ERROR', 400, {
      upstream: await res.text(),
      status: res.status,
    });
  }
}

/** 設成所有好友的預設選單。LINE 以新選單取代目前的預設，不必先取消。回傳是否成功 */
export async function setLineDefaultRichMenu(accessToken: string, lineRichMenuId: string): Promise<boolean> {
  try {
    const res = await lineFetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu/${lineRichMenuId}`, {
      method: 'POST',
      headers: auth(accessToken),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 目前所有好友的預設選單 id；沒有預設時回 null */
export async function getLineDefaultRichMenuId(accessToken: string): Promise<string | null> {
  const res = await lineFetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu`, { headers: auth(accessToken) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new AppError('無法取得 LINE 目前的預設圖文選單，請稍後重試', 'LINE_API_ERROR', 400, {
      upstream: await res.text(),
      status: res.status,
    });
  }
  const { richMenuId } = (await res.json()) as { richMenuId?: string };
  return richMenuId ?? null;
}

export async function cancelLineDefaultRichMenu(accessToken: string) {
  const res = await lineFetch(`${LINE_API_BASE}/v2/bot/user/all/richmenu`, {
    method: 'DELETE',
    headers: auth(accessToken),
  });
  if (!res.ok && res.status !== 404) {
    throw new AppError('LINE 無法取消預設圖文選單，請稍後重試', 'LINE_API_ERROR', 400, {
      upstream: await res.text(),
      status: res.status,
    });
  }
}

/** 刪除 LINE 選單。404 視為已刪除 */
export async function deleteLineRichMenu(accessToken: string, lineRichMenuId: string) {
  const res = await lineFetch(`${LINE_API_BASE}/v2/bot/richmenu/${lineRichMenuId}`, {
    method: 'DELETE',
    headers: auth(accessToken),
  });
  if (!res.ok && res.status !== 404) {
    throw new AppError('LINE 無法刪除此圖文選單，請稍後重試', 'LINE_API_ERROR', 400, {
      upstream: await res.text(),
      status: res.status,
    });
  }
}
