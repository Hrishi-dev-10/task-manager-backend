import {Router} from "express";
import { getAllUsers, getUsers, patchUser } from "../../controllers/user.controller.js";

const userRouter = Router();

userRouter.get('/',getUsers);
userRouter.patch('/:id',patchUser);

export default userRouter;