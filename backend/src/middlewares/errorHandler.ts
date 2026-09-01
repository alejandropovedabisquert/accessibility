import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import config from '../config/config';
import { AppError } from '../utils/errors';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Datos de entrada no validos',
      details: err.issues.map((issue) => ({
        field: issue.path.join('.') || '(raiz)',
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) console.error(err);
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  console.error(err);
  const message = err instanceof Error ? err.message : 'Error interno del servidor';
  res.status(500).json({
    error: config.nodeEnv === 'production' ? 'Error interno del servidor' : message,
  });
};
