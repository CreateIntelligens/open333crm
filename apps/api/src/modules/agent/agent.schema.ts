import { z } from 'zod';

export const agentRoleEnum = z.enum(['ADMIN', 'SUPERVISOR', 'AGENT']);

export const createAgentSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format'),
  // legacy enum role（過渡相容）。提供 roleId 時以 roleId 為準；未提供 roleId 時用 role 解析對應 system role。
  role: agentRoleEnum,
  // 細粒度 RBAC：自訂角色 / system role 皆可透過此欄位指派（同租戶）。提供時以此為準。
  roleId: z.string().uuid('Invalid roleId format').optional(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const updateAgentRoleSchema = z
  .object({
    // 兩者至少擇一；提供 roleId 時以 roleId 為準。
    role: agentRoleEnum.optional(),
    roleId: z.string().uuid('Invalid roleId format').optional(),
  })
  .refine((v) => v.role !== undefined || v.roleId !== undefined, {
    message: 'role 或 roleId 至少需提供一個',
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
