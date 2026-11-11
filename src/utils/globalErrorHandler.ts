export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly errorCode: string;
    public readonly details?: Record<string, unknown>;
    constructor(
        message: string,
        statusCode = 500,
        isOperational = true,
        errorCode = 'INTERNAL_ERROR',
        details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.errorCode = errorCode;

        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ServerRequestError extends AppError {
  constructor(message = 'Server error', details?: Record<string, unknown>) {
    super(message, 500, true, 'SERVER_ERROR', details);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: Record<string, unknown>) {
    super(message, 400, true, 'BAD_REQUEST', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: Record<string, unknown>) {
    super(message, 401, true, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super(message, 403, true, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, 404, true, 'NOT_FOUND', details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super(message, 409, true, 'CONFLICT', details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, unknown>) {
    super(message, 422, true, 'VALIDATION_ERROR', details);
  }
}
export class DatabaseError extends AppError {
  constructor(message = 'Database error', details?: Record<string, unknown>) {
    super(message, 500, false, 'DATABASE_ERROR', details);
  }
}