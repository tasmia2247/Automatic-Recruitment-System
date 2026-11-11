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

## Tests

```bash
npm test
```

Runs against the `ars_test` database (`TEST_DATABASE_URL` overrides it). `backend/test/rules.spec.ts` covers
screening, extraction, quota and form rules; `backend/test/workflow.e2e-spec.ts` drives the whole workflow
through HTTP and asserts acceptance criteria **AC-01 … AC-27** (AC-28, backup/restore, is the manual procedure below).

## Security & integrity notes

* Every endpoint checks permissions server-side (global `AuthGuard` + `@RequirePerm`); department scope is
  enforced in queries. Auth is an httpOnly cookie (JWT); passwords are bcrypt-hashed.
* Critical writes run in transactions with row locks; unique constraints make vacancy creation, approvals,
  email batches (`clientKey`), marks and joining records idempotent.
* CV files are kept alongside the text read from them, so HR can view the original or download a ZIP of selected candidates'
  CVs. Files live in `STORAGE_DIR` outside the web root and are served only through authorised routes.
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
