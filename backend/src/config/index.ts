import * as path from 'path';
import * as dotenv from 'dotenv';

// src/config (ts-node) or dist/config (build): the backend folder holds .env and storage/.
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
dotenv.config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });

const env = (key: string, fallback = '') => process.env[key] ?? fallback;
const bool = (key: string, fallback: boolean) => (process.env[key] === undefined ? fallback : process.env[key] === 'true');
/** Credentials have no default in the code: they live only in backend/.env. */
const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set. Add it to backend/.env (see README).`);
  return value;
};

/** Central typed configuration; every value comes from the environment (SRS 21.2). */
export const config = {
  env: env('NODE_ENV', 'development'),
  port: Number(env('PORT', '4000')),
  webUrl: env('WEB_URL', 'http://localhost:3000'),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '8h'),
  storageDir: path.resolve(BACKEND_DIR, env('STORAGE_DIR', './storage')),
  maxUploadBytes: Number(env('MAX_UPLOAD_MB', '10')) * 1024 * 1024,
  allowedCvExtensions: env('ALLOWED_CV_EXTENSIONS', 'pdf,docx,doc,txt').split(',').map((s) => s.trim().toLowerCase()),
  idFormats: {
    REQ: env('ID_FORMAT_REQUISITION', 'REQ-{YYYY}-{SEQ:6}'),
    VAC: env('ID_FORMAT_VACANCY', 'VAC-{YYYY}-{SEQ:6}'),
    JOB: env('ID_FORMAT_JOBPOST', 'JOB-{YYYY}-{SEQ:6}'),
    CAND: env('ID_FORMAT_CANDIDATE', 'CAND-{SEQ:6}'),
    APP: env('ID_FORMAT_APPLICATION', 'APP-{YYYY}-{SEQ:6}'),
    IMP: env('ID_FORMAT_IMPORT', 'IMP-{YYYY}-{SEQ:5}'),
  } as Record<string, string>,
  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '587')),
    secure: bool('SMTP_SECURE', false),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    from: env('MAIL_FROM', 'Ananta HR <hr@example.com>'),
  },
  workerIntervalMs: Number(env('WORKER_INTERVAL_MS', '3000')),
  workerEnabled: bool('WORKER_ENABLED', true),
  allowDirectHrVacancy: bool('ALLOW_DIRECT_HR_VACANCY', true),
  requisitionIdOn: env('REQUISITION_ID_ON', 'draft') as 'draft' | 'submit',
  seedPassword: env('SEED_PASSWORD'),
  /** Default "Send your CV to" address printed on generated hiring circulars. */
  careerEmail: env('CAREER_EMAIL', 'career@ananta.com.bd'),
};
