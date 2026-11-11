import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken, type AuthTokenPayload } from '../utils/auth.jwt.js';
import { UnauthorizedError } from '../utils/globalErrorHandler.js';

/** Verifies the Bearer access token and stores its payload on res.locals.auth. */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const [scheme, token] = header?.split(' ') ?? [];
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError('Authentication required');
  }
  res.locals.auth = verifyAuthToken(token, 'access');
  next();
};

/** Allows only the given roles. Must run after `authenticate`. */
export const requireRole =
  (...allowed: string[]) =>
  (_req: Request, res: Response, next: NextFunction) => {
    const auth = res.locals.auth as AuthTokenPayload | undefined;
    if (!auth) {
      throw new UnauthorizedError('Authentication required');
    }
    const permitted = allowed.map((r) => r.toLowerCase());
    if (!permitted.includes(auth.role.toLowerCase())) {
      return res.status(403).json({ message: 'Admin access required' });
    }
    next();
  };

export const requireAdmin = [authenticate, requireRole('admin')];