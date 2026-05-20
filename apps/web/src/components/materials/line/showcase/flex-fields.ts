/**
 * Flex JSON 欄位掃描器 / 修改器
 *
 * 把任意 Flex JSON（bubble / carousel）拆解成「可編輯欄位」列表：
 *   - text 元件的 text 屬性
 *   - image 元件的 url 屬性
 *   - icon 元件的 url 屬性
 *   - button 內 action.label / action.uri / action.text / action.data
 *
 * 每個欄位用 JSON Pointer 路徑（如 "/body/contents/0/text"）定位，
 * 提供 getValue / setValue / addItem / removeItem 操作給編輯器用。
 */

export type FlexFieldKind = 'text' | 'image' | 'icon' | 'button_label' | 'button_uri' | 'button_text' | 'button_data';

export interface FlexField {
  /** JSON Pointer 路徑，如 "/body/contents/0/text" */
  path: string;
  kind: FlexFieldKind;
  /** 父元件可讀標籤，如 "body / 第 1 個 text" */
  label: string;
  /** 當下值 */
  value: string;
}

export interface FlexContainer {
  /** 容器路徑，如 "/body/contents" 或 "/footer/contents"，可在此 path 下新增 / 刪除子元件 */
  path: string;
  label: string;
  /** 目前子元件數量 */
  length: number;
}

// ─── JSON Pointer 工具 ────────────────────────────────────

function get(obj: unknown, path: string): unknown {
  if (path === '') return obj;
  const parts = path.split('/').slice(1).map(decodeJsonPointerSegment);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

function setPath<T>(obj: T, path: string, value: unknown): T {
  if (path === '') return value as T;
  const next = clone(obj);
  const parts = path.split('/').slice(1).map(decodeJsonPointerSegment);
  let cur: unknown = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (Array.isArray(cur)) cur = (cur as unknown[])[Number(part)];
    else cur = (cur as Record<string, unknown>)[part];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) (cur as unknown[])[Number(last)] = value;
  else (cur as Record<string, unknown>)[last] = value;
  return next;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function decodeJsonPointerSegment(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~');
}

// ─── 掃出所有欄位 ─────────────────────────────────────────

export function extractFields(json: unknown): FlexField[] {
  const fields: FlexField[] = [];
  walk(json, '', '', fields);
  return fields;
}

function walk(node: unknown, path: string, parentLabel: string, fields: FlexField[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => walk(item, `${path}/${idx}`, parentLabel, fields));
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj.type as string | undefined;

  if (type === 'text') {
    fields.push({
      path: `${path}/text`,
      kind: 'text',
      label: contextLabel(parentLabel, 'text'),
      value: (obj.text as string) ?? '',
    });
  }
  if (type === 'image') {
    fields.push({
      path: `${path}/url`,
      kind: 'image',
      label: contextLabel(parentLabel, 'image'),
      value: (obj.url as string) ?? '',
    });
  }
  if (type === 'icon') {
    fields.push({
      path: `${path}/url`,
      kind: 'icon',
      label: contextLabel(parentLabel, 'icon'),
      value: (obj.url as string) ?? '',
    });
  }
  if (type === 'button' && obj.action && typeof obj.action === 'object') {
    const action = obj.action as Record<string, unknown>;
    const actionType = action.type as string;
    if (action.label !== undefined) {
      fields.push({
        path: `${path}/action/label`,
        kind: 'button_label',
        label: contextLabel(parentLabel, 'button 標籤'),
        value: (action.label as string) ?? '',
      });
    }
    if (actionType === 'uri' && action.uri !== undefined) {
      fields.push({
        path: `${path}/action/uri`,
        kind: 'button_uri',
        label: contextLabel(parentLabel, 'button URL'),
        value: (action.uri as string) ?? '',
      });
    }
    if (actionType === 'message' && action.text !== undefined) {
      fields.push({
        path: `${path}/action/text`,
        kind: 'button_text',
        label: contextLabel(parentLabel, 'button 訊息文字'),
        value: (action.text as string) ?? '',
      });
    }
    if (actionType === 'postback' && action.data !== undefined) {
      fields.push({
        path: `${path}/action/data`,
        kind: 'button_data',
        label: contextLabel(parentLabel, 'button postback data'),
        value: (action.data as string) ?? '',
      });
    }
  }

  // 遞迴展開子節點
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'text' || k === 'url' || k === 'action') continue;
    const childLabel = type ? `${parentLabel ? parentLabel + ' / ' : ''}${type}` : parentLabel;
    walk(v, `${path}/${k}`, childLabel, fields);
  }
}

function contextLabel(parent: string, kind: string): string {
  return parent ? `${parent} / ${kind}` : kind;
}

// ─── 掃出可新增 / 刪除子元件的容器 ─────────────────────

/**
 * 找出 JSON 中所有 box 的 contents 陣列（這是 LINE Flex 唯一可動態加減元件的地方）。
 */
export function extractContainers(json: unknown): FlexContainer[] {
  const containers: FlexContainer[] = [];
  walkContainers(json, '', '', containers);
  return containers;
}

function walkContainers(node: unknown, path: string, parentLabel: string, containers: FlexContainer[]): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((item, idx) => walkContainers(item, `${path}/${idx}`, parentLabel, containers));
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj.type as string | undefined;

  if (type === 'box' && Array.isArray(obj.contents)) {
    const layout = (obj.layout as string) ?? '';
    const label = parentLabel ? `${parentLabel} / box (${layout})` : `box (${layout})`;
    containers.push({
      path: `${path}/contents`,
      label,
      length: (obj.contents as unknown[]).length,
    });
  }
  if (type === 'carousel' && Array.isArray(obj.contents)) {
    containers.push({
      path: `${path}/contents`,
      label: parentLabel ? `${parentLabel} / carousel` : 'carousel',
      length: (obj.contents as unknown[]).length,
    });
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'action') continue;
    const childLabel = type ? `${parentLabel ? parentLabel + ' / ' : ''}${type}` : parentLabel;
    walkContainers(v, `${path}/${k}`, childLabel, containers);
  }
}

// ─── 修改／新增／刪除 ───────────────────────────────────

export function updateField<T>(json: T, path: string, value: string): T {
  return setPath(json, path, value);
}

export function getFieldValue(json: unknown, path: string): string {
  const v = get(json, path);
  return typeof v === 'string' ? v : '';
}

/**
 * 在容器路徑（如 "/body/contents"）末尾新增一個預設元件
 */
export function addItemToContainer<T>(json: T, containerPath: string, kind: 'text' | 'image' | 'button'): T {
  const items = get(json, containerPath);
  if (!Array.isArray(items)) return json;
  const newItem = defaultItem(kind);
  return setPath(json, containerPath, [...items, newItem]);
}

/**
 * 從容器移除第 idx 個元件
 */
export function removeItemFromContainer<T>(json: T, containerPath: string, idx: number): T {
  const items = get(json, containerPath);
  if (!Array.isArray(items)) return json;
  return setPath(json, containerPath, items.filter((_, i) => i !== idx));
}

function defaultItem(kind: 'text' | 'image' | 'button'): Record<string, unknown> {
  if (kind === 'text') return { type: 'text', text: '新文字', wrap: true };
  if (kind === 'image') return { type: 'image', url: 'https://placehold.co/600x400.png', size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
  return { type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '按鈕', uri: 'https://example.com' } };
}
