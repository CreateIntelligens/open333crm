/**
 * 遮蔽佇列監控顯示的 job 資料（change queue-monitoring，design 決策 6）。
 *
 * job 資料可能含客人的訊息與聯絡方式，所以只保留識別欄位：最上層的 name、type，
 * 以及任一層名稱為 id 或以 Id 結尾、值是字串或數字的欄位。其他值換成 MASKED，
 * 之後新增的欄位也一樣。物件與陣列遞迴處理。
 */
export const MASKED = '[已遮蔽]';

const TOP_LEVEL_IDENTIFIERS = new Set(['name', 'type']);

function isIdentifierKey(key: string): boolean {
  return key === 'id' || key.endsWith('Id');
}

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value !== null && typeof value === 'object') return maskObject(value as Record<string, unknown>, false);
  return MASKED;
}

function maskObject(data: Record<string, unknown>, topLevel: boolean): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const identifier = isIdentifierKey(key) || (topLevel && TOP_LEVEL_IDENTIFIERS.has(key));
    // 以 defineProperty 寫入：名稱為 __proto__ 的欄位以指派寫入時，會改掉 masked 的原型，不會成為欄位
    Object.defineProperty(masked, key, {
      value: identifier && (typeof value === 'string' || typeof value === 'number') ? value : maskValue(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return masked;
}

export function maskJobData(data: unknown): unknown {
  if (data === undefined) return undefined;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return maskObject(data as Record<string, unknown>, true);
  }
  return maskValue(data);
}
