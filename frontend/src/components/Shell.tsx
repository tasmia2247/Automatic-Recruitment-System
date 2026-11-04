'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '@/lib/api';
import { P, useAuth } from '@/lib/auth';
import { cx, Loading } from './ui';

type NavItem = { href: string; label: string; perm?: string; anyPerm?: string[]; perms?: string[] };

const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Overview', items: [{ href: '/', label: 'Dashboard' }] },
  {
    section: 'Manpower', items: [
      { href: '/quotas', label: 'Positions & Quota', perm: P.QUOTA_VIEW },
      { href: '/requisitions', label: 'Requisitions', perm: P.REQ_VIEW },
      { href: '/approvals', label: 'Approver Inbox', perm: P.APPROVAL_ACT },
    ],
  },
  {
    section: 'Recruitment', items: [
      { href: '/hr-queue', label: 'HR Approved Queue', perm: P.HR_QUEUE },
      { href: '/vacancies', label: 'Vacancies & Candidates', perm: P.VACANCY_VIEW },
      { href: '/interviews', label: 'Interview Board', perm: P.CANDIDATE_VIEW },
      { href: '/joining', label: 'Joining Pending', perm: P.JOINING_VIEW },
      { href: '/joined', label: 'Joined Candidates', perm: P.JOINED_VIEW },
      { href: '/cv-bank', label: 'All CVs / Candidate CV Bank', perm: P.CANDIDATE_VIEW },
    ],
  },
  {
    // Lists and texts the rest of ARS picks from.
    section: 'Predefined Fields', items: [
      { href: '/admin/master', label: 'Master Data', perm: P.MASTER_CONFIGURE },
      { href: '/admin/templates', label: 'Email Templates', perm: P.TEMPLATE_MANAGE },
    ],
  },
  {
    section: 'Administration', items: [
      { href: '/admin/users', label: 'Users & Roles', perm: P.USER_MANAGE },
      { href: '/admin/routes', label: 'Approval Routes', perm: P.APPROVAL_ROUTE_CONFIGURE },
      { href: '/admin/audit', label: 'Audit Log', perm: P.AUDIT_VIEW },
    ],
  },
];

function Bell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: any[]; unread: number } | null>(null);
  const load = () => api('/notifications').then(setData).catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  const read = async (n: any) => {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' });
    setOpen(false);
    load();
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="relative rounded-md p-2 text-muted hover:bg-slate-100" aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {!!data?.unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-lg border border-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-semibold">
            Notifications
            <button className="text-xs font-normal text-brand-700" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); load(); }}>Mark all read</button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <div className="p-4 text-sm text-muted">No notifications.</div>}
            {data?.items.map((n) => (
              <Link key={n.id} href={n.link ?? '/'} onClick={() => read(n)} className={cx('block border-b border-line px-3 py-2 text-sm hover:bg-slate-50', !n.readAt && 'bg-brand-50/60')}>
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="text-xs text-muted">{n.body}</div>}
                <div className="mt-0.5 text-[11px] text-muted">{fmtDateTime(n.createdAt)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, loading, can, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, pathname, router]);
  useEffect(() => setMenu(false), [pathname]);

  if (loading || !user) return <div className="p-8"><Loading /></div>;

  const visible = NAV.map((s) => ({ ...s, items: s.items.filter((i) => (!i.perm || can(i.perm)) && (!i.perms || can(...i.perms))) })).filter((s) => s.items.length);
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-screen lg:flex">
      <aside className={cx('no-print fixed inset-y-0 left-0 z-30 w-64 transform border-r border-line bg-white transition lg:static lg:translate-x-0', menu ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">A</div>
          <div>
            <div className="text-sm font-semibold leading-tight">Ananta ARS</div>
            <div className="text-[11px] text-muted leading-tight">Automatic Recruitment System</div>
          </div>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto p-3">
          {visible.map((s) => (
            <div key={s.section} className="mb-4">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.section}</div>
              {s.items.map((i) => (
                <Link key={i.href} href={i.href} className={cx('block rounded-md px-2 py-1.5 text-sm', active(i.href) ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink hover:bg-slate-50')}>
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {menu && <div className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" onClick={() => setMenu(false)} />}
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className="rounded-md p-2 hover:bg-slate-100 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu">☰</button>
          <div className="flex-1" />
          <Bell />
          <div className="text-right text-sm leading-tight">
            <div className="font-medium">{user.name}</div>
            <div className="text-xs text-muted">{user.roles.map((r) => r.name).join(', ')}{user.department ? ` · ${user.department.name}` : ''}</div>
          </div>
          <button onClick={logout} className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-slate-50">Sign out</button>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
