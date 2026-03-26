/**
 * Button Action Parser for LINE / FB plugins (Task 2.3)
 * Parses interactive button payloads and maps them to CanvasButtonAction types.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type CanvasButtonActionType =
  | 'add_tag'
  | 'trigger_node'
  | 'open_url'
  | 'reply_text'
  | 'unknown';

export interface CanvasButtonAction {
  type: CanvasButtonActionType;
  tagId?: string;         // for add_tag
  nodeId?: string;        // for trigger_node
  url?: string;           // for open_url
  text?: string;          // for reply_text
  raw?: string;           // original postback data
}

// ── Constants ──────────────────────────────────────────────────────────────

const ACTION_PREFIX = {
  ADD_TAG: 'canvas:add_tag:',
  TRIGGER_NODE: 'canvas:trigger:',
  REPLY: 'canvas:reply:',
} as const;

// ── LINE Button Parser ─────────────────────────────────────────────────────

/** LINE postback action data (from Flex Message or Quick Reply) */
export interface LinePostbackAction {
  type: 'postback';
  label?: string;
  data: string;
  displayText?: string;
}

export interface LineUriAction {
  type: 'uri';
  label?: string;
  uri: string;
}

export type LineButton = LinePostbackAction | LineUriAction | { type: string; [key: string]: unknown };

/**
 * Parses a LINE button action into a CanvasButtonAction.
 * Canvas-aware payloads must start with `canvas:` prefix.
 */
export function parseLineButton(action: LineButton): CanvasButtonAction {
  if (action.type === 'uri') {
    return { type: 'open_url', url: (action as LineUriAction).uri };
  }

  if (action.type === 'postback') {
    const data = (action as LinePostbackAction).data;
    return parsePostbackData(data);
  }

  return { type: 'unknown', raw: JSON.stringify(action) };
}

// ── FB Button Parser ───────────────────────────────────────────────────────

export interface FbPostbackButton {
  type: 'postback';
  title: string;
  payload: string;
}

export interface FbUrlButton {
  type: 'web_url';
  title: string;
  url: string;
}

export type FbButton = FbPostbackButton | FbUrlButton | { type: string; [key: string]: unknown };

/**
 * Parses a Facebook Messenger button into a CanvasButtonAction.
 */
export function parseFbButton(button: FbButton): CanvasButtonAction {
  if (button.type === 'web_url') {
    return { type: 'open_url', url: (button as FbUrlButton).url };
  }

  if (button.type === 'postback') {
    return parsePostbackData((button as FbPostbackButton).payload);
  }

  return { type: 'unknown', raw: JSON.stringify(button) };
}

// ── Shared postback parser ─────────────────────────────────────────────────

/**
 * Interprets a postback data string.
 *
 * Protocol:
 *  canvas:add_tag:<tagId>             → add_tag
 *  canvas:trigger:<nodeId>            → trigger_node
 *  canvas:reply:<text>                → reply_text
 *  https?://...                       → open_url
 *  anything else                      → unknown
 */
function parsePostbackData(data: string): CanvasButtonAction {
  if (data.startsWith(ACTION_PREFIX.ADD_TAG)) {
    return { type: 'add_tag', tagId: data.slice(ACTION_PREFIX.ADD_TAG.length), raw: data };
  }

  if (data.startsWith(ACTION_PREFIX.TRIGGER_NODE)) {
    return { type: 'trigger_node', nodeId: data.slice(ACTION_PREFIX.TRIGGER_NODE.length), raw: data };
  }

  if (data.startsWith(ACTION_PREFIX.REPLY)) {
    return { type: 'reply_text', text: data.slice(ACTION_PREFIX.REPLY.length), raw: data };
  }

  if (data.startsWith('http://') || data.startsWith('https://')) {
    return { type: 'open_url', url: data };
  }

  return { type: 'unknown', raw: data };
}

/**
 * Parse an array of LINE or FB buttons, returning all CanvasButtonActions.
 */
export function parseButtonActions(
  buttons: (LineButton | FbButton)[],
  platform: 'line' | 'fb',
): CanvasButtonAction[] {
  return buttons.map((btn) =>
    platform === 'line' ? parseLineButton(btn as LineButton) : parseFbButton(btn as FbButton),
  );
}
