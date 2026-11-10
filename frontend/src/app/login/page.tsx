'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const LOGO = '/ananta-logo.png';

/** What ARS does, shown beside the sign-in form. */
const FEATURES = [
  { title: 'Manpower requisitions', text: 'Raise, approve and track requisitions against the quota.' },
  { title: 'CV screening & ranking', text: 'Every CV read, matched to the job and ranked for HR.' },
  { title: 'Interviews to joining', text: 'Schedule, mark, decide and confirm joining in one place.' },
];

const fieldCls = 'w-full rounded-lg border border-line bg-white py-2.5 pl-10 pr-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

function MailIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
}
function LockIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}
function EyeIcon({ off }: { off: boolean }) {
  return off
    ? <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2.5 12 2.5 12s3.5 7 9.5 7a9.5 9.5 0 0 0 4.3-1" /></svg>
    : <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function Check() {
  return <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>;
}

/** The dashed globe of the Ananta logo, drawn large and faint behind the brand panel. */
function Globe({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="5 5" className={className}>
      <circle cx="100" cy="100" r="90" />
      <ellipse cx="100" cy="100" rx="45" ry="90" />
      <path d="M100 10v180M10 100h180M22 55h156M22 145h156" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    try {
      await api('/auth/login', { body: { email: email.trim(), password } });
      await refresh();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('/login') ? next : '/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const capsCheck = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">Email</label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"><MailIcon /></span>
          <input id="email" type="email" autoComplete="username" autoFocus placeholder="name@ananta.com.bd" className={fieldCls}
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">Password</label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"><LockIcon /></span>
          <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" className={`${fieldCls} pr-11`}
            value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={capsCheck} onKeyDown={capsCheck} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
            className="absolute inset-y-0 right-1.5 my-1.5 flex items-center rounded-md px-2 text-slate-400 hover:bg-slate-100 hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
            <EyeIcon off={show} />
          </button>
        </div>
        {caps && <p className="mt-1.5 text-xs text-amber-700">Caps Lock is on.</p>}
      </div>
      <Alert>{error}</Alert>
      <Button type="submit" busy={busy} className="w-full justify-center py-2.5 text-sm font-semibold shadow-sm">Sign in</Button>
      <p className="text-center text-xs text-muted">Forgot your password? Ask your ARS administrator to reset it.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-white">
      {/* Brand panel (wide screens) */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-900 via-[#1d3f86] to-[#2f63b6] p-10 text-white lg:flex xl:p-14">
        <Globe className="absolute -right-24 -top-16 h-[460px] w-[460px] text-white/10" />
        <Globe className="absolute -bottom-32 -left-24 h-[380px] w-[380px] text-white/[0.06]" />
        <div className="relative flex items-center gap-4">
          <div className="rounded-2xl bg-white p-2 shadow-xl shadow-black/20 ring-1 ring-white/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="Ananta: Making a world of fashion" className="h-24 w-24 object-contain" />
          </div>
          <div>
            <div className="text-xl font-semibold leading-tight">Ananta ARS</div>
            <div className="text-sm text-white/70">Automatic Recruitment System</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Making a world of fashion</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight xl:text-4xl">Hiring the people behind every collection.</h2>
          <p className="mt-4 text-sm leading-relaxed text-white/75">From the first requisition to the first day at work: one system for Ananta&apos;s HR, approvers and hiring teams.</p>
          <ul className="mt-8 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-white"><Check /></span>
                <div><div className="text-sm font-medium">{f.title}</div><div className="text-sm text-white/65">{f.text}</div></div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-xs text-white/50">© {new Date().getFullYear()} Ananta Companies. For authorised staff only.</div>
      </aside>

      {/* Sign-in */}
      <main className="flex flex-1 flex-col bg-gradient-to-b from-canvas to-white lg:bg-none">
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[400px]">
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <div className="rounded-2xl bg-white p-2 shadow-lg shadow-slate-200/80 ring-1 ring-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO} alt="Ananta: Making a world of fashion" className="h-24 w-24 object-contain" />
              </div>
              <div className="mt-2 text-lg font-semibold">Ananta ARS</div>
              <div className="text-xs text-muted">Automatic Recruitment System</div>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8 lg:border-0 lg:p-0 lg:shadow-none">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
              <p className="mb-7 mt-1 text-sm text-muted">Sign in with your Ananta work account.</p>
              <Suspense><LoginForm /></Suspense>
            </div>
          </div>
        </div>
        <div className="px-4 pb-6 text-center text-xs text-muted lg:hidden">© {new Date().getFullYear()} Ananta Companies. For authorised staff only.</div>
      </main>
    </div>
  );
}
