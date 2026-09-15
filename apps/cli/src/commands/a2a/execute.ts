import { createHash } from 'node:crypto';
import { Flags } from '@oclif/core';
import { ApiClient } from '../../api-client.js';
import { Open333Command } from '../../base-command.js';
import { getProfile, resolveProfileName, type ProfileMetadata } from '../../config-store.js';
import { readToken } from '../../credential-store.js';
import { CliError } from '../../errors.js';
import { consoleOutput, type CliOutput } from '../../output.js';

const MAX_PROMPT_LENGTH = 20_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 60_000;

export interface A2AExecuteOptions {
  profile?: string;
  message?: string;
  taskId?: string;
  contextId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface A2AExecuteDependencies {
  getProfile: (profile?: string) => ProfileMetadata | undefined;
  readToken: (host: string, profile: string) => Promise<string>;
  createClient: (options: { host: string; token: string; timeoutMs: number }) => Pick<ApiClient, 'post'>;
  readStdin: () => Promise<string>;
  isEnabled: () => boolean;
  getTimeoutMs: () => number;
}

interface AgentRunResponse {
  text: string;
}

interface CachedTaskResult {
  text: string;
  expiresAt: number;
}

// In-process cache to coalesce concurrent duplicate deliveries and short-lived retries
const completedTaskCache = new Map<string, CachedTaskResult>();
const inFlightTaskPromises = new Map<string, Promise<AgentRunResponse>>();

export function clearA2aTaskCache(): void {
  completedTaskCache.clear();
  inFlightTaskPromises.clear();
}

const defaultDependencies: A2AExecuteDependencies = {
  getProfile,
  readToken,
  createClient: (options) => new ApiClient(options),
  readStdin: readPromptFromStdin,
  isEnabled: () => process.env.A2A_CRM_ADAPTER_ENABLED === 'true',
  getTimeoutMs: () => parseTimeout(process.env.A2A_ADAPTER_TIMEOUT_MS),
};

export async function executeA2aCommand(
  options: A2AExecuteOptions,
  output: CliOutput = consoleOutput,
  dependencies: A2AExecuteDependencies = defaultDependencies,
): Promise<void> {
  if (!dependencies.isEnabled()) {
    throw new CliError('A2A CRM adapter is disabled. Set A2A_CRM_ADAPTER_ENABLED=true for the bridge runtime.', 'A2A_ADAPTER_DISABLED');
  }
  const profileName = resolveProfileName(options.profile);
  const profile = dependencies.getProfile(profileName);
  if (!profile) throw new CliError(`Profile "${profileName}" is not configured. Run open333 login first.`, 'PROFILE_MISSING');

  const rawPrompt = options.message ?? await dependencies.readStdin();
  const prompt = rawPrompt.trim();
  if (!prompt) throw new CliError('A2A prompt is required. Pass --message or pipe a prompt on stdin.', 'A2A_PROMPT_REQUIRED');
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new CliError(`A2A prompt must be at most ${MAX_PROMPT_LENGTH.toLocaleString('en-US')} characters.`, 'A2A_PROMPT_TOO_LARGE');
  }

  // Idempotency key: explicit task/idempotency key if provided, or SHA-256 hash of normalized prompt + profile
  const deduplicationKey = options.taskId
    ? `task:${options.taskId}`
    : options.idempotencyKey
      ? `key:${options.idempotencyKey}`
      : `hash:${createHash('sha256').update(`${profile.host}:${profile.profile}:${prompt}`).digest('hex')}`;

  const now = Date.now();
  const cached = completedTaskCache.get(deduplicationKey);
  if (cached && cached.expiresAt > now) {
    output.log(cached.text);
    return;
  }

  // Check if an identical task run is already in-flight (Single-flight coalescing)
  let executionPromise = inFlightTaskPromises.get(deduplicationKey);

  if (!executionPromise) {
    executionPromise = (async () => {
      try {
        const token = await dependencies.readToken(profile.host, profile.profile);
        const client = dependencies.createClient({ host: profile.host, token, timeoutMs: dependencies.getTimeoutMs() });
        const res = await client.post<AgentRunResponse>('/api/v1/ai/agent/run', { userMessage: prompt }, { signal: options.signal });
        if (!res || typeof res.text !== 'string') {
          throw new CliError('Open333 Agent returned no text result.', 'A2A_EMPTY_RESULT');
        }
        completedTaskCache.set(deduplicationKey, {
          text: res.text,
          expiresAt: Date.now() + DEFAULT_IDEMPOTENCY_TTL_MS,
        });
        return res;
      } finally {
        inFlightTaskPromises.delete(deduplicationKey);
      }
    })();

    inFlightTaskPromises.set(deduplicationKey, executionPromise);
  }

  const result = await executionPromise;
  output.log(result.text);
}

async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > MAX_PROMPT_LENGTH) break;
  }
  return input;
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return 120_000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000 || value > 900_000) {
    throw new CliError('A2A_ADAPTER_TIMEOUT_MS must be an integer from 1000 to 900000.', 'A2A_TIMEOUT_INVALID');
  }
  return value;
}

export default class A2AExecute extends Open333Command {
  static id = 'a2a:execute';
  static description = 'Execute one prompt for the official A2A bridge backend';

  static flags = {
    help: Flags.help({ char: 'h' }),
    profile: Flags.string({ description: 'local Open333 profile name' }),
    message: Flags.string({ description: 'prompt text; if omitted, read stdin' }),
    'task-id': Flags.string({ char: 't', description: 'A2A task identifier for idempotency' }),
    'context-id': Flags.string({ description: 'A2A context identifier' }),
    'idempotency-key': Flags.string({ description: 'Explicit idempotency key for deduplication' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(A2AExecute);
    const controller = new AbortController();

    const onSignal = () => {
      controller.abort();
    };

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    try {
      await executeA2aCommand(
        {
          profile: flags.profile,
          message: flags.message,
          taskId: flags['task-id'],
          contextId: flags['context-id'],
          idempotencyKey: flags['idempotency-key'],
          signal: controller.signal,
        },
        { log: this.log.bind(this) },
      );
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}
