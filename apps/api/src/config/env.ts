import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  JWT_EXPIRES_IN: z.string().default('7d'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LINE_LOGIN_CHANNEL_ID: z.string().optional(),
  LINE_LOGIN_CHANNEL_SECRET: z.string().optional(),
  LINE_LOGIN_CALLBACK_URL: z.string().optional(),
  FB_LOGIN_APP_ID: z.string().optional(),
  FB_LOGIN_APP_SECRET: z.string().optional(),
  FB_LOGIN_CALLBACK_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_EMBED_MODEL: z.string().default('bge-m3'),
  OLLAMA_CHAT_MODEL: z.string().default('qwen2.5:1.5b'),
  KB_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  KB_AUTO_REPLY_ENABLED: z.string().transform((v) => v === 'true').default('true'),
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
