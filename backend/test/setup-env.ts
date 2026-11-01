// Tests run against a separate database and storage folder, with the background worker driven manually.
import * as dotenv from 'dotenv';
import * as os from 'os';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

// Same server and login as backend/.env unless TEST_DATABASE_URL says otherwise, always on ars_test.
const testUrl = () => {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL (see README).');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/ars_test';
  return url.toString();
};

process.env.DATABASE_URL = testUrl();
process.env.WORKER_ENABLED = 'false';
process.env.SMTP_HOST = '';
process.env.STORAGE_DIR = path.join(os.tmpdir(), 'ars-test-storage');
process.env.JWT_SECRET = 'test-secret';
process.env.SEED_PASSWORD = 'test-seed-password';
