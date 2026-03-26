/**
 * API Fetch Node executor (Task 3.4)
 * Calls an external HTTP API and maps response JSON into FlowContext.vars.ext
 */

import { logger } from '../logger/index.js';
import type { FlowContext } from './types.js';

export interface ApiFetchConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  bodyTemplate?: string;        // JSON string with {{variable}} placeholders
  mapping?: Record<string, string>; // { 'ext.coupon_code': 'response.coupon_code' }
  timeoutMs?: number;
}

/**
 * Execute an API Fetch node.
 * Fetches from the configured URL, then maps response fields into ctx.vars.ext.
 *
 * @param config - Node configuration
 * @param ctx    - Current flow context (vars are merged in-place)
 * @returns Updated FlowContext with ext.* values set
 */
export async function executeApiFetchNode(
  config: ApiFetchConfig,
  ctx: FlowContext,
): Promise<FlowContext> {
  const {
    url,
    method = 'GET',
    headers = {},
    bodyTemplate,
    mapping = {},
    timeoutMs = 10_000,
  } = config;

  // Substitute {{variables}} in URL and body from current context vars
  const resolvedUrl = substituteVars(url, ctx.vars);
  const resolvedBody = bodyTemplate ? substituteVars(bodyTemplate, ctx.vars) : undefined;

  logger.debug(`[ApiFetchNode] ${method} ${resolvedUrl}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let responseData: Record<string, unknown>;

  try {
    const response = await fetch(resolvedUrl, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: resolvedBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`API fetch failed: ${response.status} ${response.statusText}`);
    }

    responseData = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`ApiFetchNode error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Map response fields into ctx.vars.ext using dot-notation paths
  const ext: Record<string, unknown> = { ...(ctx.vars.ext ?? {}) };

  for (const [targetPath, sourcePath] of Object.entries(mapping)) {
    const value = getByPath(responseData, sourcePath);
    if (value !== undefined) {
      const key = targetPath.replace(/^ext\./, '');
      ext[key] = value;
    }
  }

  logger.info(`[ApiFetchNode] Mapped ${Object.keys(mapping).length} fields into ext.*`);

  return {
    ...ctx,
    vars: { ...ctx.vars, ext },
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

/** Substitute {{var.path}} placeholders in a string from a nested object. */
function substituteVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path) => {
    const val = getByPath(vars as Record<string, unknown>, path);
    return val !== undefined ? String(val) : '';
  });
}

/** Access a nested value using dot-notation path. */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    return (acc as Record<string, unknown>)?.[key];
  }, obj);
}
