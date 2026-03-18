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

export function success<T>(data: T, meta?: { total: number; page: number; limit: number; totalPages: number }) {
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
