import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { db } from './config/db.config.js';
import Routers from './routes/v1/index.js';
import path from 'path';
import { AppError } from './utils/customErrorHandler.js';
import { errorHandler } from './utils/errorHandling.js';
import cors from 'cors';
import { attachSocket } from './realtime/socket.js';
const app = express();
const __dirname = import.meta.dirname;
// Middleware to parse JSON request bodies
app.use(express.json());
app.use(cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Refresh-Token", "X-User-Id", "X-User-Email", "Accept"],
    credentials: true,
}));

// Load environment variables from .env file
dotenv.config();
app.use('/api/v1', Routers);
app.use('/images', express.static(path.join(__dirname+'/public')));

// Define a port to listen on, using the PORT environment variable or defaulting to 3000
const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send('Hello, World!');
});


app.all('/{*path}', (req:Request, res:Response, next:NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(errorHandler);

const httpServer = createServer(app);
attachSocket(httpServer);

httpServer.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});