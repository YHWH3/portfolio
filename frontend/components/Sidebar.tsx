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
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          LO
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">Outreach Copilot</p>
          <p className="text-[11px] text-slate-400">LinkedIn for B2B teams</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[11px] text-slate-500">
        Human-in-the-loop outreach.
        <br />
        AI drafts, you approve.
      </div>
    </aside>
  );
}
