// Tests run against a separate database and storage folder, with the background worker driven manually.
import * as os from 'os';
import * as path from 'path';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://ars:ars_local_dev@localhost:54329/ars_test';
process.env.WORKER_ENABLED = 'false';
process.env.SMTP_HOST = '';
process.env.STORAGE_DIR = path.join(os.tmpdir(), 'ars-test-storage');
process.env.JWT_SECRET = 'test-secret';
