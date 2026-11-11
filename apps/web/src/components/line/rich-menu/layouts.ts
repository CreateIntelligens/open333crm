/**
 * LINE Rich Menu — 10 種官方版型定義
 *
 * 規格參考：https://developers.line.biz/en/reference/messaging-api/#create-rich-menu
 *
 * 尺寸決定：
 *   大選單：2500×1686（亦支援 1200×810，但 areas 以 2500×1686 為基準）
 *   小選單：2500×843（亦支援 1200×405）
 *
 * 每個版型的 defaultAreas 已對齊像素，使用者不能改 bounds，只能改 action。
 */

export type LayoutCategory = 'large' | 'compact';

export interface LayoutArea {
  bounds: { x: number; y: number; width: number; height: number };
}

export interface RichMenuLayout {
  id: string;
  category: LayoutCategory;
  /** 中文 label，使用者選擇時顯示 */
  label: string;
  /** 版型描述 */
  description: string;
  /** 像素尺寸（與 LINE API 一致） */
  size: { width: number; height: number };
  /** 預設區域劃分（順序對應使用者編輯時的「區域 1 / 2 / ...」） */
  defaultAreas: LayoutArea[];
}

// 大選單尺寸：2500 × 1686
const LARGE_W = 2500;
const LARGE_H = 1686;

// 小選單尺寸：2500 × 843
const COMPACT_W = 2500;
const COMPACT_H = 843;

/** 把 total 切成 parts 等分時第 i 條分隔線的位置（四捨五入成整數像素） */
function edge(total: number, parts: number, i: number): number {
  return Math.round((total * i) / parts);
}

/**
 * 格線上的一格（可跨欄／跨列）。座標一律是整數：LINE 與後端都只收整數，
 * 而且相鄰格共用同一條分隔線，所以各格寬高加總剛好等於畫布寬高。
 */
function box(
  width: number,
  height: number,
  cols: number,
  rows: number,
  col: number,
  row: number,
  colSpan = 1,
  rowSpan = 1,
): LayoutArea['bounds'] {
  const x = edge(width, cols, col);
  const y = edge(height, rows, row);
  return {
    x,
    y,
    width: edge(width, cols, col + colSpan) - x,
    height: edge(height, rows, row + rowSpan) - y,
  };
}

export const RICH_MENU_LAYOUTS: RichMenuLayout[] = [
  // ─── 大選單（6 種）────────────────────────────────
  {
    id: 'large-1',
    category: 'large',
    label: '2 × 2（四等分）',
    description: '上下左右四格平均',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 0) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 1, 0) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 1) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 1, 1) },
    ],
  },
  {
    id: 'large-2',
    category: 'large',
    label: '上 1 + 下 2',
    description: '上方一個寬條，下方左右兩格',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 0, 2, 1) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 1) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 1, 1) },
    ],
  },
  {
    id: 'large-3',
    category: 'large',
    label: '上 2 + 下 1',
    description: '上方左右兩格，下方一個寬條',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 0) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 1, 0) },
      { bounds: box(LARGE_W, LARGE_H, 2, 2, 0, 1, 2, 1) },
    ],
  },
  {
    id: 'large-4',
    category: 'large',
    label: '上 1 + 下 3',
    description: '上方一個寬條，下方三格平均',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 0, 0, 3, 1) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 0, 1) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 1, 1) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 2, 1) },
    ],
  },
  {
    id: 'large-5',
    category: 'large',
    label: '上下 2 條',
    description: '上下各一個全寬橫條',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 1, 2, 0, 0) },
      { bounds: box(LARGE_W, LARGE_H, 1, 2, 0, 1) },
    ],
  },
  {
    id: 'large-6',
    category: 'large',
    label: '3 × 2（六等分）',
    description: '兩列三欄共六格',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 0, 0) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 1, 0) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 2, 0) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 0, 1) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 1, 1) },
      { bounds: box(LARGE_W, LARGE_H, 3, 2, 2, 1) },
    ],
  },

  // ─── 小選單（4 種）────────────────────────────────
  {
    id: 'compact-1',
    category: 'compact',
    label: '3 等寬',
    description: '三格平均橫排',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: box(COMPACT_W, COMPACT_H, 3, 1, 0, 0) },
      { bounds: box(COMPACT_W, COMPACT_H, 3, 1, 1, 0) },
      { bounds: box(COMPACT_W, COMPACT_H, 3, 1, 2, 0) },
    ],
  },
  {
    id: 'compact-2',
    category: 'compact',
    label: '左 1 + 右 2',
    description: '左半一格，右半上下兩格',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 0, 0, 1, 2) },
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 1, 0) },
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 1, 1) },
    ],
  },
  {
    id: 'compact-3',
    category: 'compact',
    label: '左 2 + 右 1',
    description: '左半上下兩格，右半一格',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 0, 0) },
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 0, 1) },
      { bounds: box(COMPACT_W, COMPACT_H, 2, 2, 1, 0, 1, 2) },
    ],
  },
  {
    id: 'compact-4',
    category: 'compact',
    label: '全寬單格',
    description: '一整片大區塊',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: box(COMPACT_W, COMPACT_H, 1, 1, 0, 0) },
    ],
  },
];

/** 依 id 取得版型；找不到回 undefined */
export function getLayoutById(id: string): RichMenuLayout | undefined {
  return RICH_MENU_LAYOUTS.find((l) => l.id === id);
}

/** 取所有合法 size 組合（給後端驗證用） */
export function getAllValidSizes(): Array<{ width: number; height: number }> {
  return [
    { width: LARGE_W, height: LARGE_H },
    { width: COMPACT_W, height: COMPACT_H },
  ];
}

/** 檢查 size 是否在白名單 */
export function isValidSize(size: { width: number; height: number }): boolean {
  return getAllValidSizes().some((v) => v.width === size.width && v.height === size.height);
}
