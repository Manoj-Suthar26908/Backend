import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`[${req.method}] ${req.url} >> ${message}`, {
    stack: err.stack,
    details: err.details,
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      details: err.details || undefined,
    },
  });
}
