export const LINE_FLEX_TEMPLATE_CONTENT_TYPE = 'line_flex_template';

export const FLEX_TEMPLATE_FIELD_KINDS = [
  'text',
  'image_url',
  'uri',
  'postback_data',
  'color',
  'number',
  'alt_text',
] as const;

export const FLEX_TEMPLATE_COMPONENT_KINDS = [
  'text',
  'image',
  'button',
  'box',
  'spacer',
  'separator',
  'bubble',
] as const;

export type FlexTemplateFieldKind = (typeof FLEX_TEMPLATE_FIELD_KINDS)[number];
export type FlexTemplateComponentKind = (typeof FLEX_TEMPLATE_COMPONENT_KINDS)[number];

export interface FlexTemplateFieldConstraints {
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  min?: number;
  max?: number;
}

export interface FlexTemplateField {
  key: string;
  label: string;
  path: string;
  kind: FlexTemplateFieldKind;
  defaultValue?: string;
  required: boolean;
  constraints?: FlexTemplateFieldConstraints;
  sampleValue?: string;
  invalid?: boolean;
}

export interface FlexEditableContainer {
  path: string;
  label: string;
  allowedChildren: FlexTemplateComponentKind[];
  maxChildren?: number;
}

export interface LineFlexTemplateBody {
  altText: string;
  contents: Record<string, unknown>;
  fields: FlexTemplateField[];
  editableContainers: FlexEditableContainer[];
  source?: {
    importedAt: string;
    format: 'message' | 'contents';
    hash: string;
  };
  quickReplies?: unknown;
}

export interface LineFlexMessageBody {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
  quickReplies?: unknown;
}

export interface NormalizeLineFlexTemplateOptions {
  altText?: string;
  importedAt?: string;
}

export interface LineFlexValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; path?: string }>;
}

export class LineFlexTemplateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'LineFlexTemplateError';
  }
}

const MAX_FLEX_TEMPLATE_JSON_LENGTH = 120_000;
const FIELD_KEY_RE = /^[a-zA-Z0-9_.]+$/;
const BOX_CHILDREN: FlexTemplateComponentKind[] = [
  'text',
  'image',
  'button',
  'box',
  'spacer',
  'separator',
];
const CAROUSEL_CHILDREN: FlexTemplateComponentKind[] = ['bubble'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function hashJson(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function encodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function getJsonPointer(value: unknown, path: string): unknown {
  if (path === '') return value;
  if (!path.startsWith('/')) return undefined;
  const parts = path.split('/').slice(1).map(decodeJsonPointerSegment);
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function hasJsonPointer(value: unknown, path: string): boolean {
  return getJsonPointer(value, path) !== undefined;
}

export function setJsonPointer<T>(value: T, path: string, nextValue: unknown): T {
  if (path === '') return nextValue as T;
  if (!path.startsWith('/')) {
    throw new LineFlexTemplateError('INVALID_JSON_POINTER', `Invalid JSON Pointer: ${path}`, path);
  }

  const next = clone(value);
  const parts = path.split('/').slice(1).map(decodeJsonPointerSegment);
  let current: unknown = next;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new LineFlexTemplateError('INVALID_JSON_POINTER', `Path not found: ${path}`, path);
      }
      current = current[index];
    } else if (isRecord(current) && part in current) {
      current = current[part];
    } else {
      throw new LineFlexTemplateError('INVALID_JSON_POINTER', `Path not found: ${path}`, path);
    }
  }

  const last = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= current.length) {
      throw new LineFlexTemplateError('INVALID_JSON_POINTER', `Path not found: ${path}`, path);
    }
    current[index] = nextValue;
    return next;
  }
  if (!isRecord(current) || !(last in current)) {
    throw new LineFlexTemplateError('INVALID_JSON_POINTER', `Path not found: ${path}`, path);
  }
  current[last] = nextValue;
  return next;
}

export function normalizeLineFlexTemplateBody(
  input: unknown,
  options: NormalizeLineFlexTemplateOptions = {},
): LineFlexTemplateBody {
  if (!isRecord(input)) {
    throw new LineFlexTemplateError('INVALID_LINE_FLEX_PAYLOAD', 'LINE Flex payload must be an object');
  }
  if (jsonLength(input) > MAX_FLEX_TEMPLATE_JSON_LENGTH) {
    throw new LineFlexTemplateError('LINE_FLEX_PAYLOAD_TOO_LARGE', 'LINE Flex payload is too large');
  }

  const isMessagePayload = input.type === 'flex' && isRecord(input.contents);
  const contents = isMessagePayload ? input.contents : input;
  if (!isRecord(contents) || (contents.type !== 'bubble' && contents.type !== 'carousel')) {
    throw new LineFlexTemplateError(
      'INVALID_LINE_FLEX_PAYLOAD',
      'LINE Flex contents root must be bubble or carousel',
      '/contents',
    );
  }

  const altText =
    options.altText ??
    (typeof input.altText === 'string' ? input.altText : undefined) ??
    'Flex Message';

  const normalizedContents = clone(contents);
  return {
    altText,
    contents: normalizedContents,
    fields: [],
    editableContainers: extractEditableContainers(normalizedContents),
    source: {
      importedAt: options.importedAt ?? new Date().toISOString(),
      format: isMessagePayload ? 'message' : 'contents',
      hash: hashJson(input),
    },
  };
}

export function normalizeLineFlexMessageBody(
  input: unknown,
  options: NormalizeLineFlexTemplateOptions = {},
): LineFlexMessageBody {
  if (!isRecord(input)) {
    throw new LineFlexTemplateError('INVALID_LINE_FLEX_PAYLOAD', 'LINE Flex payload must be an object');
  }
  if (jsonLength(input) > MAX_FLEX_TEMPLATE_JSON_LENGTH) {
    throw new LineFlexTemplateError('LINE_FLEX_PAYLOAD_TOO_LARGE', 'LINE Flex payload is too large');
  }

  const isFlexMessage = input.type === 'flex' && isRecord(input.contents);
  const isLegacyNormalized = input.type !== 'flex' && isRecord(input.contents) && typeof input.altText === 'string';
  const contents = isFlexMessage || isLegacyNormalized ? input.contents : input;
  if (!isRecord(contents) || (contents.type !== 'bubble' && contents.type !== 'carousel')) {
    throw new LineFlexTemplateError(
      'INVALID_LINE_FLEX_PAYLOAD',
      'LINE Flex contents root must be bubble or carousel',
      '/contents',
    );
  }

  const altText =
    options.altText ??
    (typeof input.altText === 'string' ? input.altText : undefined) ??
    'Flex Message';

  return {
    type: 'flex',
    altText,
    contents: clone(contents),
    ...(Array.isArray(input.quickReplies) ? { quickReplies: clone(input.quickReplies) } : {}),
  };
}

export function validateLineFlexMessageBody(body: unknown): LineFlexValidationResult {
  const errors: LineFlexValidationResult['errors'] = [];
  if (!isRecord(body)) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_LINE_FLEX_BODY', message: 'Line Flex message body must be an object' }],
    };
  }

  if (body.type !== 'flex') {
    errors.push({ code: 'INVALID_LINE_FLEX_PAYLOAD', message: 'type must be flex', path: '/type' });
  }
  if (typeof body.altText !== 'string' || body.altText.trim() === '') {
    errors.push({ code: 'INVALID_ALT_TEXT', message: 'altText is required', path: '/altText' });
  }
  if (!isRecord(body.contents) || (body.contents.type !== 'bubble' && body.contents.type !== 'carousel')) {
    errors.push({
      code: 'INVALID_LINE_FLEX_PAYLOAD',
      message: 'contents root must be bubble or carousel',
      path: '/contents',
    });
  }
  if (jsonLength(body) > MAX_FLEX_TEMPLATE_JSON_LENGTH) {
    errors.push({ code: 'LINE_FLEX_PAYLOAD_TOO_LARGE', message: 'Line Flex message body is too large' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateLineFlexTemplateBody(body: unknown): LineFlexValidationResult {
  const errors: LineFlexValidationResult['errors'] = [];
  if (!isRecord(body)) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_LINE_FLEX_BODY', message: 'Line Flex template body must be an object' }],
    };
  }

  if (typeof body.altText !== 'string' || body.altText.trim() === '') {
    errors.push({ code: 'INVALID_ALT_TEXT', message: 'altText is required', path: '/altText' });
  }
  if (!isRecord(body.contents) || (body.contents.type !== 'bubble' && body.contents.type !== 'carousel')) {
    errors.push({
      code: 'INVALID_LINE_FLEX_PAYLOAD',
      message: 'contents root must be bubble or carousel',
      path: '/contents',
    });
  }
  if (jsonLength(body) > MAX_FLEX_TEMPLATE_JSON_LENGTH) {
    errors.push({ code: 'LINE_FLEX_PAYLOAD_TOO_LARGE', message: 'Line Flex template body is too large' });
  }

  const fields = Array.isArray(body.fields) ? (body.fields as FlexTemplateField[]) : [];
  const keys = new Set<string>();
  for (const field of fields) {
    const result = validateTemplateField(body as unknown as LineFlexTemplateBody, field, keys);
    errors.push(...result.errors);
    if (field.key) keys.add(field.key);
  }

  const containers = Array.isArray(body.editableContainers)
    ? (body.editableContainers as FlexEditableContainer[])
    : [];
  const computedContainers = new Map(
    extractEditableContainers(body.contents).map((container) => [container.path, container]),
  );
  for (const container of containers) {
    const computed = computedContainers.get(container.path);
    if (!computed) {
      errors.push({
        code: 'INVALID_EDITABLE_CONTAINER_PATH',
        message: `Editable container path is not available: ${container.path}`,
        path: container.path,
      });
      continue;
    }
    const disallowed = container.allowedChildren.filter(
      (kind) => !computed.allowedChildren.includes(kind),
    );
    if (disallowed.length > 0) {
      errors.push({
        code: 'DISALLOWED_FLEX_TREE_INSERTION',
        message: `Container ${container.path} does not allow ${disallowed.join(', ')}`,
        path: container.path,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateTemplateField(
  body: LineFlexTemplateBody,
  field: FlexTemplateField,
  seenKeys: Set<string>,
): LineFlexValidationResult {
  const errors: LineFlexValidationResult['errors'] = [];
  if (!field.key || !FIELD_KEY_RE.test(field.key)) {
    errors.push({
      code: 'INVALID_TEMPLATE_FIELD_KEY',
      message: `Invalid field key: ${field.key}`,
      path: field.path,
    });
  }
  if (seenKeys.has(field.key)) {
    errors.push({
      code: 'DUPLICATE_TEMPLATE_FIELD',
      message: `Duplicate field key: ${field.key}`,
      path: field.path,
    });
  }
  if (!FLEX_TEMPLATE_FIELD_KINDS.includes(field.kind)) {
    errors.push({
      code: 'INVALID_TEMPLATE_FIELD_KIND',
      message: `Unsupported field kind: ${field.kind}`,
      path: field.path,
    });
  }
  if (!isSupportedFieldPath(body, field.path, field.kind)) {
    errors.push({
      code: 'INVALID_TEMPLATE_FIELD_PATH',
      message: `Unsupported field path: ${field.path}`,
      path: field.path,
    });
  }
  return { valid: errors.length === 0, errors };
}

export function isSupportedFieldPath(
  body: LineFlexTemplateBody,
  path: string,
  kind: FlexTemplateFieldKind,
): boolean {
  if (kind === 'alt_text') return path === '/altText';
  const value = getJsonPointer(body.contents, path);
  if (value === undefined || isRecord(value) || Array.isArray(value)) return false;
  if (kind === 'number') return typeof value === 'number' || typeof value === 'string';
  return typeof value === 'string';
}

export function createFieldHole(
  body: LineFlexTemplateBody,
  field: FlexTemplateField,
): LineFlexTemplateBody {
  const next: LineFlexTemplateBody = {
    ...clone(body),
    fields: [...(body.fields ?? [])],
  };

  const validation = validateTemplateField(next, field, new Set(next.fields.map((item) => item.key)));
  if (!validation.valid) {
    const first = validation.errors[0];
    throw new LineFlexTemplateError(first.code, first.message, first.path);
  }

  const placeholder = `{{${field.key}}}`;
  if (field.kind === 'alt_text') {
    next.altText = placeholder;
  } else {
    next.contents = setJsonPointer(next.contents, field.path, placeholder);
  }
  next.fields.push({ ...field });
  next.editableContainers = extractEditableContainers(next.contents);
  return next;
}

export function extractEditableContainers(contents: unknown): FlexEditableContainer[] {
  const containers: FlexEditableContainer[] = [];
  walkContainers(contents, '', '', containers);
  return containers;
}

function walkContainers(
  node: unknown,
  path: string,
  parentLabel: string,
  containers: FlexEditableContainer[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      walkContainers(item, `${path}/${index}`, parentLabel, containers),
    );
    return;
  }
  if (!isRecord(node)) return;

  const type = typeof node.type === 'string' ? node.type : undefined;
  if (type === 'box' && Array.isArray(node.contents)) {
    const layout = typeof node.layout === 'string' ? node.layout : '';
    const label = parentLabel ? `${parentLabel} / box (${layout})` : `box (${layout})`;
    containers.push({
      path: `${path}/contents`,
      label,
      allowedChildren: BOX_CHILDREN,
      maxChildren: 20,
    });
  }
  if (type === 'carousel' && Array.isArray(node.contents)) {
    containers.push({
      path: `${path}/contents`,
      label: parentLabel ? `${parentLabel} / carousel` : 'carousel',
      allowedChildren: CAROUSEL_CHILDREN,
      maxChildren: 12,
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'action') continue;
    const childLabel = type ? `${parentLabel ? `${parentLabel} / ` : ''}${type}` : parentLabel;
    walkContainers(value, `${path}/${encodeJsonPointerSegment(key)}`, childLabel, containers);
  }
}

export function insertFlexComponent(
  body: LineFlexTemplateBody,
  containerPath: string,
  kind: FlexTemplateComponentKind,
): LineFlexTemplateBody {
  const containers = extractEditableContainers(body.contents);
  const container = containers.find((item) => item.path === containerPath);
  if (!container || !container.allowedChildren.includes(kind)) {
    throw new LineFlexTemplateError(
      'DISALLOWED_FLEX_TREE_INSERTION',
      `Cannot insert ${kind} at ${containerPath}`,
      containerPath,
    );
  }

  const current = getJsonPointer(body.contents, containerPath);
  if (!Array.isArray(current)) {
    throw new LineFlexTemplateError(
      'INVALID_EDITABLE_CONTAINER_PATH',
      `Editable container is not an array: ${containerPath}`,
      containerPath,
    );
  }
  if (container.maxChildren && current.length >= container.maxChildren) {
    throw new LineFlexTemplateError(
      'FLEX_CONTAINER_LIMIT_EXCEEDED',
      `Container ${containerPath} already has the maximum number of children`,
      containerPath,
    );
  }

  const contents = setJsonPointer(body.contents, containerPath, [
    ...current,
    defaultFlexComponent(kind),
  ]);
  return recomputeFlexTemplateMetadata({ ...clone(body), contents });
}

export function recomputeFlexTemplateMetadata(body: LineFlexTemplateBody): LineFlexTemplateBody {
  const next = clone(body);
  next.editableContainers = extractEditableContainers(next.contents);
  next.fields = (next.fields ?? []).map((field) => ({
    ...field,
    invalid: !isSupportedFieldPath(next, field.path, field.kind),
  }));
  return next;
}

export function validateRequiredFlexTemplateValues(
  body: LineFlexTemplateBody,
  values: Record<string, string | undefined>,
): string[] {
  return (body.fields ?? [])
    .filter((field) => field.required)
    .filter((field) => {
      const provided = values[field.key];
      return (provided === undefined || provided === '') && !field.defaultValue;
    })
    .map((field) => field.key);
}

export function buildFlexTemplateVariableMap(
  body: LineFlexTemplateBody,
  values: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of body.fields ?? []) {
    if (field.defaultValue !== undefined) result[field.key] = field.defaultValue;
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

export function renderLineFlexTemplateBody(
  body: LineFlexTemplateBody,
  values: Record<string, string | undefined> = {},
): LineFlexTemplateBody {
  const missing = validateRequiredFlexTemplateValues(body, values);
  if (missing.length > 0) {
    throw new LineFlexTemplateError(
      'MISSING_TEMPLATE_FIELD_VALUE',
      `Missing required template field values: ${missing.join(', ')}`,
    );
  }
  return renderPlaceholders(body, buildFlexTemplateVariableMap(body, values));
}

function renderPlaceholders<T>(value: T, variables: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, key: string) =>
      variables[key] !== undefined ? variables[key] : match,
    ) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderPlaceholders(item, variables)) as unknown as T;
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = renderPlaceholders(item, variables);
    }
    return result as T;
  }
  return value;
}

export function flexTemplateFieldToMaterialVariable(field: FlexTemplateField) {
  return {
    key: field.key,
    label: field.label,
    defaultValue: field.defaultValue,
    required: field.required,
  };
}

export function defaultFlexComponent(kind: FlexTemplateComponentKind): Record<string, unknown> {
  switch (kind) {
    case 'text':
      return { type: 'text', text: '新文字', wrap: true };
    case 'image':
      return {
        type: 'image',
        url: 'https://placehold.co/600x400.png',
        size: 'full',
        aspectRatio: '20:13',
        aspectMode: 'cover',
      };
    case 'button':
      return {
        type: 'button',
        style: 'link',
        height: 'sm',
        action: { type: 'uri', label: '按鈕', uri: 'https://example.com' },
      };
    case 'box':
      return { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '新區塊' }] };
    case 'spacer':
      return { type: 'spacer', size: 'md' };
    case 'separator':
      return { type: 'separator', margin: 'md' };
    case 'bubble':
      return {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: '新頁面', weight: 'bold', size: 'lg', wrap: true }],
        },
      };
  }
}
