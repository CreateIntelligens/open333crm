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
