import type { Request, Response, NextFunction } from 'express';
import { AppError, DatabaseError } from './globalErrorHandler.js';
import { asyncHandler } from './asyncErrorHandler.js';

const isProd = process.env.NODE_ENV === 'production';

/** Common Postgres error codes -> HTTP-friendly AppError. */
function mapPgError(err: any): AppError | null {
  if (!err?.code) return null;

  switch (err.code) {
    case '23505': // unique_violation
      return new AppError('A record with this value already exists', 409, true, 'DUPLICATE_ENTRY', {
        constraint: err.constraint,
        detail: isProd ? undefined : err.detail,
      });
    case '23503': // foreign_key_violation
      return new AppError('Referenced record does not exist', 409, true, 'FOREIGN_KEY_VIOLATION', {
        constraint: err.constraint,
      });
    case '23502': // not_null_violation
      return new AppError(`Missing required field: ${err.column}`, 400, true, 'MISSING_FIELD', {
        column: err.column,
      });
    case '22P02': // invalid_text_representation (bad UUID/int cast etc.)
      return new AppError('Invalid input syntax for one or more fields', 400, true, 'INVALID_INPUT');
    case '57014': // query_canceled (timeout)
      return new DatabaseError('Database query timed out');
    case 'ECONNREFUSED':
    case '08006': // connection_failure
      return new DatabaseError('Database connection failed');
    default:
      return null;
  }
}

/**
 * Global error-handling middleware. Must be registered LAST, after all
 * routes and other middleware: app.use(errorHandler)
 *
 * Express identifies error middleware by arity - it must take exactly
 * 4 arguments (err, req, res, next), even if `next` is unused.
 */
export async function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let normalized: AppError;

  if (err instanceof AppError) {
    normalized = err;
  } else {
    const mapped = mapPgError(err);
    if (mapped) {
      normalized = mapped;
    } else {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      normalized = new AppError(message, 500, false, 'INTERNAL_ERROR');
      if (err instanceof Error && err.stack) {
        normalized.stack = err.stack;
      }
    }
  }

  const severity: 'error' | 'warn' | 'fatal' = normalized.statusCode >= 500 ? 'error' : 'warn';

  // Log to console immediately (synchronous, always happens).
  // eslint-disable-next-line no-console
  console.error(
    `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${normalized.statusCode} ${normalized.errorCode}: ${normalized.message}`,
  );

//   void logErrorToDb({ error: normalized, statusCode: normalized.statusCode, req, severity });

  const errorBody = {
    status_code:normalized.statusCode,
    error_message: normalized.message,
    error_stack: normalized.stack,
    url: req.originalUrl,
    method: req.method
  }

  if (res.headersSent) {
    return; // let Express's default handler close the connection
  }

  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.errorCode,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
      ...(isProd ? {} : { stack: normalized.stack }),
      path:req.originalUrl,
      method:req.method
    },
    requestId: (req as any).requestId ?? req.headers['x-request-id'] ?? undefined,
  });
}

export function registerProcessErrorHandlers(): void {
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    // eslint-disable-next-line no-console
    console.error('[unhandledRejection]', error);
    // void logErrorToDb({ error, statusCode: 500, severity: 'fatal' });
  });

  process.on('uncaughtException', (error) => {
    // eslint-disable-next-line no-console
    console.error('[uncaughtException]', error);
    // Best-effort log, then exit - the process is in an undefined state.
    // void logErrorToDb({ error, statusCode: 500, severity: 'fatal' }).finally(() => {
    //   process.exit(1);
    // });
  });
}