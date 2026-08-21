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

const base64UrlSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);

const webAuthnCredentialBaseSchema = z.object({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal('public-key'),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.unknown()),
});

export const passkeyRegistrationResponseSchema = webAuthnCredentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: base64UrlSchema,
    attestationObject: base64UrlSchema,
    authenticatorData: base64UrlSchema.optional(),
    transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64UrlSchema.optional(),
  }),
});

export const passkeyAuthenticationResponseSchema = webAuthnCredentialBaseSchema.extend({
  response: z.object({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional(),
  }),
});

export const passkeyChallengeIdSchema = z.object({
  challengeId: z.string().uuid(),
});

export const passkeyAuthenticationOptionsSchema = z.object({
  email: z.string().email('Invalid email format').optional(),
  rememberMe: z.boolean().optional().default(false),
});

export const passkeyRegistrationVerifySchema = passkeyChallengeIdSchema.extend({
  name: z.string().trim().min(1).max(80).default('Passkey'),
  response: passkeyRegistrationResponseSchema,
});

export const passkeyAuthenticationVerifySchema = passkeyChallengeIdSchema.extend({
  response: passkeyAuthenticationResponseSchema,
});

export const passkeyIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type PasskeyRegistrationResponse = z.infer<typeof passkeyRegistrationResponseSchema>;
export type PasskeyAuthenticationResponse = z.infer<typeof passkeyAuthenticationResponseSchema>;

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
