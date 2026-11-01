# Running ARS with Docker

Production runs on Ubuntu Server. Local development has hot reload. Both are managed with Docker Compose.

**Docker PostgreSQL is the single development database.** See [Development database](#development-database).

## Test status

**Development stack: run on real Docker on 2026-11-01** (Docker Desktop on Windows, Compose 5.6.1). **Production stack: not run yet.**

| Checked on Docker, `docker-compose.dev.yml` | Result |
| --- | --- |
| `docker compose config`, image builds, `up --build -d` | Passed |
| `db`, `api` and `web` healthy; `migrate` exited 0 with 7 migrations applied to a new, empty database | Passed |
| PostgreSQL 18.6, UTF8, data inside the volume; API connects to it | Passed |
| Web reaches the API, both from the browser and between containers | Passed |
| Files in the storage volume and the database survive recreating their containers | Passed |
| A second `migrate` run reports nothing pending | Passed |
| No env file or `.pgdata` in the images; containers run as `node` | Passed |
| Existing data moved in by dump and restore, compared table by table with the source | Passed |
| Sign-in through the web app with existing users; CV and attachment downloads | Passed |
| New CV upload and download, on a throwaway copy of the data; files survive recreating the API container | Passed |
| API and web hot reload with Compose Watch on Windows | Passed |
| All 40 callable GET routes and 24 web pages, on the copy | Passed (`/api/job-posts/:id/circular` returns 404 because no post has an attached circular) |
| All 63 tests inside the `api` container | Passed |
| Database and documents survive `restart`, `stop`, `down` without `-v`, and a Docker Desktop restart | Passed |
| Hot reload of a `package.json` change (image rebuild) | **Not run** |

Checked earlier without Docker, in a clean copy of the project on Windows:

| Checked | Result |
| --- | --- |
| Every Dockerfile build step, with only the files the Docker context sends | Passed |
| Production run with runtime packages only: migrate, seed, API, web, both health check commands | Passed |
| Through the web proxy: sign-in, HTTPS-only cookie, direct vacancy, CV upload to storage | Passed |
| PDF circular, PDF CV reading, Excel | Passed |
| Dev commands, and hot reload of the API and web app | Passed |
| All 63 tests with no `backend/.env` | Passed |
| Moving a copy of the existing data: dump, restore, row counts, no pending migrations | Passed |
| Compose files: YAML, references, networks, volumes, build targets, ignore rules | Passed |

**Check these on the first production run:**

1. The production images build.
2. All services reach `healthy` in `docker compose ps`.
3. HTTPS works through Caddy and you can sign in.
4. Data survives `docker compose down` followed by `up -d`.

## What runs

| Service | Image | Purpose | Reachable from |
| --- | --- | --- | --- |
| `caddy` | `caddy:2-alpine` | HTTPS, the only public entry point | Ports 80 and 443 |
| `web` | `ars-web` | Next.js app; proxies `/api/*` to the API | Caddy |
| `api` | `ars-api` | NestJS API and background worker | Web |
| `db` | `postgres:18-bookworm` | PostgreSQL, UTF8 | API, on a network with no internet access |
| `migrate` | `ars-api` | Applies pending migrations, then exits. Runs before the API on every `up` | One-shot |
| `seed` | `ars-api` | Creates roles, master data and prototype users. Run by hand on first install only | One-shot |

| Volume | Holds |
| --- | --- |
| `ars_db_data` | The database |
| `ars_api_storage` | CVs, attachments, generated circulars, email outbox |
| `ars_caddy_data`, `ars_caddy_config` | HTTPS certificates and keys |

Development uses separate `ars-dev_*` volumes, so the two stacks never share data.

**HTTPS is required in production.** The login cookie is HTTPS-only when `NODE_ENV=production`, so signing in fails on plain
HTTP from any address except `localhost`.

## Environment file

Compose reads one `.env` file beside `docker-compose.yml`. **It is never committed**, and there is no example file in the
repository, so create it on each machine. These commands generate new secrets. Use letters and numbers only for
`DB_PASSWORD`, because it goes inside a URL.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SITE_ADDRESS` | Production | Domain or IP address of the server, for example `ars.ananta.com.bd` |
| `DB_PASSWORD` | Yes | Database password. Changing it later does not change an existing database |
| `JWT_SECRET` | Yes | Signs login sessions. Changing it signs everyone out |
| `SEED_PASSWORD` | First install | Password given to the seeded prototype users |
| `DB_USER`, `DB_NAME` | No | Default to `ars` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | For real email | With no `SMTP_HOST`, emails go to the storage outbox and are **not delivered** |
| `CAREER_EMAIL`, `MAX_UPLOAD_MB`, `ALLOW_DIRECT_HR_VACANCY`, and others | No | Every other setting and its default is in `backend/src/config/index.ts` |

## Production on Ubuntu Server

### First install

Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

Let your user run Docker, then sign out and back in:

```bash
sudo usermod -aG docker $USER
```

Open only SSH and web traffic:

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 80,443/tcp
```

```bash
sudo ufw enable
```

Get the code, then run the remaining commands from the project folder:

```bash
git clone https://github.com/tasmia2247/Automatic-Recruitment-System.git ars
```

```bash
cd ars
```

Create `.env`, replacing the address with yours:

```bash
cat > .env <<EOF
SITE_ADDRESS=ars.example.com
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
SEED_PASSWORD=$(openssl rand -hex 12)
EOF
```

```bash
chmod 600 .env
```

Build and start everything:

```bash
docker compose up -d --build
```

Load roles, master data and users. This is for a new, empty database only. If you are moving existing data, skip it and follow
[Moving the development data to production](#moving-the-development-data-to-production):

```bash
docker compose --profile tools run --rm seed
```

Check that every service is `healthy`:

```bash
docker compose ps
```

Open `https://<SITE_ADDRESS>`. Sign in with a seeded account and the `SEED_PASSWORD` from `.env`, then change the password.

### HTTPS

| `SITE_ADDRESS` | Certificate | What you need |
| --- | --- | --- |
| Public domain | Let's Encrypt, automatic | DNS pointing at the server; ports 80 and 443 reachable from the internet |
| IP address, or a `.local` / `.internal` name | Caddy's own CA | Browsers warn until the root certificate is installed on each PC |

Export the root certificate for office PCs:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > backups/ars-root.crt
```

### Daily commands

| Task | Command |
| --- | --- |
| Start | `docker compose up -d` |
| Stop, keeping all data | `docker compose down` |
| Restart one service | `docker compose restart api` |
| Status and health | `docker compose ps` |
| Follow logs | `docker compose logs -f api web` |
| Open a shell in the API | `docker compose exec api sh` |
| Open the database | `docker compose exec db psql -U ars ars` |
| CPU and memory use | `docker stats` |

**Never add `-v` to `docker compose down` on a server.** It deletes the database and all CVs.

### Updating

Take a [backup](#backup-and-restore) first, then:

```bash
git pull
```

```bash
docker compose up -d --build
```

This rebuilds the changed images, applies new migrations, and replaces the containers. Users see a short interruption.

Update PostgreSQL and Caddy within their versions:

```bash
docker compose pull db caddy
```

```bash
docker compose up -d
```

Remove old images afterwards:

```bash
docker image prune -f
```

**To roll back:** run `git checkout <previous-commit>` and `docker compose up -d --build`. Migrations are not undone by this, so if
the update changed the database, restore the backup as well.

### Backup and restore

Back up the database and storage **together**, because documents are referenced from the database. `backups/` is ignored by git
and Docker, but it holds personal data, so copy it off the server to a safe place.

```bash
mkdir -p backups
```

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/ars-$(date +%F).dump
```

```bash
docker compose exec -T api tar czf - -C /app/backend storage > backups/storage-$(date +%F).tgz
```

To restore, stop the app, load both files, and start again. Use your own file names:

```bash
docker compose stop web api
```

```bash
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < backups/ars-2026-11-01.dump
```

```bash
docker compose run --rm -T --no-deps -v ars_api_storage:/app/backend/storage api tar xzf - -C /app/backend < backups/storage-2026-11-01.tgz
```

```bash
docker compose up -d
```

Verify by opening a candidate's CV preview.

### Moving the development data to production

Run these two commands on the development PC, from the project folder, with the development stack running:

```bash
docker compose -f docker-compose.dev.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/ars.dump
```

```bash
docker compose -f docker-compose.dev.yml exec -T api tar czf - -C /app/backend storage > backups/storage.tgz
```

Copy `ars.dump` and `storage.tgz` to `backups/` on the server. Create `.env`, then start only the database:

```bash
docker compose up -d --build db
```

```bash
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < backups/ars.dump
```

Start the rest. Do not run `seed`.

```bash
docker compose up -d --build
```

```bash
docker compose exec -T api tar xzf - -C /app/backend < backups/storage.tgz
```

Delete `ars.dump` and `storage.tgz` from the development PC when you have confirmed the move.

## Development database

Docker PostgreSQL is the single source of truth for ARS development. The API, migrations and every host command use it.

| Setting | Value |
| --- | --- |
| Container | `ars-dev-db-1` (`postgres:18-bookworm`, PostgreSQL 18.6, UTF8, locale C) |
| Database and user | `ars` and `ars`; the password is `DB_PASSWORD` in the root `.env` |
| Database volume | `ars-dev_db_data`, mounted at `/var/lib/postgresql` |
| Document volume | `ars-dev_api_storage`, mounted at `/app/backend/storage` |
| API inside Docker | `postgres://ars:<DB_PASSWORD>@db:5432/ars`, set in `docker-compose.dev.yml` |
| Commands run on this PC, and pgAdmin | `postgres://ars:<DB_PASSWORD>@127.0.0.1:55432/ars`, set in `backend/.env` |

**Never run `docker compose -f docker-compose.dev.yml down -v`.** These volumes are the only live copy of the data.
Do not run `seed` here either: the database already holds ARS data, and seed can bring back deleted records.

### Migration record, 2026-11-01

The local database in `backend/.pgdata` (PostgreSQL 18.4) and the files in `backend/storage` were moved here.

| Item | Result |
| --- | --- |
| Method | `pg_dump` and `pg_restore`, from a temporary snapshot of `.pgdata`, so the original was never started |
| Switch-over | Restored to a new database, compared, then renamed to `ars` in one transaction |
| Database comparison | 39 tables and 292 rows, identical in row counts and row content; all columns, 365 constraints, 96 indexes, sequences and 7 migrations identical; 33 foreign keys with no orphans |
| Documents | 7 files, every path and checksum identical; all 4 database references found |

- **Old local data:** `backend/.pgdata` and `backend/storage` are retired and were left unchanged. `npm run db:local` remains only
  to open that old copy. It is not part of development.
- **Previous Docker database:** the seed-only database is kept as `ars_pre_migration` in the same container. Nothing uses it.
- **Backups:** `backups/2026-11-01-migration/` holds dumps of both databases, both storage areas, and checksums in `SHA256SUMS`. It is
  ignored by git and Docker, and holds personal data, so keep a copy somewhere safe.
- **Sign-in:** migrated accounts keep the passwords they had in the old database. `SEED_PASSWORD` in the root `.env` does not sign in to them.

## Local development with hot reload

You need Docker Desktop on Windows, or Docker Engine on Linux, with Compose 2.22 or later. Stop any ARS already running through npm,
because ports 3000 and 4000 are used here too.

Start the stack:

```bash
docker compose -f docker-compose.dev.yml up --build --watch
```

Open http://localhost:3000. Saved changes in `backend/src`, `backend/test` and `frontend/src` are copied into the containers and
reload the app. Changing a `package.json` or lock file rebuilds that image.

| Task | Command |
| --- | --- |
| Start without hot reload | `docker compose -f docker-compose.dev.yml up -d` |
| Stop, keeping all data | `docker compose -f docker-compose.dev.yml stop` |
| Restart | `docker compose -f docker-compose.dev.yml restart` |
| Check status | `docker compose -f docker-compose.dev.yml ps` |
| Apply a new migration | `docker compose -f docker-compose.dev.yml run --rm migrate` |
| Follow logs | `docker compose -f docker-compose.dev.yml logs -f api` |

On a new PC, create `.env` first with the production commands in Git Bash (`SITE_ADDRESS` is not used here). Then either restore the
data, or run `docker compose -f docker-compose.dev.yml --profile tools run --rm seed` once on the empty database.

The database is available to pgAdmin on this PC only, at `localhost:55432`. Set `DB_PORT` in `.env` to change the port.

The development containers do not start by themselves. After restarting Docker Desktop or the PC, run `up -d` again.

Tests use `ars_test` and wipe it each time, and never touch `ars`. That database already exists on this PC, so run:

```bash
docker compose -f docker-compose.dev.yml exec api npm test
```

On a new PC, create it once first:

```bash
docker compose -f docker-compose.dev.yml exec db createdb -U ars ars_test
```

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `Set DB_PASSWORD in .env` | `.env` is missing or incomplete, or you are not in the project folder |
| Sign-in does nothing | The site was opened over HTTP. Use `https://` |
| `password authentication failed` | `DB_PASSWORD` was changed after the database was created. Restore the old value, or change it in PostgreSQL too |
| `migrate` failed, `api` will not start | Run `docker compose logs migrate`. The API starts only after migrations succeed |
| Certificate error on a domain | Check DNS and ports 80 and 443, then run `docker compose logs caddy` |
| Port 80 or 443 already in use | Another web server is running. Stop it, for example `sudo systemctl disable --now nginx` |
| Emails not delivered | `SMTP_HOST` is empty, so they are in the storage outbox. Set the SMTP values in `.env`, then run `docker compose up -d` |
| Hot reload does nothing | Start with `--watch`, and check `docker compose version` is 2.22 or later |
| `dependency api failed to start` | The web app did not start. Seen once in 11 starts after `down`, cause unknown. Run `up -d` again |
| Web calls the wrong API | The `/api` target is fixed when the web image is built. Rebuild it with `docker compose build web` |
