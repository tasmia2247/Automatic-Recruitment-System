# PROJECT_MEMORY.md — Ananta ARS

Working memory for anyone (human or Claude) changing this project. It describes **what the code does today**, why it
does it, and what is still open.

- **Last reviewed against the code:** 2026-11-01
- **If this file and the code disagree, the code wins.** Fix this file in the same change.
- Requirements come from the documents in [section 2](#2-source-documents). Anything marked *not built* in
  [section 14](#14-known-gaps-limits-and-oddities) is not a feature, however the documents describe it.

## Contents

1. [Project at a glance](#1-project-at-a-glance)
2. [Source documents](#2-source-documents)
3. [Architecture](#3-architecture)
4. [Running and operating](#4-running-and-operating)
5. [Roles, permissions and data visibility](#5-roles-permissions-and-data-visibility)
6. [End-to-end workflow and statuses](#6-end-to-end-workflow-and-statuses)
7. [Backend modules](#7-backend-modules)
8. [Rules that must not be broken](#8-rules-that-must-not-be-broken)
9. [Database structure](#9-database-structure)
10. [Frontend](#10-frontend)
11. [Notifications and audit catalogue](#11-notifications-and-audit-catalogue)
12. [Testing](#12-testing)
13. [Implementation decisions](#13-implementation-decisions)
14. [Known gaps, limits and oddities](#14-known-gaps-limits-and-oddities)
15. [Open business questions](#15-open-business-questions)
16. [Keeping this file current](#16-keeping-this-file-current)

---

## 1. Project at a glance

Ananta ARS (Automatic Recruitment System) is a connected web application for **Ananta Companies**, currently a
**prototype / first development**. It runs recruitment from a department's manpower need through to HR-confirmed joining:

> Department quota → Form No. 01 requisition → approval → HR Approved Queue (coordinator assigned) → vacancy → job post,
> hiring circular → CV upload → extraction → rule-based screening → Excel summary →
> HR shortlist / override → individual invitation emails → attendance and written / interview / viva marks → final HR
> decision → result / joining-letter email → HR-approved joining → Joined Candidates.

**Automated:** CV text extraction, rule-based screening, sorting, email personalisation, Excel processing, notifications,
circular generation. **Always a human decision:** approving requisitions, shortlisting, final selection, confirming joining.

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, in `frontend/` |
| Backend | NestJS 11 (CommonJS), class-validator DTOs, in `backend/` |
| Database | PostgreSQL (must be UTF8), TypeORM 1.x entities with versioned migrations |
| Background work | DB-backed queue (`processing_jobs`) run by an in-process worker |
| Files | Private local disk under `STORAGE_DIR`, served only through authorised API routes |
| Documents | `exceljs` (Excel), `pdf-parse` and `mammoth` (reading CVs), `pdfkit` (circular PDF), `nodemailer` (email) |
| Auth | JWT in an httpOnly cookie, bcrypt password hashes |
| DB admin | pgAdmin only; the app connects through `DATABASE_URL` |

Next.js, React, NestJS, PostgreSQL, DTOs with class-validator and pgAdmin are the stack confirmed in SRS v3.1 §21.1.

Git: branch `main`, remote `origin` is `https://github.com/tasmia2247/Automatic-Recruitment-System` (public). Commit and push only when the owner asks.

---

## 2. Source documents

None of these are in the repository (`docs/` is empty). Paths are on the owner's machine.

| Document | Location | Role |
| --- | --- | --- |
| **SRS v3.1 Consolidated, TechStack** | `D:\Running Backup\Downloads\Ananta_ARS_Consolidated_Detailed_SRS_v3.1_TechStack.docx` | **Main requirements baseline.** `SRS x.y`, `AC-nn`, `NFR-nn` in code comments refer to this. |
| **Roles & Permissions Specification** | `D:\Running Backup\Downloads\Ananta_ARS_Roles_and_Permissions_Updated.docx` | Later than the SRS. Governs roles, dashboards and coordinators, **as adjusted by the owner's decisions** in [§5.8](#58-roles-document-versus-what-was-built). |
| Users & Roles UI mockup | Supplied as an image in the conversation | Functions only. The owner said to keep the current look. |
| Hiring circular samples (3 posters) | Supplied as images in the conversation | Visual reference for the generated PDF. |
| Earlier SRS | `D:\oct-2026\ARS\srs.docx` | Source of v3.1; superseded where they differ. |
| Form No. 01 and other references | `D:\oct-2026\ARS\` (`Form-1-Format on Manpower Requisition.docx`, overview doc, offer letter, appointment letter, CV bank / quota xlsx, employee forms, joining automation xlsx, `ARS_mail.pdf`) | Reference files. |

Order of authority: the owner's latest explicit instruction → Roles & Permissions Specification → SRS v3.1 → earlier documents.
The `README.md` holds setup, prototype defaults, backup steps and a short user guide.

---

## 3. Architecture

```
Browser ──> Next.js (port 3000) ──rewrites /api/*──> NestJS (port 4000, prefix /api) ──> PostgreSQL
                                                       │  ├─ global AuthGuard
                                                       │  ├─ global ValidationPipe
                                                       │  └─ in-process job worker
                                                       └──> STORAGE_DIR (CVs, attachments, outbox)
```

Same-origin `/api/*` through the Next.js rewrite (`frontend/next.config.ts`, target `API_URL`) lets the httpOnly cookie
work without CORS. The API root `/` redirects to `WEB_URL`.

### Repository layout

Laid out to match the owner's `D:\pos` project. **Do not reintroduce `apps/` or npm workspaces.**

```
D:\ARS
├─ package.json            root scripts only (npm --prefix backend|frontend ...)
├─ README.md  CLAUDE.md  PROJECT_MEMORY.md
├─ docs/                   empty
├─ backend/                independent project (own package.json, lock file, node_modules)
│  ├─ src/
│  │  ├─ main.ts, app.module.ts
│  │  ├─ config/index.ts   typed env config; reads backend/.env
│  │  ├─ common/           auth guard, permissions, permission-matrix, scope, services, pagination
│  │  ├─ database/         entities/, migrations/, seed.ts, data-source.ts
│  │  ├─ auth/  roles-permissions/  master/  requisitions/  vacancies/  candidates/
│  │  └─ cv-bank/  evaluation/  email/  joining/  processing/  screening/  system/
│  ├─ scripts/             local-db.js, sample-circular.ts
│  ├─ test/                Jest tests
│  └─ .pgdata/  storage/  mail-inbox/   local data and saved CV mails, git-ignored
└─ frontend/               independent project
   └─ src/  app/  components/  lib/
```

Feature folders use `<feature>.controller.ts`, `.service.ts`, `.dto.ts`, `.module.ts`. Exceptions:

- `master`, `system`: no service, the controller holds the queries.
- `processing`: the service is `jobs.service.ts`.
- `screening`: `screening.engine.ts` only, pure functions.
- `candidates/cv-extractor.ts`: pure extraction functions (`extractFromText`), plus `readCv` / `cvToText` for stored files.
- `candidates/pdf-layout.ts`: turns positioned PDF text into reading order (columns, rebuilt tables, name hint). Pure apart from `readPdfPages`.
- `vacancies/circular.ts`: circular building and rendering.
- `publicUser()` lives in `auth/auth.controller.ts` and is reused by `roles-permissions`.

### Request handling

1. `AuthGuard` (global `APP_GUARD`) skips `@Public()` routes. Otherwise it reads the `ars_token` cookie or a `Bearer` header,
   verifies the JWT, loads the user and refuses inactive or deleted accounts with 401.
2. It builds `AuthUser` (`id, name, email, departmentId, roles, permissions, scopes`) and checks `@RequirePerm(...)`.
   All listed permissions are required. A class-level `@RequirePerm` applies to every handler in the controller.
3. `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`: unknown body fields are rejected with 400.
4. Service code applies **record-level** checks: department scope, coordinator scope, workflow state.

### Backend conventions

- Critical writes run in `ds.transaction`, with `lock: { mode: 'pessimistic_write' }` where state is read then changed.
- Call `audit.log(m, ...)` and `jobs.enqueue(m, ...)` with the **transaction manager**, so they commit with the change.
- Field-level errors: `throw new BadRequestException({ message, fieldErrors: { field: 'text' } })`. The frontend shows them.
- Status codes: 400 invalid input, 403 permission/scope, 404 missing, 409 wrong workflow state or conflict.
- Lists use `ListQuery` / `paged()` / `skipTake()` (`page`, `pageSize` up to 500, `q`).
- Display IDs come from `IdService.next(m, kind)` using `id_counters`; primary keys are UUIDs.
- Bulk actions return per-item results; one bad item does not cancel the rest (CV upload, shortlist, schedule, email).
- Permissions in code use `P.X` from `common/permissions.ts`, never string literals.
- **DTO gotcha:** optional fields the client left out are present as `undefined` on the DTO. Filter them before
  `Object.assign` onto an entity whose logic reads those fields (see `updateUser`).
- `candidates/cv-extractor.ts` and `screening/screening.engine.ts` stay free of database access.
- **Security headers** (2026-11-05): `configureApp` removes `X-Powered-By` and sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and
  `Referrer-Policy: same-origin`; `frontend/next.config.ts` sends the same (plus a `Permissions-Policy`) on pages and `poweredByHeader: false`. SAMEORIGIN, not DENY,
  because the job post page shows the circular PDF in a frame.

### Frontend conventions

- Client components calling `api()` from `lib/api.ts`. Errors become `ApiError` with `fieldErrors`. A 401 redirects to `/login?next=...`.
- `useLoad(fn, deps)` for fetching, `useAction()` for mutations (`busy`, `error`, `fieldErrors`, `message`, `run`).
- Shared primitives are in `components/ui.tsx`: Button, Card, Table, Field, Modal, Tabs, Badge, Stat, Pager and others.
- `useAuth()` from `lib/auth.tsx` gives `user`, `permissions`, `scopes`, `can(...)`. Permission checks in the UI are a
  convenience only; **the API must enforce every rule**.
- `P` in `lib/auth.tsx` is a **hand-kept mirror** of backend codes. Add new codes there too.
- `reqStatusLabel()` in `lib/api.ts` shows `Pending Approval` as **Processing** and `Sent to HR` as **Approved**.
- `download(path)` in `lib/api.ts` saves an authorised file response.

---

## 4. Running and operating

From the repo root:

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install backend and frontend dependencies |
| `npm run db:local` | Start bundled PostgreSQL on port **54329**; data in `backend/.pgdata`; creates `ars` and `ars_test` on first run |
| `npm run migrate` | Run TypeORM migrations (ts-node, from `src`) |
| `npm run migrate:dist` / `npm run seed:dist` | The same from the compiled `dist`, for servers (README "Deploying to a server") |
| `npm run seed` | Idempotent seed. It can bring back seeded records that were soft-deleted, so do not run it on a database with real data |
| `npm run dev:api` / `npm run dev:web` | Watch-mode API (4000) / Next.js dev (3000) |
| `npm run build` | Build backend, then frontend |
| `npm run start:api` / `npm run start:web` | Run built output |
| `npm test` | Backend Jest suite (needs the database running) |
| `npm run typecheck` | `tsc --noEmit` in both projects |

Generate a migration from `backend/`: `npm run migration:generate -- src/database/migrations/Name`. Then rename the file and
class to the next `17933000000NN` number, because generated timestamps sort **before** the existing fixed-number migrations.

`.claude/launch.json` defines `ars-api` (`npm --prefix backend run start`, i.e. `node dist/main.js`) and
`ars-web` (`npm --prefix frontend run dev`).

### Environment (`backend/.env`, never committed)

`DATABASE_URL` and `JWT_SECRET` are required: the API, migrations and seed stop with an error without them. `seed` also needs `SEED_PASSWORD`. `npm run db:local` takes its password from `DATABASE_URL`. No credential has a default in the code. All other settings default in `backend/src/config/index.ts`.

`NODE_ENV`, `PORT`, `WEB_URL`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN` (8h), `COOKIE_SECURE` (`auto`: Secure only for HTTPS requests, read from `req.secure` or `X-Forwarded-Proto`; `true`/`false` force it), `SEED_PASSWORD`, `CAREER_EMAIL`,
`STORAGE_DIR` (`./storage`, relative to `backend/`), `MAIL_INTAKE_DIR` (`./mail-inbox`, relative to `backend/`), `MAX_UPLOAD_MB` (10), `ALLOWED_CV_EXTENSIONS` (pdf,docx,doc,txt),
`ID_FORMAT_REQUISITION|VACANCY|JOBPOST|CANDIDATE|APPLICATION|IMPORT`, `SMTP_HOST|PORT|SECURE|USER|PASS`, `MAIL_FROM`,
`WORKER_INTERVAL_MS` (3000), `WORKER_ENABLED`, `ALLOW_DIRECT_HR_VACANCY`, `REQUISITION_ID_ON` (`draft`|`submit`).
Frontend: `API_URL` (`frontend/.env.local`, default `http://localhost:4000`), read when the web app is **built** (rewrites are fixed at build time). Tests: `TEST_DATABASE_URL`, otherwise `DATABASE_URL` with the database name swapped to `ars_test`.

Empty `SMTP_HOST` means emails are written to `backend/storage/outbox/*.eml` and **not delivered**; transport is recorded as `dev-outbox`.

### No Docker

The owner removed Docker from the project on 2026-11-03; development runs locally with `npm run db:local`. Between 2026-11-01 and
2026-11-03 the data lived in a Docker database. Writes made there and not in `backend/.pgdata`: migration `1793300000006` (applied
locally again with `npm run migrate`), two `intake.scan` audit rows for scans of an empty folder, and one sign-in time. No CVs or
candidates. That copy, its volumes and the root `.env` holding its password are left on the PC, outside the project. Dumps are in
`backups/` (git-ignored).

### Operational lessons

- **The `ars-api` preview runs the compiled `dist/`.** After backend changes: migrate if needed, `npm run build`, restart. A
  "Cannot DELETE /api/..." style error meant the running API was an old build.
- Every sign-in updates `users.lastLoginAt` and `updatedAt`. Allow for that when comparing the database with a backup.
- **Port 4000 clash:** the owner's `D:\pos` backend also uses port 4000. Check before assuming ARS is the listener.
- After stale-UI reports, compare with what the server serves. Open tabs kept old page code once the dev server's
  live-reload connection failed; restarting `ars-web` and a hard reload fixed it.
- `backend/tsconfig.json` must not use `incremental`: `nest build` with `deleteOutDir` plus a stale tsbuildinfo gave a partial `dist`.
- Stopping the `db:local` npm process can leave `postgres.exe` running. Stop it with `pg_ctl stop -D backend/.pgdata -m fast`, using
  the `pg_ctl.exe` under `backend/node_modules/@embedded-postgres/windows-x64/native/bin/`.
- The machine's installed PostgreSQL 18 service needs a password that is not available here; development uses `db:local`.
- A database in another encoding rejects Bangla text. `local-db.js` forces UTF8, and the API logs an error on boot if the encoding is not UTF8.
- Backup: database and storage folder together. Commands are in the README (AC-28).
- **Deployment checks (2026-11-04):** before the `COOKIE_SECURE` setting, `NODE_ENV=production` always set a Secure cookie, so a plain-http
  address could not stay signed in. The Next `/api` proxy forwarded only **10 MB** per request (`experimental.proxyClientMaxBodySize`,
  now 100 MB) and cut larger CV / mail folder batches off with "socket hang up"; the pages now also batch uploads by size
  (`uploadBatches`, 80 MB). `npm audit`: NestJS bundled multer 2.4.0 (DoS advisory); `overrides: { multer: "$multer" }` in
  `backend/package.json` makes it use the patched direct dependency. The remaining moderate findings are the exceljs chain (uuid,
  minimatch); npm's only fix is downgrading exceljs to 3.x, and the affected code paths are not used.
- `npm ci` with `NODE_ENV=production` in the shell skips dev packages, and building, `npm run migrate` and `npm run seed` need them: use `--include=dev`.

---

## 5. Roles, permissions and data visibility

Source of truth: `backend/src/common/permissions.ts`, `common/permission-matrix.ts`, `common/scope.ts`.

### 5.1 How a user's rights are computed

`effective = (permissions of active roles) + user.extraPermissions − user.deniedPermissions − system-wide disabled codes`

Applied per request in `AuthGuard`. Disabled codes are cached for 30 seconds and the cache is cleared when an admin changes one.
Permission codes are fixed in code. A new code means nothing until the API checks it, so codes are not created at runtime.

### 5.2 Default roles

| Code | Name | Default permissions |
| --- | --- | --- |
| `DEPT_REQUESTER` | Department | `master.view`, `quota.view`, `quota.edit`, `requisition.view`, `requisition.create`, `requisition.edit`, `requisition.submit`, `requisition.cancel`, `joining.view_joined`, `dashboard.department` |
| `HR_RECRUITER` | HR | "HR core": `master.view`, `quota.view`, `quota.view_all_departments`, `requisition.view`, `requisition.view_all_departments`, `vacancy.view`, `vacancy.edit`, `jobpost.edit`, `candidate.view`, `candidate.edit`, `cv.upload`, `cv.download`, `candidate.duplicate_review`, `screening.run`, `report.export`, `selection.shortlist`, `selection.override`, `evaluation.attendance`, `evaluation.marks`, `evaluation.import`, `evaluation.overwrite`, `selection.final_decision`, `email.send`, `email.manage_template`, `joining.view`, `joining.view_joined`, `joining.approve`, `monitor.view`, `dashboard.hr` |
| `HR_MANAGER` | HR Manager | HR core + `hr.queue`, `hr.assign_coordinator`, `recruitment.view_all`, `vacancy.create`, `vacancy.create_direct`, `monitor.retry`, `audit.view` |
| `ADMIN` | Admin | `master.view`, `requisition.view`, `requisition.view_all_departments`, `approval.act`, `approval.act_on_behalf`, `dashboard.admin` |
| `APPROVER` | Designated Requisition Approver | `master.view`, `approval.act` |
| `CORPORATE_HR` | Corporate HR | `master.view`, `quota.view`, `approval.act`, `requisition.view`, `requisition.corporate_hr_remarks`, `requisition.quota_chart` |
| `CV_SCREENER` | CV Screening User | `vacancy.view`, `candidate.view`, `candidate.edit`, `cv.download`, `screening.run` |
| `EXAMINER` | Interview / Examiner | `vacancy.view`, `candidate.view`, `cv.download`, `evaluation.attendance`, `evaluation.marks`, `evaluation.import` |
| `READ_ONLY` | Read-only User | `master.view`, `quota.view`, `requisition.view`, `vacancy.view`, `candidate.view`, `joining.view`, `joining.view_joined`, `dashboard.hr` |
| `SUPER_ADMIN` | Super Admin | All permissions |

Codes not in any default role except Super Admin: `master.configure`, `requisition.manage_all`, `approval.configure_route`, `admin.users`.

`COORDINATOR_ROLES = ['HR_RECRUITER', 'HR_MANAGER']`: active members of these active roles are the coordinator candidates.

**Seed behaviour.** `seed.ts` creates missing roles and **does not overwrite existing roles** (Super Admin edits survive),
except `SUPER_ADMIN`, which is reset to all permissions on every run. So changing a default role for an existing database
needs a migration (see `1793300000002`). A new role is created by the seed.

### 5.3 Permission catalogue

The grid in `permission-matrix.ts` places every code in a module and action. Approve and Reject / Return share `approval.act`.

| Module key | Label | View | Create | Edit | Submit | Approve / Reject | Export | Manage | Other rights |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard` | Dashboard | `dashboard.department` | | | | | | | `dashboard.hr`, `dashboard.admin` |
| `quotas` | Positions & Quota | `quota.view` | | `quota.edit` | | | | | `requisition.quota_chart`, `quota.view_all_departments` |
| `requisitions` | Requisitions | `requisition.view` | `requisition.create` | `requisition.edit` | `requisition.submit` | | | `requisition.manage_all` | `requisition.cancel`, `requisition.corporate_hr_remarks`, `requisition.view_all_departments` |
| `approvals` | Approver Inbox | `approval.act` | | | | `approval.act` (both) | | `approval.act_on_behalf` | |
| `hr_queue` | HR Approved Queue | `hr.queue` | `vacancy.create` | `hr.assign_coordinator` | | | | | |
| `recruitment` | Vacancies & Job Posts | `vacancy.view` | `vacancy.create_direct` | `vacancy.edit` | | | | `recruitment.view_all` | `jobpost.edit` |
| `candidates` | Candidates (CV Bank) | `candidate.view` | `cv.upload` | `candidate.edit` | | `selection.shortlist` (approve only) | `report.export` | `candidate.duplicate_review` | `cv.download`, `screening.run`, `selection.override` |
| `interviews` | Interviews / Exam / Viva | | `evaluation.import` | `evaluation.marks` | | `selection.final_decision` (approve only) | | `evaluation.overwrite` | `evaluation.attendance` |
| `email` | Recruitment Email & Templates | | | | `email.send` | | | `email.manage_template` | |
| `joining` | Joining | `joining.view` | | | | `joining.approve` (approve only) | | | `joining.view_joined` |
| `master` | Master Data | `master.view` | | | | | | `master.configure` | |
| `users` | Users & Roles | | | | | | | `admin.users` | |
| `approval_config` | Approval Configuration | | | | | | | `approval.configure_route` | |
| `monitor` | Processing Monitor | `monitor.view` | | `monitor.retry` | | | | | |
| `audit` | Audit Log | `audit.view` | | | | | | | |

### 5.4 Department scope (Access Scope)

Modules: `dashboard`, `quotas`, `requisitions`, `joining`. Stored per user in `users.departmentScopes`.

- Modes: `own` (the user's `departmentId`), `all`, `custom` (listed departments, at least one).
- No entry for a module means **Role default**: all departments if the user holds the module's default permission, otherwise own.
- Default permissions (`ALL_BY_DEFAULT`): `dashboard` and `quotas` → `quota.view_all_departments`; `requisitions` →
  `requisition.view_all_departments`; `joining` → `recruitment.view_all`.
- A user Access Scope **overrides** those permissions in both directions.
- `departmentScope(user, module)` returns `null` for all, otherwise a list of IDs. It throws 403 if "own" applies and the user has no
  department. `resolveScope` returns `undefined` in that case instead.
- A department filter can narrow a scope but never widen it.
- `/auth/me` returns the resolved scopes; the frontend uses them for department pickers and subtitles.

Who sees what by default:

| Data | Department | HR / HR Manager | Admin | Super Admin |
| --- | --- | --- | --- | --- |
| Positions & Quota | Own | All (view) | None | All |
| Requisitions | Own | All (view) | All | All |
| Joined candidates | Own, no email/phone, no links | Coordinated vacancies / every vacancy | None | All |

Extra requisition access (`assertCanView`): holders of `hr.queue` can open `Sent to HR` requisitions, and anyone named on the requisition's
approval actions can open it. `GET /requisitions/:id` has no `@RequirePerm`; this check is its gate.

### 5.5 Coordinator scope (recruitment data)

`coordinatorScope(user)`: `null` with `recruitment.view_all`, otherwise the user's ID. Without `recruitment.view_all`, a user sees
only vacancies where `vacancies.coordinatorId` is them. Other HR users get 403 from the API, not just a hidden row.

Guards in `common/scope.ts`: `assertVacancyAccess`, `assertJobPostAccess`, `assertApplicationAccess`, `assertApplicationsAccess`,
`assertDocumentAccess`, `assertImportAccess`, `assertJoiningAccess`. List queries filter directly (vacancies, CV bank, email history,
joining, HR dashboard). **Any new endpoint touching vacancy-owned data must use one of these.**

Unmatched intake (CV Bank → Unmatched CVs: scan, move, delete) requires `recruitment.view_all` as well as `cv.upload`, because those CVs belong to no vacancy yet.

### 5.6 Final approval authority

`approval.act_on_behalf` (Admin, Super Admin): see every pending requisition in the inbox and decide any pending step. See
[§6.2](#62-approval-mechanics). It does **not** allow editing requisitions; that is `requisition.manage_all` (Super Admin).

### 5.7 Administration safeguards

- You cannot deactivate yourself or remove your own `admin.users`.
- The `SUPER_ADMIN` role must stay active and keep `admin.users`.
- `admin.users` cannot be switched off system-wide.
- Built-in roles (`DEFAULT_ROLES`) cannot be deleted, only deactivated, because the seed would recreate them.

### 5.8 Roles document versus what was built

These differences are deliberate, confirmed by the owner on 2026-10-29. Do not "correct" them back to the document.

| Roles document says | Built |
| --- | --- |
| Requisition approve / Approver Inbox: Admin only (Super Admin "—") | **Admin and Super Admin**; one approval from either is final |
| HR Approved Queue: matrix says HR ✓; §8 says HR manager + Super Admin; §8.3 says Admin retains access | **HR Manager + Super Admin only.** Plain HR and Admin get 403 |
| Keep Approve and Return/Reject as separate permissions | **One permission**, `approval.act` |
| Matrix columns: Department, HR, Admin, Super Admin | Added an **HR Manager** role for §8. Older roles (Approver, Corporate HR, CV Screener, Examiner, Read-only) stay assignable by Super Admin |
| Plain HR | **Only assigned vacancies**; the full CV bank and unassigned vacancies are for HR Manager / Super Admin |
| Other coordinators' records may be reached if "an authorized Admin intervenes" | Only `recruitment.view_all` holders see them |
| New requisition for HR: "Authorized" | Not in the HR default role; grant individually |
| Audit Log for HR: "Authorized view" | HR Manager only by default |
| Processing Monitor for HR: "Authorized operational view" | `monitor.view` for HR; retry (`monitor.retry`) for HR Manager. The **screen was removed** (owner, 2026-11-04); the API and these codes remain, with no page using them |

**Recruitment is coordinator-only** (owner, 2026-11-04): a vacancy, its job posts, CV scan, CVs and CV Bank are seen only by its coordinator,
with HR Manager seeing everything consolidated and Super Admin everything. Migration `1793300000007` removed `recruitment.view_all` from CV Screener,
Examiner and Read-only, so they see no vacancy unless they are its coordinator (only HR / HR Manager can be) or Super Admin grants
`recruitment.view_all` to that user.

### 5.9 Seeded accounts (password = `SEED_PASSWORD`)

`admin` (Super Admin, ICT), `requester.ict`, `requester.admin` (Department), `director`, `concerned.hr`, `aded`, `hod.hr` (Approver),
`corporate.hr` (Corporate HR), `approval.admin` (Admin, no department), `hr.manager` (HR Manager), `recruiter`, `recruiter2` (HR),
`screener` (CV Screener), `examiner` (Examiner), `viewer` (Read-only, no department). All are `@ars.local`.

---

## 6. End-to-end workflow and statuses

### 6.1 Requisition

Statuses (`REQ_STATUS`): `Draft`, `Pending Approval`, `Returned for Clarification`, `Rejected`, `Sent to HR`, `Cancelled`.
`Approved` exists in the constant but **is never stored**; `Sent to HR` is the persisted fully approved state. It appears only as a
value inside the audit entry. The UI labels: Pending Approval → Processing, Sent to HR → Approved.

```
Draft ──submit──> Pending Approval ──final approval──> Sent to HR ──> vacancy
  ^                 │      │    │
  │                 │      │    └─reject──> Rejected (terminal; raise a new requisition)
  └──resubmit── Returned ◄─┘ return
Draft / Returned / Pending ──cancel──> Cancelled
```

- **ID:** `reqNo` issued at draft by default (`REQUISITION_ID_ON`), otherwise at first submit; never changes.
- **Edit:** only `Draft` and `Returned`, by the requester or a `requisition.manage_all` holder, and the department must be in scope.
- **Submit validation** (`validateForSubmit`, returned as `fieldErrors`, draft kept): rank, headcount ≥ 1, background, seats available,
  deadline 30 or 60 days, gender, the four current-quota / present-manpower numbers. Replace Plan = Yes needs the employee name and a
  termination reference or `TERMINATION_REQUEST` attachment. A vacancy figure differing from quota − present needs an override reason.
- **Vacancy figures:** default to quota − present; a manual value is kept.
- **Route choice:** the department's active route, otherwise the default route (`departmentId` null). Only `required` steps create actions.
- Submitting something already pending is a no-op.

### 6.2 Approval mechanics

Approval actions are per `(requisitionId, version, stepOrder)`, statuses `Waiting`, `Pending`, `Approved`, `Returned`, `Rejected`, `Superseded`.
Prototype default route: Concerned Director → Concerned HR → Concerned AD/ED → Corporate HR → HOD-HR, sequential, one named approver per step.

- **Named approver on the current step:** approves that step only; the next `Waiting` step becomes `Pending` and is notified.
  After the last step the requisition becomes `Sent to HR`.
- **Final approver on behalf** (`approval.act_on_behalf`, current step belongs to someone else): must send `actionId`, otherwise 400.
  That one approval is **final**: the step records `actedById`, remaining `Waiting` steps become `Superseded` with the remark
  "Not required: approved by <name> (final approval)", and the requisition goes to `Sent to HR` in the same transaction. Audit keeps
  `onBehalfOf` and `skippedSteps`. **Display** (owner, 2026-11-04): on the requisition page and the printed form those closed steps show **Approved**, with
  "Approved by <name> (final approval)" and the final approval's date (`approvalStep()` in `frontend/src/lib/api.ts`, keyed on that remark). The stored status
  stays `Superseded`, so the record never claims the named approver acted.
- **If a final approver is themself the named approver of the current step**, it is a normal step approval, not final.
- **Reject / Return:** reason of at least 3 characters; `Waiting` steps become `Superseded`; requester notified. On-behalf decisions need
  `actionId` too.
- **Decision documents:** approve, reject and return accept JSON, or multipart with an optional `file` (pdf, docx, doc, jpg, jpeg, png). Stored as
  `requisition_attachments` with `kind = 'APPROVAL'` and `approvalActionId`, shown under that step, not with form attachments.
- **Idempotency:** a repeated click on an already approved step returns `{ duplicate: true }` and records nothing. A stale `actionId` on a step not
  awaiting a decision is 409.

**Resubmission:** version increments and the old version's actions stay as history. If no `APPROVAL_CRITICAL_FIELDS` value changed and the route
is unchanged, steps approved before the returning step are carried forward (`carriedOver`) and approval resumes at the returning step. Otherwise it
restarts from the first step. Critical fields: department, company, position, rank, headcount, replace plan, replacement name and ID, termination
reference, present and proposed salary, current and revised quota for department and designation.

**Cancel:** from Draft, Returned or Pending, by the requester holding `requisition.cancel`, or by a holder of `approval.configure_route`. Reason of
at least 3 characters. Open actions become `Superseded`.

**Route edits** apply to future submissions; in-flight approvals keep their assigned approvers. Only one active route per department or as default.
Every step needs an active named account.

### 6.3 Quota revision

Revised quota on the form stays a proposal. Corporate HR (`requisition.quota_chart`) sets *Inserted in quota chart?* to Yes, No or Not Applicable.
**Yes** is allowed only at `Sent to HR`, and on first setting it writes `revisedQuotaDept` to the department row and, if the requisition has a position,
`revisedQuotaDesig` to the designation row, creating the row if needed. Remarks need `requisition.corporate_hr_remarks`.

### 6.4 HR queue, coordinator, vacancy

1. The HR Approved Queue lists `Sent to HR` requisitions. The API default view is `pending` (no vacancy yet); **the page defaults to All approved**.
2. HR Manager picks a **Coordinator** (a list of active HR users) and creates the vacancy, in either order. The coordinator is stored on the requisition
   and copied to the vacancy on creation; afterwards assignment updates both in one transaction.
3. The vacancy takes the requisition's **attached company** (`companyId`), shown as "Attached company" on the vacancy overview and, read-only, on each job post, and printed on the circular.
4. `vacancies.coordinatorId` drives access. Reassigning moves access at once. `null` clears it (Unassigned). Holders of `hr.assign_coordinator` can also
   change it from the Vacancies list and the vacancy page.

Vacancy statuses: `Open`, `Posting`, `Screening`, `On Hold`, `Filled`, `Closed`.

- First job post: Open → Posting. First CV: Open/Posting → Screening. Approved joinings reaching headcount: → Filled.
- Manual status change accepts any listed status and is audited as `vacancy.status_change`.
- Closed or Filled vacancies refuse new job posts and CVs.
- One vacancy per requisition (unique partial index); creating twice returns the existing one with `duplicate: true`.
- Only `Sent to HR` requisitions can become vacancies (409 otherwise).
- **Direct HR vacancy:** needs `vacancy.create_direct` and `ALLOW_DIRECT_HR_VACANCY`, a reason of at least 5 characters, source `DIRECT_HR`, shown as
  *Direct HR Entry*. It has its own optional **Specialization required** (the four fields; set in the create form, edited in a dialog on the vacancy page by `vacancy.edit`; a change to any of them bumps
  `specializationVersion` and is audited as `vacancy.update`). A requisition vacancy refuses it (400): it uses the approved requisition's. The coordinator can be chosen in the create form (optional; needs `hr.assign_coordinator`, active HR users only) or later, and a
  chosen one is audited and notified like any assignment. Direct vacancies have no requisition, so they never appear in the HR Approved Queue.

### 6.5 Job post

Statuses and transitions: Draft → Published or Cancelled; Published → Closed or Cancelled; Closed → Published; Cancelled is final. Publishing needs no
screening criteria. Closed and Cancelled posts cannot be edited. Deadline must not precede the start date. A vacancy may have several posts. Default CV
method: `Email CV with subject "Application for <designation> - <department>"`. **No job ID** in the CV method or the email subject (owner,
2026-11-05): the subject is the one typed on the post, else "Application for <designation> - <department>"; the mail scan matches designation and department,
and mails that tie between identical open posts go to Unmatched CVs. Migration `1793300000012` rewrote only untouched old defaults.

**What a new job post starts with** (owner, 2026-11-05; `jobPostPrefill()` in `vacancies.service.ts`): from the requisition, *Min Edu. Qualification* →
`education`, *Experience* → `experienceRequirement`, *JD of this position* → `duties` (Key responsibilities), *Skills* → `skills` (one per line). A Direct HR
vacancy gives only its Skills. Whatever the request sends wins. The other *Specialization required* fields (screening education, minimum years, other
requirements) never go on a post. `GET job-posts/:id` returns no requisition or `screening` block, only `prefill` with those four values: a **Draft** post
opened by someone with `jobpost.edit` shows them in the fields it left empty, with a note to check and Save (nothing is saved until Save).
The generated circular (PDF and text, so also Copy text) prints the same values for any field the post leaves empty, saved or not; an experience
written as a bare number ("2") prints as "2 years".

**No screening criteria on job posts** (owner, 2026-11-04): the criteria editor and `POST job-posts/:id/criteria` were removed. Screening uses the
requisition's *Specialization required* ([§6.6](#66-cv-intake-to-screening)). The `screening_criteria_sets` tables stay only so that older runs remain explainable.

**Hiring circular** (`vacancies/circular.ts`): `GET /job-posts/:id/circular-file?format=pdf|txt&download=1`, built fresh from saved details.
Layout (owner, 2026-11-05, after Ananta's printed circulars): "We're Hiring!", a title bar "Designation – Department Department" with the company
under it, the intro, VACANCY INFORMATION with icons (Department, Job Location, Employment Type, Job Shift if set, Experience, Vacancy if more than one,
Salary), KEY RESPONSIBILITIES beside REQUIRED SKILLS and a dashed EMAIL SUBJECT box, EDUCATION & EXPERIENCE, the "Send your CV to" bar, the deadline,
and the logo. Drafts are **not** marked on the PDF or text (the page shows the status). The logo is `backend/assets/circular-logo.png|jpg` when present
(the Ananta globe logo, cut from the owner's sample circular, 2026-11-05), between two rules ending in dots; else the ANANTA wordmark. The job post page shows the PDF in a preview frame above the text version.

- Facts: company, department, location, employment type (default Full-time), shift if set, experience, vacancy count (headcount), salary (default "As per company policy").
- `description` is the intro; `duties` become responsibilities; `skills` one per line. Leading bullets and numbers typed by users are stripped.
- Apply address: `applyEmail`, else `CAREER_EMAIL`. The email subject has no job number (designation and department only, see above).
- Drafts are not marked on the PDF or text and can be downloaded.
- The A4 poster shrinks text to as little as 70% to fit one page; responsibilities that still do not fit continue on a second page.
- Separate from these: a manually uploaded circular attachment (pdf, jpg, jpeg, png) and pasted `circularContent`, which the generated circular does not use.

### 6.6 CV intake to screening

1. **Manual upload / CV folder scan** (`POST /vacancies/:id/cvs`, up to 50 files): per-file result. On the vacancy's Candidates tab HR can choose a folder on their PC (`webkitdirectory`); every PDF, DOCX, DOC or TXT in it goes into **this** vacancy (no subject matching), sent 20 files per request; other files are skipped. Types from `ALLOWED_CV_EXTENSIONS`, size limit, and a signature check for PDF and DOCX.
   **Mail scan:** HR saves mails as `.eml` files. `POST /intake/scan-files` takes a folder picked in the browser (`webkitdirectory`, sent 20 mails per request; the files stay on the user's PC). `POST /intake/scan` reads the server folder `MAIL_INTAKE_DIR` (`backend/mail-inbox/`), up to 200 mails per scan, and moves each to `processed/` or `failed/`; nothing is deleted. Each subject goes through `candidates/subject-match.ts`: a Published post of an open vacancy matches on **position name from the circular plus department** (name or code), or the circular's custom subject. The longest position wins, so "Sr. Executive" beats "Executive". Company, then Job ID, only separate ties. Anything still unclear becomes `Unmatched` for manual assignment; ARS never guesses. The scan and the unmatched list live on **CV Bank → Unmatched CVs** (`/cv-bank/unmatched`); the separate "Mail folder / Unmatched CVs" menu item and `/intake` page were removed (owner, 2026-11-04). There HR selects mails and either **moves** them (department → designation → vacancy, when several open vacancies share both; one `POST intake/:id/assign` per mail) or **deletes** them permanently (`DELETE intake/:id`: only `Unmatched` / `Failed`, 409 otherwise; erases the row and the stored `intake` copies; applications already made from it keep their own CV copy; audited as `intake.delete` with subject, sender and file names; scanning the same mail again brings it back). `Message-ID` (or the file's SHA-256) stops a mail being imported twice. Only attachments with allowed CV extensions count, so photos and logos are skipped. The candidate's email comes from the CV, not the mail sender, because mails are often forwarded by HR or a job portal. `receivedAt` is the mail's date.
2. Each accepted file creates a new `Candidate`, `Application`, `CandidateDocument` and an `EXTRACTION` job. The application attaches to the latest Published
   post, else the latest post. The **same file twice for one vacancy is refused** (SHA-256).
3. **Extraction** (`rules-2.0`, rewritten 2026-11-05 against real CVs: Bdjobs exports, two-column designed CVs, labelled HR CVs): deterministic rules over text
   from txt, pdf or docx. `.doc` and text-less (scanned) files fail for manual review.
   - **PDF reading** (`pdf-layout.ts`): uses the positions of the text (pdf.js bundled in `pdf-parse`, through its `load()`; falls back to plain `getText()`).
     A page with a vertical gutter whose sides do not share baselines is read left column first (a narrow strip of side headings is not a column).
     Tables with a known header (Exam Title / Concentration/Major / Institute / Result / Pass.Year, Training Title / Topic / ..., Certification / From / To,
     Language / Reading / ...) become one line per row: `Exam Title: BSc | Institute: X | Result: CGPA 3.1 (out of 4) | Pass.Year: 2017`. Rows start at the
     year (or From) cell; wrapped cells are joined. The biggest text near the top of page 1 is passed as `nameHint`.
   - **Sections**: the text is cut at known headings (also "Heading: text", "Heading<tab>text", letter-spaced "S K I L L S"). Lines under References are ignored for
     email, phone, address, name and jobs. A Bdjobs "Job Title:" at the top is the post applied for, never a job held.
   - `name`: nameHint, else a "Name:" label (not Father's / Mother's / referee), else the first name-like line. `phone`: first Bangladeshi mobile, stored as `01XXXXXXXXX`.
   - Education: rows or degree lines (in the education section; anywhere when there is none) each with their own subject, institute, result and year. `degree` is the
     highest **finished** one (an enrolled / appeared PGD or master does not replace a finished bachelor; a running bachelor counts when nothing higher is finished).
     `cgpa` / `cgpaRaw` / `institution` / `specialization` belong to that degree (no longer the first CGPA in the file, which was often the HSC GPA out of 5).
     Bdjobs junk majors ("Degree", "Madrasa") are not subjects. `education` lists up to 5 entries.
   - Experience: `totalExperienceYears` prefers "Total ... experience: N" over "N years of experience" in a summary. Jobs come from Bdjobs entries
     ("1. Title (N yrs)" + date line + company), else labelled Designation/Job Position + Company pairs, else date-range lines in the experience section split into
     title and organization by word lists. `lastPosition` / `workplace` are the first job; `previousJobs` lists all, one per line.
   - `skills`: the skills section items, plus Bdjobs "Area of Expertise" values; the Bdjobs HTML description is dropped when a bullet list exists.
     `certifications`: training / certification table rows as "Title (Institute, Year)", or the section's lines with wrapped lines joined.
   - `address`: present / mailing / "Present:" / "Address:" label, else the unlabelled address between the name and the phone (Bdjobs header) or a contact block at
     the top, else the permanent address. `age`: an "Age:" label, else worked out from a written date of birth on the day of extraction (14 to 80 only).
   - Tests: `test/cv-extraction.spec.ts` uses made-up people in these layouts; the real CVs are personal data and are not in the repo.
   CVs already in the database keep the values from the old extractor until they are processed again; nothing re-extracts them automatically.
   None of address, certifications, previousJobs, skills, lastPosition, specialization is a core field.
   Values only if literally present. CGPA is normalised only on an explicit /4 scale or a value ≤ 4 with no scale. Missing core fields (name, email, phone, degree,
   cgpa, total experience) give `Partial` / `Review Required`. `relevantExperienceYears` is never extracted, only entered by correction. Fields a human corrected are
   never overwritten.
4. **Duplicate detection:** same normalised email, same phone (last 10 digits) or identical file on another candidate sets `duplicateReview = PENDING` with evidence. HR
   chooses merge or keep separate. **Never automatic.** Merge is refused if the target already has an application for that vacancy. A candidate left with no applications gets `mergedIntoId`.
5. **Screening** checks the requisition's **Specialization required**, or a Direct HR vacancy's own (owner, 2026-11-04). Since 2026-11-05 (owner) it is four fields,
   on the requisition's Position details card and on Direct HR vacancies (`SpecializationFields.tsx`); `requirementCriteria()` builds the criteria.
   On the requisition form, typing "Min Edu. Qualification" fills Education / Qualification and the number in "Experience" fills Minimum experience, until
   HR changes those by hand (form only; the API does not copy them). Of these, only Skills goes on a job post (see §6.5):
   - **Education / Qualification** (`requiredEducation`, operator `education`): alternatives on separate lines, ";" or " or " (one is enough). Each passes when the CV's
     highest degree (degree field or education list, `degreeRank` from the extractor) is at that level or higher, a named degree ("BSc", "MBA", with full names such as
     "Bachelor of Science") is on the CV unless the CV holds a higher degree, and the subject ("in X", split on "/" "," " or "; "any ..." means none) is written in the CV.
   - **Minimum experience (years)** (`requiredExperienceYears`, operator `min_years`): HR's `relevantExperienceYears` if entered, else `totalExperienceYears`.
   - **Skills** (`requiredSkills`) and **Other requirements** (the old `specialization` column, so earlier wording keeps working): split on commas, semicolons and new
     lines; each item is a mandatory `mentions` criterion searched for, as whole words with dots and punctuation ignored ("B.Sc." = "BSc", "Full-Stack" = "full stack"), in the
     CV's full text plus the extracted or corrected fields.
   - The **JD** is roles and responsibilities only and is not used for screening.
   **All met → Pass; anything not found or short (a lower degree, fewer years) → Review Required with the reason; never Fail** (owner, 2026-11-05). The UI shows the
   `Missing` outcome as "Review". The run stores `basis = 'REQUISITION'` with the requisition version
   (or `'VACANCY'` with the vacancy's `specializationVersion`) as `criteriaVersion`, and no criteria set; the CV text is not copied into the run. Without the
   field, CVs are not screened (job `Partial`). Corrections and "Re-run screening" queue new runs; old runs, including older `JOB_POST` ones, stay.
   Corrections and "rescreen" queue new runs; old runs stay.

Screening result (`screen()`, shared with the older job post criteria):

- **Fail** if any mandatory criterion is confirmed not met, or is missing with policy `FAIL`.
- Otherwise **Review Required** if a mandatory criterion is missing or unreadable with policy `REVIEW`.
- Otherwise **Pass**. Policy `IGNORE` and preferred criteria never decide the result.

Default list order: Pass, Review Required, Fail, not screened, then CGPA descending.

### 6.7 Shortlist, invitation, evaluation, decision

- **Shortlist** is separate from the screening result, which never changes. Non-Pass needs `selection.override`; Fail also needs a reason. Bulk with per-item results.
- **Stages (the three marks, owner 2026-11-04):** `WRITTEN` (Written exam), `INTERVIEW` (Interview board / viva), `OPTIONAL` (Optional exam, only when held; was `VIVA`).
  Every shortlisted candidate sits the written exam and the interview board **on the same day**: `upsertStage` writes the shared fields (time, venue, panel,
  duration, attendance) to both rows whenever either is changed, so they never differ; a result, and marks, stay per exam. No stage rows are created at
  shortlisting (that would turn the derived status into Interview). Attendance needs `evaluation.attendance`; schedule, location and result need `evaluation.marks` or `selection.shortlist`.
  Missing attendance stays `Not Recorded`, never Present.
- **Interview Board** (`/interviews`, owner 2026-11-04) replaces the vacancy page's "Interview / exam / results" tab, which was removed. It lists shortlisted
  applications, and any with a round on record, across every vacancy the user coordinates; HR Manager and Super Admin see all (`recruitment.view_all`).
  Views: **Schedule (date-wise)**, a Saturday-start week strip with per-day counts, the day's slots in time order (from–to, round, candidate, department ·
  designation · vacancy, venue, panel, attendance, result, marks) and an Upcoming list; **Candidates by department & designation**, grouped per vacancy, with
  each round's slot, a computed *next step* (schedule → attend → result → final decision → joining) and the final decision. Work from the board: schedule or
  reschedule many at once (`POST interviews/schedule`, any vacancy, **shortlisted only**), manage one slot (time, duration, venue, panel, attendance, marks,
  result), final decision, invitation and result emails, Excel marks import. The page loads the whole board once and filters it in the browser (department,
  designation, vacancy, exam, search by name / ID / phone), so the dropdowns always keep every choice; the API still accepts `departmentId`, `vacancyId` and `q`.
  **Finished candidates are hidden** unless "Show finished" is ticked (2026-11-05): joined, rejected at joining, Not Selected, or of a Filled / Closed vacancy
  unless still Selected and waiting to join. One slot per candidate for the written & interview day, one for the optional exam.
  Each stage has `panel` (free text) and `durationMinutes` (5–600). **A round starts only with a date, an attendance or a result** (2026-11-05): a slot dialog saved
  with only venue, panel or duration creates no stage row (it used to, which turned the CV Bank status into Interview). Dates in the past get a warning, not a block.
  The **final decision** dropdown opens a confirmation dialog (attendance and marks, optional remarks, and a warning when the candidate would leave Joining Pending
  and lose its planned date and letter status) instead of saving at once.
  **Two Excel uploads** (owner, 2026-11-05): *Written & interview marks*, one sheet for both exams, and *Optional exam marks*. In the dialog HR picks department →
  designation → vacancy (the vacancy is chosen by itself when only one matches), downloads the template already listing that vacancy's shortlisted candidates, fills
  in marks and uploads it.
- **Marks** per application / stage / component (default `Total`), with evaluator. Changing another evaluator's mark needs `evaluation.overwrite`. **No weighted total exists.**
- **Excel marks import:** template download; `.xlsx` only; needs an Application ID or Candidate ID column and a Marks column; never matches on name or row order. Preview flags
  unmatched, duplicate, invalid and over-maximum rows and saves nothing. Confirm saves valid rows, cannot apply twice, and overwrites need both `allowOverwrite` and `evaluation.overwrite`.
  **Written & interview sheet** (`stageType=MAIN` template, `POST vacancies/:id/marks-import-main`): columns Application ID, Candidate ID, Candidate Name, Written Marks,
  Interview Marks, Remarks (the file is named `<vacancy>_<department>_<designation>_written_interview_marks.xlsx`). One upload makes one ordinary preview batch per exam
  (each with its own maximum), which the dialog confirms together. A blank cell means that mark is not entered yet and is left out, not an error. The Remarks column is not imported.
- **Final decision** (`selection.final_decision`): `Pending`, `Selected`, `Not Selected`, `On Hold`. Requires a shortlist first. Stage results are untouched. Selected creates a `Pending`
  joining record; moving away from Selected deletes a still-Pending record. After joining is approved the decision can no longer change.

### 6.8 Email

Kinds: `INTERVIEW_INVITE`, `RESULT`, `JOINING_LETTER`, `GENERAL`. Saved templates are versioned; a content change bumps the version. Unknown placeholders are refused.
Placeholders: `candidateName`, `candidateId`, `applicationId`, `position`, `department`, `company`, `vacancyId`, `interviewDate`, `interviewTime`, `location`, `instructions`,
`result`, `joiningDate`, `reportingTime`, `contactPerson`. Dates display in Asia/Dhaka.

Preview shows each recipient and message; recipients with no valid email or a missing placeholder value are skipped and reported. Sending needs `confirmed: true` and a client `clientKey`; the same
key cannot send twice. Each candidate gets a **separate email**. Delivery is a background job; transient SMTP errors retry automatically; only failed sends can be retried; a sent event is never sent again.
Coordinators can email only their own vacancies' candidates. A sent joining letter sets `letterStatus = Sent` and nothing else.

### 6.9 Joining

Selected applications appear in Joining Pending. HR sets date, remarks and letter status, then either **approves** (joining date required; final decision must be Selected; repeat click returns
`duplicate: true`) or **rejects** (reason of at least 3 characters). A rejected record has status `Rejected` (was `Did Not Join`) and stays listed on the
Joining page's **Rejected** tab; the final decision stays Selected for the record. **Move back to pending** (`reopen`, reason required) is allowed while the final
decision is still Selected. Only approval puts someone in Joined Candidates. An email never marks joining.

The page (2026-11-05) shows each row's seats ("Joined 1 of 2": `headcount` and `joinedCount` from `GET joining/pending|rejected`) and when it was selected, has a search
box and a vacancy filter, and saves the planned date as soon as a full date is picked. The approve dialog starts at the planned date (else today) and warns, without
blocking, when the date is in the future (see [§15](#15-open-business-questions)). **No joining beyond the headcount** (owner, 2026-11-05): once approved joinings of a
vacancy equal its `headcount`, `approve` (and the CV Bank move to Joined, which calls it) is refused with 409, counted with the vacancy row locked so two approvals
at once cannot both take the last seat; the page disables Approve for such rows and suggests rejecting or a new requisition. Selecting more candidates than seats
is still allowed (a waiting list). The Rejected tab offers "Move back to pending" only while the final decision is still Selected.

### 6.10 Derived application status (CV Bank)

Not stored. `STATUS_SQL` derives it in order: Joined → Rejected (joining rejected) → final decision (if not Pending) → Interview (any stage record) → Shortlisted → screening result → Review Required (processing failed) →
Received → Screening.

| From | Allowed moves |
| --- | --- |
| Received, Screening, Joined | None |
| Pass, Fail, Review Required | Shortlisted |
| Shortlisted | Interview, Selected, Not Selected, On Hold, back to its screening result (reason required) |
| Interview | Selected, Not Selected, On Hold |
| On Hold | Selected, Not Selected |
| Selected | Joined, Not Selected, On Hold |
| Rejected | None here; reopen from the Joining page |
| Not Selected | Selected, On Hold |

`POST /applications/:id/status` sends `fromStatus`; a mismatch is 409. It **calls the existing workflow actions**, so their permissions and validation apply, then writes `application.status_change`.
Shortlisting from Fail and reversing Selected or Not Selected need a reason. Joined needs a joining date. Other applications of the same candidate are untouched.

---

## 7. Backend modules

`@` = needs the permission. Every route is under `/api`. Routes are signed-in unless marked public.

### auth

Sign-in, sign-out, current user. Login is case-insensitive on email, refuses inactive or deleted accounts, and gives the same error for an unknown user or wrong password.
An unknown email is checked against a dummy hash, so it takes as long as a wrong password (no account discovery by timing). **Failed sign-ins** (security test, 2026-11-05;
`auth.service.ts`): 5 wrong passwords for one email from one address (the first `X-Forwarded-For` entry, else the socket), or 20 from anywhere, within 15 minutes give 429
"Too many failed sign-in attempts" until the window passes; a successful sign-in clears that address's count. Counted in memory per API instance; a restart clears it.
Sets `ars_token` (httpOnly, sameSite lax, secure in production).

`POST auth/login` (public), `POST auth/logout` (public), `GET auth/me`.

### roles-permissions

All under `admin/`, whole controller `@admin.users`.

| Route | Purpose |
| --- | --- |
| `GET permissions`, `GET permission-matrix` | Catalogue; grid with module overrides, `permissions` settings, `scopeModules`, `scopeDefaults` |
| `GET users?deleted=true`, `POST users`, `PATCH users/:id` | Lists accounts in use or deleted ones; edit details, roles, overrides, scopes, password (min 8) |
| `DELETE users/:id`, `POST users/:id/restore` | Delete keeps history; restore |
| `GET roles`, `POST roles`, `PATCH roles/:id`, `DELETE roles/:id` | `builtIn` flag in the list |
| `PUT` / `DELETE permission-settings/:kind/:key` | `kind` = `permission` or `module`; rename, describe, switch off, reset |
| `GET`/`POST permission-templates`, `PUT`/`DELETE permission-templates/:id` | Saved permission + scope sets |

**Delete user** sets `deletedAt` and `active = false`. The row stays, so names remain on past records; the email becomes reusable (unique index only among non-deleted accounts). Refused for yourself, the
last active account with Users & Roles, and anyone with work: named in an active route, approvals waiting, or coordinating a vacancy not Filled/Closed.

**Restore** brings the account back **Inactive**, refused if the email is now taken.

**Role delete:** custom roles only, once no non-deleted user holds them.

**Permission settings** change display only, plus the off switch. Codes stay fixed, and only permissions (not modules) can be switched off.

**Templates** are copied onto a user **in the browser** (`UsersTab.applyTemplate`): the user's effective permissions become exactly the template's, then Save persists it. Seeded on an empty table: HR Coordinator,
Department User - view only, Requisition Approver.

### master

`GET master/lookups` (any signed-in user), `POST`/`PATCH master/companies`, `master/departments`, `master/positions` `@master.configure`, `GET master/quotas` `@quota.view`, `POST master/quotas` and `PATCH master/quotas/:id` `@quota.edit`.
`DELETE master/companies|departments|positions/:id` `@master.configure` (owner, 2026-11-04): only while nothing uses the record, otherwise 409 listing the uses (requisitions, vacancies, quota rows; for departments also users by `departmentId` or Access Scope, approval routes, permission templates). Audited as `<kind>.delete`. Records in use are retired with `active` instead.

Quota rows: `positionId` null is the department total. Vacancy = quota − present (`computeVacancy`); a missing value gives "Not available", a negative gives "Needs review". On `PATCH`, changing `approvedQuota` needs `requisition.quota_chart`.

### requisitions

`RequisitionsController` (`requisitions`): `GET /` `@requisition.view`, `GET :id` (record check), `POST /` `@requisition.create`, `PUT :id` `@requisition.edit`, `POST :id/submit` `@requisition.submit`,
`POST :id/approve|reject|return` `@approval.act`, `POST :id/cancel` and `POST :id/corporate-hr` (checked in service), `POST :id/attachments` `@requisition.edit`, `GET :id/attachments/:attId` (record check).

`ApprovalsController` (`approvals`): `GET inbox` `@approval.act`; `GET`/`POST routes`, `PUT routes/:id` `@approval.configure_route`. Routes have no delete.

Inbox returns `pending` (my current steps), `upcoming` (my later steps, view only, with the current approver), `all` (every pending step, only with `approval.act_on_behalf`) and `history` (my last 50 decisions).

### vacancies

`GET hr-queue` `@hr.queue`, `GET hr-queue/coordinators` `@hr.assign_coordinator`, `PUT hr-queue/:requisitionId/coordinator` `@hr.queue + hr.assign_coordinator`, `PUT vacancies/:id/coordinator` `@hr.assign_coordinator`,
`POST hr-queue/:requisitionId/vacancy` `@vacancy.create`, `POST vacancies/direct` `@vacancy.create_direct`, `GET vacancies`, `GET vacancies/:id` `@vacancy.view`, `PUT vacancies/:id` `@vacancy.edit`,
`POST vacancies/:id/job-posts`, `PUT job-posts/:id`, `POST job-posts/:id/status|circular` `@jobpost.edit`, `GET job-posts/:id`, `GET job-posts/:id/circular`, `GET job-posts/:id/circular-file` `@vacancy.view`. `GET vacancies/:id` and `GET job-posts/:id` return `screening: { source: 'REQUISITION' | 'VACANCY', reqNo, specialization, items }`. `PUT vacancies/:id` changes only the fields sent.

### candidates

`POST vacancies/:id/cvs` `@cv.upload`, `GET vacancies/:id/applications` `@candidate.view`, `POST vacancies/:id/rescreen` `@screening.run`, `POST vacancies/:id/shortlist` `@selection.shortlist`, `GET vacancies/:id/export` `@report.export`,
`GET applications/:id`, `POST applications/:id/remarks`, `GET applications/:id/jobs` `@candidate.view`, `PATCH applications/:id` `@candidate.edit`, `POST applications/:id/duplicate` `@candidate.duplicate_review`, `GET documents/:id` `@cv.download`,
`GET intake/unmatched`, `POST intake/:id/assign`, `DELETE intake/:id`, `GET intake/mail-folder`, `POST intake/scan`, `POST intake/scan-files` `@cv.upload + recruitment.view_all`.
`GET vacancies/:id/cv-data-export` `@report.export`: one Excel per vacancy in the layout of HR's "New CV data bank" sheet, CV columns only, built on request so corrections are included. After the 14 sheet columns come ADDRESS, SKILLS, PREVIOUS JOBS & DESIGNATIONS, CERTIFICATIONS, EXPECTED SALARY, AGE. `GET vacancies/:id/cv-data` `@candidate.view` returns the same columns and rows as JSON for "View Excel" (not audited; the download is). The older `GET vacancies/:id/export` (with screening columns) is unchanged. `mail-intake.service.ts` reads the mails.

Excel summary columns: Candidate ID, Application ID, Candidate Name, Education, Institution, CGPA, Work Experience, Workplace, Email, Phone, Applied Position, Screening Status, Screening Reasons, Remarks. One row per application. Missing name, email or phone
shows "Needs review". Exports are audited.

### cv-bank

`GET cv-bank/tree`, `GET cv-bank/applications`, `POST applications/:id/status`, all `@candidate.view` (the status change then needs the permission of the action it calls). The screens are separate pages: departments, then one department's vacancies, then one vacancy's CVs, with search and status filter.

### evaluation

`GET interviews/board?departmentId&vacancyId&q` `@candidate.view` (coordinator scope in the query), `POST interviews/schedule` `@selection.shortlist` (+ `assertApplicationsAccess`), `GET vacancies/:id/evaluation` `@candidate.view` (no screen uses it now), `POST vacancies/:id/schedule` `@selection.shortlist`, both schedule routes refuse applications that are not shortlisted, `PUT applications/:id/stages/:stage` (checked in service), `PUT applications/:id/marks` `@evaluation.marks`,
`POST applications/:id/final-decision` `@selection.final_decision`, `GET vacancies/:id/marks-template?stageType=WRITTEN|INTERVIEW|OPTIONAL|MAIN`, `POST vacancies/:id/marks-import`, `POST vacancies/:id/marks-import-main?writtenMaxMarks&interviewMaxMarks` (returns `{ batches }`), `GET imports/:id`, `POST imports/:id/confirm|cancel` `@evaluation.import`.

### email

`GET email/placeholders` (signed-in), `GET email/templates`, `POST email/preview`, `POST email/send`, `POST email/events/:id/retry`, `GET email/history` `@email.send`, `POST email/templates`, `PUT email/templates/:id`, `DELETE email/templates/:id` `@email.manage_template`. Delete removes the template and its versions (audited `template.delete`); sent emails keep their own subject and body, so their `templateId` may no longer resolve.

### joining

`GET joining/pending`, `GET joining/rejected` `@joining.view` (rows include `headcount`, `joinedCount`, `vacancyStatus`), `GET joining/joined` `@joining.view_joined`, `PUT joining/:id`, `POST joining/:id/approve|reject|reopen` `@joining.approve`.

Scope order in `JoiningService.scope`: `recruitment.view_all` sees everything; else `vacancy.view` holders see their coordinated vacancies; else the `joining` department scope applies. Contact details are returned only with `candidate.view`.

### processing

`JobsService`: types `EXTRACTION`, `SCREENING`, `EMAIL_SEND`; statuses `Queued`, `Processing`, `Completed`, `Partial`, `Failed`. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several API instances are safe. Up to 25 jobs per tick, every `WORKER_INTERVAL_MS`.
`enqueue` reuses an active job for the same type and record. Only `RetryableError` retries automatically (3 attempts, growing delay). **Handlers must be idempotent.**

`GET monitor/jobs` `@monitor.view`, `POST monitor/jobs/:id/retry` `@monitor.retry`.

### system

`GET dashboard` (signed-in; sections by permission), `GET notifications`, `POST notifications/:id/read`, `POST notifications/read-all`, `GET audit` `@audit.view`, `GET health` (public).

Dashboard sections:

- **Department** (`dashboard.department`): quota, manpower, vacant, rows needing review, requisition counts, joined; within the `dashboard` scope. All departments for Super Admin.
- **HR** (`dashboard.hr`): active vacancies, CV counts, screening pending/pass/fail/review, shortlisted, stage progress, joining pending/joined; coordinated vacancies unless `recruitment.view_all`. With `hr.queue`, also queue size and vacancies without a coordinator.
- **Admin** (`dashboard.admin` + `requisition.view_all_departments`): total, pending, approved, rejected requisitions, excluding drafts.
- Also: `myApprovals` (`approval.act`), failed jobs and emails (`monitor.view`), my last 10 audit entries.

Super Admin sees Department, HR and Admin in order, each with a heading.

---

## 8. Rules that must not be broken

From the SRS and acceptance tests. Each is enforced server-side today.

1. No HR vacancy from a requisition that is not fully approved (`Sent to HR`). (AC-05)
2. Permissions and department or coordinator scope are enforced by the API, never only in the UI. (AC-24, roles doc §7, §8.3)
3. Approvers act through their own named accounts; on-behalf decisions always record who acted. (SRS 3.1)
4. Revised quota never overwrites approved quota before approval and the quota-chart step. (SRS 5.3)
5. Repeated clicks and retries must not duplicate approvals, vacancies, applications, marks, emails or joining records. (AC-09, AC-26)
6. Extraction never invents data; missing stays null and leads to Review Required. A missing value is not a failure. (AC-14, SRS 10.2, 10.4)
7. The screening result is never changed by HR actions; overrides are recorded separately. (AC-18)
8. Earlier screening results stay explainable: each run keeps its criteria, reasons and basis (job post criteria version, requisition version, or vacancy specialization version). (AC-16)
9. Duplicate candidates are flagged, never merged automatically. (SRS 9.4)
10. Marks are matched by ID, never by name or row order, and saved only after confirmation. (AC-20)
11. Missing attendance is not Present. (SRS 13.3)
12. Each candidate gets a separate email; no shared To/CC. Bulk send needs preview and confirmation. Only failed sends retry. (AC-19, SRS 12.4)
13. An interview pass or a sent email never marks someone joined. Only HR approval does. (AC-23)
14. Display IDs never change with status; a Candidate ID identifies a person, an Application ID one vacancy application. (SRS 2.1)
15. Sensitive changes are audited with actor, record and old/new values. Audit rows are never edited by the application. (AC-25)
16. Candidate data and files are served only through authorised routes. (NFR-03)
17. Deleting a user must keep history readable. Existing requisitions and approval history are not to be deleted. (owner instruction, 2026-10-29)
18. Weighted mark totals must not be invented until the business defines them. (SRS 13.5)

---

## 9. Database structure

37 entities plus the `user_roles` join table, in `backend/src/database/entities/`. Primary keys are UUIDs with `createdAt` and `updatedAt`, except `audit_events` (no `updatedAt`) and `id_counters` (`key`).

### Identity (`identity.entities.ts`)

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `roles` | code, name, description, permissions[], active | code unique |
| `users` | name, email, passwordHash, designation, active, departmentId, extraPermissions[], deniedPermissions[], departmentScopes (jsonb), lastLoginAt, deletedAt | email unique **where `deletedAt` IS NULL**; passwordHash not selected by default |
| `user_roles` | userId, roleId | many-to-many |
| `permission_templates` | name, description, permissions[], departmentScopes | name unique |
| `permission_settings` | kind, key, label, description, disabled | (kind, key) unique; no row = defaults |

### Master (`master.entities.ts`)

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `companies`, `departments` | code, name, active | code unique |
| `positions` | title, code, active | title unique; not tied to a department or company |
| `manpower_quotas` | companyId, departmentId, positionId, approvedQuota, presentManpower, effectiveDate, remarks, updatedById | (company, department, position) unique; null position = department total |

### Requisitions (`requisition.entities.ts`)

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `requisitions` | reqNo, formNo, requestDate, requesterId, departmentId, companyId, positionId, rank, headcount, replace fields, education, experience, salaries, current/revised quota, present manpower, vacancy figures + override reason, seatsAvailable, deadlineDays, gender, specialization, jobDescription, background, corporate fields, status, version, currentStepOrder, approvalRouteId, submittedSnapshot (jsonb), submittedAt, approvedAt, sentToHrAt, coordinatorId, cancelledAt, cancelReason | reqNo unique |
| `requisition_attachments` | requisitionId, kind (`TERMINATION_REQUEST`, `SIGNATURE`, `OTHER`, `APPROVAL`), approvalActionId, storageKey, originalName, mimeType, size, uploadedById | cascade on requisition |
| `approval_routes` | name, departmentId, active | null department = default route |
| `approval_route_steps` | routeId, stepOrder, label, approverUserId, required | (route, stepOrder) unique; cascade |
| `approval_actions` | requisitionId, version, stepOrder, stepLabel, approverUserId, status, remarks, decidedAt, actedById, carriedOver | (requisition, version, stepOrder) unique; cascade |

### Recruitment (`recruitment.entities.ts`)

| Table | Key columns | Constraints and notes |
| --- | --- | --- |
| `vacancies` | vacancyNo, source, requisitionId, departmentId, companyId, positionId, positionTitle, headcount, vacancyType, replacementEmployee, directReason, specialization, specializationVersion (Direct HR only), status, remarks, createdById, updatedById, coordinatorId | vacancyNo unique; requisitionId unique when not null |
| `job_posts` | jobNo, vacancyId, title, startDate, deadline, description, duties, education, requiredDegree, minCgpa, experienceRequirement, cvCollection, circularContent, location, employmentType, jobShift, salary, skills, applyEmail, emailSubject, circular attachment key and name, status, currentCriteriaVersion, createdById | jobNo unique |
| `screening_criteria_sets` | jobPostId, version, note, createdById | (jobPost, version) unique; no longer written, kept for old runs |
| `screening_criteria` | setId, sortOrder, label, field, operator, value, mandatory, missingPolicy | cascade |
| `candidates` | candidateNo, name, email, emailNormalized, phone, phoneNormalized, mergedIntoId | candidateNo unique |
| `applications` | applicationNo, candidateId, vacancyId, jobPostId, source, receivedAt, processing fields, duplicate fields, extracted fields (incl. address, certifications, previousJobs), extractionStatus, correctedFields[], screeningResult, latestScreeningRunId, shortlist fields, final decision fields | applicationNo unique; (candidate, vacancy) unique |
| `candidate_documents` | applicationId, candidateId, storageKey, originalName, mimeType, size, sha256, source, uploadedById | cascade on application |
| `extraction_runs` | applicationId, documentId, status, extracted (jsonb), missingFields[], error, processorVersion, completedAt | history |
| `screening_runs` | applicationId, basis (`JOB_POST` / `REQUISITION` / `VACANCY`), criteriaSetId (null unless `JOB_POST`), criteriaVersion, overallResult, results (jsonb), inputs (jsonb), runById | history |
| `candidate_remarks` | applicationId, candidateId, text, authorId | |
| `candidate_stages` | applicationId, stageType, scheduledAt, location, panel, durationMinutes, attendance, result, updatedById | (application, stage) unique |
| `evaluation_marks` | applicationId, stageType, component, marks, maxMarks, evaluatorId, remarks, importBatchId | (application, stage, component) unique |
| `import_batches` | batchNo, vacancyId, stageType, component, uploaderId, fileName, status, sheetName, detectedColumns[], row counts, maxMarks, confirmedAt | batchNo unique |
| `import_rows` | batchId, rowNumber, IDs, candidateName, applicationId, marks, previousMarks, status, errors[] | cascade |
| `email_templates` | name, kind, vacancyId, subject, body, version, active, updatedById | |
| `email_template_versions` | templateId, version, subject, body, createdById | (template, version) unique |
| `email_batches` | clientKey, kind, templateId, templateVersion, vacancyId, createdById, total | clientKey unique |
| `email_events` | batchId, applicationId, kind, recipient, subject, body, template refs, status, transport, providerRef, error, attempts, sentAt, createdById | (batch, application) unique |
| `joining_records` | applicationId, joiningDate, status, letterStatus, remarks, approvedById, approvedAt | applicationId unique |
| `intake_messages` | messageId, sender, subject, receivedAt, status, vacancyId, attachments (jsonb), error | messageId unique |

### System (`system.entities.ts`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `notifications` | userId, event, title, body, link, readAt | |
| `audit_events` | actorId, actorName, action, entityType, entityId, entityLabel, oldValues, newValues, ip, createdAt | append-only |
| `processing_jobs` | type, refId, refLabel, status, attempts, error, payload, runAfter, startedAt, completedAt | queue |
| `id_counters` | key, value | key is kind, plus year when the format has `{YYYY}` |

### Relationships

Department/Company 1─N quotas, requisitions, vacancies. Requisition 1─N approval actions and attachments, 1─0..1 vacancy. Vacancy 1─N job posts and applications. Job post 1─N criteria sets. Candidate 1─N applications. Application 1─N documents, extraction runs,
screening runs, remarks, stages, marks, email events; 1─0..1 joining record.

Many ID columns have no database foreign key (for example `latestScreeningRunId`, `uploadedById`, `createdById`); the code maintains them.

### Migrations (`backend/src/database/migrations/`)

| File | Purpose |
| --- | --- |
| `1793186337802-InitialSchema` | Base schema |
| `1793300000000-DepartmentScopedViews` | Removes `requisition.view_all_departments` from HR, Corporate HR, Read-only (HR's later regained by the next role migration) |
| `1793300000001-ApprovalOnBehalfAndDocuments` | `approvalActionId`, `actedById` |
| `1793300000002-RolesAndCoordinators` | `coordinatorId` columns; role permission changes; role renames |
| `1793300000003-UserScopesAndTemplates` | `departmentScopes`; `permission_templates` |
| `1793300000004-DeleteUsersPermissionSettings` | `deletedAt`, partial email index; `permission_settings` |
| `1793300000005-JobPostCircularFields` | Circular fields on `job_posts` |
| `1793300000006-ApplicationLastPositionSpecialization` | `lastPosition`, `specialization` on `applications` |
| `1793300000007-CoordinatorScreeningAndCvFields` | `address`, `certifications`, `previousJobs` on `applications`; `screening_runs.basis`, `criteriaSetId` nullable; removes `recruitment.view_all` from CV Screener, Examiner, Read-only |
| `1793300000008-DirectVacancySpecialization` | `specialization`, `specializationVersion` on `vacancies` |
| `1793300000009-InterviewPanelDuration` | `panel`, `durationMinutes` on `candidate_stages` |
| `1793300000010-ExamRoundsAndJoiningRejected` | `VIVA` → `OPTIONAL` in stages, marks and import batches; joining `Did Not Join` → `Rejected` |
| `1793300000011-StructuredSpecialization` | requisitions and vacancies: `requiredEducation`, `requiredSkills` text, `requiredExperienceYears` numeric(4,1); `specialization` stays as "Other requirements" |
| `1793300000012-CvMethodWithoutJobId` | job posts whose CV method was still the old default with the job ID get the designation - department default |

Never edit an applied migration; add a new one. `synchronize` is off.

### Stored files

`STORAGE_DIR/<folder>/<YYYY-MM>/<uuid>.<ext>`, folders `cvs`, `intake`, `requisitions`, `approvals`, `circulars`, plus `outbox/`. Back up with the database. Paths are checked to stay inside the storage root.

---

## 10. Frontend

`frontend/src/app/(app)/` is wrapped by `components/Shell.tsx`: sidebar filtered by permission (sections Overview, Manpower, Recruitment ending with Joining Pending, Joined Candidates, All CVs / Candidate CV Bank; Predefined Fields; Administration with Users & Roles, Approval Routes, Audit Log), notification bell polling every 30 seconds, redirect to `/login?next=...` when signed out.

| Route | Screen | Sidebar permission |
| --- | --- | --- |
| `/login` | Sign in | none |
| `/` | Dashboard (Department, HR, Admin sections) | none |
| `/quotas` | Positions & Quota | `quota.view` |
| `/requisitions`, `/requisitions/new`, `/requisitions/[id]`, `/requisitions/[id]/edit`, `/requisitions/[id]/print` | List, form, detail (read-only for approvers: no Approve / Return / Reject, only a link to the inbox), Print/PDF | `requisition.view` |
| `/approvals` | Approver Inbox | `approval.act` |
| `/approvals/[id]` | The requisition with the Approve / Return / Reject card: the **only** place decisions are taken in the UI (owner, 2026-11-05); `components/RequisitionDetail.tsx` with `inbox` | `approval.act` |
| `/hr-queue` | HR Approved Queue with Coordinator column; default All approved | `hr.queue` |
| `/vacancies`, `/vacancies/[id]` | List with Coordinator select and Direct HR vacancy form (with Coordinator); tabs Overview & job posts, Candidates & screening (CV folder scan, single-file upload, screening basis; table without Application and Processing columns, with previous jobs, skills, certifications, address, expected salary, age), Emails | `vacancy.view` |
| `/interviews` | Interview Board: date-wise schedule and department → designation view of shortlisted candidates | `candidate.view` |
| `/job-posts/[id]` | Circular & requirements, Hiring circular card (the Screening card was removed, owner 2026-11-05; the vacancy page shows what CVs are screened against) | reached from a vacancy |
| `/applications/[id]` | Candidate profile with CV preview, corrections, remarks, history | reached from lists |
| `/cv-bank` | All CVs / Candidate CV Bank: departments, and search across all CVs | `candidate.view` |
| `/cv-bank/[departmentId]` | Vacancies of one department | `candidate.view` |
| `/cv-bank/[departmentId]/[vacancyId]` | CVs of one vacancy, Download CV data Excel, View Excel | `candidate.view` |
| `/cv-bank/[departmentId]/[vacancyId]/excel` | The CV data sheet in the browser, searchable | `candidate.view` |
| `/cv-bank/unmatched` | Unmatched CVs: mail folder scan (browser folder or server folder), select, move by department and designation, delete permanently. Linked from the bottom of `/cv-bank` with a count; no sidebar item | `cv.upload` + `recruitment.view_all` |
| `/joining` | Joining Pending with Pending and Rejected tabs; approve, reject, move back to pending | `joining.view` |
| `/joined` | Joined Candidates | `joining.view_joined` |
| `/admin/users` | Users & Roles: tabs Users, Roles, Permissions, Permission Templates | `admin.users` |
| `/admin/routes` | Approval Routes | `approval.configure_route` |
| `/admin/master`, `/admin/templates` | Sidebar section **Predefined Fields**: Master Data (companies, departments, positions; add, edit, deactivate, delete) and Email Templates (edit, delete) | `master.configure`, `email.manage_template` |
| `/admin/audit` | Audit Log | `audit.view` |

Components: `RequisitionForm`, `FormView` (Form No. 01 layout), `EmailComposer`, `components/vacancy/` (`CandidatesTab`, `EvaluationTab`, `CoordinatorSelect`), `components/admin/` (`UsersTab`, `RolesTemplatesTabs`, `PermissionGrid`).

UI placement requests from the owner: Delete sits right after Edit in the Users table. On the requisition page the decision dialog takes a document upload. The HR queue has Coordinator instead of a Vacancy column, with the vacancy link or Create vacancy button under the requisition number.
Circular downloads appear under each job post number on the vacancy page, at the top of the job post page and in the Hiring circular card.

The owner chose to **keep the current visual design**; the Users & Roles mockup was for functions only.

---

## 11. Notifications and audit catalogue

**Notification events:** `approval.pending` (next approver), `approval.submitted` (holders of `approval.act_on_behalf`), `requisition.approved`, `requisition.rejected`, `requisition.returned` (requester), `hr.queue` (holders of `hr.queue`), `coordinator.assigned`,
`import.completed` (uploader), `joining.pending` (holders of `joining.approve`), `joining.approved` (vacancy creator).

**Audit actions:** `requisition.create|edit|submit|resubmit|approve_step|approve_final|sent_to_hr|reject|return|cancel|corporate_hr|attachment_add`, `quota.create|update|revise_from_requisition`, `companies.*`, `departments.*`, `positions.create|update`, `approval_route.create|update`,
`vacancy.create_from_requisition|create_direct|update|status_change`, `coordinator.assign|reassign`, `jobpost.create|update|status_change|circular_attach`, `criteria.new_version` (older records only), `cv.upload_batch`, `screening.rerun`, `application.correct|remark|status_change`, `candidate.correct|merge|keep_separate`,
`selection.shortlist|shortlist_override|unshortlist|final_decision`, `stage.<type>.update`, `marks.enter|edit|import_preview|import_confirm|import_cancel`, `report.candidate_export`, `email.send_batch|sent|failed|retry`, `template.create|update`, `joining.update|approve|reject|reopen` (`joining.did_not_join` on older records), `intake.assign`, `intake.scan`, `intake.delete`, `report.cv_data_export`, `job.retry`,
`user.create|update|update_with_password_reset|delete|restore`, `role.create|update|delete`, `permission_template.create|update|delete`, `permission_setting.update|reset`, `module_setting.update|reset`.

---

## 12. Testing

`npm test` runs Jest with `--runInBand` against `ars_test`. **The end-to-end suite wipes that database** (`dropDatabase`), then migrates and seeds. Keep tests away from the `ars` database. The worker is disabled in tests; call `jobs.drain()` to process jobs.

- `backend/test/rules.spec.ts`: screening engine, extraction, quota and form rules, email placeholders.
- `backend/test/workflow.e2e-spec.ts`: the whole workflow over HTTP. Tests **run in order and share state** (`ids`), so a later test depends on earlier ones. Running one test with `-t` usually misleads.
  Covers AC-01 to AC-27, final approval, coordinators, Users & Roles, delete and restore, permission settings, the hiring circular.
- AC-28 (backup/restore) is the manual README procedure.

At the last full run (2026-11-05), 108 tests passed. Stop any other API pointed at `ars_test` before `npm test`: its background worker takes the test's jobs and
screening tests fail.

**Production smoke, sanity and security pass (2026-11-05).** The compiled API (`NODE_ENV=production`) and `next build` / `next start` were run on `ars_test`
with the test seed values, and the whole workflow (requisition, five approvals, vacancy, job post, CV upload and worker, shortlist, schedule, attendance, marks by hand
and Excel, final decisions, joining reject / reopen / approve, Filled) was driven through the web proxy as the seeded users, then the Interview Board and Joining
pages in the browser. Security checks: every non-public route refuses anonymous callers; forged, `alg=none` and garbage tokens are refused; no access across coordinators
(applications, marks, stages, decisions, documents, exports, email preview); admin routes and self-promotion refused; no password hashes in responses; search fields
parameterised; unknown body fields refused; renamed executables, HTML and SVG uploads refused; file names cannot leave storage; oversize uploads refused. Fixed from it:
sign-in lockout, equal sign-in timing, security headers, empty slot rows. There are no automated frontend tests; verify screens in the browser.

To check circular layout without data, from `backend/`: `npx ts-node scripts/sample-circular.ts <folder>`.

---

## 13. Implementation decisions

| Decision | Why |
| --- | --- |
| NestJS 11, not 12 | NestJS 12 packages are ESM-only and broke the CommonJS, TypeORM CLI and Jest setup |
| DB-backed job queue | Jobs commit with the record that needs them; retries are visible; no extra infrastructure |
| Separate `Candidate` and `Application` | SRS: one person, many vacancy applications |
| Application status derived, not stored | It can never disagree with the records each step owns |
| `Sent to HR` is the fully approved state, shown as Approved | Reuses the status the queue, vacancy creation and dashboard already use |
| Final approver closes remaining steps as `Superseded` | Owner, 2026-10-29: Super Admin approval is sufficient; no waiting on other approvers; history kept |
| Requisition: `requisition.manage_all` separated from `approval.act_on_behalf` | Admin may approve but must not edit requisitions |
| Coordinator stored on requisition and vacancy, kept in sync | Assignment can happen before the vacancy exists; direct vacancies have no requisition |
| Quota visibility split from requisition visibility | HR sees all quotas; Admin sees all requisitions but no quotas |
| Hide email and phone from department users on the joined list | Roles doc: contact data restricted to authorised roles |
| Unmatched CVs only for `recruitment.view_all` | Coordinators may access only their vacancies; unmatched CVs have none (confirmed by the owner, 2026-11-04) |
| Deleting an unmatched CV is permanent (row and file) | Owner, 2026-11-04; the audit entry stays |
| One cross-vacancy Interview Board instead of a per-vacancy tab | Owner, 2026-11-04: coordinator-scoped; HR Manager and Super Admin see all |
| Soft delete for users | Owner, 2026-10-29: keep history, restorable, email reusable |
| Permission codes fixed; labels, groups and on/off editable | Owner, 2026-10-29: a code created in the UI would protect nothing |
| Backend and frontend are independent projects | Owner, 2026-10-29: match `D:\pos`; `.pgdata` and `storage` moved into `backend/` |
| Mail intake reads saved `.eml` files, chosen in the browser or from a server folder, routed by circular position plus department | Owner, 2026-11-01 |
| No env file, example included, and no credential is ever committed | Owner, 2026-11-01: `.gitignore` covers `.env`, `.env.*` and database files; required settings are listed in the README without values |
| Screening from the requisition's Specialization required (Direct HR vacancies: their own field); job post criteria removed; a missing item is Review Required, never Fail | Owner, 2026-11-04 |
| Specialization required split into Education / Qualification, Skills, Minimum experience and Other requirements; JD is roles and responsibilities only; a shortfall is Review Required, never Fail | Owner, 2026-11-05 |
| Recruitment coordinator-only; HR Manager and Super Admin see everything | Owner, 2026-11-04: CV Screener, Examiner and Read-only lost `recruitment.view_all` |
| CV folder scan on the vacancy page puts every CV in the folder into that vacancy | Owner, 2026-11-04: HR collects CVs from any source into one folder per job |
| `pdfkit` for the circular | Direct server-side PDF download |
| HR queue page defaults to All approved | Owner, 2026-10-29 |

**Superseded:** an earlier 2026-10-29 instruction that only Super Admin sees every department was replaced by the Roles & Permissions Specification (HR and Admin see all requisitions, HR sees all quotas). An earlier rule letting `approval.act_on_behalf`
also edit requisitions moved to `requisition.manage_all`.

---

## 14. Known gaps, limits and oddities

### Not built

- **Direct mailbox connection.** ARS reads saved `.eml` files, not a live mailbox (owner's choice, 2026-11-01). Outlook `.msg` files are not read; they are listed so HR can save them as `.eml`.
- **Automatic job post expiry.** A post closes only when someone closes it; there is no `Expired` status or deadline job.
- **Multiple approvers on one step** (any one / all). One named approver per step only.
- **Weighted mark totals**, data retention policy for unsuccessful candidates.
- **Separate Reports or System Settings pages.** The mockup showed them; none exist.
- **Notifications** for new CVs, CV processing failures and requisition edits. `CandidatesService` injects `NotificationService` but does not use it. Email notifications for events do not exist; notifications are in-system only.
- **Password change by the user themself.** Only an administrator can set a password.
- **Delete** for approval routes. Routes have an `active` flag instead.
- **Processing Monitor screen** (removed 2026-11-04). Failed CV jobs show their error in the vacancy's candidate list, and failed emails retry from the vacancy's Emails tab, but a failed CV job can no longer be retried from the UI.

### Behaviour to be aware of

- Two open jobs with the same position and department cannot be told apart from those alone. Such a mail goes to Unmatched unless its subject has the company or the Job ID. The circular's default subject has neither (owner, 2026-11-05).
- Signing out only clears the cookie: the token itself stays valid until it expires (`JWT_EXPIRES_IN`, default 8h). Deactivating or deleting a user takes effect at once, because every request re-reads the account.
- The sign-in lockout is in memory, so with several API instances each counts on its own, and a restart clears it.
- A `%` or `_` typed into a search box acts as a wildcard (it is matched with ILIKE). Not an injection, since values are parameterised.
- `lastPosition`, `specialization`, `address`, `certifications` and `previousJobs` are read only when a CV is processed, so CVs received before each was added show it blank until corrected by hand.
- Applications screened before 2026-11-04 keep their job post criteria result until "Re-run screening" is used.
- A Direct HR vacancy without its own Specialization required is not screened; changing it does not re-screen CVs already received until "Re-run screening".
- Specialization matching is literal: "BSc in CSE" is not found in "B.Sc. in Computer Science and Engineering". Such CVs go to Review Required, never Fail.
- Each CV attachment in a mail creates its own application, so a separate cover letter in PDF or DOCX becomes one too.
- The same person uploaded to a second vacancy gets a **new Candidate** first; the shared Candidate ID appears only after HR confirms the merge.
- A final approver who is the named approver on the current step approves only that step ([§6.2](#62-approval-mechanics)).
- The `joining` Access Scope has no effect for users with `recruitment.view_all` or `vacancy.view`; those rules are checked first.
- `quota.edit` holders can set `approvedQuota` when **creating** a quota row; the quota-chart check applies only to `PATCH`.
- `NotificationService.usersWithPermission` ignores the system-wide off switch, and `POST auth/login` returns permissions without removing switched-off codes. The app uses `/auth/me`, which is correct, right after sign-in.
- `audit_events.ip` exists but is not filled in.
- `GET master/lookups` and `GET email/placeholders` need sign-in only.
- The circular PDF uses the built-in Helvetica font, so **Bangla text does not render in the PDF**; the text version is fine. The footer logo is `backend/assets/circular-logo.png` when present.
- Company names marked *(confirm name)* in the seed are placeholders from the quota sheets. Quota and user data are prototype figures.

### Oddities in the repository

- `backend/package.json` and `frontend/package.json` each list `"ananta-ars": "file:.."`. Nothing uses it; it appeared around the move to separate projects.
- `README.md` still says `requisition.service.ts` (it is now `requisitions.service.ts`) and its layout section omits `roles-permissions`.

---

## 15. Open business questions

From SRS §25 and the README prototype defaults; confirm with the business owner before production.

- Final approval order and which steps are mandatory, given that an Admin approval is currently final.
- Any-one versus all approvers on a step.
- Requisition ID at draft or at submission.
- Whether direct HR vacancies are allowed in production.
- Recruitment mailbox and protocol, and whether it is needed for the first demo.
- Upload size and supported formats.
- Duplicate-matching criteria and who confirms merges.
- Mark maxima, weighting, and whether stages differ by vacancy.
- Whether an actual joining date in the future should be refused; today the approve dialog only warns.
- Whether joining-letter generation is required, or only recording the sent status.
- Approved company, department and position master data, including the *(confirm name)* companies.
- Retention and deletion policy for unsuccessful candidates and their CVs.
- Deployment environment.

---

## 16. Keeping this file current

Update this file in the same change whenever you alter roles or permissions, statuses or transitions, a business rule, an endpoint's access rule, the schema, environment variables, or the run steps; and when a gap in §14 is closed or an open question in §15 is answered.

Record the reason for non-obvious choices in §13. Change the *Last reviewed* date after a real review. Write only what the code does or what a document or the owner has stated; put anything else under open questions.
