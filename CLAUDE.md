# CLAUDE.md

Ananta ARS (Automatic Recruitment System): `backend/` is a NestJS API, `frontend/` is a Next.js app. They are two independent projects.

## Read this first

**Before making any change to this project, read [PROJECT_MEMORY.md](PROJECT_MEMORY.md).** It documents the modules, features,
business rules, workflows, roles, permissions, architecture, database structure, implementation decisions and known gaps.

- Read at least sections 5 (roles and permissions), 6 (workflow) and 8 (rules that must not be broken), plus the sections for the area you are changing.
- Section 5.8 lists places where the code deliberately differs from the Roles & Permissions document. Do not "fix" those.
- If that file and the code disagree, trust the code, and correct the file in the same change.
- When a change alters behaviour, rules, permissions, the schema or setup, update `PROJECT_MEMORY.md` in the same change.

## Working rules

- Do not invent requirements. If a requirement is unclear, ask the owner before implementing.
- Do not commit or push unless the owner explicitly asks.
- Never commit or push any env file, `.env.example` included, or anything sensitive: passwords, secrets, keys, database data or dumps, uploaded CVs. Credentials have no defaults in the code. Check the staged files before every commit.
- Enforce permissions and data scope in the API, never only in the UI. New endpoints on vacancy-owned data need the guards in `backend/src/common/scope.ts`.
- Keep the backend and frontend separate, with features directly under `backend/src/<feature>/`. Do not reintroduce `apps/` or npm workspaces.
- Never edit an applied migration. Add a new one, named after the latest `17933000000NN` number.
- Docker PostgreSQL (`ars-dev-db-1`, volume `ars-dev_db_data`) is the only development database. Never run `down -v` or `seed` on it, and do not use `backend/.pgdata` or `npm run db:local`.
- Do not touch the `ars` database when testing; tests use `ars_test`. Do not delete requisitions, approval history or other records unless the owner asks.

## Commands (from the repo root)

```bash
docker compose -f docker-compose.dev.yml up -d
```

```bash
npm run migrate
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

The app runs in Docker. Without `--watch`, a backend change needs `docker compose -f docker-compose.dev.yml up -d --build`.
