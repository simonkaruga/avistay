# Running Avistay locally

```bash
npm run setup     # first time: installs Node packages + Python environment
npm start         # checks your setup, migrates the database, starts both servers
```

- Website: http://localhost:5173 (Vite; `/api` is proxied to the backend)
- API: http://localhost:8000 (FastAPI, auto-reloads on save)
- Stop both with **Ctrl+C**.

Other commands: `npm run start:web` / `npm run start:api` (one side only), `npm run db:migrate`, `npm test`.

## Needs

| | |
|---|---|
| Node 20+ and Python 3.12 | |
| PostgreSQL running, `DATABASE_URL` set in `backend/.env` | copy `.env.example` → `backend/.env` |
| Redis (optional) | Without it: no rate limiting, OTP codes are kept in memory, Celery jobs don't run |

M-Pesa, SMS and email work in "dev mode" with empty keys — they print what they would send to the API console instead.

## Database

`npm start` runs `alembic upgrade head` every time; it's forward-only and safe.

If it warns **"tables the migration history doesn't know about"**, the database was partly built
outside Alembic. On a database with no data you care about, the simplest fix is a fresh one:

```bash
dropdb staynaivasha && createdb staynaivasha && npm run db:migrate
```
