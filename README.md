# Boardly

A Trello-style team project board built with FastAPI, React and PostgreSQL. Teams organise work into workspaces and boards, drag cards between lists, comment on tasks, and see every change appear live for everyone on the board.

**Live demo:** https://YOUR-VERCEL-URL.vercel.app

The backend runs on a free tier, so the first request after a period of inactivity can take about a minute while the server wakes up. All data in the demo is fake. Create your own account on the sign-up page to try it.

## About the project

Boardly demonstrates real-time, permission-aware application design:

- **Real-time collaboration:** a WebSocket connection per board broadcasts card moves, edits, comments and list changes to everyone viewing it, along with presence and typing indicators.
- **Stateless security:** JWT authentication, bcrypt password hashing and role-based access (owner, member, viewer) enforced on the server for every endpoint.
- **Efficient ordering:** cards use fractional positions, so dropping a card between two others updates a single database row.
- **Versioned schema:** database changes are managed with Alembic migrations.

## Features

**Workspaces and access**
- Sign up, sign in and sign out
- Create workspaces and add teammates by email as members (can edit) or viewers (read-only)
- Owners can delete boards; permissions are checked on the server, not just hidden in the UI

**Boards and cards**
- New boards start with To do, In progress and Done lists; add, rename and delete lists
- Drag and drop cards within and across lists, with the order saved
- Card details: description, assignee, due date, priority and colour-coded labels
- Overdue and due-today highlighting
- Search cards and filter by assignee or label

**Collaboration**
- Live updates for all changes, with a connection indicator and automatic reconnect
- See who is currently viewing the board
- "Is typing…" indicator in card comments
- Comments on every card, and a board activity log

**Interface**
- Light and dark mode
- Responsive layout that works on phones and tablets

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy 2.0, Alembic, WebSockets |
| Auth | JWT (PyJWT), bcrypt |
| Database | PostgreSQL (Docker locally, Neon in the cloud) |
| Frontend | React, TypeScript, Vite, Tailwind CSS, TanStack Query, dnd-kit, Axios, React Router |
| Hosting | Vercel (frontend), Render (API), Neon (database) |

## Architecture

```
React (Vercel) ──REST──► FastAPI (Render) ──► PostgreSQL (Neon)
      │                       │
      └────── WebSocket ──────┘
```

Every change goes through the REST API and is saved to PostgreSQL. The server then broadcasts a small event over the board's WebSocket room, and each connected client refreshes the affected data. Dragging a card updates the UI immediately and syncs in the background.

## Run locally

```bash
# Database (from the project root)
docker compose up -d

# Backend
cd backend
python -m venv venv
venv\Scripts\activate        # macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.seed           # optional demo data
uvicorn app.main:app --reload

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. API docs are at http://localhost:8000/docs.

With the seed data, sign in as `demo@boardly.dev` / `demo1234`.

## Environment variables

**Backend:** `DATABASE_URL`, `SECRET_KEY`, `CORS_ORIGINS`, `ENV`
**Frontend:** `VITE_API_URL`

Local defaults exist for development only. Set `ENV=production` and your own `SECRET_KEY` for anything deployed; the app refuses to start without one.

## Limitations

- Live updates run in memory on a single server instance. Scaling to several instances would need Redis pub/sub.
- Concurrent edits to the same card are last-write-wins.
- Teammates can only be added if they already have an account; there are no email invitations.
- No password reset, email verification or login rate limiting yet.
- Lists cannot be reordered, and there are no file attachments.
