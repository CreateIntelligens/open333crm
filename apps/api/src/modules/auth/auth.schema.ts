import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  agent: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.string(),
    avatarUrl: z.string().nullable(),
    tenantId: z.string().uuid(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const cliLoginRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
  name: z.string().min(1).max(120).optional(),
  profile: z.string().min(1).max(80).optional(),
});

export type CliLoginRequest = z.infer<typeof cliLoginRequestSchema>;

export const cliLoginResponseSchema = z.object({
  token: z.string().startsWith('cli_'),
  session: z.object({
    id: z.string().uuid(),
    name: z.string(),
    tokenPrefix: z.string(),
    tokenSuffix: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
  }),
  agent: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.string(),
    avatarUrl: z.string().nullable(),
    tenantId: z.string().uuid(),
  }),
});

export type CliLoginResponse = z.infer<typeof cliLoginResponseSchema>;

const cliEndpointSchema = z.object({
  name: z.string(),
  description: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string(),
  params: z.record(
    z.object({
      desc: z.string(),
      value: z.unknown(),
    }),
  ),
  scopes: z.array(z.string()).optional(),
});

export const cliCapabilitiesResponseSchema = z.object({
  token: z.object({
    id: z.string().uuid(),
    name: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
    tokenPrefix: z.string(),
    tokenSuffix: z.string(),
  }),
  endpoints: z.array(cliEndpointSchema.extend({
    scopes: z.array(z.string()),
  })),
  capabilities: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      routes: z.array(z.string()),
      scopes: z.array(z.string()),
      endpoints: z.array(cliEndpointSchema),
    }),
  ),
});

export type CliCapabilitiesResponse = z.infer<typeof cliCapabilitiesResponseSchema>;
