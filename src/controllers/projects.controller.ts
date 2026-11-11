import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncErrorHandler.js";
import { BadRequestError, ConflictError } from "../utils/globalErrorHandler.js";
import { db } from "../config/db.config.js";
import { projects } from "../models/projects.model.js";
import { projectMembers } from "../models/project-members.model.js";
import { tasks } from "../models/tasks.model.js";
import { and, arrayContains, desc, eq, inArray, sql } from "drizzle-orm";
import { users } from "../models/users.model.js";
import { alias } from "drizzle-orm/pg-core";
import { requestUser } from "../utils/requestUser.js";
import { notifyAddedToProject } from "../realtime/notify.js";
import { notifications } from "../models/notifications.model.js";

export const createProject = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const { name, description, createdBy, projectMembers: members = [] } = req.body;
    if(!name || !createdBy){
        throw new BadRequestError('Name and createdBy are required');
    }
    const result = await db.transaction(async(tx)=>{
        const newProject:any= await tx.insert(projects).values({
            name,
            description,
            createdBy
        }).returning();

        await Promise.all(members.map(async (member: { userId: string }) => {
            return tx.insert(projectMembers).values({
                projectId: newProject[0].id,
                userId: member.userId
            });
        }));

        return newProject;
    })
    const created = result[0];
    if (created?.id) {
        const caller = await requestUser(req);
        await notifyAddedToProject(
            created.id,
            members.map((member: { userId: string }) => member.userId),
            caller?.id ?? String(createdBy),
        );
    }
    res.status(200).send({
        status: 'success',
        data: result[0]
    })
})


export const getProjects = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const projectCreator = alias(users, "createdBy");
    const caller = await requestUser(req);
    const onlyMembership = caller?.role === "USER"
        ? inArray(
            projects.id,
            db
                .select({ projectId: projectMembers.projectId })
                .from(projectMembers)
                .where(eq(projectMembers.userId, caller.id)),
        )
        : undefined;

const result = await db
    .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        createdAt: projects.createdAt,

        createdBy: {
            id: projectCreator.id,
            name: projectCreator.name,
            email: projectCreator.email,
        },

        members: sql<{
            id: string;
            name: string;
            email: string;
        }[]>`
            COALESCE(
                jsonb_agg(
                    DISTINCT jsonb_build_object(
                        'id', ${users.id},
                        'name', ${users.name},
                        'email', ${users.email}
                    )
                ) FILTER (WHERE ${users.id} IS NOT NULL),
                '[]'::jsonb
            )
        `,

        taskCount: sql<number>`
            COUNT(DISTINCT ${tasks.id})::int
        `,
    })
    .from(projects)
    .leftJoin(
        projectCreator,
        eq(projects.createdBy, projectCreator.id)
    )
    .leftJoin(
        projectMembers,
        eq(projects.id, projectMembers.projectId)
    )
    .leftJoin(
        users,
        eq(projectMembers.userId, users.id)
    )
    .leftJoin(
        tasks,
        eq(projects.id, tasks.projectId)
    )
    .where(onlyMembership)
    .groupBy(
        projects.id,
        projectCreator.id
    );
    res.status(200).send({
        status: 'success',
        data: result
    })
})

type ProjectMemberInput = { id?: string; userId: string };

const readProjectMembers = (value: unknown): ProjectMemberInput[] | undefined => {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new BadRequestError("projectMembers must be an array");
    }

    const members: ProjectMemberInput[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            throw new BadRequestError("Each project member needs a userId");
        }
        const userId = "userId" in entry && typeof entry.userId === "string" ? entry.userId.trim() : "";
        if (!userId) {
            throw new BadRequestError("Each project member needs a userId");
        }
        const id = "id" in entry && typeof entry.id === "string" ? entry.id.trim() : "";
        members.push(id ? { id, userId } : { userId });
    }

    const userIds = members.map((member) => member.userId);
    if (new Set(userIds).size !== userIds.length) {
        throw new BadRequestError("Duplicate project members are not allowed");
    }
    const ids = members.flatMap((member) => (member.id ? [member.id] : []));
    if (new Set(ids).size !== ids.length) {
        throw new BadRequestError("Duplicate project member ids are not allowed");
    }

    return members;
};

const syncProjectMembers = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    projectId: string,
    members: ProjectMemberInput[],
) => {
    const desiredUserIds = members.map((member) => member.userId);
    if (desiredUserIds.length > 0) {
        const foundUsers = await tx
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, desiredUserIds));
        if (foundUsers.length !== desiredUserIds.length) {
            throw new BadRequestError("One or more project members were not found");
        }
    }

    const current = await tx
        .select({ id: projectMembers.id, userId: projectMembers.userId })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));
    const currentById = new Map(current.map((member) => [member.id, member]));

    for (const member of members) {
        if (member.id && !currentById.has(member.id)) {
            throw new BadRequestError("Project member not found");
        }
    }

    const keptIds = new Set<string>();
    const assignedUserIds = new Set<string>();
    const reassignedUserIds: string[] = [];
    for (const member of members) {
        if (!member.id) {
            continue;
        }
        keptIds.add(member.id);
        assignedUserIds.add(member.userId);
    }
    for (const member of current) {
        if (keptIds.has(member.id) || !desiredUserIds.includes(member.userId) || assignedUserIds.has(member.userId)) {
            continue;
        }
        keptIds.add(member.id);
        assignedUserIds.add(member.userId);
    }

    const deleteIds = current.filter((member) => !keptIds.has(member.id)).map((member) => member.id);
    if (deleteIds.length > 0) {
        await tx
            .delete(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.id, deleteIds)));
    }

    for (const member of members) {
        if (!member.id) {
            continue;
        }
        const existing = currentById.get(member.id);
        if (existing && existing.userId !== member.userId) {
            await tx
                .update(projectMembers)
                .set({ userId: member.userId })
                .where(and(eq(projectMembers.id, member.id), eq(projectMembers.projectId, projectId)));
            reassignedUserIds.push(member.userId);
        }
    }

    const insertUserIds = desiredUserIds.filter((userId) => !assignedUserIds.has(userId));
    if (insertUserIds.length > 0) {
        await tx.insert(projectMembers).values(
            insertUserIds.map((userId) => ({ projectId, userId })),
        );
    }
    return [...insertUserIds, ...reassignedUserIds];
};

export const updateProject = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const { id } = req.params;
    const { name, description } = req.body;
    const members = readProjectMembers(req.body?.projectMembers);
    if(!id){
        throw new BadRequestError('Project ID is required');
    }
    if(!name && !description && !members){
        throw new BadRequestError('At least one field is required to update');
    }

    const projectId = String(id);
    const caller = await requestUser(req);
    const data = await db.transaction(async (tx) => {
        const result = await tx.update(projects).set({
            updatedAt: new Date(),
            ...(name ? { name } : {}),
            ...(description ? { description } : {}),
        }).where(eq(projects.id, projectId)).returning();
        if(result.length === 0){
            throw new BadRequestError('Project not found');
        }

        const addedUserIds = members ? await syncProjectMembers(tx, projectId, members) : [];

        const memberRows = await tx
            .select({
                id: projectMembers.id,
                userId: projectMembers.userId,
                joinedAt: projectMembers.joinedAt,
                name: users.name,
                email: users.email,
            })
            .from(projectMembers)
            .innerJoin(users, eq(projectMembers.userId, users.id))
            .where(eq(projectMembers.projectId, projectId));

        return {
            project: {
                ...result[0],
                members: memberRows,
            },
            addedUserIds,
        };
    });

    if (data.addedUserIds.length > 0) {
        await notifyAddedToProject(projectId, data.addedUserIds, caller?.id ?? null);
    }

    res.status(200).send({
        status: 'success',
        data: data.project,
    })
})

export const getProjectById = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const { id } = req.params;
    if(!id){
        throw new BadRequestError('Project ID is required');
    }
    const projectCreator = alias(users, "createdBy");

    const result = await db
        .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            createdAt: projects.createdAt,

            createdBy: {
                id: projectCreator.id,
                name: projectCreator.name,
                email: projectCreator.email,
            },

            members: sql<{
                id: string;
                name: string;
                email: string;
            }[]>`
                COALESCE(
                    jsonb_agg(
                        DISTINCT jsonb_build_object(
                            'id', ${users.id},
                            'name', ${users.name},
                            'email', ${users.email}
                        )
                    ) FILTER (WHERE ${users.id} IS NOT NULL),
                    '[]'::jsonb
                )
            `,

            taskCount: sql<number>`
                COUNT(DISTINCT ${tasks.id})::int
            `,
        })
        .from(projects)
        .leftJoin(
            projectCreator,
            eq(projects.createdBy, projectCreator.id)
        )
        .leftJoin(
            projectMembers,
            eq(projects.id, projectMembers.projectId)
        )
        .leftJoin(
            users,
            eq(projectMembers.userId, users.id)
        )
        .leftJoin(
            tasks,
            eq(projects.id, tasks.projectId)
        )
        .where(eq(projects.id, String(id)))
        .groupBy(
            projects.id,
            projectCreator.id
        );

    if(result.length === 0){
        throw new BadRequestError('Project not found');
    }

    const caller = await requestUser(req);
    if (caller?.role === "USER") {
        const [membership] = await db
            .select({ id: projectMembers.id })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, String(id)), eq(projectMembers.userId, caller.id)))
            .limit(1);
        if (!membership) {
            throw new BadRequestError('Project not found');
        }
    }

    res.status(200).send({
        status: 'success',
        data: result[0]
    })
})

const projectMemberSelection = {
    id: projectMembers.id,
    userId: projectMembers.userId,
    joinedAt: projectMembers.joinedAt,
    name: users.name,
    email: users.email,
};

export const addProjectMember = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const projectId = String(req.params.projectId ?? "");
    const memberId = String(req.params.memberId ?? "");
    if (!projectId) {
        throw new BadRequestError("Project ID is required");
    }
    if (!memberId) {
        throw new BadRequestError("Member ID is required");
    }

    const member = await db.transaction(async (tx) => {
        const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) {
            throw new BadRequestError("Project not found");
        }

        const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, memberId))
            .limit(1);
        if (!user) {
            throw new BadRequestError("User not found");
        }

        const [existing] = await tx
            .select({ id: projectMembers.id })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberId)))
            .limit(1);
        if (existing) {
            throw new ConflictError("User is already a project member");
        }

        await tx.insert(projectMembers).values({ projectId, userId: memberId });
        await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

        const [added] = await tx
            .select(projectMemberSelection)
            .from(projectMembers)
            .innerJoin(users, eq(projectMembers.userId, users.id))
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberId)))
            .limit(1);
        return added;
    });

    const caller = await requestUser(req);
    await notifyAddedToProject(projectId, [memberId], caller?.id ?? null);

    res.status(200).send({
        status: "success",
        message: "Project member added successfully",
        data: member,
    });
});

export const removeProjectMember = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const projectId = String(req.params.projectId ?? "");
    const memberId = String(req.params.memberId ?? "");
    if (!projectId) {
        throw new BadRequestError("Project ID is required");
    }
    if (!memberId) {
        throw new BadRequestError("Member ID is required");
    }

    const member = await db.transaction(async (tx) => {
        const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) {
            throw new BadRequestError("Project not found");
        }

        const [existing] = await tx
            .select(projectMemberSelection)
            .from(projectMembers)
            .innerJoin(users, eq(projectMembers.userId, users.id))
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberId)))
            .limit(1);
        if (!existing) {
            throw new BadRequestError("User is not a project member");
        }

        await tx
            .delete(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberId)));
        await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));

        return existing;
    });

    res.status(200).send({
        status: "success",
        message: "Project member removed successfully",
        data: member,
    });
});

export const deleteProject = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const projectId = req.params.id ?? req.params.projectId;
    if(!projectId){
        throw new BadRequestError('Project ID is required');
    }
    const result = await db.delete(projects).where(eq(projects.id, String(projectId))).returning();
    if(result.length === 0){
        throw new BadRequestError('Project not found');
    }
    res.status(200).send({
        status: 'success',
        data: result[0]
    })
})

export const showLastNotifications = asyncHandler(async(req:Request,res:Response,next:NextFunction)=>{
    const fromQuery = req.query.userId;
    const userId = String(req.params.id || (typeof fromQuery === "string" ? fromQuery : "")).trim();
    if(!userId){
        throw new BadRequestError('User ID is required');
    }
    const result = await db.select().from(notifications).where(arrayContains(notifications.toUser, [userId])).orderBy(desc(notifications.createdAt)).limit(3);
    res.status(200).send({
        status: 'success',
        data: result
    })
})