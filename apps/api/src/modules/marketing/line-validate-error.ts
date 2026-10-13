/**
 * 把 LINE validate API 的錯誤整理成使用者看得懂的訊息
 * （change readable-material-validation-errors，spec material-system）。
 *
 * 表單版型（純文字、圖片、影片、卡片、圖文）：使用者看不到 messages[0].previewImageUrl、
 * /contents/0/footer/contents/0/action/uri 這類路徑，所以換成編輯器上的欄位名稱，常見說明翻成中文；
 * 對應不到的欄位或說明保留原文，避免把看不懂的錯誤藏起來。
 *
 * ⚠️ Flex 版型（line_flex_*）**刻意保留 LINE 原文**：使用者直接編輯 JSON，
 * 需要知道是哪個屬性不合規才能修正，隱藏細節會讓編輯器失去價值。
 * LINE 的驗證回應只含版型結構資訊，不含帳號或系統內部資料。
 */

type Detail = { property?: string; message: string };

const SCHEME_HINT = '開頭不正確，請用 https://、http://、tel: 或 line://';

/** LINE 的說明 → [中文說明, 優先順序]；同一欄位有多則說明時只留順序最小的一則 */
function translateMessage(message: string): [string, number] | null {
  if (/may not be empty|must be non-empty/i.test(message)) return ['不可空白', 0];
  if (/^invalid uri$/i.test(message)) return ['格式不正確', 1];
  if (/invalid uri scheme|must use one of the following schemes/i.test(message)) return [SCHEME_HINT, 2];
  if (/valid HTTPS URL/i.test(message)) return ['必須是 https:// 開頭的公開網址', 3];
  const length = /length must be between \d+ and (\d+)/i.exec(message);
  if (length) return [`不可超過 ${length[1]} 字`, 4];
  return null;
}

const ACTION_FIELD: Record<string, string> = { uri: '連結', linkUri: '連結', label: '文字', text: '文字', data: '回傳值' };

/** LINE 的屬性路徑 → 編輯器的欄位名稱；對應不到回 null */
function fieldLabel(contentType: string, property: string): string | null {
  const isVideo = contentType === 'line_video';
  switch (property) {
    case 'text':
      return '訊息內容';
    case 'altText':
      return '通知訊息文字';
    case 'baseUrl':
      return '底圖網址';
    case 'originalContentUrl':
      return isVideo ? '影片網址' : '圖片網址';
    case 'previewImageUrl':
      return isVideo ? '預覽圖網址' : '縮圖網址';
  }

  // 圖文訊息的點擊區：actions[i] 對應編輯器的第 i+1 個點擊區
  const area = /^actions\[(\d+)\]\.(\w+)/.exec(property);
  if (area) {
    const part = area[2] === 'area' ? '範圍' : ACTION_FIELD[area[2]];
    return part ? `第 ${Number(area[1]) + 1} 個點擊區的${part}` : null;
  }

  const quick = /^quickReply\.items\[(\d+)\]\.action\.(\w+)$/.exec(property);
  if (quick && ACTION_FIELD[quick[2]]) return `第 ${Number(quick[1]) + 1} 個快速回覆的${ACTION_FIELD[quick[2]]}`;

  // 卡片訊息：每頁一個 bubble，footer.contents 依序是按鈕
  if (contentType === 'line_carousel') {
    const page = /^\/contents\/(\d+)\/(.+)$/.exec(property);
    if (page) {
      const n = Number(page[1]) + 1;
      if (page[2] === 'hero/url') return `第 ${n} 頁的圖片網址`;
      const button = /^footer\/contents\/(\d+)\/action\/(\w+)$/.exec(page[2]);
      if (button && ACTION_FIELD[button[2]]) return `第 ${n} 頁第 ${Number(button[1]) + 1} 個按鈕的${ACTION_FIELD[button[2]]}`;
    }
  }
  return null;
}

function readDetails(body: Record<string, unknown>): Detail[] {
  if (!Array.isArray(body.details)) return [];
  return body.details.flatMap((d) => {
    if (!d || typeof d !== 'object') return [];
    const item = d as Record<string, unknown>;
    if (typeof item.message !== 'string') return [];
    return [{ message: item.message, property: typeof item.property === 'string' ? item.property : undefined }];
  });
}

/**
 * @param contentType 素材版型，決定欄位名稱與是否保留原文
 * @param status      LINE 回應的 HTTP 狀態碼
 * @param body        LINE 回應的 JSON
 * @returns 錯誤說明（不含「素材格式不符合 LINE 規範：」前綴）
 */
export function formatLineValidateError(contentType: string, status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const topMessage = typeof record.message === 'string' ? record.message : undefined;
  const details = readDetails(record);

  if (details.length === 0) {
    return `LINE 驗證失敗（HTTP ${status}）${topMessage ? `：${topMessage}` : ''}`;
  }

  if (contentType.startsWith('line_flex_')) {
    const text = details.map((d) => (d.property ? `${d.property}: ${d.message}` : d.message)).join('; ');
    return [topMessage, text].filter(Boolean).join(' - ');
  }

  // 依欄位分組，保留第一次出現的順序
  const byField = new Map<string, { label: string | null; best: [string, number] | null; raw: string }>();
  for (const d of details) {
    const property = (d.property ?? '').replace(/^messages\[\d+\]\./, '');
    const translated = translateMessage(d.message);
    const entry = byField.get(property);
    if (!entry) {
      byField.set(property, { label: fieldLabel(contentType, property), best: translated, raw: d.message });
    } else if (translated && (!entry.best || translated[1] < entry.best[1])) {
      entry.best = translated;
    }
  }

  return [...byField.entries()]
    .map(([property, { label, best, raw }]) => {
      const text = best ? best[0] : raw;
      if (label && best) return `${label}${text}`;
      const name = label ?? property;
      return name ? `${name}：${text}` : text;
    })
    .join('；');
}
