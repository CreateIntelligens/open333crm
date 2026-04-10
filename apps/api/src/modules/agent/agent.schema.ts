import { z } from 'zod';

export const agentRoleEnum = z.enum(['ADMIN', 'SUPERVISOR', 'AGENT']);

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  role: agentRoleEnum,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateAgentRoleSchema = z.object({
  role: agentRoleEnum,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type AgentRoleValue = z.infer<typeof agentRoleEnum>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentRoleInput = z.infer<typeof updateAgentRoleSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
