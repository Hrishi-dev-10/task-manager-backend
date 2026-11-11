import { Router } from 'express';
import { login, logout, refreshToken, registerUser, resetPassword } from '../../controllers/auth.controller.js';

const authRouter = Router();

authRouter.post('/login', login);
authRouter.post('/refresh-token', refreshToken);
authRouter.post('/logout', logout);
authRouter.post('/register', registerUser);
// Implement mailer to get mail and send reset password link to user.
authRouter.post('/reset-password', resetPassword);

export default authRouter;
