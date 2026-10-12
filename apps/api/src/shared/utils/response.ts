export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function success<T>(
  data: T,
  /** 分頁資訊；個別端點可附加其他欄位（例如聯絡人對話清單的 hiddenCount） */
  meta?: { total: number; page: number; limit: number; totalPages: number; hiddenCount?: number },
) {
  const response: { success: true; data: T; meta?: typeof meta } = {
    success: true,
    data,
  };
  if (meta) {
    response.meta = meta;
  }
  return response;
}

export function paginated<T>(data: T[], total: number, page: number, limit: number) {
  return success(data, {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
