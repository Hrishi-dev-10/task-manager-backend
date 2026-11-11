import type { Server as HttpServer } from "node:http";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import { db } from "../config/db.config.js";
import { users } from "../models/users.model.js";

export type LiveNotification = {
  title: string;
  message: string;
  createdAt: string;
};

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let io: Server | null = null;

function isLocalOrigin(origin: string | undefined) {
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function attachSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (isLocalOrigin(origin)) callback(null, true);
        else callback(new Error("Origin not allowed"));
      },
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    try {
      const claimed = socket.handshake.auth?.userId;
      const userId = typeof claimed === "string" ? claimed.trim() : "";
      if (!userIdPattern.test(userId)) {
        next(new Error("Unauthorized"));
        return;
      }
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        next(new Error("Unauthorized"));
        return;
      }
      socket.data.userId = user.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    if (typeof userId === "string" && userId) socket.join(roomFor(userId));
  });

  return io;
}

export function notifyUsers(userIds: string[], notification: LiveNotification) {
  if (!io) return;
  const rooms = [...new Set(userIds.filter(Boolean))].map(roomFor);
  const [first, ...rest] = rooms;
  if (!first) return;
  let target = io.to(first);
  for (const room of rest) target = target.to(room);
  target.emit("notification", notification);
}

function roomFor(userId: string) {
  return `user:${userId}`;
}
