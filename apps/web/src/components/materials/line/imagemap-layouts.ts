/**
 * LINE 圖文訊息（Imagemap）28 種預設版型 + 自訂
 *
 * 對齊 LINE OA 後台「圖文訊息 > 選擇版型」dialog：
 *   正方形 1040×1040（12 種）
 *   橫長 1040×350 / 1040×700 / 1040×585（7 種）
 *   縱長 1040×1300 / 1040×1850（8 種）
 *   自訂 1040×520-2080（1 種）
 *
 * 每個版型有固定的「預設區域座標」(defaultAreas)，使用者選版型後 areas 會被初始化。
 * 自訂版型 (custom_*) 初始為 1 區覆蓋整圖，使用者可用 cropper 自己加區域。
 */

export type LayoutCategory = '正方形' | '橫長' | '縱長' | '自訂';

export interface ImagemapArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagemapLayout {
  id: string;
  category: LayoutCategory;
  width: number;          // 固定 1040
  height: number;
  /** 縮圖用 CSS grid-template，畫小縮圖時使用 */
  thumbGrid: { rows: number; cols: number; areas: string };
  defaultAreas: ImagemapArea[];
}

// 工具：產生「grid-template-areas」字串
function grid(rows: number, cols: number, cells: string[]): { rows: number; cols: number; areas: string } {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = cells.slice(r * cols, (r + 1) * cols).map((c) => `"${c}"`).join(' ');
    lines.push(row);
  }
  return { rows, cols, areas: lines.join(' ') };
}

// ─── 正方形 1040×1040（12 種）────────────────────────

const SQUARE_LAYOUTS: ImagemapLayout[] = [
  // 1 整塊
  {
    id: 'sq_1',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 1040 }],
  },
  // 左右對切（2 格）
  {
    id: 'sq_2_v',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(1, 2, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 1040 },
      { x: 520, y: 0, width: 520, height: 1040 },
    ],
  },
  // 上下對切（2 格）
  {
    id: 'sq_2_h',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 1, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 520 },
      { x: 0, y: 520, width: 1040, height: 520 },
    ],
  },
  // 上下三等分（3 格）
  {
    id: 'sq_3_h',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(3, 1, ['a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 347 },
      { x: 0, y: 347, width: 1040, height: 347 },
      { x: 0, y: 694, width: 1040, height: 346 },
    ],
  },
  // 田字 4 格
  {
    id: 'sq_4grid',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'b', 'c', 'd']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 520 },
      { x: 520, y: 0, width: 520, height: 520 },
      { x: 0, y: 520, width: 520, height: 520 },
      { x: 520, y: 520, width: 520, height: 520 },
    ],
  },
  // 上 1 下 2（3 格）
  {
    id: 'sq_1_2',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 520 },
      { x: 0, y: 520, width: 520, height: 520 },
      { x: 520, y: 520, width: 520, height: 520 },
    ],
  },
  // 上 2 下 1（3 格）
  {
    id: 'sq_2_1',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'b', 'c', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 520 },
      { x: 520, y: 0, width: 520, height: 520 },
      { x: 0, y: 520, width: 1040, height: 520 },
    ],
  },
  // 左 1 右 3 直（4 格）
  {
    id: 'sq_1_3',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(3, 2, ['a', 'b', 'a', 'c', 'a', 'd']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 1040 },
      { x: 520, y: 0, width: 520, height: 347 },
      { x: 520, y: 347, width: 520, height: 347 },
      { x: 520, y: 694, width: 520, height: 346 },
    ],
  },
  // 大左 + 上下右（3 格）
  {
    id: 'sq_big_left',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'b', 'a', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 1040 },
      { x: 520, y: 0, width: 520, height: 520 },
      { x: 520, y: 520, width: 520, height: 520 },
    ],
  },
  // 上 1 + 下左 1 下右 1（3 格）
  {
    id: 'sq_top_2bot',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 520 },
      { x: 0, y: 520, width: 520, height: 520 },
      { x: 520, y: 520, width: 520, height: 520 },
    ],
  },
  // 大右 + 上下左（3 格）— 鏡像版
  {
    id: 'sq_big_right',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(2, 2, ['a', 'c', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 520 },
      { x: 0, y: 520, width: 520, height: 520 },
      { x: 520, y: 0, width: 520, height: 1040 },
    ],
  },
  // 田字 + 上 1（5 格）
  {
    id: 'sq_top1_4grid',
    category: '正方形',
    width: 1040,
    height: 1040,
    thumbGrid: grid(3, 2, ['a', 'a', 'b', 'c', 'd', 'e']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 347 },
      { x: 0, y: 347, width: 520, height: 347 },
      { x: 520, y: 347, width: 520, height: 347 },
      { x: 0, y: 694, width: 520, height: 346 },
      { x: 520, y: 694, width: 520, height: 346 },
    ],
  },
];

// ─── 橫長 1040×350 / 1040×700 / 1040×585（共 7 種）─────────

const LANDSCAPE_LAYOUTS: ImagemapLayout[] = [
  // 1040×350 — 1 整塊
  {
    id: 'lo_350_1',
    category: '橫長',
    width: 1040,
    height: 350,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 350 }],
  },
  // 1040×700 — 1 整塊
  {
    id: 'lo_700_1',
    category: '橫長',
    width: 1040,
    height: 700,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 700 }],
  },
  // 1040×700 — 左右對切
  {
    id: 'lo_700_2v',
    category: '橫長',
    width: 1040,
    height: 700,
    thumbGrid: grid(1, 2, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 700 },
      { x: 520, y: 0, width: 520, height: 700 },
    ],
  },
  // 1040×585 — 1 整塊
  {
    id: 'lo_585_1',
    category: '橫長',
    width: 1040,
    height: 585,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 585 }],
  },
  // 1040×585 — 左右對切（3 種變化）
  {
    id: 'lo_585_2v_a',
    category: '橫長',
    width: 1040,
    height: 585,
    thumbGrid: grid(1, 2, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 585 },
      { x: 520, y: 0, width: 520, height: 585 },
    ],
  },
  {
    id: 'lo_585_2v_b',
    category: '橫長',
    width: 1040,
    height: 585,
    thumbGrid: grid(1, 2, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 693, height: 585 },
      { x: 693, y: 0, width: 347, height: 585 },
    ],
  },
  {
    id: 'lo_585_2v_c',
    category: '橫長',
    width: 1040,
    height: 585,
    thumbGrid: grid(1, 2, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 347, height: 585 },
      { x: 347, y: 0, width: 693, height: 585 },
    ],
  },
];

// ─── 縱長 1040×1300 / 1040×1850（共 8 種）────────────────

const PORTRAIT_LAYOUTS: ImagemapLayout[] = [
  // 1040×1300 — 1 整塊
  {
    id: 'po_1300_1',
    category: '縱長',
    width: 1040,
    height: 1300,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 1300 }],
  },
  // 1040×1300 — 上下對切
  {
    id: 'po_1300_2h',
    category: '縱長',
    width: 1040,
    height: 1300,
    thumbGrid: grid(2, 1, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 650 },
      { x: 0, y: 650, width: 1040, height: 650 },
    ],
  },
  // 1040×1300 — 上 1 下 2
  {
    id: 'po_1300_1_2',
    category: '縱長',
    width: 1040,
    height: 1300,
    thumbGrid: grid(2, 2, ['a', 'a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 650 },
      { x: 0, y: 650, width: 520, height: 650 },
      { x: 520, y: 650, width: 520, height: 650 },
    ],
  },
  // 1040×1300 — 上下三等分
  {
    id: 'po_1300_3h',
    category: '縱長',
    width: 1040,
    height: 1300,
    thumbGrid: grid(3, 1, ['a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 433 },
      { x: 0, y: 433, width: 1040, height: 433 },
      { x: 0, y: 866, width: 1040, height: 434 },
    ],
  },
  // 1040×1850 — 1 整塊
  {
    id: 'po_1850_1',
    category: '縱長',
    width: 1040,
    height: 1850,
    thumbGrid: grid(1, 1, ['a']),
    defaultAreas: [{ x: 0, y: 0, width: 1040, height: 1850 }],
  },
  // 1040×1850 — 上下對切
  {
    id: 'po_1850_2h',
    category: '縱長',
    width: 1040,
    height: 1850,
    thumbGrid: grid(2, 1, ['a', 'b']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 925 },
      { x: 0, y: 925, width: 1040, height: 925 },
    ],
  },
  // 1040×1850 — 上 1 中 1 下 1
  {
    id: 'po_1850_3h',
    category: '縱長',
    width: 1040,
    height: 1850,
    thumbGrid: grid(3, 1, ['a', 'b', 'c']),
    defaultAreas: [
      { x: 0, y: 0, width: 1040, height: 617 },
      { x: 0, y: 617, width: 1040, height: 617 },
      { x: 0, y: 1234, width: 1040, height: 616 },
    ],
  },
  // 1040×1850 — 田字 4 格
  {
    id: 'po_1850_4grid',
    category: '縱長',
    width: 1040,
    height: 1850,
    thumbGrid: grid(2, 2, ['a', 'b', 'c', 'd']),
    defaultAreas: [
      { x: 0, y: 0, width: 520, height: 925 },
      { x: 520, y: 0, width: 520, height: 925 },
      { x: 0, y: 925, width: 520, height: 925 },
      { x: 520, y: 925, width: 520, height: 925 },
    ],
  },
];

// ─── 自訂 1040×520-2080 ─────────────────────────────────

const CUSTOM_LAYOUT: ImagemapLayout = {
  id: 'custom',
  category: '自訂',
  width: 1040,
  height: 1040, // 預設 1040，使用者上傳圖片後依實際 height 重設（520-2080）
  thumbGrid: grid(1, 1, ['a']),
  defaultAreas: [{ x: 0, y: 0, width: 1040, height: 1040 }],
};

// ─── 匯出 ─────────────────────────────────────────────

export const IMAGEMAP_LAYOUTS: ImagemapLayout[] = [
  ...SQUARE_LAYOUTS,
  ...LANDSCAPE_LAYOUTS,
  ...PORTRAIT_LAYOUTS,
  CUSTOM_LAYOUT,
];

export function getLayoutById(id: string): ImagemapLayout | undefined {
  return IMAGEMAP_LAYOUTS.find((l) => l.id === id);
}

export function getLayoutsByCategory(category: LayoutCategory): ImagemapLayout[] {
  return IMAGEMAP_LAYOUTS.filter((l) => l.category === category);
}

/** 群組依高度（用於 dialog 顯示） */
export function groupLayoutsByHeight(category: LayoutCategory): Map<number, ImagemapLayout[]> {
  const map = new Map<number, ImagemapLayout[]>();
  for (const l of getLayoutsByCategory(category)) {
    const arr = map.get(l.height) ?? [];
    arr.push(l);
    map.set(l.height, arr);
  }
  return map;
}
