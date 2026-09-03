import type {
  ChatboxMessageInput,
  ChatboxMessageOutput,
  ChatboxMessagePayload,
  ChatboxMessageType,
} from '@open333crm/shared';
import { AppError } from '../../shared/utils/response.js';

const MAX_CHATBOX_TEXT_LENGTH = 4_000;

export interface ChatboxParsedMessage {
  contentType: ChatboxMessageType;
  content: Record<string, unknown>;
}

export interface ChatboxMessageTypeHandler {
  readonly type: ChatboxMessageType;
  parse(input: ChatboxMessageInput): ChatboxParsedMessage;
  serialize(message: {
    id: string;
    direction: string;
    senderType: string;
    senderId?: string | null;
    contentType: string;
    content: unknown;
    createdAt: Date;
    sequence?: number | null;
  }): ChatboxMessageOutput;
}

export interface ChatboxMessageRegistry {
  register(handler: ChatboxMessageTypeHandler): void;
  get(type: string): ChatboxMessageTypeHandler | undefined;
  parse(input: ChatboxMessageInput): ChatboxParsedMessage;
  serialize(message: Parameters<ChatboxMessageTypeHandler['serialize']>[0]): ChatboxMessageOutput;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`${field} is required`, 'BAD_REQUEST', 400);
  }
  return value.trim();
}

function createHandler(type: ChatboxMessageType, validate: (payload: Record<string, unknown>) => Record<string, unknown>): ChatboxMessageTypeHandler {
  return {
    type,
    parse(input) {
      return {
        contentType: type,
        content: validate(asRecord(input.payload)),
      };
    },
    serialize(message) {
      return {
        id: message.id,
        direction: message.direction as ChatboxMessageOutput['direction'],
        senderType: message.senderType as ChatboxMessageOutput['senderType'],
        senderId: message.senderId ?? null,
        type,
        payload: asRecord(message.content) as unknown as ChatboxMessagePayload,
        createdAt: message.createdAt.toISOString(),
        sequence: message.sequence ?? null,
        deliveryStatus: 'sent',
      };
    },
  };
}

export function createChatboxMessageRegistry(): ChatboxMessageRegistry {
  const handlers = new Map<string, ChatboxMessageTypeHandler>();

  return {
    register(handler) {
      handlers.set(handler.type, handler);
    },
    get(type) {
      return handlers.get(type);
    },
    parse(input) {
      const handler = handlers.get(input.type);
      if (!handler) {
        throw new AppError(`Unsupported message type: ${input.type}`, 'BAD_REQUEST', 400);
      }
      return handler.parse(input);
    },
    serialize(message) {
      const handler = handlers.get(message.contentType);
      if (!handler) {
        throw new AppError(`Unsupported message type: ${message.contentType}`, 'BAD_REQUEST', 400);
      }
      return handler.serialize(message);
    },
  };
}

export function registerBuiltInChatboxMessageHandlers(registry: ChatboxMessageRegistry): void {
  registry.register(createHandler('text', (payload) => {
    const text = assertString(payload.text, 'payload.text');
    if (text.length > MAX_CHATBOX_TEXT_LENGTH) {
      throw new AppError(`payload.text must be at most ${MAX_CHATBOX_TEXT_LENGTH} characters`, 'BAD_REQUEST', 400);
    }
    return { text };
  }));
  registry.register(createHandler('image', validateMediaPayload));
  registry.register(createHandler('video', validateMediaPayload));
  registry.register(createHandler('file', validateMediaPayload));
  registry.register(createHandler('emoji', (payload) => ({ emoji: assertString(payload.emoji, 'payload.emoji'), label: payload.label })));
  registry.register(createHandler('system', (payload) => ({ code: assertString(payload.code, 'payload.code'), text: payload.text, params: payload.params })));
}

function validateMediaPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    url: assertString(payload.url, 'payload.url'),
    mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : undefined,
    filename: typeof payload.filename === 'string' ? payload.filename : undefined,
    altText: typeof payload.altText === 'string' ? payload.altText : undefined,
    sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : undefined,
  };
}
