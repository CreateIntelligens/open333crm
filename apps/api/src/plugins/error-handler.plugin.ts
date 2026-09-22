import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../shared/utils/response.js';

/**
 * 唯一約束衝突時，把資料庫欄位名轉成使用者看得懂的說法。
 * 未收錄者不顯示欄位名——寧可訊息籠統，也不要把 schema 洩漏出去。
 */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  email: '電子郵件',
  name: '名稱',
  slug: '代稱',
  code: '代碼',
  uid: '使用者識別',
  phone: '電話',
  permissionCode: '權限',
  tagId: '標籤',
  key: '欄位名稱',
};

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    request.log.error(error);

    // ZodError - validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '輸入內容有誤，請檢查後重新送出',
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
      });
    }

    // AppError - custom application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    }

    // Prisma known request errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002': {
          // 唯一約束衝突。target 是「資料庫欄位名」，不可直接顯示給使用者——
          // 轉成使用者語彙；未收錄的欄位寧可籠統也不要洩漏 schema。
          const target = (error.meta?.target as string[]) ?? [];
          const labels = target.map((t) => UNIQUE_FIELD_LABELS[t]).filter(Boolean);
          return reply.status(409).send({
            success: false,
            error: {
              code: 'CONFLICT',
              message: labels.length
                ? `${labels.join('、')}已存在，請換一個`
                : '資料重複，已有相同的記錄存在',
            },
          });
        }
        case 'P2025':
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: '找不到指定的資料，可能已被刪除',
            },
          });
        default:
          // ⚠️ 原本回 error.message，會外洩表名、欄位與 SQL 片段。
          // 第 9 行的 request.log.error 已保留原文，除錯資訊不會遺失。
          return reply.status(400).send({
            success: false,
            error: {
              code: 'DATABASE_ERROR',
              message: '資料處理失敗，請確認輸入內容後重試',
            },
          });
      }
    }

    // Prisma validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: '提供的資料格式不正確',
        },
      });
    }

    // Fastify built-in errors (e.g., 404 from router)
    if ('statusCode' in error && typeof error.statusCode === 'number') {
      const statusCode = error.statusCode;
      // ⚠️ 原本回 error.message（框架原文，如 "Body must be object"）。
      // 原文已在 log 中，此處只回可讀說明。
      return reply.status(statusCode).send({
        success: false,
        error: {
          code: statusCode === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR',
          message: statusCode === 404 ? '找不到此頁面或資源' : '請求格式不正確，請重新操作',
        },
      });
    }

    // Unknown errors
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '系統發生未預期的錯誤，請稍後重試',
      },
    });
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
});
