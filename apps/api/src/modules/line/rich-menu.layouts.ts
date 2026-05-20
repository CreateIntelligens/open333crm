/**
 * Backend 端的版型驗證 helper
 *
 * 與 apps/web/src/components/line/rich-menu/layouts.ts 對齊。
 * 後端只需驗證 size 是否合法，不需要完整 defaultAreas 資訊。
 */

const VALID_SIZES = [
  { width: 2500, height: 1686 }, // 大選單
  { width: 2500, height: 843 },  // 小選單
];

export function isValidRichMenuSize(size: unknown): boolean {
  if (!size || typeof size !== 'object') return false;
  const s = size as Record<string, unknown>;
  if (typeof s.width !== 'number' || typeof s.height !== 'number') return false;
  return VALID_SIZES.some((v) => v.width === s.width && v.height === s.height);
}

export const VALID_RICH_MENU_SIZES = VALID_SIZES;
