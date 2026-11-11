import {Router} from "express";
import { createTask, getTasksByProjectId, updateTask } from "../../controllers/tasks.controller.js";


const taskRouter = Router();

taskRouter.post('/',createTask);
taskRouter.get('/',getTasksByProjectId);
taskRouter.patch('/:id',updateTask);

export default taskRouter
