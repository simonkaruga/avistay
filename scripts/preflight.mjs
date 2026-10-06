#!/usr/bin/env node
/**
 * Runs before `npm start`: checks the dev environment and brings the database
 * up to date, with plain-English fixes instead of stack traces.
 * Never fails the start for a database problem — it warns and carries on.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const backend = join(root, "backend");
const win = process.platform === "win32";
const venvBin = join(backend, ".venv", win ? "Scripts" : "bin");

const red = s => `\x1b[31m${s}\x1b[0m`, yellow = s => `\x1b[33m${s}\x1b[0m`, green = s => `\x1b[32m${s}\x1b[0m`;
const problems = [];

if (!existsSync(join(root, "node_modules", "concurrently")) || !existsSync(join(root, "frontend", "node_modules")))
  problems.push("Node packages missing → run: npm run setup");
if (!existsSync(join(venvBin, win ? "uvicorn.exe" : "uvicorn")))
  problems.push("Python environment missing → run: npm run setup");
if (!existsSync(join(backend, ".env")))
  problems.push("backend/.env missing → copy .env.example to backend/.env and fill in DATABASE_URL");

if (problems.length) {
  console.error(red("\n✖ Can't start yet:\n") + problems.map(p => `  • ${p}`).join("\n") + "\n");
  process.exit(1);
}

// Database: apply any new migrations (forward-only, safe to run every start).
const alembic = join(venvBin, win ? "alembic.exe" : "alembic");
const mig = spawnSync(alembic, ["upgrade", "head"], { cwd: backend, encoding: "utf8" });
if (mig.status === 0) {
  console.log(green("✔ Database is up to date"));
} else {
  const out = `${mig.stdout}\n${mig.stderr}`;
  const reason =
    /could not connect|Connection refused|connection is bad/i.test(out) ? "PostgreSQL isn't running or DATABASE_URL in backend/.env is wrong."
    : /already exists/i.test(out) ? "The database has tables the migration history doesn't know about (it was partly built outside Alembic)."
    : "A migration failed.";
  console.warn(yellow(`\n⚠ Database not migrated: ${reason}`));
  console.warn(yellow("  The app will start, but pages using newer features will error. See docs/DEVELOPMENT.md → 'Database'.\n"));
}

// Redis is optional in dev: the backend falls back gracefully without it.
const redisPing = "import asyncio; from app.core.redis import redis; asyncio.run(redis.ping())";
if (spawnSync(join(venvBin, win ? "python.exe" : "python"), ["-c", redisPing], { cwd: backend }).status !== 0) {
  console.warn(yellow("⚠ Redis isn't running — fine for local testing (rate limits and background jobs are off)."));
}
