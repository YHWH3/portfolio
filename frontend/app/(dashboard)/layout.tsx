'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import { getAccessToken } from '@/lib/api';
import { WsProvider } from '@/lib/ws';
import { PageLoader } from '@/components/Spinner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/auth/login');
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return <PageLoader label="Loading workspace…" />;
  }

  return (
    <WsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </WsProvider>
  );
}
