import { Router } from 'express';
import authRouter from './auth.routes.js';
import userRouter from './user.routes.js';
import projectRouter from './project.routes.js';
import taskRouter from './tasks.routes.js';
import { authenticate } from '../../utils/auth.middleware.js';

const Routers = Router();

Routers.use('/auth', authRouter);
Routers.use('/users',authenticate, userRouter);
Routers.use('/projects',authenticate, projectRouter);
Routers.use('/tasks', authenticate, taskRouter);

export default Routers;