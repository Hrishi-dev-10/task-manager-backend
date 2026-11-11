# Task Master — Backend API

REST + real-time API for a project and task management app. Admins create projects and manage membership; members see only the projects they belong to and work on tasks inside them. Changes are pushed to project members live over Socket.IO and stored as notifications.

## Features

- **Authentication** with short-lived JWT access tokens and long-lived refresh tokens. Each login creates a session row; refresh tokens are stored only as SHA-256 hashes and can be revoked on logout.
- **Role-based access** (`ADMIN` / `USER`). Admin-only routes guard project creation, editing, deletion and membership changes.
- **Projects** with members, task counts and creator info returned in a single query.
- **Tasks** with status (`PENDING`, `IN_PROGRESS`, `BLOCKED`, `IN_REVIEW`, `COMPLETED`), assignee and position.
- **Users** listing with pagination, search and role filter.
- **Live notifications**: task created/updated and "added to project" events are saved to the database and emitted to each recipient's Socket.IO room.
- Centralised error handling with typed errors (`BadRequestError`, `UnauthorizedError`, `NotFoundError`, etc.).

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime / language | Node.js (ESM), TypeScript |
| Framework | Express 5 |
| Database | PostgreSQL via `pg` |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Auth | `jsonwebtoken`, `bcrypt` |
| Real-time | Socket.IO |
| Dev tooling | `tsx` (watch mode) |

## Project structure

```
Backend/
├── drizzle/                 # Generated SQL migrations + snapshots
├── drizzle.config.ts        # drizzle-kit config (reads DATABASE_URL)
└── src/
    ├── server.ts            # App bootstrap: middleware, routes, HTTP + Socket.IO
    ├── config/db.config.ts  # pg Pool + Drizzle instance
    ├── models/              # Drizzle table definitions and relations
    ├── controllers/         # auth, users, projects, tasks
    ├── routes/v1/           # Route modules mounted under /api/v1
    ├── realtime/            # socket.ts (server) and notify.ts (notification helpers)
    └── utils/               # JWT helpers, auth middleware, error classes
```

## Getting started

### Prerequisites

- Node.js 20+ (the code uses `import.meta.dirname`)
- A running PostgreSQL database

### 1. Install

```bash
cd Backend
npm install
```

### 2. Configure environment

Create a `.env` file in `Backend/`:

```env
# Postgres connection string (DB_LINK is also accepted and takes priority)
DATABASE_URL=postgres://user:password@localhost:5432/taskmaster

# Required: secret used to sign and verify JWTs
JWT_SECRET=replace-with-a-long-random-string

# Optional
JWT_EXPIRES_IN=15m          # access token lifetime (s, m, h, d)
JWT_REFRESH_EXPIRES_IN=7d   # refresh token lifetime
PORT=5000                   # defaults to 3000 if unset
NODE_ENV=development        # "production" turns on Secure / SameSite=None cookies
```

> The frontend defaults to `http://localhost:5000/api/v1`, so set `PORT=5000` (or change the frontend base URL).

### 3. Set up the database

Make sure the `notifications` table is part of the schema first. It is defined in `src/models/notifications.model.ts` but is **not exported from `src/models/index.ts`**, and it is **not in the existing migration**. Add this line to `src/models/index.ts`:

```ts
export { notifications } from './notifications.model.js';
```

Then generate and apply migrations:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
# or, for quick local setup: npx drizzle-kit push
```

### 4. Run

```bash
npm run dev      # tsx watch src/server.ts
```

The API is served at `http://localhost:<PORT>/api/v1`.

### Creating the first admin

`POST /auth/register` always creates a `USER`; the `role` field in the body is ignored. Register an account, then promote it in the database:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the server with hot reload (`tsx watch`) |
| `npm run build` | Type-check and compile with `tsc` |
| `npm start` | Run `node dist/server.js` |

> `outDir` is commented out in `tsconfig.json`. Uncomment `"outDir": "./dist"` before using `build` + `start`.

## Authentication

1. `POST /api/v1/auth/login` returns `accessToken`, `refreshToken`, `expiresIn` and session info. The tokens are also set as `httpOnly` cookies (`token`, `refreshToken`).
2. Send the access token on every protected request: `Authorization: Bearer <accessToken>`.
3. When it expires, call `POST /api/v1/auth/refresh-token` with the refresh token to get a new pair.
4. `POST /api/v1/auth/logout` revokes the session.

Inactive accounts (`is_active = false`) cannot log in.

## API reference

Base path: `/api/v1`. 🔒 = requires a Bearer token. 👑 = also requires the `ADMIN` role.

### Auth

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/auth/register` | Create an account (`name`, `email`, `password`) |
| POST | `/auth/login` | Log in (`email`, `password`) |
| POST | `/auth/refresh-token` | Exchange a refresh token for new tokens |
| POST | `/auth/logout` | Revoke the current session |
| POST | `/auth/reset-password` | Set a new password (`email`, `password`) — see notes |

### Users 🔒

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/users` | Paginated list. Query: `page`, `limit` (max 100), `search`, `role` (`admin` / `user`) |
| PATCH | `/users/:id` | Update `name` and/or `email`. Passwords are rejected here |

### Projects 🔒

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/projects` | Projects with members and task count. `USER` sees only their own projects |
| GET | `/projects/:id` | Single project with details |
| POST | `/projects` 👑 | Create a project (`name`, `description`, `createdBy`, `projectMembers`) |
| PATCH | `/projects/:id` 👑 | Update name, description and members |
| DELETE | `/projects/:id` 👑 | Delete a project (cascades to tasks and memberships) |
| POST | `/projects/:projectId/member/:memberId` 👑 | Add a member (notifies them) |
| DELETE | `/projects/:projectId/member/:memberId` 👑 | Remove a member |
| GET | `/projects/notifications/:id` | Latest notifications for user `:id` |

### Tasks 🔒

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/tasks` | Create a task (`name`, `description`, `projectId`, `assignedTo`, `status`) |
| GET | `/tasks` | List tasks, newest first. Optional `?projectId=`. `USER` sees only their projects' tasks |
| PATCH | `/tasks/:id` | Update name, description, assignee, status or project |

## Real-time notifications

Socket.IO runs on the same port as the HTTP server. Connect with the user's id in the handshake:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', { auth: { userId: '<user-uuid>' } });
socket.on('notification', ({ title, message, createdAt }) => { /* ... */ });
```

Each user is placed in a `user:<id>` room. Events are emitted when a task is created or updated (to all other project members) and when a user is added to a project.

## Data model

```
users ──< project_members >── projects ──< tasks
  │                                          ▲
  ├──< sessions                              │ assigned_to / created_by
  └──< notifications >── projects            └── users
```

- **users**: `id`, `name`, `email` (unique), `password` (bcrypt), `role`, `is_active`, timestamps
- **projects**: `name`, `description`, `created_by`, timestamps
- **project_members**: unique `(project_id, user_id)` pairs
- **tasks**: `title`, `description`, `status`, `position`, `assigned_to`, `created_by`, indexed by project/status/position
- **sessions**: hashed refresh token, user agent, IP, expiry, revocation time
- **notifications**: `message`, sender, recipient id array, project

## Known limitations

These are worth fixing before any production use:

- **Password reset is unauthenticated.** `/auth/reset-password` changes a password knowing only the email. A mailer and reset-token flow still need to be implemented (the route has a TODO).
- **Socket.IO trusts a claimed `userId`.** The handshake checks the user exists but does not verify a JWT, so anyone with a user id could listen to that user's notifications.
- **CORS is hard-coded** to `http://localhost:5173`, and Socket.IO only accepts localhost origins.
- **Missing endpoints the frontend calls:** `DELETE /tasks/:id` and `PUT /tasks/order` (drag-and-drop persistence) are not implemented yet.
- `PATCH /users/:id` has no ownership or admin check, so any authenticated user can edit another user's name and email.
- `GET /` returns a placeholder "Hello, World!" and `createTask` logs request bodies to the console.

## License

ISC