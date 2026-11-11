import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncErrorHandler.js";
import { AppError, BadRequestError, ServerRequestError } from "../utils/globalErrorHandler.js";
import { tasks } from "../models/tasks.model.js";
import { db } from "../config/db.config.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { projects } from "../models/projects.model.js";
import { projectMembers } from "../models/project-members.model.js";
import { alias } from "drizzle-orm/pg-core";
import { users } from "../models/users.model.js";
import { requestUser } from "../utils/requestUser.js";
import { notifyTaskChange, taskChangeDetail } from "../realtime/notify.js";

export const createTask = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { name, description, projectId, assignedTo, assigneeId, status } = req.body;
    console.log(req.body)

    if (!name || !description || !projectId || !assignedTo || !assigneeId) {
        throw new BadRequestError('All fields are required');
    }
    const [result] = await db.insert(tasks).values({
        title: name,
        description,
        projectId,
        assignedTo,
        createdBy:assigneeId,
        ...(status ? { status } : {}),
    }).returning();
    if (!result) {
        throw new ServerRequestError('Task creation failed');
    }
    const caller = await requestUser(req);
    await notifyTaskChange({
        projectId: result.projectId,
        taskTitle: result.title,
        actorId: caller?.id ?? String(assigneeId),
        kind: "created",
    });
    res.status(201).json({
        success: true,
        data: result
    });
})

export const updateTask = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const taskId = req.params.id ?? req.params.taskId;
    const { name, description, assignedTo, status, projectId } = req.body;

    if (!taskId) {
        throw new BadRequestError('Task ID is required');
    }

    const [result] = await db.update(tasks)
        .set({
            ...(name ? { title: name } : {}),
            ...(description ? { description } : {}),
            ...(assignedTo ? { assignedTo } : {}),
            ...(projectId ? { projectId } : {}),
            ...(status ? { status } : {}),
            updatedAt: new Date(),
        })
        .where(eq(tasks.id, String(taskId)))
        .returning();

    if (!result) {
        throw new ServerRequestError('Task update failed');
    }

    const caller = await requestUser(req);
    const detail = taskChangeDetail({ name, description, assignedTo, status, projectId });
    await notifyTaskChange({
        projectId: result.projectId,
        taskTitle: result.title,
        actorId: caller?.id ?? null,
        kind: "updated",
        ...(detail ? { detail } : {}),
    });

    res.status(200).json({
        success: true,
        data: result
    });
});

export const getTasksByProjectId = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { projectId } = req.query;
    const caller = await requestUser(req);
    const assignedUser = alias(users, "assigned_user");
    const taskCreator = alias(users, "task_creator");
    const filters = [];
    if (projectId) filters.push(eq(projects.id, String(projectId)));
    if (caller?.role === "USER") {
        filters.push(inArray(
            tasks.projectId,
            db
                .select({ projectId: projectMembers.projectId })
                .from(projectMembers)
                .where(eq(projectMembers.userId, caller.id)),
        ));
    }

    const result = await db
        .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            position: tasks.position,
            projectId: tasks.projectId,

            createdAt: tasks.createdAt,
            updatedAt: tasks.updatedAt,

            assignedTo: {
                id: assignedUser.id,
                name: assignedUser.name,
                email: assignedUser.email,
            },

            createdBy: {
                id: taskCreator.id,
                name: taskCreator.name,
                email: taskCreator.email,
            },
        })
        .from(tasks)
        .innerJoin(
            projects,
            eq(tasks.projectId, projects.id)
        )
        .leftJoin(
            assignedUser,
            eq(tasks.assignedTo, assignedUser.id)
        )
        .leftJoin(
            taskCreator,
            eq(tasks.createdBy, taskCreator.id)
        )
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(tasks.createdAt));
    res.status(200).json({
        success: true,
        data: result
    });
})
