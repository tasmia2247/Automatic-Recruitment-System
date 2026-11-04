# Ananta ARS — Automatic Recruitment System (prototype)

Connected web application implementing the end-to-end workflow in
*Ananta_ARS_Consolidated_Detailed_SRS_v3.1_TechStack*:

Department quota → Form No. 01 requisition → configurable named-approver chain → HR approved queue →
vacancy → job post → CV upload / intake → extraction → rule-based screening →
Excel summary → HR shortlist / override → individual invitation emails → attendance, written / interview / viva
marks (incl. Excel import) → final HR decision → result / joining-letter email → HR-approved joining →
Joined Candidate List.

| Layer | Technology (SRS 21.1) |
| --- | --- |
| Frontend | Next.js 16 (App Router) + React 19, Tailwind CSS 4 — `frontend/` |
| Backend | NestJS 11 REST API, DTOs validated with class-validator — `backend/` |
| Database | PostgreSQL (TypeORM 1.x entities + versioned migrations) |
| Background work | DB-backed job queue (`processing_jobs`, `FOR UPDATE SKIP LOCKED`) run by an in-process worker |
| Admin | pgAdmin (administration only; the app connects via `DATABASE_URL`) |

> NestJS 12 is ESM-only; this prototype uses the NestJS 11 (CommonJS) line so the TypeORM CLI, Jest and Nest
> CLI work without ESM workarounds. Upgrading later is a mechanical change.

## Quick start (Windows / macOS / Linux, Node 20+)

Backend and frontend are separate projects, each with its own `package.json` and `node_modules`.
Install both from the repo root:

```bash
npm run setup
```

1. **Configure.** Create `backend/.env` with your own values. Env files are never committed, and the API will not
   start without the first two:

   ```env
   DATABASE_URL=postgres://ars:<database-password>@localhost:54329/ars
   JWT_SECRET=<long-random-string>
   SEED_PASSWORD=<password-for-seeded-users>
   ```

   Every other setting and its default is in `backend/src/config/index.ts`.

2. **Database.** Either point `DATABASE_URL` at your PostgreSQL (database **must be UTF8**:
   `CREATE DATABASE ars ENCODING 'UTF8' TEMPLATE template0;`), or start the bundled throwaway PostgreSQL
   (real Postgres binaries, port 54329, data in `backend/.pgdata/`, password taken from `DATABASE_URL`):

   ```bash
   npm run db:local
   ```

3. **Migrate and seed** (seed is idempotent):

   ```bash
   npm run migrate
   ```

   ```bash
   npm run seed
   ```

4. **Run** the API (port 4000) and web app (port 3000) in two terminals:

   ```bash
   npm run dev:api
   ```

   ```bash
   npm run dev:web
   ```

   Open http://localhost:3000. The web app proxies `/api/*` to the API (`API_URL` in `frontend/.env.local`, default `http://localhost:4000`).

## Deploying to a server

Checked on 2026-11-04 with a fresh copy of the repository: install from the lockfiles, build, migrate an empty database, seed.

1. **Server:** Node 20+, PostgreSQL with a **UTF8** database, and a disk that is backed up for the CV files. Put HTTPS in
   front of the web app if you can; open only the web app's port to users and keep port 4000 and PostgreSQL internal.

2. **Install with the dev packages** (they are needed to build, migrate and seed). `--include=dev` matters when the
   shell already has `NODE_ENV=production`, because npm then skips them:

   ```bash
   npm --prefix backend ci --include=dev
   ```

   ```bash
   npm --prefix frontend ci --include=dev
   ```

3. **`backend/.env`** (never committed). Besides `DATABASE_URL`, `JWT_SECRET` (long, random, not the one used in testing)
   and `SEED_PASSWORD`, set at least:

   | Variable | Why |
   | --- | --- |
   | `NODE_ENV=production` | Production mode |
   | `WEB_URL` | The address users open, e.g. `https://ars.ananta.local`; the API redirects there |
   | `STORAGE_DIR`, `MAIL_INTAKE_DIR` | Absolute paths on the backed-up disk (CVs, attachments, the server mail folder) |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Without `SMTP_HOST` emails are **not delivered**, only written to the outbox folder |
   | `CAREER_EMAIL` | "Send your CV to" on hiring circulars |
   | `COOKIE_SECURE` | Default `auto`: the sign-in cookie is Secure only when users come over HTTPS, so a plain-http office address still works. `true` / `false` force it |

4. **Web app address of the API.** `API_URL` (default `http://localhost:4000`) is read when the web app is **built**,
   so set it in `frontend/.env.local` or the shell before building, e.g. `API_URL=http://127.0.0.1:4000`.

5. **Build, migrate, seed.** The `:dist` commands run the compiled build:

   ```bash
   npm run build
   ```

   ```bash
   npm run migrate:dist
   ```

   First installation only:

   ```bash
   npm run seed:dist
   ```

   The seed creates the roles, master data and the prototype accounts below, all with `SEED_PASSWORD`. Straight after, sign
   in as `admin@ars.local`, change its password, and deactivate or re-password the other prototype accounts in
   *Users & Roles*. Do not re-run the seed on live data without a reason: it resets the Super Admin role to all permissions.

6. **Run** both under a service manager (PM2, NSSM, systemd) so they restart after a reboot:

   ```bash
   npm run start:api
   ```

   ```bash
   npm run start:web
   ```

7. **Uploads.** The web app forwards up to 100 MB per request to the API (`next.config.ts`) and sends CV and mail folders
   in batches below 80 MB. A reverse proxy in front (nginx, IIS) needs a body limit of at least that, e.g. nginx
   `client_max_body_size 100m;`.

8. **Check** `GET /api/health`, sign in, and open a CV preview. Set up the backup below before real CVs arrive.

Updating later: pull, install as in step 2, then `npm run build`, `npm run migrate:dist`, and restart both services.

### Prototype accounts

All seeded users share the password in `SEED_PASSWORD` (`backend/.env`). **Change it before any shared demo.**

| Email | Role |
| --- | --- |
| `admin@ars.local` | Super Admin |
| `requester.ict@ars.local`, `requester.admin@ars.local` | Department (ICT / Administration) |
| `approval.admin@ars.local` | Admin (approves requisitions; one approval is final) |
| `hr.manager@ars.local` | HR Manager (HR Approved Queue, coordinator assignment, every vacancy) |
| `director@ars.local`, `concerned.hr@ars.local`, `aded@ars.local`, `hod.hr@ars.local` | Designated approvers |
| `corporate.hr@ars.local` | Corporate HR (approval + remarks + quota chart) |
| `recruiter@ars.local`, `recruiter2@ars.local` | HR (works only on vacancies they coordinate) |
| `screener@ars.local` | CV Screening User |
| `examiner@ars.local` | Interview / Examiner |
| `viewer@ars.local` | Read-only |

## Tests

```bash
npm test
```

Runs against the `ars_test` database (`TEST_DATABASE_URL` overrides it). `backend/test/rules.spec.ts` covers
screening, extraction, quota and form rules; `backend/test/workflow.e2e-spec.ts` drives the whole workflow
through HTTP and asserts acceptance criteria **AC-01 … AC-27** (AC-28, backup/restore, is the manual procedure below).

## Prototype defaults (SRS 25 — confirm with the business owner)

| Decision | Prototype default | Where to change |
| --- | --- | --- |
| Approval order / mandatory steps | Concerned Director → Concerned HR → Concerned AD/ED → Corporate HR → HOD-HR, all mandatory, one named approver per step, sequential | *Administration → Approval Routes* (department routes override the default) |
| Resubmission after return | No approval-critical change → resume at the returning step (earlier approvals carried forward); any critical change → restart route | `APPROVAL_CRITICAL_FIELDS` in `requisition.service.ts` |
| Requisition ID issued | At draft creation | `REQUISITION_ID_ON=draft\|submit` |
| ID formats | `REQ-YYYY-000001`, `VAC-…`, `JOB-…`, `CAND-000001`, `APP-…`, `IMP-…` | `ID_FORMAT_*` env vars |
| Direct HR vacancy | Enabled, only with `vacancy.create_direct` permission, marked *Direct HR Entry*, reason required | `ALLOW_DIRECT_HR_VACANCY`, role permissions |
| Revised quota | Stays a proposal; applied to the quota list only when Corporate HR sets *Inserted in quota chart? = Yes* after full approval | Corporate HR panel on the requisition |
| Mail intake | HR saves mails as `.eml` files, then chooses that folder on CV Bank → Unmatched CVs or uses the `backend/mail-inbox` folder, and scans. There is no live mailbox connection | `MAIL_INTAKE_DIR` |
| CV formats / size | PDF, DOCX, DOC, TXT; 10 MB. DOC (legacy Word) and scanned PDFs are stored but marked *Failed* for manual review | `ALLOWED_CV_EXTENSIONS`, `MAX_UPLOAD_MB` |
| CV extraction | Deterministic rules (`rules-1.2`): contact, education, CGPA, experience, last position and organization, skills, address, certifications, previous jobs; values only if literally present; GPA normalised only when on a /4 scale | `cv-extractor.ts` |
| Duplicate detection | Same normalised email, same phone (last 10 digits) or identical file → *flagged*; HR chooses merge / keep separate. Never auto-merged | `detectDuplicate()` |
| Screening | Against the requisition's *Specialization required* (a Direct HR vacancy's own): every item written in the CV = Pass, otherwise Review Required | Requisition form, vacancy page |
| Marks | Per exam (written exam, interview board, optional exam) with evaluator & time; written exam and interview board share one day; **no weighted total** until weighting is agreed | Interview Board |
| Joining letter | Optional: template + letter status; sending never marks joined | Email templates |
| Email | Individual sends via SMTP; when `SMTP_HOST` is empty messages go to `backend/storage/outbox/*.eml` and are labelled *dev outbox — not delivered* | `SMTP_*` |
| Company names | Codes from the quota sheets; names marked *(confirm name)* | *Administration → Master Data* |
| Data retention for unsuccessful candidates | Not implemented (policy pending) | — |

## Security & integrity notes

* Every endpoint checks permissions server-side (global `AuthGuard` + `@RequirePerm`); department scope is
  enforced in queries. Auth is an httpOnly cookie (JWT); passwords are bcrypt-hashed.
* Critical writes run in transactions with row locks; unique constraints make vacancy creation, approvals,
  email batches (`clientKey`), marks and joining records idempotent.
* CVs and attachments live in `STORAGE_DIR` outside the web root and are served only through authorised routes.
* The audit log (`audit_events`) is append-only from the application and readable only with `audit.view`.

## Backup and restore (NFR-12 / AC-28)

The database and the storage folder must be backed up **together** (documents are referenced by `storageKey`).

```bash
pg_dump --format=custom --file=ars_backup.dump "$DATABASE_URL"
```

Then archive the storage folder (default `backend/storage/`) with the same timestamp.

To restore into an empty UTF8 database, run `pg_restore`, then copy the storage archive back to `STORAGE_DIR`:

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" ars_backup.dump
```

Verify with `GET /api/health`, then open a candidate's CV preview.

## Short user guide

* **Department Requester:** *Positions & Quota* to maintain present manpower; *Requisitions → New* to fill
  Form No. 01 (save draft any time; submit validates required fields). Returned requests show the approver's
  comment — edit and resubmit. *Print / PDF* produces the signed-off form.
* **Department visibility:** department users see their own department's *Positions & Quota*, *Requisitions*
  (Processing / Approved / Rejected / Returned / Draft / Cancelled) and *Joined Candidates* (no contact details).
  HR and the Super Admin see every department's quotas; HR, Admin and the Super Admin see every requisition.
* **Approver:** *Approver Inbox* lists your current steps (Approve, Return with a comment, Reject with a reason)
  and, view only, requisitions that will reach your step next. Every decision can carry a supporting document
  (PDF, Word or image), shown under that step in the approval history. After the last approval the requisition
  moves to *HR Approved Queue*.
* **Admin / Super Admin (final approval):** `approval.act_on_behalf` lists every department's pending requisitions;
  one approval is final: the remaining steps close as *not required* and the requisition goes to the *HR Approved
  Queue*. History and audit record who decided on behalf of which step. Only the Super Admin
  (`requisition.manage_all`) can edit or submit another department's requisition, or manage configuration.
* **HR Manager:** *HR Approved Queue* → choose the **Coordinator** (any active HR user; new HR accounts appear
  automatically) and *Create vacancy*. The coordinator can be changed on the vacancy page too; every assignment and
  reassignment is audited with old / new coordinator. HR Manager and Super Admin (`recruitment.view_all`) see every
  vacancy, CV and coordinator.
* **HR (coordinator):** sees and works only on the vacancies assigned to them — the API refuses everything else
  (CVs, applications, screening, interviews, emails, joining). In the vacancy: create a
  job post, configure criteria (saved as a new version), publish; upload CVs; review Pass / Review Required /
  Fail with reasons; correct extracted data on the candidate profile; shortlist (override reason needed for
  Fail); send invitations; schedule stages; import marks; record the final decision; send results; then
  *Joining Pending → Verify & approve joining*.
* **Hiring circular:** on a job post, fill location, employment type, shift, salary, key responsibilities and required
  skills (one per line), the CV email and the applicant email subject (the job ID is added so emailed CVs reach the post).
  The *Hiring circular* card downloads a poster-style A4 PDF and a plain-text version, both generated from the saved
  details; drafts are marked "not yet published". Default CV address: `CAREER_EMAIL` in `backend/.env`. To check the
  layout without data: `npx ts-node scripts/sample-circular.ts <folder>` (in `backend/`).
* **Mail folder:** choose a folder of saved `.eml` mails and scan it. Each subject is matched to the circular's position and
  department and the CV joins that vacancy; anything unclear waits in Unmatched CVs.
* **All CVs / Candidate CV Bank:** separate pages for departments, then vacancies, then CVs, with a CV data Excel for each vacancy and search by name /
  Candidate ID / Application ID and a status filter. *Change* moves one application through the normal workflow
  (shortlist, interview, final decision, joining); other applications of the same candidate are not affected.
* **Screening user:** candidate list and profile — correct extracted fields (audited) and add remarks.
* **Examiner:** *Interview / exam / results* tab — attendance, marks, Excel import (overwrites need HR).
* **Users & Roles (Super Admin):** *Users* — create / edit accounts (Basic Information, Role & Department,
  Permissions), reset passwords. The Permissions tab shows every module with View / Create / Edit / Submit / Approve /
  Reject-Return / Export / Manage (Approve and Reject-Return share one permission) plus the module's other rights:
  **Allow** adds a right the user's roles lack, **Deny** removes one they give, so two users with the same role can
  differ. **Access Scope** (Dashboard, Positions & Quota, Requisitions, Joining): Role default, Own Department, All
  Departments or Custom Departments — enforced by the API. *Copy from Permission Template* fills the grid from a saved
  set; *Save as template* stores the current one. *Roles* edits role defaults (and adds roles), *Permissions* lists the
  catalogue with the roles that grant each right, *Permission Templates* manages saved sets. You cannot deny yourself
  Users & Roles or deactivate yourself; every change is audited.
* **Deleting:** *Delete* (beside *Edit*) hides a user and blocks sign-in while past requisitions, approvals and audit
  entries keep their name; the email can be reused. It is refused for yourself, the last Users & Roles administrator, and
  anyone still named in an approval route, with approvals waiting, or coordinating an open vacancy. *Deleted* in the
  status filter lists them with *Restore* (comes back Inactive). Custom roles can be deleted once nobody holds them;
  built-in roles can only be deactivated. On *Permissions*, *Edit* renames a module or permission, adds a description,
  or switches a permission off for everyone (not Users & Roles itself); *Reset to default* undoes it.
* **Super Admin:** users and role matrix, approval routes, master data, email templates, processing monitor
  (retry failed jobs), audit log.

## Repository layout

```
backend/    NestJS API, its own package.json / node_modules
  src/<feature>/         auth, requisitions, vacancies, candidates, cv-bank, evaluation, email,
                         joining, master, processing, screening, system
                         each: <feature>.controller.ts / .service.ts / .dto.ts / .module.ts
  src/common/            auth guard, permissions, scope checks, shared services
  src/config/            typed environment config (reads backend/.env)
  src/database/          entities, migrations, seed
  scripts/ test/         local Postgres launcher, Jest tests
  .pgdata/ storage/ mail-inbox/  local DB data, uploaded files and saved CV mails (git-ignored)
frontend/   Next.js app, its own package.json / node_modules
  src/app/(app)/*        screens
  src/components/ lib/   shared UI, API client, auth
docs/       project documents
package.json  root scripts only (npm --prefix backend|frontend ...)
```
