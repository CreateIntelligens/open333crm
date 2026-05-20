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

export const RICH_MENU_LAYOUTS: RichMenuLayout[] = [
  // ─── 大選單（6 種）────────────────────────────────
  {
    id: 'large-1',
    category: 'large',
    label: '2 × 2（四等分）',
    description: '上下左右四格平均',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 2, y: 0, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 2, y: LARGE_H / 2, width: LARGE_W / 2, height: LARGE_H / 2 } },
    ],
  },
  {
    id: 'large-2',
    category: 'large',
    label: '上 1 + 下 2',
    description: '上方一個寬條，下方左右兩格',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 2, y: LARGE_H / 2, width: LARGE_W / 2, height: LARGE_H / 2 } },
    ],
  },
  {
    id: 'large-3',
    category: 'large',
    label: '上 2 + 下 1',
    description: '上方左右兩格，下方一個寬條',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 2, y: 0, width: LARGE_W / 2, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W, height: LARGE_H / 2 } },
    ],
  },
  {
    id: 'large-4',
    category: 'large',
    label: '上 1 + 下 3',
    description: '上方一個寬條，下方三格平均',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 3, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: (LARGE_W * 2) / 3, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
    ],
  },
  {
    id: 'large-5',
    category: 'large',
    label: '上下 2 條',
    description: '上下各一個全寬橫條',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W, height: LARGE_H / 2 } },
    ],
  },
  {
    id: 'large-6',
    category: 'large',
    label: '3 × 2（六等分）',
    description: '兩列三欄共六格',
    size: { width: LARGE_W, height: LARGE_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 3, y: 0, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: (LARGE_W * 2) / 3, y: 0, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: 0, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: LARGE_W / 3, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
      { bounds: { x: (LARGE_W * 2) / 3, y: LARGE_H / 2, width: LARGE_W / 3, height: LARGE_H / 2 } },
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
      { bounds: { x: 0, y: 0, width: COMPACT_W / 3, height: COMPACT_H } },
      { bounds: { x: COMPACT_W / 3, y: 0, width: COMPACT_W / 3, height: COMPACT_H } },
      { bounds: { x: (COMPACT_W * 2) / 3, y: 0, width: COMPACT_W / 3, height: COMPACT_H } },
    ],
  },
  {
    id: 'compact-2',
    category: 'compact',
    label: '左 1 + 右 2',
    description: '左半一格，右半上下兩格',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: COMPACT_W / 2, height: COMPACT_H } },
      { bounds: { x: COMPACT_W / 2, y: 0, width: COMPACT_W / 2, height: COMPACT_H / 2 } },
      { bounds: { x: COMPACT_W / 2, y: COMPACT_H / 2, width: COMPACT_W / 2, height: COMPACT_H / 2 } },
    ],
  },
  {
    id: 'compact-3',
    category: 'compact',
    label: '左 2 + 右 1',
    description: '左半上下兩格，右半一格',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: COMPACT_W / 2, height: COMPACT_H / 2 } },
      { bounds: { x: 0, y: COMPACT_H / 2, width: COMPACT_W / 2, height: COMPACT_H / 2 } },
      { bounds: { x: COMPACT_W / 2, y: 0, width: COMPACT_W / 2, height: COMPACT_H } },
    ],
  },
  {
    id: 'compact-4',
    category: 'compact',
    label: '全寬單格',
    description: '一整片大區塊',
    size: { width: COMPACT_W, height: COMPACT_H },
    defaultAreas: [
      { bounds: { x: 0, y: 0, width: COMPACT_W, height: COMPACT_H } },
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
