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
      { href: '/interviews', label: 'Interview', perm: P.CANDIDATE_VIEW },
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
    section: 'Reports & Analytics', items: [
      { href: '/reports', label: 'Recruitment Dashboard', perm: P.REPORTS_VIEW },
      { href: '/reports/reports', label: 'Recruitment Reports', perm: P.REPORTS_VIEW },
    ],
  },
  {
    section: 'Administration', items: [
      { href: '/admin/users', label: 'Users & Roles', perm: P.USER_MANAGE },
      { href: '/admin/audit', label: 'Logs', perm: P.AUDIT_VIEW },
    ],
  },
];

/** Small line icons for the menu (24-unit paths, drawn with the current colour). */
const ICON: Record<string, string> = {
  '/': 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  '/quotas': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  '/requisitions': 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6',
  '/approvals': 'M4 13l4 4L20 5',
  '/hr-queue': 'M4 6h16M4 12h16M4 18h10',
  '/vacancies': 'M3 7h18v13H3zM8 7V4h8v3',
  '/interviews': 'M8 3v3M16 3v3M3 8h18M4 5h16v16H4zM8 13h3v3H8z',
  '/joining': 'M15 12H3M10 7l5 5-5 5M21 4v16',
  '/joined': 'M16 11a4 4 0 1 0-8 0M4 21c1-4 4-6 8-6s7 2 8 6M17 7l2 2 3-3',
  '/cv-bank': 'M4 4h12l4 4v12H4zM8 12h8M8 16h5',
  '/admin/master': 'M4 6h16M4 12h16M4 18h16M8 4v4M14 10v4M10 16v4',
  '/admin/templates': 'M3 6h18v12H3zM3 7l9 6 9-6',
  '/admin/users': 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c1-4 4-6 7-6s6 2 7 6M17 11a3 3 0 1 0 0-6M22 21c-.5-3-2-4.5-4-5',
  '/admin/audit': 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  '/reports': 'M3 20h18M6 20V10M12 20V4M18 20v-7',
  '/reports/reports': 'M7 3h10v18H7zM10 7h4M10 11h4M10 15h4',
};
const NavIcon = ({ href }: { href: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
    <path d={ICON[href] ?? 'M4 12h16'} />
  </svg>
);
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

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
      <aside className={cx('no-print fixed inset-y-0 left-0 z-30 w-64 transform border-r border-line bg-white transition lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', menu ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ananta-logo.png" alt="Ananta" className="h-12 w-12 shrink-0 object-contain" />
          <div>
            <div className="text-sm font-semibold leading-tight">Ananta ARS</div>
            <div className="text-[11px] text-muted leading-tight">Automatic Recruitment System</div>
          </div>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto px-3 py-4">
          {visible.map((s) => (
            <div key={s.section} className="mb-4">
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{s.section}</div>
              {s.items.map((i) => (
                <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}
                  className={cx('relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    active(i.href) ? 'bg-brand-50 font-medium text-brand-700 before:absolute before:inset-y-1 before:-left-3 before:w-1 before:rounded-r before:bg-brand-600' : 'text-slate-600 hover:bg-slate-50 hover:text-ink')}>
                  <NavIcon href={i.href} />
                  <span className="truncate">{i.label}</span>
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
          <div className="hidden h-8 w-px bg-line sm:block" />
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white" aria-hidden="true">{initials(user.name)}</span>
            <div className="hidden text-left text-sm leading-tight sm:block">
              <div className="font-medium">{user.name}</div>
              <div className="max-w-[16rem] truncate text-xs text-muted">{user.roles.map((r) => r.name).join(', ')}{user.department ? ` · ${user.department.name}` : ''}</div>
            </div>
          </div>
          <button onClick={logout} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-slate-50">Sign out</button>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
