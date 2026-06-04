export class CliError extends Error {
  constructor(
    message: string,
    public readonly code = 'CLI_ERROR',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function formatCliError(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
