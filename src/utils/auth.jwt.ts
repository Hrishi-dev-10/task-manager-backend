import { createHash } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { ServerRequestError, UnauthorizedError } from './globalErrorHandler.js';

export type TokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
    sub: string;
    sid: string;
    role: string;
    type: TokenType;
}

const UNIT_SECONDS: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24,
};

const getJwtSecret = (): string => {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret) {
        throw new ServerRequestError('JWT secret is not configured');
    }
    return secret;
};

export const durationToSeconds = (duration: string, fallbackSeconds: number): number => {
    const match = /^(\d+)([smhd])$/.exec(duration.trim());
    const amount = Number(match?.[1]);
    const unit = match?.[2];
    const unitSeconds = unit ? UNIT_SECONDS[unit] : undefined;
    if (!Number.isFinite(amount) || amount <= 0 || unitSeconds === undefined) {
        return fallbackSeconds;
    }
    return amount * unitSeconds;
};

export const getAccessTokenTtlSeconds = (): number =>
    durationToSeconds(process.env.JWT_EXPIRES_IN ?? '15m', 15 * 60);

export const getRefreshTokenTtlSeconds = (): number =>
    durationToSeconds(process.env.JWT_REFRESH_EXPIRES_IN ?? '7d', 7 * 24 * 60 * 60);

export const hashToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

export const generateToken = (payload: AuthTokenPayload, expiresInSeconds: number): string => {
    const options: SignOptions = { expiresIn: expiresInSeconds };
    return jwt.sign(payload, getJwtSecret(), options);
};

const isTokenType = (value: unknown): value is TokenType =>
    value === 'access' || value === 'refresh';

export const verifyAuthToken = (
    token: string,
    expectedType: TokenType,
    ignoreExpiration = false,
): AuthTokenPayload => {
    const secret = getJwtSecret();
    const options: VerifyOptions = ignoreExpiration ? { ignoreExpiration: true } : {};

    let decoded: JwtPayload;
    try {
        const result = jwt.verify(token, secret, options);
        if (typeof result === 'string') {
            throw new UnauthorizedError('Invalid or expired token');
        }
        decoded = result;
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            throw error;
        }
        throw new UnauthorizedError('Invalid or expired token');
    }

    const { sub, sid, role, type } = decoded;
    if (typeof sub !== 'string' || typeof sid !== 'string' || typeof role !== 'string' || !isTokenType(type)) {
        throw new UnauthorizedError('Invalid or expired token');
    }
    if (type !== expectedType) {
        throw new UnauthorizedError(`A ${expectedType} token is required`);
    }

    return { sub, sid, role, type };
};

export const verifyToken = (token: string): JwtPayload => {
    const secret = getJwtSecret();
    try {
        const decoded = jwt.verify(token, secret);
        if (typeof decoded === 'string') {
            throw new UnauthorizedError('Invalid or expired token');
        }
        return decoded;
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            throw error;
        }
        throw new UnauthorizedError('Invalid or expired token');
    }
};
