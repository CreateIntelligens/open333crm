import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { ChatboxFingerprintInput } from '@open333crm/shared';
import {
  createChatboxMessageRegistry,
  registerBuiltInChatboxMessageHandlers,
  type ChatboxMessageRegistry,
} from '../modules/chatbox/chatbox.registry.js';
import { verifyChatboxSession, type ChatboxSessionVerifier } from '../modules/chatbox/chatbox.service.js';

export interface ChatboxI18nRegistry {
  resolveLocale(locale?: string): string;
  t(key: string, locale?: string): string;
}

declare module 'fastify' {
  interface FastifyInstance {
    chatboxMessageRegistry: ChatboxMessageRegistry;
    chatboxSessionVerifier: ChatboxSessionVerifier;
    chatboxI18n: ChatboxI18nRegistry;
  }
}

function createI18nRegistry(): ChatboxI18nRegistry {
  const messages: Record<string, Record<string, string>> = {
    'zh-TW': {
      'session.expired': '此聊天連結已失效，請重新開啟聊天室。',
      'session.invalid': '無法使用此聊天連結。',
    },
    en: {
      'session.expired': 'This chat link has expired. Please start a new chat.',
      'session.invalid': 'This chat link cannot be used.',
    },
  };

  return {
    resolveLocale(locale) {
      if (!locale) return 'zh-TW';
      const normalized = locale.toLowerCase();
      return normalized.startsWith('en') ? 'en' : 'zh-TW';
    },
    t(key, locale) {
      const resolved = this.resolveLocale(locale);
      return messages[resolved]?.[key] ?? messages['zh-TW'][key] ?? key;
    },
  };
}

async function chatboxPlugin(fastify: FastifyInstance) {
  const registry = createChatboxMessageRegistry();
  registerBuiltInChatboxMessageHandlers(registry);

  fastify.decorate('chatboxMessageRegistry', registry);
  fastify.decorate('chatboxI18n', createI18nRegistry());
  fastify.decorate('chatboxSessionVerifier', {
    verify(input: { sessionId: string; fingerprint?: ChatboxFingerprintInput; userAgent?: string }) {
      return verifyChatboxSession(fastify.prisma, input);
    },
  });
}

export default fp(chatboxPlugin, {
  name: 'chatbox',
  dependencies: ['prisma'],
});
