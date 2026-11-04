---
description: Run the full validation and local run workflow for the current ARS change, then report. Never commits or pushes.
---

# Finish Development Task — ARS

When I run `/finish-task`, automatically perform the complete development validation and local run workflow for the current ARS project.
Do not ask me to repeat these instructions.

## 1. Inspect Changes

- Check current Git branch and working tree.
- Review all modified, added and deleted files.
- Identify the modules and features changed.
- Preserve all unrelated existing changes.
- Read CLAUDE.md and PROJECT_MEMORY.md when relevant.

## 2. Code Quality

- Run the project's existing lint checks.
- Run TypeScript type checks.
- Run relevant backend and frontend tests.
- Fix errors introduced by the current changes.
- Do not hide or ignore failing tests.
- Do not modify unrelated business logic.

## 3. Database Safety

- Inspect database schema and migration changes.
- Generate new migrations when required by the existing project workflow.
- Never run destructive database commands.
- Never drop, reset, truncate or overwrite the `ars` database.
- Never run seed scripts against the migrated development database unless explicitly requested.
- Verify migrations before applying them.
- Preserve existing records and relationships.

## 4. Local Development Workflow

- Check that the local PostgreSQL (`npm run db:local`, port 54329, data in `backend/.pgdata`) is running; start it if not.
- Apply pending database migrations safely with `npm run migrate`.
- Rebuild the backend (`npm run build`) when source or dependency changes require it, because the `ars-api` preview runs the compiled `backend/dist`.
- Start or restart the `ars-api` and `ars-web` previews as necessary.
- Verify API and frontend startup.
- Verify API health endpoint.
- Verify frontend accessibility.
- Check application logs for errors.
- Confirm PostgreSQL connection.
- Confirm database persistence.
- Confirm uploaded file storage persistence.

Use:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- API health: http://localhost:4000/api/health
- PostgreSQL port: 54329

The application must use the local PostgreSQL through `DATABASE_URL` in `backend/.env`.

## 5. Regression Testing

- Test the modified feature.
- Test related existing modules.
- Verify role-based permissions and backend authorization.
- Verify API requests and responses.
- Check browser-facing functionality where possible.
- Report anything that cannot be tested automatically.

## 6. Documentation

Update relevant documentation only when necessary:

- CLAUDE.md
- README.md
- PROJECT_MEMORY.md

Do not create unnecessary documentation.

## 7. Git Safety

- Review `git diff` and `git status`.
- Check for exposed secrets, `.env`, database files, backups and uploaded documents.
- Never commit automatically.
- Never push automatically.
- Never reset or clean the Git working tree.
- Never discard unrelated changes.

## 8. Final Report

Provide a concise report with:

1. Features and files changed.
2. Lint and type-check results.
3. Backend and frontend test results.
4. Database migration status.
5. Build and server status.
6. API and frontend health.
7. Regression test results.
8. Security issues found.
9. Remaining problems or untested items.
10. Git status and suggested commit message.

## Important Rules

- Work independently wherever safe.
- Fix issues caused by the current task.
- Stop and ask for approval before destructive or irreversible actions.
- Never claim a test passed unless it actually ran successfully.
- Never compromise migrated ARS data.
- Do not commit or push without my explicit approval.

The goal is to leave ARS in a working, tested local development environment after every `/finish-task` execution.
