'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Alert>{error}</Alert>
      <Button type="submit" busy={busy} className="w-full">Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-canvas p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">A</div>
          <div>
            <h1 className="font-semibold">Ananta ARS</h1>
            <p className="text-xs text-muted">Automatic Recruitment System</p>
          </div>
        </div>
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
