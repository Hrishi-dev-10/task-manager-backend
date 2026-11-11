import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../models/index.js';

dotenv.config();

const connectionString = (process.env.DB_LINK || process.env.DATABASE_URL || '').trim();

const pool = new Pool(
  connectionString ? { connectionString } : {},
);

export const db = drizzle(pool, { schema });