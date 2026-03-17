import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV:       z.enum(['development', 'test', 'production']).default('development'),
  PORT:           z.coerce.number().default(3000),
  DATABASE_URL:   z.string().min(1),
  REDIS_URL:      z.string().min(1),
  CACHE_DRIVER:   z.enum(['memory', 'redis']).default('memory'),
  CACHE_SEGMENT:  z.string().default('open333crm-api-cache'),
  CACHE_EXPIRES_IN: z.coerce.number().optional(),
  CACHE_REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  JWT_SECRET:     z.string().min(32),
  CORS_ORIGIN:    z.string().default('http://localhost:3001'),

  // Storage
  STORAGE_PROVIDER:      z.enum(['minio', 's3', 'gcs']).default('minio'),
  MINIO_ENDPOINT:        z.string().optional(),
  MINIO_PORT:            z.coerce.number().optional(),
  MINIO_USE_SSL:         z.coerce.boolean().default(false),
  MINIO_ACCESS_KEY:      z.string().optional(),
  MINIO_SECRET_KEY:      z.string().optional(),
  MINIO_BUCKET:          z.string().default('open333crm'),
  MINIO_PUBLIC_BASE_URL: z.string().optional(),

  // License
  LICENSE_KEY:              z.string().min(1),
  LICENSE_FETCH_URL:        z.string().url(),
  LICENSE_SIGNATURE_SECRET: z.string().min(1),

  // Web Push (VAPID)
  VAPID_PUBLIC_KEY:  z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT:     z.string().optional(),

  // SMTP (optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Credential encryption
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(32),
});

export type Env = z.infer<typeof EnvSchema>;

const result = EnvSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:\n', result.error.format());
  process.exit(1);
}

export const env: Env = result.data;
