export class AppError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(message, 400, details);
export const notFound = (message: string) => new AppError(message, 404);
export const conflict = (message: string) => new AppError(message, 409);

export const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
