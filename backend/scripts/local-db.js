/**
 * Starts a throwaway local PostgreSQL (real Postgres binaries via the
 * `embedded-postgres` package) for development and automated tests when no
 * PostgreSQL credentials are available. Production must use DATABASE_URL.
 *
 *   node scripts/local-db.js            -> starts on LOCAL_PG_PORT (default 54329)
 *   LOCAL_PG_RESET=1 node scripts/...   -> wipes the data directory first
 */
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const EmbeddedPostgres = require('embedded-postgres').default;

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const port = Number(process.env.LOCAL_PG_PORT || 54329);
const dataDir = path.resolve(__dirname, '..', '.pgdata');
// The pg_ctl / postgres binaries that embedded-postgres ships: we call pg_ctl directly for a proper fast shutdown
// on Windows (owner, 2026-11-11). The package's own `.stop()` uses `taskkill /F /T`, which force-kills postgres
// without releasing the shared memory segment — the exact cause of the "pre-existing shared memory block is still
// in use" error that was blocking every second start on this machine.
const binDir = path.resolve(__dirname, '..', 'node_modules', '@embedded-postgres',
  process.platform === 'win32' ? 'windows-x64' : (process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64'), 'native', 'bin');
const pgCtl = path.join(binDir, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');

/**
 * Remove any orphan postgres processes that previously ran on this data directory (owner, 2026-11-11). On Windows the
 * embedded-postgres package starts postgres.exe as a child of node, and when the parent terminal is closed abruptly the
 * children orphan and keep the shared memory block, which blocks the next start with "pre-existing shared memory block is
 * still in use". This clean-up targets ONLY the postgres.exe whose command line references this `.pgdata` directory, so
 * other users' Postgres on the same machine is untouched. Fails open: if a process is owned by another user we cannot
 * kill it and the usual error surfaces to the console with a hint.
 */
function cleanupOrphans() {
  if (process.platform !== 'win32') return; // Linux/Mac: embedded-postgres cleans up via SIGCHLD; no fix needed.
  try {
    // WMIC reads command lines; ignore its `No Instance(s) Available.` on an empty match.
    const out = execSync('wmic process where "name=\'postgres.exe\'" get ProcessId,CommandLine /format:csv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = [];
    for (const line of out.split(/\r?\n/)) {
      const cols = line.split(',');
      if (cols.length < 3) continue;
      const cmdline = cols[1] || '';
      const pid = (cols[2] || '').trim();
      // Match this data directory in the command line; postgres is started with -D "<dataDir>" by embedded-postgres.
      if (pid && /^\d+$/.test(pid) && cmdline.toLowerCase().includes(dataDir.toLowerCase())) pids.push(pid);
    }
    if (!pids.length) return;
    console.log(`Cleaning up ${pids.length} orphan postgres process${pids.length === 1 ? '' : 'es'} from a previous run…`);
    const failed = [];
    for (const pid of pids) {
      // /T kills the tree (any worker that postgres forked), /F forces it. We capture the output so an Access-Denied
      // failure (process owned by another Windows user) is reported with a clear hint rather than disappearing silently.
      const r = spawnSync('taskkill', ['/F', '/T', '/PID', pid], { encoding: 'utf8' });
      if (r.status !== 0) { failed.push(pid); console.warn(`  PID ${pid}: ${(r.stderr || r.stdout || 'kill failed').trim()}`); }
    }
    if (failed.length) {
      console.warn(`\n${failed.length} process${failed.length === 1 ? '' : 'es'} could not be killed. Open an Administrator PowerShell and run: taskkill /F /IM postgres.exe\n`);
    }
    try { fs.rmSync(path.join(dataDir, 'postmaster.pid'), { force: true }); } catch { /* not there */ }
    // Give Windows up to ~3 seconds to release the shared memory segment before we start a fresh postmaster.
    const until = Date.now() + 3000;
    while (Date.now() < until) {
      const still = execSync('wmic process where "name=\'postgres.exe\'" get ProcessId /format:csv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/).filter((l) => /,\d+\s*$/.test(l)).length;
      if (!still) break;
      // Busy wait: a short pause is fine here (startup only).
      const end = Date.now() + 200; while (Date.now() < end) {}
    }
  } catch (e) {
    // wmic missing (Windows 11 24H2+) or some other failure: don't block the start, let postgres report the real error.
    console.warn(`Orphan clean-up skipped: ${e.message}`);
  }
}

async function main() {
  // The password comes from DATABASE_URL in backend/.env, never from the code.
  const password = decodeURIComponent(new URL(process.env.DATABASE_URL || 'postgres://x').password);
  if (!password) throw new Error('DATABASE_URL with a password is not set. Add it to backend/.env (see README).');
  if (process.env.LOCAL_PG_RESET === '1' && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  cleanupOrphans();
  const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'ars',
    password,
    port,
    persistent: true,
    // Force UTF-8: on Windows initdb otherwise inherits WIN1252, which rejects Bangla text.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) {
    await pg.createDatabase('ars');
    await pg.createDatabase('ars_test');
  }
  console.log(`Local PostgreSQL ready on port ${port} (databases ars and ars_test)`);

  // Clean shutdown via pg_ctl (owner, 2026-11-11): sends SIGTERM / graceful shutdown to the postmaster so it
  // closes connections, flushes WAL, removes postmaster.pid and releases the shared memory segment. This
  // replaces the package's own `.stop()` which uses `taskkill /F /T` — a force-kill that leaves the shared
  // memory block held, orphaning worker processes and blocking the next start of the same data directory.
  let stopping = false;
  const shutdown = (why) => {
    if (stopping) return;
    stopping = true;
    try {
      const r = spawnSync(pgCtl, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '10'], { encoding: 'utf8' });
      if (r.status !== 0) {
        console.warn(`pg_ctl stop (${why}) failed:`, (r.stderr || r.stdout || '').trim());
        // Fall back to the package's own stop so we at least try to kill the child.
        pg.stop().catch(() => undefined);
      } else {
        console.log(`PostgreSQL stopped cleanly (${why}).`);
      }
    } catch (e) {
      console.warn(`pg_ctl stop (${why}) errored:`, e.message);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows: a Ctrl-Break in the console comes in as SIGBREAK, and a parent death may close the console; both
  // get the same graceful stop.
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

main().catch((e) => { console.error(e); process.exit(1); });
