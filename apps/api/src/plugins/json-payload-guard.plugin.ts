/**
 * 全域 JSON 解析器：解析之前先限制請求內容（change limit-request-array-size，spec request-payload-limits，issue #382）。
 *
 * 取代 Fastify 根層的 `application/json` 解析器。先以 `findJsonPayloadViolation()` 掃描原始文字，
 * 超過上限就回 400（不呼叫 JSON.parse，也不進入路由與 Zod）；沒有超過才交給 Fastify 預設的 JSON 解析器，
 * 保留它的 `__proto__`／`constructor` 防護與錯誤格式。
 *
 * - 路由可用 `config: { jsonPayloadLimits: { maxArrayLength: 50_000 } }` 調高部分上限，未給的沿用全域值。
 * - 子範圍若要加自己的 `application/json` 解析器，必須先 `removeContentTypeParser('application/json')`，
 *   否則 Fastify 丟 `FST_ERR_CTP_ALREADY_PRESENT`；並以 `assertJsonPayloadWithinLimits()` 套用相同的掃描
 *   （見 modules/webhook/webhook.routes.ts）。
 */
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  DEFAULT_JSON_PAYLOAD_LIMITS,
  findJsonPayloadViolation,
  jsonPayloadViolationError,
  type JsonPayloadLimits,
} from '../shared/utils/json-payload-limits.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 全域的 JSON 請求內容上限（由 json-payload-guard 註冊） */
    jsonPayloadLimits: Readonly<JsonPayloadLimits>;
  }
  interface FastifyContextConfig {
    /** 這個路由調高的 JSON 請求內容上限；未給的欄位沿用全域值 */
    jsonPayloadLimits?: Partial<JsonPayloadLimits>;
  }
}

export interface JsonPayloadGuardOptions {
  limits: JsonPayloadLimits;
}

/** 合併全域與路由的上限。沒有註冊本外掛的 Fastify（例如單元測試）使用預設值 */
function resolveLimits(fastify: FastifyInstance, request: FastifyRequest): JsonPayloadLimits {
  const base = fastify.hasDecorator('jsonPayloadLimits') ? fastify.jsonPayloadLimits : DEFAULT_JSON_PAYLOAD_LIMITS;
  const override = request.routeOptions?.config?.jsonPayloadLimits;
  return override ? { ...base, ...override } : { ...base };
}

/**
 * 檢查 JSON 原文；超過上限時丟出 400 的 AppError（`PAYLOAD_*`）。
 * 給自訂 JSON 解析器的子範圍使用（例如進站 webhook 為了驗簽保留原始內容）。
 */
export function assertJsonPayloadWithinLimits(fastify: FastifyInstance, request: FastifyRequest, text: string): void {
  const violation = findJsonPayloadViolation(text, resolveLimits(fastify, request));
  if (violation) {
    request.log.warn({ violation, url: request.routeOptions?.url }, 'JSON 請求內容超過上限，已拒絕');
    throw jsonPayloadViolationError(violation);
  }
}

async function jsonPayloadGuardPlugin(fastify: FastifyInstance, opts: JsonPayloadGuardOptions) {
  fastify.decorate('jsonPayloadLimits', Object.freeze({ ...opts.limits }));

  const defaultJsonParser = fastify.getDefaultJsonParser(
    fastify.initialConfig.onProtoPoisoning ?? 'error',
    fastify.initialConfig.onConstructorPoisoning ?? 'error',
  );

  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    try {
      assertJsonPayloadWithinLimits(fastify, request, body as string);
    } catch (err) {
      done(err as Error, undefined);
      return;
    }
    defaultJsonParser(request, body as string, done);
  });
}

export default fp(jsonPayloadGuardPlugin, { name: 'json-payload-guard' });
