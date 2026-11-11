import { Router } from "express";
import { addProjectMember, createProject, deleteProject, getProjectById, getProjects, removeProjectMember, showLastNotifications, updateProject } from "../../controllers/projects.controller.js";
import { requireAdmin } from "../../utils/auth.middleware.js";

const projectRouter = Router();

projectRouter.get("/", getProjects);
projectRouter.get("/:id", getProjectById);
projectRouter.post("/",requireAdmin, createProject);
projectRouter.patch("/:id",requireAdmin, updateProject);
projectRouter.post("/:projectId/member/:memberId",requireAdmin, addProjectMember);
projectRouter.delete("/:projectId/member/:memberId",requireAdmin, removeProjectMember);
projectRouter.delete("/:id",requireAdmin, deleteProject);
projectRouter.get("/notifications/:id", showLastNotifications);

export default projectRouter;
