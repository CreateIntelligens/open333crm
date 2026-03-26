/**
 * AI Generation Node executor (Task 3.5)
 * Calls the brain module to generate content and stores results in ctx.vars.gen.
 */

import { logger } from '../logger/index.js';
import type { FlowContext } from './types.js';

export interface AiGenConfig {
  prompt: string;                     // Template prompt with {{variable}} placeholders
  outputKey: string;                  // key under gen.* to store result (e.g. 'greeting')
  model?: string;                     // Optional model override
  maxTokens?: number;
  systemInstruction?: string;
}

// Brain service endpoint config (from env)
const BRAIN_URL = process.env.BRAIN_SERVICE_URL ?? 'http://localhost:3001';

/**
 * Execute an AI Generation node.
 * Calls the internal brain service to generate text, stores in ctx.vars.gen.<outputKey>.
 *
 * @param config - Node config (prompt template, output key, model settings)
 * @param ctx    - Current FlowContext
 * @returns Updated context with gen.<outputKey> set
 */
export async function executeAiGenNode(
  config: AiGenConfig,
  ctx: FlowContext,
): Promise<FlowContext> {
  const { prompt, outputKey, model, maxTokens, systemInstruction } = config;

  // Substitute context variables into the prompt
  const resolvedPrompt = substituteVars(prompt, ctx.vars);

  logger.debug(`[AiGenNode] Generating content for key "${outputKey}" using brain service...`);

  let generatedText: string;

  try {
    const response = await fetch(`${BRAIN_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: resolvedPrompt,
        model,
        maxTokens,
        systemInstruction,
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Brain service error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { text?: string; content?: string };
    generatedText = data.text ?? data.content ?? '';
  } catch (err) {
    throw new Error(`AiGenNode failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  logger.info(`[AiGenNode] Generated ${generatedText.length} chars for key "${outputKey}"`);

  const gen: Record<string, string> = {
    ...(ctx.vars.gen as Record<string, string> ?? {}),
    [outputKey]: generatedText,
  };

  return {
    ...ctx,
    vars: { ...ctx.vars, gen },
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function substituteVars(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
    const val = (path as string).split('.').reduce<unknown>((acc: unknown, key: string) => {
      return (acc as Record<string, unknown>)?.[key];
    }, vars as unknown);
    return val !== undefined ? String(val) : '';
  });
}
