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
const EmbeddedPostgres = require('embedded-postgres').default;

const port = Number(process.env.LOCAL_PG_PORT || 54329);
const dataDir = path.resolve(__dirname, '..', '.pgdata');

async function main() {
  if (process.env.LOCAL_PG_RESET === '1' && fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'ars',
    password: 'ars_local_dev',
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
  console.log(`Local PostgreSQL ready: postgres://ars:ars_local_dev@localhost:${port}/ars (and /ars_test)`);
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
