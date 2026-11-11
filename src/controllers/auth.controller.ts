import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { db } from '../config/db.config.js';
import { sessions, users } from '../models/index.js';
import { asyncHandler } from '../utils/asyncErrorHandler.js';
import {
    generateToken,
    getAccessTokenTtlSeconds,
    getRefreshTokenTtlSeconds,
    hashToken,
    verifyAuthToken,
    type AuthTokenPayload,
    type TokenType,
} from '../utils/auth.jwt.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/globalErrorHandler.js';

/** http://localhost cannot store Secure cookies. Lax is enough across localhost ports. */
function authCookieOptions() {
    const secure = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure,
        sameSite: secure ? "none" as const : "lax" as const,
        path: "/",
    };
}

const clientMeta = (req: Request) => {
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined;
    const ipAddress = forwardedIp || req.ip || null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader.slice(0, 500) : null;
    return { ipAddress, userAgent };
};

const issueTokens = (userId: string, sessionId: string, role: string) => {
    const accessTtl = getAccessTokenTtlSeconds();
    const refreshTtl = getRefreshTokenTtlSeconds();
    const accessToken = generateToken(
        { sub: userId, sid: sessionId, role, type: 'access' },
        accessTtl,
    );
    const refreshToken = generateToken(
        { sub: userId, sid: sessionId, role, type: 'refresh' },
        refreshTtl,
    );
    return {
        accessToken,
        refreshToken,
        expiresIn: accessTtl,
        refreshExpiresAt: new Date(Date.now() + refreshTtl * 1000),
    };
};

export const registerUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    let { name, email, password,role } = req.body;
    let hashedPassword = await bcrypt.hash(password, 10);
    if(!name || !email || !password) {
        throw new BadRequestError('Name, email and password are required');
    }
    const newUser = await db.insert(users).values({ name, email, password: hashedPassword}).onConflictDoNothing({
        target: [users.email],
    }).returning({
        name: users.name,
        email: users.email,
        id: users.id
    });

    if (newUser.length === 0) {
        throw new ConflictError('User with this email already exists');
    }
    else {
        res.status(200).json({
            status_code: 200,
            message: "User added successfully",
            data: newUser[0],
        });
    }

})

const readBearerToken = (req: Request): string | undefined => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
        return undefined;
    }
    const token = header.slice('Bearer '.length).trim();
    return token || undefined;
};

const readBodyToken = (req: Request): string | undefined => {
    const token = req.body?.refreshToken;
    if (typeof token !== 'string') {
        return undefined;
    }
    const trimmed = token.trim();
    return trimmed || undefined;
};

const verifyLogoutToken = (token: string): AuthTokenPayload => {
    const types: TokenType[] = ['refresh', 'access'];
    let lastError: UnauthorizedError | undefined;
    for (const type of types) {
        try {
            return verifyAuthToken(token, type, true);
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                lastError = error;
                continue;
            }
            throw error;
        }
    }
    throw lastError ?? new UnauthorizedError('Invalid or expired token');
};

export const login = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
        throw new BadRequestError('Email and password are required');
    }

    const [user] = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            password: users.password,
            role: users.role,
            isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    
    if (!user) {
        throw new UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
        throw new UnauthorizedError('Invalid email or password');
    }
    if (!user.isActive) {
        throw new ForbiddenError('Account is inactive');
    }

    const sessionId = randomUUID();
    const tokens = issueTokens(user.id, sessionId, user.role);
    const { ipAddress, userAgent } = clientMeta(req);
    const now = new Date();

    await db.insert(sessions).values({
        id: sessionId,
        userId: user.id,
        refreshTokenHash: hashToken(tokens.refreshToken),
        userAgent,
        ipAddress,
        expiresAt: tokens.refreshExpiresAt,
        lastUsedAt: now,
        updatedAt: now,
    });
    const cookieOptions = authCookieOptions();
    res.cookie('token', tokens.accessToken, cookieOptions);
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    res.status(200).json({
        status_code: 200,
        message: 'Login successful',
        data: {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            session: {
                id: sessionId,
                expiresAt: tokens.refreshExpiresAt,
            },
        },
    });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const currentRefreshToken = readBodyToken(req);
    if (!currentRefreshToken) {
        throw new BadRequestError('Refresh token is required');
    }

    const payload = verifyAuthToken(currentRefreshToken, 'refresh');
    const { ipAddress, userAgent } = clientMeta(req);
    const presentedHash = hashToken(currentRefreshToken);

    const result = await db.transaction(async (tx) => {
        const [session] = await tx
            .select()
            .from(sessions)
            .where(eq(sessions.id, payload.sid))
            .limit(1)
            .for('update');

        if (!session || session.userId !== payload.sub) {
            return { ok: false as const, reason: 'invalid' as const };
        }
        if (session.revokedAt) {
            return { ok: false as const, reason: 'revoked' as const };
        }
        if (session.expiresAt.getTime() <= Date.now()) {
            return { ok: false as const, reason: 'expired' as const };
        }
        if (session.refreshTokenHash !== presentedHash) {
            await tx
                .update(sessions)
                .set({ revokedAt: new Date(), updatedAt: new Date() })
                .where(eq(sessions.id, session.id));
            return { ok: false as const, reason: 'reused' as const };
        }

        const [user] = await tx
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);

        if (!user || !user.isActive) {
            await tx
                .update(sessions)
                .set({ revokedAt: new Date(), updatedAt: new Date() })
                .where(eq(sessions.id, session.id));
            return { ok: false as const, reason: 'inactive' as const };
        }

        const tokens = issueTokens(user.id, session.id, user.role);
        const now = new Date();
        await tx
            .update(sessions)
            .set({
                refreshTokenHash: hashToken(tokens.refreshToken),
                expiresAt: tokens.refreshExpiresAt,
                lastUsedAt: now,
                updatedAt: now,
                ...(userAgent ? { userAgent } : {}),
                ...(ipAddress ? { ipAddress } : {}),
            })
            .where(eq(sessions.id, session.id));

        return {
            ok: true as const,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            expiresAt: tokens.refreshExpiresAt,
            sessionId: session.id,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        };
    });

    if (!result.ok) {
        if (result.reason === 'inactive') {
            throw new ForbiddenError('Account is inactive');
        }
        const messages = {
            invalid: 'Invalid refresh token',
            revoked: 'Session has been logged out',
            expired: 'Refresh token has expired',
            reused: 'Refresh token reuse detected. Please log in again',
        } as const;
        throw new UnauthorizedError(messages[result.reason]);
    }

    res.status(200).json({
        status_code: 200,
        message: 'Token refreshed successfully',
        data: {
            user: result.user,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            expiresIn: result.expiresIn,
            session: {
                id: result.sessionId,
                expiresAt: result.expiresAt,
            },
        },
    });
});

export const logout = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const token = readBodyToken(req) ?? readBearerToken(req);
    if (!token) {
        throw new BadRequestError('Refresh token is required');
    }

    const payload = verifyLogoutToken(token);
    const now = new Date();

    const [session] = await db
        .update(sessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(sessions.id, payload.sid), eq(sessions.userId, payload.sub)))
        .returning({
            id: sessions.id,
            revokedAt: sessions.revokedAt,
        });

    if (!session) {
        throw new UnauthorizedError('Invalid session');
    }

    res.status(200).json({
        status_code: 200,
        message: 'Logged out successfully',
        data: {
            sessionId: session.id,
            revokedAt: session.revokedAt,
        },
    });
});


export const resetPassword = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new BadRequestError('Email and new password are required');
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
        throw new NotFoundError('User not found');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, user.id));

    res.status(200).json({
        status_code: 200,
        message: 'Password reset successfully',
        data: {
            userId: user.id,
            email: user.email,
        },
    });
});