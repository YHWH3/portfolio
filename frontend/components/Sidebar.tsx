'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/drafts', label: 'Drafts', icon: '✍️' },
  { href: '/campaigns', label: 'Campaigns', icon: '🚀' },
  { href: '/inbox', label: 'Inbox', icon: '💬' },
  { href: '/leads', label: 'Leads', icon: '👥' },
  { href: '/knowledge', label: 'Knowledge', icon: '📚' },
  { href: '/safety', label: 'Safety', icon: '🛡️' },
  { href: '/analytics', label: 'Analytics', icon: '📈' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-slate-950 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-900/40">
          LC
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight text-white">
            Outreach Copilot
          </p>
          <p className="text-[11px] text-slate-500">LinkedIn for B2B teams</p>
        </div>
      </div>
      <p className="mt-2 px-6 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Workspace
      </p>
      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-white/5 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-500" />
              )}
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
        Human-in-the-loop outreach.
        <br />
        AI drafts, you approve.
      </div>
    </aside>
  );
}
