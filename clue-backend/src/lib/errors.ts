import { Context } from 'hono';
import { ZodError } from 'zod';

// ============================================
// ERROR TYPES
// ============================================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(401, 'AUTHENTICATION_ERROR', message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Permission denied') {
    super(403, 'AUTHORIZATION_ERROR', message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number) {
    super(429, 'RATE_LIMIT', 'Too many requests', { retry_after: retryAfter });
    this.name = 'RateLimitError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(502, 'EXTERNAL_SERVICE_ERROR', `${service}: ${message}`);
    this.name = 'ExternalServiceError';
  }
}

// ============================================
// ERROR RESPONSE FORMAT
// ============================================

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  request_id?: string;
}

function formatError(error: AppError, requestId?: string): ErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    request_id: requestId,
  };
}

// ============================================
// ERROR HANDLER MIDDLEWARE
// ============================================

export function errorHandler(err: Error, c: Context): Response {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  
  // Log error
  console.error(`[Error] ${requestId}:`, err);
  
  // Handle known error types
  if (err instanceof AppError) {
    return c.json(formatError(err, requestId), err.statusCode as any);
  }
  
  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details,
      },
      request_id: requestId,
    }, 400);
  }
  
  // Handle unknown errors
  const isProduction = process.env.NODE_ENV === 'production';
  
  return c.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'An unexpected error occurred' : err.message,
      details: isProduction ? undefined : err.stack,
    },
    request_id: requestId,
  }, 500);
}

// ============================================
// ASYNC HANDLER WRAPPER
// ============================================

type AsyncHandler = (c: Context) => Promise<Response>;

export function asyncHandler(handler: AsyncHandler): AsyncHandler {
  return async (c: Context) => {
    try {
      return await handler(c);
    } catch (error) {
      return errorHandler(error as Error, c);
    }
  };
}

// ============================================
// RESULT TYPE (for service layer)
// ============================================

export type Result<T, E = AppError> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function Err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ============================================
// COMMON ERROR HELPERS
// ============================================

export function badRequest(message: string, details?: any): never {
  throw new ValidationError(message, details);
}

export function unauthorized(message?: string): never {
  throw new AuthenticationError(message);
}

export function forbidden(message?: string): never {
  throw new AuthorizationError(message);
}

export function notFound(resource?: string): never {
  throw new NotFoundError(resource);
}

export function conflict(message?: string): never {
  throw new ConflictError(message);
}
