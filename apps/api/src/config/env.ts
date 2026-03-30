import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  JWT_EXPIRES_IN: z.string().default('7d'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('*'),
  LICENSE_KEY: z.string().default('dev-license-key'),
  CACHE_DRIVER: z.string().default('memory'),
  CACHE_SEGMENT: z.string().default('open333crm'),
  CACHE_REDIS_DB: z.coerce.number().int().optional(),
  CACHE_EXPIRES_IN: z.coerce.number().int().optional(),
  LINE_LOGIN_CHANNEL_ID: z.string().optional(),
  LINE_LOGIN_CHANNEL_SECRET: z.string().optional(),
  LINE_LOGIN_CALLBACK_URL: z.string().optional(),
  FB_LOGIN_APP_ID: z.string().optional(),
  FB_LOGIN_APP_SECRET: z.string().optional(),
  FB_LOGIN_CALLBACK_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('bge-m3'),
  OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:3b'),
  KB_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  KB_AUTO_REPLY_ENABLED: z.string().transform((v) => v === 'true').default('true'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('open333crm'),
  S3_REGION: z.string().default('us-east-1'),
  S3_PUBLIC_URL: z.string().default('http://localhost:9000'),
  EMAIL_DELIVERY_MODE: z.enum(['log', 'webhook']).default('log'),
  EMAIL_WEBHOOK_URL: z.string().optional(),
  EMAIL_WEBHOOK_AUTH_TOKEN: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let _config: EnvConfig | null = null;

export function loadEnvConfig(): EnvConfig {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const messages = Object.entries(formatted)
      .filter(([key]) => key !== '_errors')
      .map(([key, val]) => {
        const errors = (val as { _errors?: string[] })._errors ?? [];
        return `  ${key}: ${errors.join(', ')}`;
      })
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): EnvConfig {
  if (!_config) {
    throw new Error('Config not loaded. Call loadEnvConfig() first.');
  }
  return _config;
}

// Lazy proxy for GitHub-side code that imports { env }
// Defers loadEnvConfig() until first property access, allowing index.ts to load dotenv first.
export const env: EnvConfig = new Proxy({} as EnvConfig, {
  get(_target, prop: string) {
    const config = loadEnvConfig();
    return (config as Record<string, unknown>)[prop];
  },
});
