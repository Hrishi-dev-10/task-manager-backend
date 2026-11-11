import type { NextFunction, Request, Response } from 'express';
import { users } from '../models/index.js';
import { asyncHandler } from '../utils/asyncErrorHandler.js';
import bcrypt from 'bcrypt';
import { db } from '../config/db.config.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/globalErrorHandler.js';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

const ROLES = ['ADMIN', 'USER'] as const;
type Role = (typeof ROLES)[number];
 
const isRole = (value: unknown): value is Role =>
    typeof value === 'string' && (ROLES as readonly string[]).includes(value);



export const getAllUsers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const allUsers = await db.select({id:users.id,name:users.name,email:users.email}).from(users).where(eq(users.isActive,true));
    if(allUsers.length===0){
        throw new NotFoundError('No users found');
    }
    res.status(200).json({
        status_code: 200,
        message: "All users fetched successfully",
        data: allUsers,
    });
})

export const getOneUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const allUsers = await db.select({id:users.id,name:users.name,email:users.email}).from(users).where(and(eq(users.id,String(req.params.id)),eq(users.isActive,true)));
    if(allUsers.length===0){
        throw new NotFoundError('No users found');
    }
    res.status(200).json({
        status_code: 200,
        message: "One users fetched successfully",
        data: allUsers,
    });
})


export const getUsers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const page = Math.max(parseInt(String(req.query.page), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 10, 1), 100);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
 
    const rawRole = req.query.role;
    if (rawRole !== undefined && !isRole(rawRole)) {
        throw new BadRequestError('Role must be either admin or user');
    }
    const role = isRole(rawRole) ? rawRole : undefined;
 
    const filters = and(
        search ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)) : undefined,
        role ? eq(users.role, role) : undefined,
    );
 
    const [rows, totalRows] = await Promise.all([
        db.select()
            .from(users)
            .where(filters)
            .orderBy(desc(users.createdAt))
            .limit(limit)
            .offset((page - 1) * limit),
        db.select({ total: count() }).from(users).where(filters),
    ]);
    const total = totalRows[0]?.total ?? 0;
 
    res.status(200).json({
        status_code: 200,
        message: "Users fetched successfully",
        data: rows,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
        },
    });
});

export const patchUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { name, email } = req.body;
    const userId = String(req.params.id);
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (user.length === 0) {
        throw new NotFoundError('User not found');
    }
    const updateData: Record<string, unknown> = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if(req.body?.password){
       throw new BadRequestError('Password cannot be updated via this endpoint.'); 
    }
    if (Object.keys(updateData).length === 0) {
        throw new BadRequestError('No valid fields to update');
    }
    await db.update(users).set(updateData).where(eq(users.id, userId));
    res.status(200).json({
        status_code: 200,
        message: "User updated successfully",
    });
});